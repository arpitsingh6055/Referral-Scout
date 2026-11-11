import { networkPageCommand, profileUrl, type NetworkPageCommand } from "../shared/network";
import { ownProfileEditLink, readNetworkProfile, networkPeople, profileHeader, topCardFacts, textOf } from "../parsers/network";
import { visible, wait, sleep, guard, insert, readEditor, sameText, queryAll } from "./dom";

/*
 * Actions on LinkedIn pages. Controls are found by their visible label or aria-label,
 * never by class name, because LinkedIn's class names are generated and change.
 * Anything that sends (an invitation or a message) asks the background for
 * authorization immediately before the click, and verifies the result afterwards.
 */
let controller = new AbortController();
const claimed = new Set<string>();
const label = (e: HTMLElement) => (e.getAttribute("aria-label") || e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
const CONTROL = 'button, a, [role="button"], [role="menuitem"]';
function control(root: ParentNode, pattern: RegExp): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(CONTROL)].find(e => visible(e) && pattern.test(label(e)));
}
const CONNECT = /^connect$|^invite .+ to connect$/i, PENDING = /^pending\b/i, MORE = /^more$|^more actions$/i;

/** The background opens linkedin.com/in/me/, which LinkedIn redirects to the signed-in person's own profile. */
async function identity(signal: AbortSignal): Promise<string> {
  return wait(() => {
    const url = profileUrl(location.href);
    return url && !url.endsWith("/in/me/") && ownProfileEditLink(document, url, visible) ? url : null;
  }, signal, 15000).catch(error => {
    if (signal.aborted) throw error;
    throw new Error("Could not confirm your own LinkedIn profile. Make sure you are signed in to LinkedIn, then try again.");
  });
}
function topCard(expected: string): HTMLElement {
  if (profileUrl(location.href) !== expected) throw new Error("The open profile changed. Outreach has been paused.");
  const top = profileHeader(document);
  if (!top) throw new Error("The profile header is not available yet.");
  return top;
}
export function relationship(top: ParentNode): "connected" | "pending" | "not-connected" | "unknown" {
  // A visible Pending or Connect control is the strongest evidence; the degree line only decides when neither is shown.
  if (control(top, PENDING)) return "pending";
  if (control(top, CONNECT)) return "not-connected";
  return topCardFacts(top, visible).degree === 1 ? "connected" : "unknown";
}
const openMenus = () => queryAll('[role="menu"]').filter(visible);
/** Some profiles show Follow first and keep Connect under More. Opens that menu and returns it. */
async function moreMenu(top: HTMLElement, signal: AbortSignal): Promise<{ menu: HTMLElement | undefined; close: () => void }> {
  const more = control(top, MORE);
  if (!more) return { menu: undefined, close: () => undefined };
  more.click();
  const menu = await wait(() => openMenus()[0], signal, 3000).catch(() => undefined);
  return { menu, close: () => { if (openMenus().length) more.click(); } };
}
async function inspectRelationship(url: string, signal: AbortSignal): Promise<ReturnType<typeof relationship>> {
  const top = topCard(url), state = relationship(top);
  if (state !== "unknown") return state;
  const { menu, close } = await moreMenu(top, signal);
  const found = menu ? (control(menu, PENDING) ? "pending" : control(menu, CONNECT) ? "not-connected" : "unknown") : "unknown";
  close(); return found;
}
async function authorize(cmd: NetworkPageCommand, claim: boolean, signal: AbortSignal): Promise<void> {
  guard(signal); topCard(cmd.url);
  const reply: unknown = await chrome.runtime.sendMessage({ kind: "network.authorize", id: cmd.intentId, claim });
  guard(signal);
  if (!reply || typeof reply !== "object" || !("allowed" in reply) || reply.allowed !== true) throw new Error("Outreach is paused or this action is no longer authorized.");
}
const invitationDialog = () => queryAll('[role="dialog"]').filter(visible).find(e => /add a note|invitation|how do you know|send without a note/i.test(e.innerText)) ?? null;
async function openInvitationDialog(url: string, signal: AbortSignal): Promise<HTMLElement | null> {
  const existing = invitationDialog(); if (existing) return existing;
  const top = topCard(url);
  let connect = control(top, CONNECT);
  if (!connect) { const { menu } = await moreMenu(top, signal); connect = menu && control(menu, CONNECT); }
  if (!connect) throw new Error("Connect is unavailable on this recipient profile.");
  connect.click();
  // Either the note dialog opens, or (rarely) LinkedIn sends at once and the button turns to Pending.
  const outcome = await wait(() => invitationDialog() ?? (relationship(topCard(url)) === "pending" ? "sent" as const : null), signal, 8000);
  return outcome === "sent" ? null : outcome;
}
async function connect(cmd: NetworkPageCommand, signal: AbortSignal): Promise<unknown> {
  const existing = relationship(topCard(cmd.url));
  if (existing === "pending" || existing === "connected") return { state: existing };
  // Opening the dialog is not proof that an invitation was sent.
  await authorize(cmd, true, signal);
  const dialog = await openInvitationDialog(cmd.url, signal);
  if (!dialog) {
    if (cmd.noteMode === "require") throw new Error("LinkedIn submitted a request without exposing a note dialog. Verify the exact invitation manually.");
    return { state: "pending", noteSent: false };
  }
  if (dialog.querySelector('input[type="email"]')) throw new Error("LinkedIn requires a recipient email; no invitation was submitted.");
  let noteSent = false;
  if (cmd.noteMode !== "none") {
    const add = control(dialog, /^add a note$|^personalize invitation$/i);
    if (add) { add.click(); await sleep(400, signal); }
    const editor = [...dialog.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"], [role="textbox"]')].find(visible);
    if (!editor) {
      // "Use a note when available": free accounts run out of personalised notes, so send without one.
      if (cmd.noteMode === "require") throw new Error("No editable invitation note field was found. No note-free invitation was sent.");
    } else {
      if (!cmd.body.trim()) throw new Error("The personalized invitation note is empty.");
      const max = editor instanceof HTMLTextAreaElement ? editor.maxLength : Number(editor.getAttribute("maxlength") || editor.getAttribute("aria-valuemax"));
      if (max > 0 && cmd.body.length > max) throw new Error(`The current LinkedIn dialog permits ${max} characters; draft is ${cmd.body.length}. No invitation was sent.`);
      if (readEditor(editor).trim()) throw new Error("The note field already contains a draft. It was not overwritten.");
      insert(editor, cmd.body);
      if (!sameText(readEditor(editor), cmd.body)) throw new Error("The note was not fully reflected in LinkedIn. No invitation was sent.");
      noteSent = true;
    }
  }
  const send = control(dialog, /^send$|^send invitation$|^send without a note$/i);
  if (!send || send.hasAttribute("disabled") || send.getAttribute("aria-disabled") === "true") throw new Error("Invitation Send control is not available; no request was submitted.");
  if (noteSent && /without a note/i.test(label(send))) throw new Error("LinkedIn still shows Send without a note after insertion. No invitation was sent.");
  if (cmd.noteMode === "require" && !cmd.body.trim()) throw new Error("This outreach requires a personal note.");
  if (!dialog.isConnected || !visible(dialog) || profileUrl(location.href) !== cmd.url) throw new Error("Recipient or invitation dialog changed before sending.");
  await authorize(cmd, false, signal);
  send.click();
  await wait(() => relationship(topCard(cmd.url)) === "pending", signal, 10000).catch(() => { throw new Error("LinkedIn did not confirm Pending after Send. The invitation may have been submitted; inspect it manually before retrying."); });
  return { state: "pending", noteSent };
}
/** The chat window for exactly this recipient. It lives in LinkedIn's messaging shadow root. */
const conversations = (url: string) => queryAll('[role="dialog"][aria-label="Messaging"], .msg-overlay-conversation-bubble')
  .filter(e => visible(e) && [...e.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')].some(a => profileUrl(a.href) === url));
const HISTORY = ".msg-s-event-listitem__body, .msg-s-event-listitem__attachment";
async function message(cmd: NetworkPageCommand, signal: AbortSignal): Promise<unknown> {
  const top = topCard(cmd.url);
  if (relationship(top) !== "connected") throw new Error("A first-degree connection is required before messaging.");
  const open = control(top, /^message\b/i);
  if (!open) throw new Error("The Message button is unavailable on this profile.");
  if (!conversations(cmd.url).length) open.click();
  const conversation = await wait(() => { const found = conversations(cmd.url); return found.length === 1 ? found[0] : null; }, signal, 12000);
  const editor = await wait(() => [...conversation.querySelectorAll<HTMLElement>('[role="textbox"][contenteditable="true"], .msg-form__contenteditable')].find(visible), signal, 6000);
  // Give an existing thread time to load: its messages appear a moment after the window does.
  await sleep(3000, signal);
  if (conversation.querySelector(HISTORY)) throw new Error("You already have a conversation with this person. Continue it yourself in LinkedIn.");
  if (readEditor(editor).trim()) throw new Error("This conversation has an unsent draft. It has been left untouched.");
  insert(editor, cmd.body);
  if (!sameText(readEditor(editor), cmd.body)) throw new Error("The introduction could not be verified.");
  const send = await wait(() => { const b = control(conversation, /^send$/i); return b && !b.hasAttribute("disabled") ? b : null; }, signal, 4000)
    .catch(() => { throw new Error("The message is ready, but LinkedIn’s Send button is unavailable."); });
  if (!conversation.isConnected || conversations(cmd.url)[0] !== conversation) throw new Error("The conversation changed before sending.");
  await authorize(cmd, true, signal); send.click();
  await wait(() => conversations(cmd.url).some(c => [...c.querySelectorAll<HTMLElement>(".msg-s-event-listitem__body")].some(e => sameText(e.innerText, cmd.body))), signal, 12000);
  return { state: "messaged" };
}
/** Read-only check of what this page exposes, so a layout change shows up as a clear message instead of a mystery failure. */
function selfTest(): { page: string; found?: number; sample?: unknown[]; problems: string[] } {
  const path = location.pathname, problems: string[] = [];
  if (path.startsWith("/search/results/people")) {
    const people = networkPeople(document);
    if (!people.length) problems.push("No people could be read from this search page. LinkedIn may have changed its layout, or the results have not loaded yet.");
    if (people.length && !people.some(p => p.degree)) problems.push("People were found but their connection degree (1st/2nd/3rd) could not be read.");
    return { page: "People search", found: people.length, sample: people.slice(0, 3).map(p => ({ name: p.name, headline: p.headline.slice(0, 80), degree: p.degree ?? null, current: p.current ?? null })), problems };
  }
  const url = profileUrl(location.href);
  if (url) {
    let relation = "unknown", name = "", headline = "";
    try { relation = relationship(topCard(url)); } catch (e) { problems.push(e instanceof Error ? e.message : String(e)); }
    try { const p = readNetworkProfile(document, url, visible); name = p.name; headline = p.headline; } catch (e) { problems.push(e instanceof Error ? e.message : String(e)); }
    if (relation === "unknown" && !ownProfileEditLink(document, url, visible)) problems.push("No Connect, Pending or 1st-degree marker is on the top card. Connect may be under More, which this check does not open.");
    return { page: "Profile", sample: [{ name, headline: headline.slice(0, 80), relationship: relation }], problems };
  }
  return { page: "Other", problems: ["Open a LinkedIn people search or a profile, then run this check again."] };
}
async function handle(cmd: NetworkPageCommand, signal: AbortSignal): Promise<unknown> {
  guard(signal);
  if (cmd.action === "selftest") return selfTest();
  if (cmd.action === "identity") return { url: await identity(signal) };
  if (cmd.action === "search") {
    if (!location.pathname.startsWith("/search/results/people")) throw new Error("LinkedIn did not open people search.");
    return wait(() => {
      const people = networkPeople(document);
      if (people.length) return { people };
      if (/no results found|no results for|try shortening your search|no matching results/i.test(textOf(document.querySelector("main")))) return { people: [] };
      return null;
    }, signal, 15000).then(r => r.people).catch(error => {
      if (signal.aborted) throw error;
      throw new Error("LinkedIn search results could not be read. Open the search tab to review its layout or account notice.");
    });
  }
  await wait(() => profileHeader(document), signal, 15000);
  topCard(cmd.url);
  if (cmd.action === "profile") {
    // Profile sections load as you scroll. Scroll to the end until the page stops growing. Nothing is clicked:
    // on the live site a "…more" control inside Featured or Activity is a link that leaves the profile.
    const main = document.querySelector<HTMLElement>('main, [role="main"]');
    let previous = -1, stable = 0;
    for (let i = 0; main && i < 14 && stable < 2; i++) {
      guard(signal); topCard(cmd.url);
      // On the live site the scrolling element is <main>, not the window; do both so either layout works.
      window.scrollTo({ top: document.documentElement.scrollHeight }); main.scrollTo({ top: main.scrollHeight });
      main.lastElementChild?.scrollIntoView({ block: "end" });
      await sleep(700, signal);
      const size = main.innerText.length;
      stable = size === previous ? stable + 1 : 0; previous = size;
    }
    window.scrollTo({ top: 0 }); main?.scrollTo({ top: 0 });
    return wait(() => { try { return readNetworkProfile(document, cmd.url, visible); } catch { return null; } }, signal, 15000)
      .catch(error => { if (signal.aborted) throw error; throw new Error("This profile could not be read. Keep the LinkedIn tab open and try again."); });
  }
  if (cmd.action === "relationship") return { state: await inspectRelationship(cmd.url, signal) };
  if (claimed.has(cmd.intentId)) throw new Error("This action has already been attempted. Check the contact in LinkedIn.");
  claimed.add(cmd.intentId);
  return cmd.action === "connect" ? connect(cmd, signal) : message(cmd, signal);
}
const installed = globalThis as typeof globalThis & { __coldContactNetworkV1?: boolean };
if (!installed.__coldContactNetworkV1) chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || (sender.url && sender.url !== chrome.runtime.getURL("service-worker.js"))) return false;
  if (sender.origin && !["chrome-extension://", "extension://", "edge-extension://"].some(prefix => sender.origin === prefix + chrome.runtime.id)) return false;
  if (input && typeof input === "object" && "kind" in input && input.kind === "network.ping") { respond({ ok: true }); return false; }
  if (input && typeof input === "object" && "kind" in input && input.kind === "network.cancel") { controller.abort(); controller = new AbortController(); respond({ ok: true }); return false; }
  const parsed = networkPageCommand.safeParse(input);
  if (!parsed.success || parsed.data.deadline < Date.now() || parsed.data.deadline > Date.now() + 120000) return false;
  const cmd = parsed.data, signal = controller.signal;
  void handle(cmd, signal).then(data => respond({ requestId: cmd.requestId, ok: true, data })).catch((e: unknown) => respond({ requestId: cmd.requestId, ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});
installed.__coldContactNetworkV1 = true;
