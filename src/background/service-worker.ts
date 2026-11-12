import { openDatabase } from '../storage/database';
import { registerAiMessages } from './network-ai';
import { registerNetworkMessages } from './network-messages';
import { getNetwork, networkTick, pauseNetwork } from './network';
registerNetworkMessages();
registerAiMessages();
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'network-tick') void networkTick();
});
async function initialize(): Promise<void> {
  await chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await openDatabase();
  // Updating must never resume the retired Gmail / AI campaign.
  await chrome.alarms.clear('campaign-tick');
  await chrome.alarms.clear('cv-progress');
  chrome.power.releaseKeepAwake();
  if (!(await chrome.alarms.get('network-tick'))) await chrome.alarms.create('network-tick', { periodInMinutes: 1 });
}
// A first install starts paused. An update must not interrupt a running 24-hour cycle: initialize() re-creates the alarm.
chrome.runtime.onInstalled.addListener(details => {
  void initialize().then(async () => {
    if (details.reason === 'install' || !(await getNetwork()).active)
      await pauseNetwork('Ready when you are. Review your LinkedIn outreach and press Start.');
  });
});
chrome.runtime.onStartup.addListener(() => {
  void initialize().then(() => networkTick());
});
void initialize().catch(console.error);
