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
// After an install or update, tabs that were already open keep running the old content script, or none at all: the
// browser injects the content script only on a fresh navigation. Put the current content script into those tabs now
// so LinkedIn and ChatGPT work right away, without the person refreshing every open tab after a reload or update.
const CONTENT_HOSTS = ['https://www.linkedin.com/*', 'https://linkedin.com/*', 'https://chatgpt.com/*'];
async function injectOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: CONTENT_HOSTS }).catch(() => []);
  await Promise.all(
    tabs.map(async tab => {
      if (tab.id === undefined || tab.discarded) return;
      // A reload or update gives the tab a fresh isolated world, so this runs the new script once; a tab that
      // somehow still has it is guarded by the content script itself. Tabs we cannot script are skipped.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['health.js'] }).catch(() => undefined);
    }),
  );
}
// Installing or updating never pauses anything: a new install simply has nothing running, and an update carries on.
// Earlier versions paused here on every reload, which left a "Resume" button on a panel that had never been started.
chrome.runtime.onInstalled.addListener(() => {
  void injectOpenTabs();
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
