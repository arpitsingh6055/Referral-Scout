import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DAY, defaultSettings, emptyNetwork, introduction, nextContact, profileUrl, relevance, suggestedTarget, type NetworkContact, type NetworkState } from "../src/shared/network";
import { getNetwork, updateNetwork, processContact, recoverNetwork, pauseNetwork, networkTick } from "../src/background/network";
import { networkCommand, networkTab } from "../src/background/network-browser";
import { clearDatabase, closeDatabase } from "../src/storage/database";
import { registerNetworkMessages } from "../src/background/network-messages";
import { prepareDossier } from "../src/background/network-ai";
vi.mock("../src/background/network-ai", () => ({ clearAiJobs:vi.fn(), prepareInvitation:vi.fn().mockResolvedValue("Hi Alex, would love to connect."), prepareIntroduction: vi.fn().mockResolvedValue("Hi Alex, thanks for connecting. Could we discuss product opportunities?"), prepareDossier: vi.fn().mockResolvedValue("Saved profile") }));
vi.mock("../src/background/network-browser", () => ({ networkCommand: vi.fn(), networkTab: vi.fn().mockResolvedValue(9), readyNetworkTab: vi.fn(), showWorkTab: vi.fn(), openWorkTab: vi.fn().mockResolvedValue(9) }));
const profile = { name: "Example Student", url: "https://www.linkedin.com/in/student/", headline: "Product analyst", location: "India", about: "" };
function contact(patch: Partial<NetworkContact> = {}): NetworkContact {
  return { name: "Alex Example", url: "https://www.linkedin.com/in/alex/", headline: "Founder at Example", rawText: "Founder at Example", location: "India", about: "", state: "shortlisted", reason: "Founder", addedAt: 1, checkedAt: 0, requestedAt: 0, messagedAt: 0, message: "", ...patch };
}
async function state(p = contact()): Promise<NetworkState> { return updateNetwork(() => ({ ...emptyNetwork(), active: true, profile, ownerVerifiedAt: Date.now(), dossier:'Profile dossier',settings:{...defaultSettings,roles:['Product Management'],outreachMode:'automatic',followupMode:'automatic',noteMode:'none'},contacts: [p] })); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 9, 11, 0, 0));
  vi.clearAllMocks();
  vi.mocked(prepareDossier).mockReset().mockResolvedValue("Saved profile");
  vi.mocked(networkCommand).mockReset(); vi.mocked(networkTab).mockReset().mockResolvedValue(9);
  vi.stubGlobal("chrome", { runtime: { id: "abc", onMessage: { addListener: vi.fn() } }, tabs: { sendMessage: vi.fn().mockResolvedValue({}),update:vi.fn().mockResolvedValue({}) } });
});
afterEach(async () => { vi.useRealTimers(); await clearDatabase(); await closeDatabase(); vi.unstubAllGlobals(); });
it("prioritizes pending checks only after 24 hours and does not retry uncertain contacts", () => {
  const s = { ...emptyNetwork(), contacts: [contact({ state: "attention" }), contact({ url: "https://www.linkedin.com/in/pending/", state: "pending", requestedAt:100, checkedAt: 100 })] };
  expect(nextContact(s, DAY + 99)).toBeUndefined();
  expect(nextContact(s, DAY + 100)?.state).toBe("pending");
  expect(introduction({ ...s, target: "design" }, { name: "Alex Example" })).toContain("Hi Alex");
});
it("records the request intent before acting and tracks a confirmed invitation", async () => {
  const s = await state(), p = s.contacts[0]!;
  vi.mocked(networkCommand).mockImplementation(async (_, cmd) => {
    if (cmd.action === "relationship") return { state: "not-connected" };
    const stored = await getNetwork(); expect(stored.intent?.kind).toBe("connect"); expect(stored.contacts[0]?.state).toBe("requesting");
    return { state: "pending" };
  });
  await processContact(s, p, new AbortController().signal);
  const stored = await getNetwork(); expect(stored.contacts[0]?.state).toBe("pending"); expect(stored.contacts[0]?.requestedAt).toBeGreaterThan(0); expect(stored.intent).toBeNull();
});
it("sends one introduction only after a tracked invitation becomes first-degree", async () => {
  const s = await state(contact({ state: "pending", requestedAt: 1 }));
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'connected' }).mockResolvedValueOnce(contact()).mockResolvedValueOnce({ state: 'messaged' });
  await processContact(s, s.contacts[0]!, new AbortController().signal);
  expect((await getNetwork()).contacts[0]?.state).toBe("messaged");
  expect(vi.mocked(networkCommand).mock.calls[2]?.[1]).toMatchObject({ action: 'message', url: contact().url });
  expect(nextContact(await getNetwork())).toBeUndefined();
});
it.each(["connected", "pending"])("does not adopt pre-existing %s relationships", async relation => {
  const s = await state(); vi.mocked(networkCommand).mockResolvedValue({ state: relation });
  await processContact(s, s.contacts[0]!, new AbortController().signal);
  expect((await getNetwork()).contacts[0]?.state).toBe("skipped"); expect(networkCommand).toHaveBeenCalledTimes(1);
});
it("pauses on an uncertain send and never automatically retries it", async () => {
  const s = await state(contact({ state: "pending", requestedAt: 1 }));
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'connected' }).mockResolvedValueOnce(contact()).mockRejectedValueOnce(new Error('Response lost'));
  await processContact(s, s.contacts[0]!, new AbortController().signal);
  const stored = await getNetwork(); expect(stored.active).toBe(false); expect(stored.contacts[0]?.state).toBe("attention");
  await networkTick(); expect(networkCommand).toHaveBeenCalledTimes(3);
});
it("recovers interrupted actions into attention and respects a concurrent pause", async () => {
  await state(contact({ state: "messaging" })); await recoverNetwork();
  expect((await getNetwork()).contacts[0]?.state).toBe("attention");
  const s = await state(); vi.mocked(networkCommand).mockImplementation(async () => { await pauseNetwork(); return { state: "not-connected" }; });
  await expect(processContact(s, s.contacts[0]!, new AbortController().signal)).rejects.toThrow("paused");
  expect(networkCommand).toHaveBeenCalledTimes(1); expect((await getNetwork()).active).toBe(false);
});
it("does not invent a hard-coded five-per-day invitation cap", async () => {
  await state();
  await updateNetwork(s=>({...s,actions:Array.from({length:5},()=>({kind:'connect',at:Date.now(),url:contact().url,confirmed:true}))}));
  vi.mocked(networkCommand).mockResolvedValueOnce({state:'unknown'});
  await networkTick();
  expect(networkTab).toHaveBeenCalled();
});
it("keeps checking pending invitations when invitation and message limits are reached", () => {
  const s = { ...emptyNetwork(), settings:{...defaultSettings,dailyMessages:5}, contacts: [contact({ state: "connected" }), contact({ state: "pending", requestedAt:1, checkedAt: 0 })], actions: Array.from({ length: 5 }, () => ({ kind: "message" as const, at: Date.now(), url: contact().url })) };
  expect(nextContact(s)?.state).toBe("pending");
  s.contacts[1]!.checkedAt = Date.now(); s.contacts.push(contact());
  expect(nextContact(s)?.state).toBe("shortlisted");
});
it("authorizes an action once, for the exact tab/profile, and revokes it on pause", async () => {
  const id = crypto.randomUUID();
  await state(); await updateNetwork(s => ({ ...s, intent: { id, tabId: 9, url: contact().url, kind: "message", at: Date.now(), body: "Hello", revision: s.revision, claimed: false } }));
  registerNetworkMessages();
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]![0];
  const sender = { id: "abc", frameId: 0, url: contact().url, origin: "https://www.linkedin.com", tab: { id: 9 } } as chrome.runtime.MessageSender;
  const ask = (claim: boolean, who = sender) => new Promise(resolve => { listener({ kind: "network.authorize", id, claim }, who, resolve); });
  expect(await ask(true, { ...sender, tab: { id: 10 } as chrome.tabs.Tab })).toEqual({ allowed: false });
  expect(await ask(true)).toEqual({ allowed: true }); expect(await ask(true)).toEqual({ allowed: false });
  expect(await ask(false)).toEqual({ allowed: true }); await pauseNetwork(); expect(await ask(false)).toEqual({ allowed: false });
});









