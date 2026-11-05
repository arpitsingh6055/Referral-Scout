import { openDatabase } from "../storage/database";
import { registerOnboarding, resumeOnboarding } from "./onboarding";
registerOnboarding();
async function initialize(): Promise<void> {
  await chrome.storage.sync.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await openDatabase();
  await resumeOnboarding();
}
chrome.runtime.onInstalled.addListener(() => { void initialize().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { void initialize().catch(console.error); });
