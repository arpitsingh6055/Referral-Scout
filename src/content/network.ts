import { networkPageCommand, profileUrl, type NetworkPageCommand } from "../shared/network";
import { ownProfileLink, ownProfileEditLink, readNetworkProfile, networkPeople, networkJobs, networkJobDetail, networkCompany, profileHeader } from "../parsers/network";
import { visible, wait, sleep, guard, insert, readEditor, sameText } from "./dom";

let controller = new AbortController();
const claimed = new Set<string>();
const label = (e: HTMLElement) => (e.getAttribute("aria-label") || e.innerText || e.textContent || "").trim();
function button(root: ParentNode, pattern: RegExp): HTMLElement | undefined {
  const matches = [...root.querySelectorAll<HTMLElement>('button, [role="button"], a')].filter(e => visible(e) && pattern.test(label(e)));
  return matches.length === 1 ? matches[0] : undefined;
}
async function identity(signal: AbortSignal): Promise<string> {
  // Let the visible page finish rendering before deciding which account it is.
  let url = await wait(() => ownProfileLink(document, location.pathname.startsWith("/feed"), visible), signal, 2500).catch(() => null);
  if (url) return url;
  const me = await wait(() => {
    const candidates = [...document.querySelectorAll<HTMLElement>('header button, nav button, [role="navigation"] button')].filter(visible);
    return candidates.find(e => e.matches('button.global-nav__primary-link-me-menu-trigger, .global-nav__me button, button[data-test-global-nav-me]') || /^(?:me|.+\sme)$/i.test(label(e))) ?? null;
  }, signal, 8000).catch(() => null);
  if (!me || !visible(me)) throw new Error("Open your LinkedIn home page while signed in, then try again.");
  if (me.getAttribute("aria-expanded") !== "true") me.click();
  try { url = await wait(() => {
    const direct = ownProfileLink(document, false, visible);
    if (direct) return direct;
    const controlled = me.getAttribute("aria-controls");
    const menu = controlled ? document.getElementById(controlled) : null;
    if (!menu || !visible(menu)) return null;
    const urls = new Set([...menu.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')].filter(a => visible(a) && /^view (?:my )?profile$/i.test(label(a))).map(a => profileUrl(a.href)).filter(Boolean));
    return urls.size === 1 ? [...urls][0] : null;
  }, signal, 6000); }
  catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Could not read the profile link in LinkedIn’s Me menu. Click View profile in that menu, then choose Read my LinkedIn profile again.");
  }
  finally { if (me.getAttribute("aria-expanded") === "true") me.click(); }
  return url;
}
function topCard(expected: string): HTMLElement {
  if (profileUrl(location.href) !== expected) throw new Error("The open profile changed. Outreach has been paused.");
  const top = profileHeader(document);
  if (!(top instanceof HTMLElement)) throw new Error("The profile header is not available yet.");
  return top;
}
export function relationship(top: ParentNode): "connected" | "pending" | "not-connected" | "unknown" {
  const degree = [...top.querySelectorAll('.dist-value, [data-test-distance-badge]')].map(e => e.textContent ?? "").join(" ");
  if (/\b1st\b/i.test(degree)) return "connected";
  if (button(top, /^(pending|invitation pending)$|^pending invitation/i)) return "pending";
  if (button(top, /^connect$|^invite .+ to connect$/i)) return "not-connected";
  return "unknown";
}
async function inspectRelationship(url: string, signal: AbortSignal): Promise<ReturnType<typeof relationship>> {
  const top = topCard(url), state = relationship(top);
  if (state !== "unknown") return state;
  const more = button(top, /^more$|^more actions$/i); if (!more) return state;
  more.click(); await sleep(400, signal);
  const menus = [...document.querySelectorAll<HTMLElement>('[role="menu"], .artdeco-dropdown__content')].filter(visible);
  const connect = menus.length === 1 && button(menus[0]!, /^connect$|^invite .+ to connect$/i);
  more.click(); return connect ? "not-connected" : "unknown";
}
async function authorize(cmd: NetworkPageCommand, claim: boolean, signal: AbortSignal): Promise<void> {
  guard(signal); topCard(cmd.url);
  const reply: unknown = await chrome.runtime.sendMessage({ kind: "network.authorize", id: cmd.intentId, claim });
  guard(signal);
  if (!reply || typeof reply !== "object" || !("allowed" in reply) || reply.allowed !== true) throw new Error("Outreach is paused or this action is no longer authorized.");
}
async function openInvitationDialog(url: string, signal:AbortSignal):Promise<HTMLElement | null> {
  const open = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(visible).find(e=>/invitation|connect/i.test(e.innerText)) || null;
  const existing=open();if(existing)return existing;
  const top=topCard(url);
  let control=button(top,/^connect$|^invite .+ to connect$/i);
  if(!control){
    const more=button(top,/^more$|^more actions$/i);
    if(more){more.click();await sleep(350,signal);
      const menus=[...document.querySelectorAll<HTMLElement>('[role="menu"],.artdeco-dropdown__content')].filter(visible);
      if(menus.length===1)control=button(menus[0]!,/^connect$|^invite .+ to connect$/i);
    }
  }
  if(!control)throw new Error('Connect is unavailable on this recipient profile.');
  control.click();await sleep(450,signal);
  if(relationship(topCard(url))==='pending')return null;
  return await wait(open,signal,7000);
}
async function connect(cmd:NetworkPageCommand,signal:AbortSignal):Promise<unknown> {
  const existing=relationship(topCard(cmd.url));
  if(existing==='pending'||existing==='connected')return {state:existing};
  // Opening the modal is not proof that an invitation was sent.
  await authorize(cmd,true,signal);
  const dialog=await openInvitationDialog(cmd.url,signal);
  if(!dialog){
    if(cmd.noteMode==='require')throw new Error('LinkedIn submitted a request without exposing a note dialog. Verify the exact invitation manually.');
    return {state:'pending',noteSent:false};
  }
  if(dialog.querySelector('input[type="email"]'))throw new Error('LinkedIn requires a recipient email; no invitation was submitted.');
  let noteSent=false;
  if(cmd.noteMode!=='none'){
    const add=button(dialog,/^add a note$|^personalize invitation$/i);
    if(add){add.click();await sleep(250,signal);}
    const editor=[...dialog.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"], [role="textbox"]')].find(visible);
    if(!editor){
      // "Use a note when available": LinkedIn limits personalised notes on free accounts, so send without one.
      if(cmd.noteMode==='require')throw new Error('No editable invitation note field was found. No note-free invitation was sent.');
    }else{
      if(!cmd.body.trim())throw new Error('The personalized invitation note is empty.');
      const max=editor instanceof HTMLTextAreaElement ? editor.maxLength : Number(editor.getAttribute('maxlength') || editor.getAttribute('aria-valuemax'));
      if(max>0&&cmd.body.length>max)throw new Error(`The current LinkedIn dialog permits ${max} characters; draft is ${cmd.body.length}. No invitation was sent.`);
      if(readEditor(editor).trim())throw new Error('The note field already contains a draft. It was not overwritten.');
      insert(editor,cmd.body);
      if(!sameText(readEditor(editor),cmd.body))throw new Error('The note was not fully reflected in LinkedIn. No invitation was sent.');
      noteSent=true;
    }
  }else if(!cmd.body){ /* explicit no-note option only */ }
  const send=button(dialog,/^send$|^send invitation$|^send without a note$/i);
  if(!send||send.hasAttribute('disabled')||send.getAttribute('aria-disabled')==='true')throw new Error('Invitation Send control is not available; no request was submitted.');
  if(noteSent&&/without a note/i.test(label(send)))throw new Error('LinkedIn still shows Send without a note after insertion. No invitation was sent.');
  if(cmd.noteMode==='require'&&!cmd.body.trim())throw new Error('This outreach requires a personal note.');
  if(!dialog.isConnected||!visible(dialog)||profileUrl(location.href)!==cmd.url)throw new Error('Recipient or invitation dialog changed before sending.');
  await authorize(cmd,false,signal);
  send.click();
  await wait(()=>relationship(topCard(cmd.url))==='pending',signal,10000).catch(()=>{throw new Error('LinkedIn did not confirm Pending after Send. The invitation may have been submitted; inspect it manually before retrying.');});
  return {state:'pending',noteSent};
}
async function message(cmd: NetworkPageCommand, signal: AbortSignal): Promise<unknown> {
  const top = topCard(cmd.url);
  if (relationship(top) !== "connected") throw new Error("A first-degree connection is required before messaging.");
  const open = button(top, /^message$|^message .+$/i);
  if (!open) throw new Error("The Message button is unavailable on this profile.");
  open.click();
  const conversation = await wait(() => {
    const matches = [...document.querySelectorAll<HTMLElement>('.msg-overlay-conversation-bubble')].filter(e => visible(e) &&
      [...e.querySelectorAll<HTMLAnchorElement>('.msg-overlay-bubble-header a[href*="/in/"], .msg-thread__link-to-profile')].some(a => profileUrl(a.href) === cmd.url));
    return matches.length === 1 ? matches[0] : null;
  }, signal, 10000);
  const editor = await wait(() => conversation.querySelector<HTMLElement>('.msg-form__contenteditable[contenteditable="true"]'), signal, 5000);
  await wait(() => conversation.querySelector('.msg-s-message-list-content') && ![...conversation.querySelectorAll('.artdeco-loader')].some(visible), signal, 10000);
  await sleep(2000, signal);
  const history = [...conversation.querySelectorAll<HTMLElement>('.msg-s-event-listitem__body, .msg-s-event-listitem__attachment')];
  if (history.length) throw new Error("You already have a conversation with this person. Continue it yourself in LinkedIn.");
  if (readEditor(editor).trim()) throw new Error("This conversation has an unsent draft. It has been left untouched.");
  insert(editor, cmd.body);
  if (!sameText(readEditor(editor), cmd.body)) throw new Error("The introduction could not be verified.");
  const send = button(conversation, /^send$/i);
  if (!send || send.hasAttribute("disabled")) throw new Error("The message is ready, but LinkedIn’s Send button is unavailable.");
  if (!conversation.isConnected || !visible(conversation) || ![...conversation.querySelectorAll<HTMLAnchorElement>('.msg-overlay-bubble-header a[href*="/in/"], .msg-thread__link-to-profile')].some(a => profileUrl(a.href) === cmd.url)) throw new Error("The conversation changed before sending.");
  await authorize(cmd, true, signal); send.click();
  await wait(() => !readEditor(editor).trim() && [...conversation.querySelectorAll<HTMLElement>('.msg-s-event-listitem__body')].some(e => sameText(e.innerText, cmd.body)), signal, 10000);
  return { state: "messaged" };
}
async function handle(cmd: NetworkPageCommand, signal: AbortSignal): Promise<unknown> {
  guard(signal);
  if (cmd.action === "identity") return { url: await identity(signal) };
  if (cmd.action === "profile" && cmd.url === cmd.owner) {
    // Import only an editable own profile, never a recommendation or visited profile.
    await wait(() => profileUrl(location.href) === cmd.owner && ownProfileEditLink(document, cmd.owner, visible), signal, 15000)
      .catch(() => { throw new Error("Could not verify your own profile. Open your LinkedIn profile with the Edit intro button visible, then try again."); });
  } else if (await identity(signal) !== cmd.owner) throw new Error("The signed-in LinkedIn account could not be matched to your saved profile. Open your own profile and refresh it in the extension.");
  if(cmd.action==='jobs'){
    if(!location.pathname.startsWith('/jobs/search'))throw new Error('LinkedIn Jobs search did not load.');
    return (await wait(()=>{
      const jobs=networkJobs(document);if(jobs.length)return {jobs};
      if(/no jobs found|no matching jobs|no results/i.test(document.querySelector('main')?.textContent||''))return {jobs:[]};
      return null;
    },signal,15000)).jobs;
  }
  if(cmd.action==='job'){
    if(!location.pathname.startsWith('/jobs/view/'))throw new Error('Job details did not open.');
    return networkJobDetail(document,cmd.url);
  }
  if(cmd.action==='company'){
    if(!location.pathname.startsWith('/company/'))throw new Error('Company page did not open.');
    return networkCompany(document);
  }
  if(cmd.action==='invitationLimit'){
    // Inspection only: do not click Connect pre-authorization. Actual limit is
    // checked inside the visible modal immediately before Send.
    return {limit:null,reason:'The current invitation dialog has not opened yet.'};
  }
  if (cmd.action === "search") {
    if (location.pathname !== "/search/results/people/") throw new Error("LinkedIn did not open people search.");
    const result = await wait(() => {
      const people = networkPeople(document);
      if (people.length) return { people };
      if (/no results found|no results for|try shortening your search/i.test(document.querySelector("main")?.textContent ?? "")) return { people: [] };
      return null;
    }, signal, 12000).catch(() => { throw new Error("LinkedIn search results could not be read. Open the search tab to review its layout or account notice."); });
    return result.people;
  }
  await wait(() => profileHeader(document), signal, 15000);
  topCard(cmd.url);
  if (cmd.action === "profile") {
    // Load lazy profile sections and expand inline text in the visible tab.
    const main = document.querySelector<HTMLElement>('main, [role="main"]');
    let previous = '', stable = 0;
    for (let i = 0; main && i < 12 && stable < 3; i++) {
      guard(signal); topCard(cmd.url);
      const expand = [...main.querySelectorAll<HTMLElement>('button, [role="button"]')].filter(e => visible(e) && /^(?:see more|show more|…?\s*more)$/i.test(label(e)) && !e.closest('aside, [role="complementary"]'));
      for (const control of expand.slice(0, 20)) control.click();
      main.lastElementChild?.scrollIntoView({ block: 'end' });
      await sleep(500, signal);
      const text = main.innerText;
      stable = text === previous ? stable + 1 : 0; previous = text;
    }
    topCard(cmd.url).scrollIntoView({ block: 'start' });
    return wait(() => {
    try { return readNetworkProfile(document, cmd.url); } catch { return null; }
    }, signal, 15000).catch(() => { throw new Error("Your profile details have not loaded. Keep your own LinkedIn profile open and try again."); });
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
