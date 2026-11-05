import "./styles.css";
import { z } from "zod";
import { appRoot, element, errorText } from "./render";
import { field, proofLines } from "./fields";
import { cvRequestSchema, extractedSchema } from "../shared/onboarding";
import { replySchema } from "../shared/commands";
import { profileSchema, readiness } from "../shared/schemas";
import { loadSettings, saveSettings } from "../storage/settings";
import { cvAttachment, fetchCv } from "./cv-file";
const root = appRoot();
root.append(element("h1", "Let’s set up your profile"), element("p", "Add your CV, review the details, and tell us what you’re looking for. You can edit everything later."));
const status = element("p"); status.setAttribute("role", "status");
const setup = element("section"); setup.append(element("h2", "1. Add your CV"));
const resume = field(setup, "resume", "Public resume link (also used in your emails)", "", "url");
const file = element("input"); file.type = "file"; file.accept = ".pdf,.docx,.txt"; file.setAttribute("aria-label", "Upload your CV"); setup.append(file);
const pasted = field(setup, "cv-text", "Or paste your CV text", "", "textarea");
setup.append(element("p", "Your CV will be shared with ChatGPT through your logged-in browser tab. We extract facts only; you review them before saving. The extension removes its temporary CV copy after extraction. ChatGPT’s own retention rules still apply."));
const consent = field(setup, "consent", "I agree to share this CV with ChatGPT for profile extraction", false, "checkbox") as HTMLInputElement;
const extract = element("button", "Read my CV with ChatGPT"), cancel = element("button", "Cancel extraction");
setup.append(extract, cancel); root.append(setup, status);
const review = element("form"); review.append(element("h2", "2. Review and finish"), element("p", "You can also fill these fields manually without sharing a CV."));
const controls = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
let applied = "";
const taskSchema = z.strictObject({ id: z.string(), state: z.enum(["queued", "running", "done", "error", "cancelled"]), result: extractedSchema.nullable(), resumeUrl: z.string(), error: z.string() }).nullable();
async function request(data: Record<string, unknown>): Promise<unknown> {
  const requestId = crypto.randomUUID(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = replySchema.parse(await Promise.race([chrome.runtime.sendMessage({ ...data, requestId }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Extension did not respond. Reload it and try again.")), 30000); })]));
    if (result.requestId !== requestId || !result.ok) throw new Error(result.error ?? "Invalid response"); return result.data;
  } finally { if (timer) clearTimeout(timer); }
}
async function poll(): Promise<void> {
  const task = taskSchema.parse(await request({ kind: "onboarding.status" })); if (!task) return;
  extract.disabled = task.state === "queued" || task.state === "running";
  if (extract.disabled) status.textContent = "Reading your CV… Keep the ChatGPT window visible. You can edit the other fields while it works.";
  if (task.state === "error") status.textContent = task.error;
  if (task.state === "done" && task.result && applied !== task.id) {
    applied = task.id;
    for (const key of ["name", "gmail", "education"] as const) { const control = controls.get(key); if (control) control.value = task.result[key]; }
    const proof = controls.get("proofPoints"); if (proof) proof.value = task.result.proofPoints.map(p => `${p.id} | ${p.text}`).join("\n");
    resume.value = task.resumeUrl || resume.value;
    status.textContent = "CV read. Review the details below—especially the sending email and proof points—then add availability and save.";
    review.scrollIntoView({ behavior: "smooth" });
  }
}
extract.addEventListener("click", () => {
  if (!consent.checked) { status.textContent = "Please agree before sharing your CV, or fill in the fields manually."; return; }
  const chosen = file.files?.[0], text = pasted.value.trim();
  if (chosen && text) { status.textContent = "Choose either a file or pasted CV text."; return; }
  if (!chosen && !text && !resume.value) { status.textContent = "Upload a CV, paste its text, or add a public file link."; return; }
  // The permission request must be directly inside this user click.
  const permission = !chosen && !text ? chrome.permissions.request({ origins: ["https://*/*"] }) : Promise.resolve(true);
  extract.disabled = true;
  void (async () => {
    if (!await permission) throw new Error("Download permission was declined. You can upload the CV instead.");
    const attachment = text ? undefined : await cvAttachment(chosen ?? await fetchCv(resume.value));
    cvRequestSchema.parse({ kind: "onboarding.extract", requestId: crypto.randomUUID(), consent: true, resumeUrl: resume.value, ...(text ? { text } : { attachment }) });
    await request({ kind: "onboarding.extract", consent: true, resumeUrl: resume.value, ...(text ? { text } : { attachment }) });
    file.value = ""; pasted.value = ""; await poll();
  })().catch(e => { status.textContent = errorText(e); extract.disabled = false; });
});
cancel.addEventListener("click", () => { void request({ kind: "onboarding.cancel" }).then(() => { extract.disabled = false; status.textContent = "Extraction cancelled and the local temporary copy removed. A CV already submitted to ChatGPT cannot be recalled."; }).catch(e => { status.textContent = errorText(e); }); });
void (async () => {
  const { profile, campaign } = await loadSettings(); resume.value = profile.resumeUrl;
  for (const [key, label, type] of [["name", "Your name", "text"], ["gmail", "Email address to send from in Gmail", "email"], ["education", "Education and graduation year", "text"], ["target", "What roles are you looking for?", "text"], ["availability", "When can you start, for how long, and remote or which city?", "textarea"], ["writingStyle", "How should your emails sound?", "textarea"]] as const)
    controls.set(key, field(review, key, label, profile[key], type));
  controls.set("proofPoints", field(review, "proofPoints", "Your best examples — one ID | evidence per line", profile.proofPoints.map(p => `${p.id} | ${p.text}`).join("\n"), "textarea"));
  const save = element("button", "Save my profile"); save.type = "submit"; review.append(save); root.append(review);
  review.addEventListener("submit", event => {
    event.preventDefault(); save.disabled = true;
    void (async () => {
      const values = Object.fromEntries([...controls].map(([key, input]) => [key, input.value]));
      const next = profileSchema.parse({ ...profile, ...values, resumeUrl: resume.value, proofPoints: proofLines(controls.get("proofPoints")?.value ?? "") });
      await saveSettings(next, campaign); await request({ kind: "onboarding.cancel" }); const missing = readiness(next, campaign, false);
      status.textContent = missing.length ? `Saved. Still needed: ${missing.join("; ")}.` : "Profile saved. You can edit it anytime in Settings.";
    })().catch(e => { status.textContent = errorText(e); }).finally(() => { save.disabled = false; });
  });
  await poll(); const timer = setInterval(() => { void poll().catch(e => { status.textContent = errorText(e); }); }, 4000);
  addEventListener("pagehide", () => clearInterval(timer), { once: true });
})().catch(e => { status.textContent = errorText(e); });
