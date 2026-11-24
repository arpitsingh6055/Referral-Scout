import { openDatabase } from '../storage/database';
import { registerAiMessages, pruneAiJobs } from './network-ai';
import { registerNetworkMessages } from './network-messages';
import { registerApplyMessages } from './apply';
import { networkTick, updateNetwork } from './network';
import { registerCampaignMessages, migrateAnswerBank } from './campaign';
import { registerGmailMessages } from './gmail';
import { applySurfaceBehaviour, installMenus, openWorkbench, registerSurfaceMessages, registerSurfaces } from './surfaces';
import { registerWorkspaceMessages } from './workspace';
import { registerRunner, ensureRunnerAlarm, recoverQueue, tick, abortAll } from './runner';
registerNetworkMessages();
registerAiMessages();
registerApplyMessages();
registerCampaignMessages();
registerGmailMessages();
registerRunner();
registerSurfaces();
registerSurfaceMessages();
registerWorkspaceMessages();
// Clicking an important background notification takes the person back into the workbench; notifications are
// otherwise passive and never perform a consequential action on their own.
chrome.notifications?.onClicked.addListener(notificationId => {
  void chrome.notifications.clear(notificationId);
  void openWorkbench('overview');
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'network-tick') void networkTick();
});
let starting: Promise<void> | undefined;

/** Runs once per service-worker generation; onInstalled, onStartup and the module's own call share one run. */
function initialize(): Promise<void> {
  starting ??= start().catch(error => {
    starting = undefined;
    throw error;
  });
  return starting;
}

async function start(): Promise<void> {
  await chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  // Fresh installs open the side panel first; the full workbench remains one click away for setup and detailed review.
  await applySurfaceBehaviour();
  await installMenus();
  await openDatabase();
  // Saved people, jobs and answers live in the browser's local database; this keeps the browser from clearing it to
  // free space (unlimitedStorage exempts the extension's storage from eviction).
  await navigator.storage?.persist?.().catch(() => false);
  await pruneAiJobs().catch(() => 0);
  // Updating must never resume the retired Gmail / AI campaign.
  await chrome.alarms.clear('campaign-tick');
  await chrome.alarms.clear('cv-progress');
  chrome.power.releaseKeepAwake();
  if (!(await chrome.alarms.get('network-tick'))) await chrome.alarms.create('network-tick', { periodInMinutes: 1 });
  // The application queue outlives this service worker. Anything the previous generation left mid-form is handed
  // back before the runner claims anything new, so a restart can never leave two workers on one application.
  await recoverQueue().catch(() => undefined);
  await migrateAnswerBank().catch(() => undefined);
  // LinkedIn/CV captures remain source evidence only. Candidate profile records are created only from an
  // explicitly approved ChatGPT reconciliation draft.
  await ensureRunnerAlarm();
}
// After an install or update, tabs that were already open keep running the old content script, or none at all: the
// browser injects the content script only on a fresh navigation. Put the current content script into those tabs now
// so LinkedIn and ChatGPT work right away, without the person refreshing every open tab after a reload or update.
const CONTENT_HOSTS = ['https://www.linkedin.com/*', 'https://linkedin.com/*', 'https://chatgpt.com/*', 'https://mail.google.com/*'];
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
// Put the content script into one tab only if it is not already answering there. Blind re-injection would re-run
// the content modules and register a second copy of their message listeners, so a ping guards it: an up-to-date tab
// replies and is left alone; a tab without the script (opened before this extension loaded, then navigated in-app)
// gets it. This is what makes the messaging card appear on in-app navigation without a manual refresh.
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const pong = (await chrome.tabs.sendMessage(tabId, { kind: 'network.ping' })) as { ok?: boolean } | undefined;
    if (pong?.ok) return;
  } catch {
    // No receiver in this tab: inject below.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['health.js'] }).catch(() => undefined);
}
// LinkedIn is a single-page app, so moving into Messaging (clicking the Message icon or a conversation) can change
// the tab's URL without a page load. Ensure the content script is present whenever a tab reaches Messaging.
const MESSAGING = /^https:\/\/(www\.)?linkedin\.com\/messaging(\/|$)/;
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = info.url ?? tab.url ?? '';
  if (MESSAGING.test(url)) void ensureContentScript(tabId);
});
// Installing or updating never pauses anything: a new install simply has nothing running, and an update carries on.
// Earlier versions paused here on every reload, which left a "Resume" button on a panel that had never been started.
chrome.runtime.onInstalled.addListener(() => {
  void injectOpenTabs();
  void initialize()
    .then(() =>
      updateNetwork(s => {
        if (s.paused && /^Ready when you are\./.test(s.status)) {
          delete s.paused;
          delete s.resumeTo;
          s.status = '';
        }
        return s;
      }),
    )
    .catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  // Tab ids start again after a restart, so every in-flight worker from the last session is already invalid.
  abortAll();
  void initialize()
    .then(() => Promise.all([networkTick(), tick()]))
    .catch(console.error);
});
void initialize().catch(console.error);