it("rejects look-alike profile addresses and judges relevance from the headline", () => {
  for (const url of ["https://linkedin.com.evil.test/in/x/", "https://person@linkedin.com/in/x/", "https://linkedin.com/in/x/detail/", "http://linkedin.com/in/x/"]) expect(profileUrl(url)).toBeNull();
  expect(suggestedTarget(profile.headline)).toBe("Product Management");
  expect(relevance("Founder at Example", "Product Management")).toContain("Founder");
  expect(relevance("Senior Product Manager", "Product Management")).toContain("team leader");
  expect(relevance("Software intern", "Product Management")).toBeNull();
});

it("finds the signed-in person through linkedin.com/in/me/ and reads that profile in the same tab", async () => {
  vi.stubGlobal('chrome', { runtime: {id:'abc', getURL: (p:string) => `chrome-extension://abc/${p}`, onMessage:{addListener:vi.fn()}}, tabs:{sendMessage:vi.fn()} });
  vi.mocked(networkCommand).mockResolvedValueOnce({url:profile.url}).mockResolvedValueOnce(profile);
  registerNetworkMessages();
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]![0];
  const reply = await new Promise(resolve => listener({kind:'network',action:'import'}, {id:'abc',url:'chrome-extension://abc/sidepanel.html',origin:'chrome-extension://abc'}, resolve));
  expect(reply).toMatchObject({ok:true,data:{profile}});
  expect(networkTab).toHaveBeenCalledWith('https://www.linkedin.com/in/me/', expect.any(AbortSignal));
  expect(prepareDossier).not.toHaveBeenCalled();
  expect(networkCommand).toHaveBeenLastCalledWith(9, {action:'profile',url:profile.url}, expect.any(AbortSignal));
  expect((await getNetwork()).ownerVerifiedAt).toBe(Date.now());
});

