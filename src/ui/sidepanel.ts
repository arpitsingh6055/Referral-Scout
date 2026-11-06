import "./network.css";
import { appRoot, element, errorText } from "./render";
import { DAY, introduction, type NetworkRequest, type NetworkState, type ContactState } from "../shared/network";
import { completeCvText } from './cv-text';


const root = appRoot();
let busy = false, filter = "all", last: NetworkState | null = null, signature = "";
const notice = element("div"); notice.className = "notice"; notice.setAttribute("role", "status");
const page = element("div"); root.append(notice, page);
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const result = element(tag, text); result.className = className; return result;
}
async function request(data: NetworkRequest): Promise<NetworkState> {
  const reply = await chrome.runtime.sendMessage(data) as { ok: boolean; data?: NetworkState; error?: string };
  if (!reply?.ok || !reply.data) throw new Error(reply?.error || "The extension did not respond. Reload it and try again.");
  return reply.data;
}
function button(text: string, action: () => Promise<void>, className = "button"): HTMLButtonElement {
  const b = node("button", text, className); b.type = "button";
  b.addEventListener("click", () => {
    if (busy) return; busy = true; b.disabled = true; notice.textContent = "";
    void action().catch(e => { notice.textContent = errorText(e); }).finally(() => { busy = false; b.disabled = false; });
  }); return b;
}
function link(text: string, url: string, className = "text-link"): HTMLAnchorElement {
  const a = node("a", text, className); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; return a;
}
async function act(action: NetworkRequest): Promise<void> { render(await request(action)); }
async function ensureCvText(): Promise<void> {
  const current = await request({kind:'network',action:'status'});
  if (!current.cv || current.cv.textVersion === 1 && current.cv.text.trim()) return;
  notice.textContent = 'Extracting all text from your saved CV locally…';
  const cv = current.cv;
  const bytes = Uint8Array.from(atob(cv.data), c => c.charCodeAt(0));
  const text = await completeCvText(bytes.buffer,cv.name);
  await request({kind:'network',action:'saveCv',name:cv.name,type:cv.type,data:cv.data,text});
}
function field(label: string, value: string, multiline = false): { label: HTMLLabelElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const wrapper = node("label", label), input = multiline ? node("textarea") : node("input");
  input.value = value; if (input instanceof HTMLTextAreaElement) input.rows = 6;
  wrapper.append(input); return { label: wrapper, input };
}
const labels: Record<ContactState, string> = { shortlisted: "Shortlisted", requesting: "Connecting", pending: "Invitation pending", connected: "Accepted", messaging: "Sending introduction", messaged: "Introduction sent", attention: "Needs attention", skipped: "Skipped" };
function render(s: NetworkState): void {
  last = s; signature = JSON.stringify(s); page.replaceChildren();
  const header = node("header", "", "brand");
  header.append(node("span", "cc", "brand-mark"), node("span", "Cold Contact", "brand-name"), node("span", "LINKEDIN", "eyebrow")); page.append(header);
  if (!s.profile) {
    const hero = node("section", "", "welcome");
    hero.append(node("span", "LESS SETUP. MORE CONVERSATIONS.", "eyebrow"), node("h1", "Meet your next opportunity."), node("p", "Find the right people, connect, and introduce yourself when they accept. All from LinkedIn.", "lede"));
    const steps = node("ol", "", "steps");
    for (const [title, detail] of [["Start with your profile", "We read your name, headline and profile details from your signed-in LinkedIn account."], ["Find people worth meeting", "Recruiters, founders and relevant team leaders are saved in your shortlist."], ["Let the conversation begin", "We check pending invitations every 24 hours and send your introduction after acceptance."]]) {
      const item = node("li"); item.append(node("strong", title), node("p", detail)); steps.append(item);
    }
    hero.append(steps, button("Read my LinkedIn profile", async () => { notice.textContent = "Reading your profile from LinkedIn…"; await act({ kind: "network", action: "import" }); notice.textContent = ""; }, "button primary wide"), node("p", "Open your LinkedIn home or profile page first. Keep your LinkedIn profile up to date — that’s your starting point.", "hint"));
    page.append(hero); return;
  }
  const greeting = node("div", "", "greeting"); greeting.append(node("span", "YOUR OUTREACH", "eyebrow"), node("h1", s.active ? "Making connections." : "Good people. Real conversations.")); page.append(greeting);
  const profile = node("section", "", "profile-strip");
  profile.append(node("div", s.profile.name.split(/\s+/).map(n => n[0]).slice(0, 2).join(""), "avatar"));
  const identity = node("div"); identity.append(link(s.profile.name, s.profile.url, "profile-name"), node("p", s.profile.headline, "muted")); profile.append(identity); page.append(profile);
  const preferences = node("details", "", "preferences");
  preferences.append(node("summary", `Looking for: ${s.target}`), node("p", "Adjust your target or introduction anytime before starting.", "hint"));
  const target = field("What opportunity are you looking for?", s.target), location = field("Where should we look?", s.location), template = field("Message sent after they accept", s.template, true);
  target.input.maxLength = 150; location.input.maxLength = 150; template.input.maxLength = 1500;
  for (const f of [target, location, template]) { f.input.disabled = s.active; preferences.append(f.label); }
  const preview = node("div", "", "message-preview");
  function updatePreview(): void { preview.textContent = introduction({ template: template.input.value, target: target.input.value }, { name: s.contacts[0]?.name || "Alex" }); }
  updatePreview(); target.input.addEventListener("input", updatePreview); template.input.addEventListener("input", updatePreview);
  preferences.append(node("p", "{firstName} becomes their first name. {target} becomes your chosen opportunity.", "hint"), node("span", "PREVIEW", "eyebrow"), preview);
  const processing = node("section", "", "control-card");
  processing.append(node("h2", "Your career profile"), node("p", s.dossier ? "Processed with ChatGPT and saved for personalized messages." : "LinkedIn profile saved. Add a CV if you want, then process it with ChatGPT.", "hint"));
  const cvLabel = node("label", s.cv ? `CV saved: ${s.cv.name}` : "Optional CV (PDF, Word, or text)");
  const cv = node("input") as HTMLInputElement; cv.type = "file"; cv.accept = ".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"; cv.disabled = s.active;
  cv.addEventListener("change", () => {
    if (busy) return;
    const file = cv.files?.[0]; if (!file) return;
    if (file.size > 2_000_000) { notice.textContent = "CV must be 2 MB or smaller."; cv.value = ""; return; }
    busy = true; cv.disabled = true; notice.textContent = "Saving your CV locally…";
    void file.arrayBuffer().then(async buffer => {
      const bytes = new Uint8Array(buffer);
      let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
      const data = btoa(binary);
      const text = await completeCvText(buffer,file.name);
      return request({ kind: "network", action: "saveCv", name: file.name, type: file.type || "application/octet-stream", text, data }).then(state => { render(state); notice.textContent = "CV and extracted text saved. Choose Process with ChatGPT when ready."; });
    }).catch(e => { notice.textContent = errorText(e); }).finally(() => { busy = false; cv.disabled = false; });
  });
  cvLabel.append(cv); processing.append(cvLabel, node("p", "We extract your CV text locally and put it with your saved LinkedIn text into one ChatGPT prompt. The structured response is checked and saved here. Without a CV, we use LinkedIn alone. Your original CV stays saved for introductions.", "hint"));
  if (!s.active) processing.append(button(s.dossier ? "Reprocess with ChatGPT" : "Process with ChatGPT", async () => {
    await ensureCvText();
    notice.textContent = "Processing in the visible ChatGPT tab. Waiting for the completed answer…";
    await act({kind:"network",action:"analyze"}); notice.textContent = "Your detailed career profile is saved.";
  }, "button primary wide"));
  if (s.dossier) { const detail=node("details"); detail.append(node("summary","Saved career profile"),node("p",s.dossier,"message-preview")); processing.append(detail); }
  page.append(processing);
  async function save(): Promise<void> { await request({ kind: "network", action: "save", target: target.input.value, location: location.input.value, template: template.input.value }); }
  if (!s.active) preferences.append(button("Save changes", async () => { await save(); await act({ kind: "network", action: "status" }); }), button("Refresh from LinkedIn", () => act({ kind: "network", action: "import" }), "button quiet"));
  else preferences.append(node("p", "Pause outreach to make changes.", "hint"));
  preferences.append(node("p", "Keep your LinkedIn profile up to date. Your profile and optional CV are shared with your signed-in ChatGPT tab for preparation.", "hint")); page.append(preferences);
  const control = node("section", "", "control-card");
  const state = node("div", "", "state-line"); state.append(node("span", "", s.active ? "dot live" : "dot"), node("strong", s.active ? "Outreach is on" : "You’re in control")); control.append(state);
  control.append(node("p", s.status || "Ready to find your next connection.", "muted"));
  control.append(button(s.active ? "Pause outreach" : s.contacts.length ? "Resume outreach" : "Start outreach", async () => {
    if (s.active) await act({ kind: "network", action: "pause" });
    else { await save(); await ensureCvText(); notice.textContent = s.dossier ? "Starting outreach…" : "Processing your profile in ChatGPT first. Outreach will wait until it is saved…"; await act({ kind: "network", action: "start" }); notice.textContent = ""; }
  }, s.active ? "button wide" : "button primary wide"));
  control.append(node("p", "If your profile is not processed yet, Start outreach processes it in ChatGPT first. Outreach begins only after the result is saved. Up to 5 requests and 5 introductions per 24 hours. Existing conversations are left for you.", "hint")); page.append(control);
  const stats = node("div", "", "stats");
  for (const [label, count] of [["Saved", s.contacts.filter(p => p.state !== "skipped").length], ["Pending", s.contacts.filter(p => p.state === "pending").length], ["Introduced", s.contacts.filter(p => p.state === "messaged").length]] as const) {
    const stat = node("div"); stat.append(node("strong", String(count)), node("span", label)); stats.append(stat);
  } page.append(stats);
  const section = node("section", "", "people-section");
  const heading = node("div", "", "section-heading"); heading.append(node("h2", "Your people"));
  const select = node("select"); select.setAttribute("aria-label", "Filter saved people");
  for (const [value, label] of [["all", "All people"], ["shortlisted", "Shortlisted"], ["pending", "Pending"], ["messaged", "Introduced"], ["attention", "Needs attention"], ["skipped", "Skipped"]]) { const option = node("option", label); option.value = value!; select.append(option); }
  select.value = filter; select.addEventListener("change", () => { filter = select.value; if (last) render(last); }); heading.append(select); section.append(heading);
  const people = s.contacts.filter(p => filter === "all" ? p.state !== "skipped" : p.state === filter);
  if (!people.length) {
    const empty = node("div", "", "empty"); empty.append(node("span", "↗", "empty-icon"), node("h3", s.contacts.length ? "Nothing here yet" : "Your shortlist starts here"), node("p", s.contacts.length ? "People will appear here as outreach progresses." : "Start outreach and we’ll look for recruiters, founders and team leads who match your target.")); section.append(empty);
  }
  for (const p of people) {
    const card = node("article", "", "person");
    const top = node("div", "", "person-top"); top.append(link(p.name, p.url, "person-name"), node("span", labels[p.state], `badge ${p.state}`)); card.append(top, node("p", p.headline, "person-headline"));
    if (p.location) card.append(node("p", p.location, "person-location"));
    card.append(node("p", p.reason, "hint"));
    if (p.state === "pending") card.append(node("p", `Next check: ${new Date(p.checkedAt + DAY).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${s.active ? "" : " · paused"}`, "hint"));
    if (p.message) { const detail = node("details"); detail.append(node("summary", p.state === "messaged" ? "View introduction" : "Prepared introduction"), node("p", p.message, "message-preview")); card.append(detail); }
    const actions = node("div", "", "person-actions"); actions.append(link("Open profile ↗", p.url));
    if (p.state !== "skipped") actions.append(button("Prepare with ChatGPT", async () => { notice.textContent = "Opening ChatGPT and preparing a visible draft…"; await act({ kind: "network", action: "prepare", url: p.url }); notice.textContent = "Draft prepared. Review it in LinkedIn before sending."; }, "button quiet"));
    if (!["messaged", "skipped", "requesting", "messaging"].includes(p.state)) actions.append(button("Skip", () => act({ kind: "network", action: "skip", url: p.url }), "button text-button"));
    card.append(actions); section.append(card);
  } page.append(section);
  const footer = node("footer"); footer.append(node("p", "Checks run while Chrome is open and your computer is awake. If a check is missed, it resumes when you return. LinkedIn may require you to sign in or review an account notice.", "hint"));
  footer.append(button("Clear saved outreach", async () => { if (confirm("Clear your saved LinkedIn profile and people? Invitations and messages already on LinkedIn will stay there.")) await act({ kind: "network", action: "clear", confirm: true }); }, "button text-button")); page.append(footer);
}
async function refresh(): Promise<void> {
  if (busy || page.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "")) return;
  const state = await request({ kind: "network", action: "status" }); if (JSON.stringify(state) !== signature) render(state);
}
void refresh().catch(e => { notice.textContent = errorText(e); });
const timer = setInterval(() => { void refresh().catch(e => { notice.textContent = errorText(e); }); }, 5000);
addEventListener("pagehide", () => clearInterval(timer), { once: true });
