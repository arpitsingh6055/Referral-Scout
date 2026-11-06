import { z } from "zod";
import { DAY, emptyNetwork, networkKey, networkProfileSchema, nextContact, relevance, type NetworkState, type NetworkContact } from "../shared/network";
import { read, mutate } from "../storage/state";
import { acquire, release, renew } from "./lease";
import { networkCommand, networkTab } from "./network-browser";
import { prepareIntroduction } from "./network-ai";

export const getNetwork = async (): Promise<NetworkState> => await read<NetworkState>(networkKey) ?? emptyNetwork();
export const updateNetwork = (fn: (s: NetworkState) => NetworkState) => mutate<NetworkState>(networkKey, old => fn(old ?? emptyNetwork()));
let running: Promise<void> | null = null, controller: AbortController | null = null;
export async function pauseNetwork(reason = "Paused. Your saved people and progress are kept."): Promise<void> {
  await updateNetwork(s => ({ ...s, active: false, revision: s.revision + 1, status: reason }));
  controller?.abort();
  const tab = await read<number>("network-tab");
  if (tab !== undefined) await chrome.tabs.sendMessage(tab, { kind: "network.cancel" }).catch(() => undefined);
}
export async function currentRun(revision: number, signal: AbortSignal): Promise<NetworkState> {
  signal.throwIfAborted(); const s = await getNetwork();
  if (!s.active || s.revision !== revision) throw new Error("Outreach was paused."); return s;
}
export async function recoverNetwork(): Promise<void> {
  await updateNetwork(s => {
    for (const p of s.contacts) if (p.state === "requesting" || p.state === "messaging") {
      p.state = "attention"; p.reason = "The browser stopped during an action. Check LinkedIn; this will not be retried automatically.";
    }
    s.intent = null; return s;
  });
}
async function saveContact(person: NetworkContact): Promise<void> {
  await updateNetwork(s => { s.contacts = s.contacts.map(p => p.url === person.url && p.state !== "skipped" ? person : p); s.intent = null; return s; });
}
async function discover(s: NetworkState, signal: AbortSignal): Promise<void> {
  const categories = ["recruiter", "founder", "head"], category = categories[s.searchCursor % categories.length];
  const url = new URL("https://www.linkedin.com/search/results/people/");
  url.searchParams.set("keywords", `${s.target.replace(/internship|opportunities/gi, "").trim()} ${category} ${s.location}`.trim());
  url.searchParams.set("page", String(Math.floor(s.searchCursor / 3) % 5 + 1));
  const tab = await networkTab(url.href, signal);
  const people = z.array(networkProfileSchema).max(100).parse(await networkCommand(tab, { action: "search", owner: s.profile!.url }, signal));
  await currentRun(s.revision, signal);
  await updateNetwork(current => {
    if (!current.active || current.revision !== s.revision) return current;
    let added = 0;
    for (const person of people) {
      if (current.contacts.length >= 500) break;
      const reason = relevance(person.headline, current.target);
      if (!reason || person.url === current.profile?.url || current.contacts.some(p => p.url === person.url)) continue;
      current.contacts.push({ ...person, reason, state: "shortlisted", addedAt: Date.now(), requestedAt: 0, checkedAt: 0, messagedAt: 0, message: "" }); added++;
      if (added >= 10) break;
    }
    current.searchCursor++; current.nextDiscoveryAt = Date.now() + (added ? DAY : 3600000);
    current.status = added ? `Saved ${added} relevant people. Connection requests will go out gradually.` : "No new matches on this search page. Your saved people are still being tracked; another search will run later.";
    return current;
  });
}
export async function processContact(s: NetworkState, p: NetworkContact, signal: AbortSignal): Promise<void> {
  const tab = await networkTab(p.url, signal);
  const relation = z.object({ state: z.enum(["connected", "pending", "not-connected", "unknown"]) }).parse(await networkCommand(tab, { action: "relationship", url: p.url, owner: s.profile!.url }, signal));
  await currentRun(s.revision, signal); p.checkedAt = Date.now();
  if (relation.state === "pending") {
    if (!p.requestedAt) { p.state = "skipped"; p.reason = "An invitation was already pending before this outreach. It has been left untouched."; }
    else p.state = "pending";
    await saveContact(p); return;
  }
  // Existing first-degree contacts are never silently treated as newly accepted invitations.
  if (relation.state === "connected" && !p.requestedAt) { p.state = "skipped"; p.reason = "Already connected before this outreach. Continue directly in LinkedIn."; await saveContact(p); return; }
  if (p.requestedAt && relation.state !== "connected") {
    if (relation.state === "unknown") { p.state = "attention"; p.reason = "Connection status could not be verified. Open the profile to check."; }
    else { p.state = "pending"; p.reason = "Acceptance has not been confirmed. No second invitation will be sent."; }
    await saveContact(p); return;
  }
  const kind = relation.state === "connected" ? "message" : "connect";
  const fresh = await currentRun(s.revision, signal);
  if (fresh.actions.filter(a => a.kind === kind && Date.now() - a.at < DAY).length >= 5) {
    if (kind === "message") p.state = "connected";
    await saveContact(p); return;
  }
  if (kind === "connect" && relation.state === "unknown") { p.state = "attention"; p.reason = "Connect and connection status could not be identified. Open this profile to review."; await saveContact(p); return; }
  p.state = kind === "connect" ? "requesting" : "messaging";
  if (kind === "message" && !p.message) {
    if (!p.rawText) Object.assign(p, networkProfileSchema.parse(await networkCommand(tab, {action:"profile",url:p.url,owner:s.profile!.url},signal)));
    p.message = await prepareIntroduction(fresh,p,signal);
    await currentRun(s.revision,signal);
    await updateNetwork(current => { current.contacts = current.contacts.map(person => person.url === p.url ? {...p,state:"connected"} : person); return current; });
    await networkTab(p.url,signal);
  }
  const intent: NonNullable<NetworkState["intent"]> = { id: crypto.randomUUID(), tabId: tab, url: p.url, kind, at: Date.now(), body: p.message, revision: s.revision, claimed: false };
  await updateNetwork(current => {
    if (!current.active || current.revision !== s.revision) throw new Error("Outreach was paused.");
    current.contacts = current.contacts.map(person => person.url === p.url ? p : person);
    current.intent = intent; current.actions = [...current.actions.filter(a => Date.now() - a.at < 7 * DAY), { at: intent.at, kind, url: p.url }];
    current.nextActionAt = Date.now() + 60000; return current;
  });
  try {
    const attachment = kind === "message" && s.cv ? { name: s.cv.name, type: s.cv.type, data: s.cv.data } : null;
    const result = z.object({ state: z.enum(["pending", "connected", "messaged"]) }).parse(await networkCommand(tab, { action: kind, url: p.url, owner: s.profile!.url, intentId: intent.id, body: p.message, attachment }, signal));
    if (kind === "connect" && result.state !== "pending") throw new Error("The connection changed during the request. Check this profile before continuing.");
    if (kind === "message" && result.state !== "messaged") throw new Error("Message delivery could not be confirmed.");
    p.state = result.state; p.reason = kind === "connect" ? "Invitation sent. We’ll check acceptance every 24 hours." : "Introduction sent. The conversation is yours from here.";
    if (kind === "connect") p.requestedAt = Date.now(); else p.messagedAt = Date.now();
  } catch (error) {
    p.state = "attention"; p.reason = `${error instanceof Error ? error.message : String(error)} This action will not be retried automatically.`;
    await pauseNetwork("One contact needs attention. Review it before resuming outreach.");
  }
  await saveContact(p);
}
async function run(): Promise<void> {
  const owner = crypto.randomUUID(); if (!await acquire(owner)) return;
  const abort = new AbortController(); controller = abort;
  const renewal = setInterval(() => { void renew(owner).then(ok => { if (!ok) abort.abort(); }); }, 20000);
  try {
    const s = await getNetwork(); if (!s.active || !s.profile) return;
    if (s.intent || s.contacts.some(p => ["requesting", "messaging"].includes(p.state))) { await recoverNetwork(); await pauseNetwork("An interrupted action needs review. Check the saved contact in LinkedIn."); return; }
    if (Date.now() < s.nextActionAt) return;
    const person = nextContact(s);
    if (person) {
      const kind = person.state === "connected" ? "message" : person.state === "shortlisted" ? "connect" : null;
      if (kind && s.actions.filter(a => a.kind === kind && Date.now() - a.at < DAY).length >= 5) return;
      await processContact(s, person, abort.signal);
    } else if (Date.now() >= s.nextDiscoveryAt && !s.contacts.some(p => p.state === "shortlisted") && s.contacts.filter(p => p.state === "pending").length < 50 && s.contacts.length < 500) await discover(s, abort.signal);
  } catch (error) { if (!abort.signal.aborted) await pauseNetwork(error instanceof Error ? error.message : String(error)); }
  finally { clearInterval(renewal); controller = null; await release(owner); }
}
export async function networkTick(): Promise<void> {
  if (running) return; running = run(); try { await running; } finally { running = null; }
}