function networkUi() {
  vi.stubGlobal('chrome', {runtime:{id:'abc',getURL:(p:string)=>`chrome-extension://abc/${p}`,onMessage:{addListener:vi.fn()}},tabs:{sendMessage:vi.fn()},alarms:{create:vi.fn().mockResolvedValue(undefined)}});
  registerNetworkMessages();
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]![0];
  return (request: object) => new Promise<any>(resolve => listener({kind:'network',...request}, {id:'abc',url:'chrome-extension://abc/sidepanel.html',origin:'chrome-extension://abc'}, resolve));
}

it('saves an original CV without opening ChatGPT and invalidates old processing', async () => {
  await updateNetwork(s => ({...s,profile,dossier:'Old profile',dossierSavedAt:1}));
  const ask=networkUi();
  const reply=await ask({action:'saveCv',name:'cv.pdf',type:'application/pdf',text:'CV TEXT'});
  expect(reply.ok).toBe(true);
  expect(prepareDossier).not.toHaveBeenCalled();
  expect(await getNetwork()).toMatchObject({cv:{name:'cv.pdf',text:'CV TEXT'},dossier:''});
  expect((await getNetwork()).dossierSavedAt).toBe(0);
});

it.each([null,{name:'cv.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',text:'Sample CV text'}])('processes on explicit click with optional CV %j and saves the answer', async cv => {
  await updateNetwork(s => ({...s,profile,cv}));
  const reply=await networkUi()({action:'analyze'});
  expect(reply.ok).toBe(true);
  expect(prepareDossier).toHaveBeenCalledWith(expect.objectContaining({profile,cv:cv?expect.objectContaining(cv):null}),expect.any(AbortSignal));
  expect(await getNetwork()).toMatchObject({dossier:'Saved profile',active:false});
  expect((await getNetwork()).dossierSavedAt).toBeGreaterThan(0);
});




