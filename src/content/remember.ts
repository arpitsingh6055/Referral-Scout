import { profileUrl } from "../shared/network";
import { ownProfileEditLink, profileHeader, topCardFacts } from "../parsers/network";
import { visible } from "./dom";
import { relationship } from "./network";

/*
 * "Remember" button on LinkedIn profile and job pages.
 * One click saves the person or job to Cold Contact with an optional note ("message her once she accepts").
 * Nothing on LinkedIn is clicked or changed; the button lives in its own closed shadow root.
 */
interface PageItem { type: "person" | "job"; url: string; title: string; subtitle: string; company?: string; relation?: string }
interface Saved extends PageItem { note: string; savedAt: number }

function pageItem(): PageItem | null {
  const person = profileUrl(location.href);
  if (person) {
    const top = profileHeader(document);
    if (!top || ownProfileEditLink(document, person, visible)) return null;
    const facts = topCardFacts(top, visible);
    if (!facts.name) return null;
    return { type: "person", url: person, title: facts.name, subtitle: facts.headline, ...(facts.company ? { company: facts.company } : {}), relation: relationship(top) };
  }
  const id = /^\/jobs\/view\/(\d+)/.exec(location.pathname)?.[1] ?? (location.pathname.startsWith("/jobs/") ? new URLSearchParams(location.search).get("currentJobId") : null);
  if (id && /^\d+$/.test(id)) {
    // The tab title is "Job title | Company | LinkedIn", which is steadier than any element on the jobs page.
    const parts = document.title.replace(/^\(\d+\)\s*/, "").split(" | ").map(s => s.trim()).filter(s => s && s !== "LinkedIn");
    if (!parts[0]) return null;
    return { type: "job", url: `https://www.linkedin.com/jobs/view/${id}/`, title: parts[0], subtitle: parts[1] ?? "", ...(parts[1] ? { company: parts[1] } : {}) };
  }
  return null;
}
const ask = async (action: "get" | "save" | "remove", item: PageItem & { note?: string }): Promise<Saved | null> => {
  try { const reply = await chrome.runtime.sendMessage({ kind: "network.remember", action, item: { note: "", ...item } }) as { saved?: Saved | null } | undefined; return reply?.saved ?? null; }
  catch { return null; }
};

const host = document.createElement("div");
host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483000;display:none";
const root = host.attachShadow({ mode: "closed" });
root.innerHTML = `<style>
  *{box-sizing:border-box;font:500 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}
  .pill{display:inline-flex;align-items:center;gap:6px;border:1px solid #2a3746;background:#17202b;color:#e9eff6;border-radius:999px;padding:8px 14px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)}
  .pill:hover{background:#1f2a37}.pill.on{border-color:#4fc58b;color:#4fc58b}
  .box{margin-bottom:8px;width:260px;background:#17202b;border:1px solid #2a3746;border-radius:12px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);color:#e9eff6}
  .box[hidden]{display:none}.who{font-weight:700;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  textarea{width:100%;height:56px;resize:none;border-radius:8px;border:1px solid #2a3746;background:#0f151d;color:#e9eff6;padding:6px 8px}
  .row{display:flex;justify-content:space-between;margin-top:8px}
  button.s{border:0;border-radius:8px;padding:6px 10px;cursor:pointer;background:#2f6fed;color:#fff}button.x{background:transparent;color:#f27f75}
</style>
<div class="box" hidden><div class="who"></div><textarea maxlength="300" placeholder="Why remember? e.g. sent a request today, message once accepted"></textarea>
<div class="row"><button class="s x" data-a="remove">Forget</button><button class="s" data-a="save">Save note</button></div></div>
<button class="pill" type="button"></button>`;
const pill = root.querySelector<HTMLButtonElement>(".pill")!, box = root.querySelector<HTMLElement>(".box")!, who = root.querySelector<HTMLElement>(".who")!, noteField = root.querySelector<HTMLTextAreaElement>("textarea")!;
let current: PageItem | null = null, saved: Saved | null = null, shownFor = "";

function paint(): void {
  host.style.display = current ? "block" : "none";
  if (!current) { box.hidden = true; return; }
  pill.textContent = saved ? "✓ Remembered · note" : `＋ Remember this ${current.type === "job" ? "job" : "person"}`;
  pill.classList.toggle("on", !!saved);
  who.textContent = current.title;
}
pill.addEventListener("click", () => {
  if (!current) return;
  if (!saved) { void ask("save", current).then(s => { saved = s; noteField.value = s?.note ?? ""; box.hidden = !s; paint(); if (s) noteField.focus(); }); return; }
  box.hidden = !box.hidden; if (!box.hidden) { noteField.value = saved.note; noteField.focus(); }
});
root.addEventListener("click", event => {
  const action = (event.target as HTMLElement).dataset?.["a"]; if (!action || !current) return;
  if (action === "save") void ask("save", { ...current, note: noteField.value.trim() }).then(s => { saved = s; box.hidden = true; paint(); });
  if (action === "remove") void ask("remove", current).then(() => { saved = null; box.hidden = true; paint(); });
});
// LinkedIn changes pages without reloading, so look again every second and only act when the page actually changed.
async function look(): Promise<void> {
  const item = pageItem(), key = item ? `${item.url}|${item.relation ?? ""}` : "";
  if (key === shownFor) return;
  shownFor = key; current = item; box.hidden = true;
  saved = item ? await ask("get", item) : null; // "get" also lets the extension notice that a remembered person has since accepted
  if (shownFor === key) paint();
}
const installed = globalThis as typeof globalThis & { __coldContactRemember?: boolean };
if (!installed.__coldContactRemember && location.hostname.endsWith("linkedin.com") && window.top === window) {
  installed.__coldContactRemember = true;
  document.documentElement.append(host);
  setInterval(() => { void look(); }, 1000); void look();
}
