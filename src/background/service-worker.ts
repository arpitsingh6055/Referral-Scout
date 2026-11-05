import { openDatabase } from "../storage/database";
import { registerOnboarding, resumeOnboarding } from "./onboarding";
import { registerCampaignMessages } from "./messages";
import { tick } from "./scheduler";
import { campaign } from "../storage/state";
registerOnboarding();
registerCampaignMessages();
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "campaign-tick") void tick(); });
async function initialize(): Promise<void> {
  await chrome.storage.sync.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await openDatabase();
  await resumeOnboarding();
  if (!await chrome.alarms.get("campaign-tick")) await chrome.alarms.create("campaign-tick", { periodInMinutes: 1 });
  const c = await campaign(); if (c?.status === "active" && !c.pausedByAlarm) chrome.power.requestKeepAwake("system");
}
chrome.runtime.onInstalled.addListener(() => { void initialize().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { void initialize().catch(console.error); });
void initialize().catch(console.error);
