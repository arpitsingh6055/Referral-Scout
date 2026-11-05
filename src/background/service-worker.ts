import { openDatabase } from "../storage/database";
async function initialize(): Promise<void> {
  await chrome.storage.sync.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await openDatabase();
}
chrome.runtime.onInstalled.addListener(() => { void initialize().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { void initialize().catch(console.error); });
