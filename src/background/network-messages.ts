import { z } from "zod";
import { networkRequest, networkProfileSchema, profileUrl, networkKey, suggestedTarget } from "../shared/network";
import { trustedExtension, trustedSite } from "../validators/security";
import { getNetwork, updateNetwork, pauseNetwork, networkTick } from "./network";
import { networkCommand, networkTab, readyNetworkTab } from "./network-browser";
import { acquire, release, renew } from "./lease";
import { remove } from "../storage/database";
import { prepareDossier, prepareIntroduction } from "./network-ai";

const authorization = z.object({ kind: z.literal("network.authorize"), id: z.uuid(), claim: z.boolean() });
async function importProfile(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["https://www.linkedin.com/*", "https://linkedin.com/*"] });
  const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.find(t => t.id === focused[0]?.id) ?? tabs.find(t => t.active) ?? (tabs.length === 1 ? tabs[0] : undefined);
  if (tab?.id === undefined) throw new Error("Open LinkedIn and sign in, then choose Read my LinkedIn profile.");
  const signal = new AbortController().signal;
  await readyNetworkTab(tab.id, signal);
  const identity = z.object({ url: z.string().refine(v => profileUrl(v) === v) }).parse(await networkCommand(tab.id, { action: "identity" }, signal));
  const current = await getNetwork();
  if (current.profile && current.profile.url !== identity.url && current.contacts.length) throw new Error("This is a different LinkedIn account. Clear the saved outreach before switching accounts.");
  // Stay on the verified own profile instead of redirecting a stored outreach tab.
  const profileTab = profileUrl(tab.url ?? "") === identity.url ? tab.id : await networkTab(identity.url, signal);
  const profile = networkProfileSchema.parse(await networkCommand(profileTab, { action: "profile", url: identity.url, owner: identity.url }, signal));
  await updateNetwork(s => ({ ...s, profile, dossier: "", dossierSavedAt: 0, contacts: s.contacts.map(p => p.messagedAt ? p : {...p, message: ""}), target: s.profile ? s.target : suggestedTarget(profile.headline), location: s.profile ? s.location : profile.location || "India", status: "LinkedIn profile saved. Add an optional CV, then choose Process with ChatGPT." }));
}
export function registerNetworkMessages(): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    const auth = authorization.safeParse(input);
    if (auth.success) {
      if (!trustedSite(sender, chrome.runtime.id) || !profileUrl(sender.url ?? "")) { respond({ allowed: false }); return false; }
      void (async () => {
        let allowed = false;
        await updateNetwork(s => {
          const i = s.intent;
          allowed = !!i && s.active && i.revision === s.revision && i.id === auth.data.id && i.tabId === sender.tab?.id && i.url === profileUrl(sender.url ?? "") && Date.now() - i.at < 120000 && (auth.data.claim ? !i.claimed : i.claimed);
          if (allowed && i && auth.data.claim) i.claimed = true;
          return s;
        }); return allowed;
      })().then(allowed => respond({ allowed })).catch(() => respond({ allowed: false })); return true;
    }
    if (!trustedExtension(sender, chrome.runtime.id)) return false;
    const parsed = networkRequest.safeParse(input); if (!parsed.success) return false;
    const req = parsed.data;
    void (async () => {
      if (req.action === "status") return getNetwork();
      if (req.action === "pause") { await pauseNetwork(); return getNetwork(); }
      if (req.action === "clear") await pauseNetwork();
      const signal = new AbortController().signal;
      const owner = crypto.randomUUID(); if (!await acquire(owner)) throw new Error("A LinkedIn step is finishing. Try again in a moment.");
      const timer = setInterval(() => { void renew(owner); }, 20000);
      try {
        const current = await getNetwork();
        if (req.action === "import") {
          if (current.active) throw new Error("Pause outreach before refreshing your profile.");
          await importProfile();
        }
        if (req.action === "save") {
          if (current.active) throw new Error("Pause outreach before editing your introduction or target.");
          if (/\{(?!firstName\}|target\})[^}]*\}/.test(req.template)) throw new Error("Use only {firstName} and {target} as message placeholders.");
          await updateNetwork(s => ({ ...s, target: req.target, location: req.location, template: req.template, nextDiscoveryAt: 0, status: "Preferences saved." }));
        }
        if (req.action === "saveCv") {
          if (current.active) throw new Error("Pause outreach before changing your CV.");
          await updateNetwork(s => ({ ...s, cv: { name: req.name, type: req.type, text: req.text, data: req.data, textVersion: 1 }, dossier: "", dossierSavedAt: 0, contacts: s.contacts.map(p => p.messagedAt ? p : { ...p, message: "" }), status: `Saved CV: ${req.name}. Choose Process with ChatGPT when ready.` }));
        }
        if (req.action === "analyze" || (req.action === "start" && !current.dossier?.trim())) {
          if(current.active) throw new Error("Pause outreach before updating your profile.");
          await updateNetwork(s => ({ ...s, status: s.cv ? "Reading your LinkedIn profile and CV in ChatGPT. Waiting for the completed answer…" : "Reading your LinkedIn profile in ChatGPT. No CV is needed. Waiting for the completed answer…" }));
          try {
            const dossier = await prepareDossier(await getNetwork(), signal);
            if (!dossier.trim()) throw new Error("ChatGPT returned an empty profile. Please try processing again.");
            await updateNetwork(s => ({ ...s, dossier, dossierSavedAt: Date.now(), contacts: s.contacts.map(p => p.messagedAt ? p : {...p, message: ""}), status: "Your detailed career profile is saved and ready for personalized messages." }));
          } catch (error) {
            await updateNetwork(s => ({...s, status: `Your original LinkedIn profile and CV are saved. ChatGPT processing needs attention: ${error instanceof Error ? error.message : String(error)}`}));
            throw error;
          }
        }
        if (req.action === "prepare") {
          const person = current.contacts.find(p => p.url === req.url);
          if (!person || !current.profile) throw new Error("Save this LinkedIn person before preparing a message.");
          if(current.active) throw new Error("Pause outreach before preparing a message manually.");
          if (!current.dossier?.trim()) throw new Error("Process your profile with ChatGPT first.");
          const message = await prepareIntroduction(current, person, signal);
          await updateNetwork(s => ({ ...s, contacts: s.contacts.map(p => p.url === person.url ? { ...p, message } : p), status: `Prepared a ChatGPT draft for ${person.name}.` }));
        }
        if (req.action === "start") {
          if (!current.profile) throw new Error("Read your LinkedIn profile first.");
          await updateNetwork(s => {
            if (s.revision !== current.revision) throw new Error("Outreach was paused while processing. Your profile is saved; start again when ready.");
            if (!s.dossier?.trim()) throw new Error("Process your profile with ChatGPT first.");
            return { ...s, active: true, revision: s.revision + 1, status: "Outreach is running. You can pause at any time." };
          });
          await chrome.alarms.create("network-tick", { periodInMinutes: 1 });
        }
        if (req.action === "skip") await updateNetwork(s => { const p = s.contacts.find(p => p.url === req.url); if (p) { p.state = "skipped"; p.reason = "Removed from outreach. No more actions will be taken."; } return s; });
        if (req.action === "clear") await remove("meta", networkKey);
        return getNetwork();
      } finally { clearInterval(timer); await release(owner); if (req.action === "start") void networkTick(); }
    })().then(data => respond({ ok: true, data })).catch((error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
}



