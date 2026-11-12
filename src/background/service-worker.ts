import { openDatabase } from '../storage/database';
import { registerAiMessages } from './network-ai';
import { registerNetworkMessages } from './network-messages';
import { networkTick, updateNetwork } from './network';
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
// Installing or updating never pauses anything: a new install simply has nothing running, and an update carries on.
// Earlier versions paused here on every reload, which left a "Resume" button on a panel that had never been started.
chrome.runtime.onInstalled.addListener(() => {
  void initialize().then(() =>
    updateNetwork(s => {
      if (s.paused && /^Ready when you are\./.test(s.status)) {
        delete s.paused;
        delete s.resumeTo;
        s.status = '';
      }
      return s;
    }),
  );
});
chrome.runtime.onStartup.addListener(() => {
  void initialize().then(() => networkTick());
});
void initialize().catch(console.error);