const REAL_SHAPED_REPLY = JSON.stringify({schemaVersion:2,name:'Arpit Singh',headline:'PGDM',summary:'s',targetRoleStrengths:[{detail:'d',source:'cv'}],
  experience:[{detail:'Oracle',source:'both'}],education:[],projects:[],skills:[],certifications:[],achievements:[],otherFacts:[],
  missingInformation:[{detail:'No CGPA supplied.'}],conflicts:[{detail:'Start date differs.',source:'both'}]});

it('saves a pasted ChatGPT reply, including the object-style conflicts ChatGPT really returns', async () => {
  await updateNetwork(s=>({...s,profile}));
  const reply=await networkUi()({action:'importDossier',text:REAL_SHAPED_REPLY});
  expect(reply.ok).toBe(true);
  const saved=await getNetwork();
  expect(saved.dossier).toContain('Arpit Singh'); expect(saved.dossierSavedAt).toBeGreaterThan(0); expect(saved.status).toMatch(/saved/i);
});

it('rejects a pasted reply that is not the dossier JSON and saves nothing', async () => {
  await updateNetwork(s=>({...s,profile}));
  const reply=await networkUi()({action:'importDossier',text:'Sure! Here is a nice summary of the candidate.'});
  expect(reply.ok).toBe(false);
  expect((await getNetwork()).dossier??'').toBe('');
});

it('starts for a user whose saved settings pre-date aiMode, without a dossier step', async () => {
  const legacy = { roles: ['Product Management internship'], searchMode: 'both', outreachMode: 'review', noteMode: 'preferred', followupMode: 'review', paceMinutes: 2, dailyInvites: null, dailyMessages: null, maxPending: null, companyAllowlist: [], companyExclusions: [], workMode: 'any', employmentType: 'any' };
  await updateNetwork(s => ({ ...s, profile, dossier: '', settings: legacy as never }));
  const reply = await networkUi()({ action: 'start' });
  expect(reply.ok).toBe(true);
  expect(prepareDossier).not.toHaveBeenCalled();
  expect((await getNetwork()).active).toBe(true);
});

it('remembers a person from a LinkedIn page, keeps the note, and notices when a pending request was accepted', async () => {
  vi.stubGlobal('chrome', {runtime:{id:'abc',getURL:(p:string)=>`chrome-extension://abc/${p}`,onMessage:{addListener:vi.fn()}},tabs:{sendMessage:vi.fn()}});
  registerNetworkMessages();
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]![0];
  const url = 'https://www.linkedin.com/in/alex/';
  const page = (action: string, item: object, sender: object = {id:'abc',tab:{id:4},frameId:0,url}) =>
    new Promise<any>(resolve => listener({kind:'network.remember',action,item:{type:'person',url,title:'Alex Example',subtitle:'Recruiter at Acme',...item}}, sender as never, resolve));
  expect((await page('get', {relation:'pending'})).saved).toBeNull();
  expect((await page('save', {relation:'pending',note:'Message once accepted'})).saved).toMatchObject({title:'Alex Example',note:'Message once accepted',relation:'pending'});
  expect((await page('get', {relation:'connected'})).saved).toMatchObject({relation:'connected',note:'Message once accepted'});
  const saved = await getNetwork();
  expect(saved.saved).toHaveLength(1);
  expect(saved.saved![0]!.acceptedAt).toBe(Date.now());
  expect(saved.status).toMatch(/Alex Example accepted your connection request\. Your note: Message once accepted/);
  // A page that is not LinkedIn, or an address that is not a profile, cannot write anything.
  expect((await page('save', {}, {id:'abc',tab:{id:4},frameId:0,url:'https://evil.example/in/alex/'})).saved).toBeNull();
  await page('remove', {});
  expect((await getNetwork()).saved).toEqual([]);
});
