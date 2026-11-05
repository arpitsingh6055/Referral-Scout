import { profileSchema, type Profile } from "../shared/schemas";
import { loadSettings, saveSettings } from "../storage/settings";
import { element, errorText } from "./render";
export function parseProfileFile(text: string): Profile {
  if (new TextEncoder().encode(text).length > 32768) throw new Error("Profile file is too large (maximum 32 KB)");
  return profileSchema.parse(JSON.parse(text) as unknown);
}
export function profileImport(): HTMLElement {
  const section = element("section"); section.append(element("h2", "Import your saved profile"));
  section.append(element("p", "Choose your private profile JSON file once. It replaces your profile and saves it to Chrome sync. Campaign settings are preserved. Never commit this file to GitHub."));
  const input = element("input"); input.type = "file"; input.accept = ".json,application/json"; input.setAttribute("aria-label", "Saved profile JSON file");
  const button = element("button", "Import and save profile"); button.type = "button";
  const status = element("p"); status.setAttribute("role", "status");
  button.addEventListener("click", () => {
    const file = input.files?.[0]; if (!file) { status.textContent = "Choose a profile file first."; return; }
    if (file.size > 32768) { status.textContent = "Profile file is too large."; return; }
    button.disabled = true;
    void (async () => {
      const profile = parseProfileFile(await file.text()); const { campaign } = await loadSettings();
      await saveSettings(profile, campaign); location.reload();
    })().catch(e => { status.textContent = errorText(e); }).finally(() => { button.disabled = false; });
  });
  section.append(input, button, status); return section;
}
