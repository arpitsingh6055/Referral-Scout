/**
 * Where the product opens.
 *
 * Fresh installs open the side panel first because it is the natural extension entry point. The panel stays
 * intentionally small: its first-run screen explains the next action and hands longer setup to the full dashboard.
 * The dashboard owns profile preparation, CV review, campaigns and detailed work; both surfaces share the same
 * background storage, and the user can change the toolbar default at any time.
 */

import { read, write } from '../storage/state';
import { trustedExtension } from '../validators/security';

export type Surface = 'tab' | 'panel';
const SURFACE_KEY = 'default-surface';
const WORKBENCH = 'workbench.html';

export const defaultSurface = async (): Promise<Surface> => (await read<Surface>(SURFACE_KEY)) ?? 'panel';

export async function setDefaultSurface(surface: Surface): Promise<void> {
  await write(SURFACE_KEY, surface);
  // The toolbar click behaviour has to match the choice, or the setting would be a label with nothing behind it.
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: surface === 'panel' })?.catch?.(() => undefined);
}

export const workbenchUrl = (route = ''): string => chrome.runtime.getURL(`${WORKBENCH}${route ? `#${route}` : ''}`);

/**
 * Opens the workbench, reusing the tab that is already showing it rather than stacking up copies. A person who
 * clicks the toolbar five times should end up looking at one dashboard, not five.
 */
export async function openWorkbench(route = ''): Promise<void> {
  const url = workbenchUrl(route);
  const open = await chrome.tabs.query({ url: chrome.runtime.getURL(`${WORKBENCH}*`) }).catch(() => []);
  const existing = open.find(t => t.id !== undefined);
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, ...(route ? { url } : {}) });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => undefined);
    return;
  }
  await chrome.tabs.create({ url, active: true });
}

export async function openPanel(tabId?: number): Promise<void> {
  const activeTab =
    tabId !== undefined
      ? await chrome.tabs.get(tabId).catch(() => undefined)
      : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const id = tabId ?? activeTab?.id;
  const windowId = activeTab?.windowId;
  if (id !== undefined) {
    try {
      await chrome.sidePanel.open({ tabId: id });
      return;
    } catch {
      // Fall back to windowId below if tab-level open is rejected.
    }
  }
  if (windowId !== undefined) await chrome.sidePanel.open({ windowId }).catch(() => undefined);
}

const DEFAULT_LINKEDIN_URL = 'https://www.linkedin.com/jobs/';

const safeLinkedInUrl = (raw?: string): string => {
  if (!raw) return DEFAULT_LINKEDIN_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' && (parsed.hostname === 'linkedin.com' || parsed.hostname.endsWith('.linkedin.com'))) {
      return parsed.toString();
    }
  } catch {
    // Fall back safely to LinkedIn Jobs.
  }
  return DEFAULT_LINKEDIN_URL;
};

/**
 * Focuses (or opens) a LinkedIn tab in the user's normal browser window and programmatically opens the
 * Side Panel beside it so the user never has to hunt for the extension toolbar icon.
 */
export async function openLinkedInWithSidePanel(targetUrl?: string): Promise<{ opened: boolean }> {
  const url = safeLinkedInUrl(targetUrl);
  const existingTabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/*', 'https://linkedin.com/*'] }).catch(() => []);
  const matching =
    targetUrl && existingTabs.find(t => t.url === url) ? existingTabs.find(t => t.url === url) : !targetUrl ? existingTabs[0] : undefined;

  let tabId = matching?.id;
  let windowId = matching?.windowId;

  if (tabId !== undefined) {
    await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
    if (windowId !== undefined) await chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
  } else {
    const win =
      (await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined)) ??
      (await chrome.windows.getAll({ windowTypes: ['normal'] }).catch(() => []))[0];
    const created = await chrome.tabs
      .create({ url, active: true, ...(win?.id !== undefined ? { windowId: win.id } : {}) })
      .catch(() => undefined);
    tabId = created?.id;
    windowId = created?.windowId ?? win?.id;
    if (windowId !== undefined) await chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
  }

  let opened = false;
  if (chrome.sidePanel?.open) {
    if (tabId !== undefined) {
      opened = await chrome.sidePanel
        .open({ tabId })
        .then(() => true)
        .catch(() => false);
    }
    if (!opened && windowId !== undefined) {
      opened = await chrome.sidePanel
        .open({ windowId })
        .then(() => true)
        .catch(() => false);
    }
  }
  return { opened };
}

const MENU_TAB = 'rs-open-tab';
const MENU_PANEL = 'rs-open-panel';

/**
 * Menu installation runs once per service-worker generation.
 *
 * `initialize()` is reached from the module's own top level, from onInstalled and from onStartup, and on an
 * install the first two overlap. Both would clear the menus and then both would create them, so the second
 * create fails with a duplicate id. Memoising the promise means concurrent callers await the same run.
 */
let menus: Promise<void> | undefined;

/** `create` reports failure through lastError; reading it in the callback is what stops the console warning. */
const createMenu = (properties: chrome.contextMenus.CreateProperties): Promise<void> =>
  new Promise(resolve =>
    chrome.contextMenus.create(properties, () => {
      void chrome.runtime.lastError;
      resolve();
    }),
  );

/**
 * Registers the toolbar click and the right-click menu. The menu is what makes the non-default surface reachable
 * without a trip into settings — whichever one the toolbar does not do, the menu does.
 */
export function registerSurfaces(): void {
  chrome.action.onClicked.addListener(tab => {
    // With the panel as default the browser opens it itself and this never fires.
    void defaultSurface().then(surface => (surface === 'panel' ? openPanel(tab.id) : openWorkbench()));
  });

  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_TAB) void openWorkbench();
    if (info.menuItemId === MENU_PANEL) void openPanel(tab?.id);
  });
}

export function installMenus(): Promise<void> {
  if (!chrome.contextMenus) return Promise.resolve();
  menus ??= (async () => {
    await new Promise<void>(resolve => chrome.contextMenus.removeAll(() => resolve()));
    await createMenu({ id: MENU_TAB, title: 'Open Referral Scout dashboard', contexts: ['action'] });
    await createMenu({ id: MENU_PANEL, title: 'Open Referral Scout side panel', contexts: ['action'] });
  })().catch(() => {
    // A failed install should not poison the memo: the next generation may well succeed.
    menus = undefined;
  });
  return menus;
}

/** The side panel's "Open dashboard" button comes through here, so tab reuse works from both surfaces. */
export function registerSurfaceMessages(): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (!input || typeof input !== 'object' || (input as { kind?: unknown }).kind !== 'surface') return false;
    if (!trustedExtension(sender, chrome.runtime.id)) return false;
    const message = input as { action?: string; route?: string; url?: string; surface?: Surface };
    if (message.action === 'open-tab')
      void openWorkbench(typeof message.route === 'string' ? message.route : '').then(() => respond({ ok: true }));
    else if (message.action === 'open-panel') {
      if (typeof message.url === 'string' && message.url) {
        void openLinkedInWithSidePanel(message.url).then(res => respond({ ok: true, ...res }));
      } else {
        void openPanel().then(() => respond({ ok: true, opened: true }));
      }
    } else if (message.action === 'open-linkedin-panel')
      void openLinkedInWithSidePanel(typeof message.url === 'string' ? message.url : undefined).then(res => respond({ ok: true, ...res }));
    else if (message.action === 'set-default' && (message.surface === 'tab' || message.surface === 'panel'))
      void setDefaultSurface(message.surface).then(() => respond({ ok: true }));
    else if (message.action === 'get-default') void defaultSurface().then(surface => respond({ ok: true, surface }));
    else return false;
    return true;
  });
}

export async function applySurfaceBehaviour(): Promise<void> {
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: (await defaultSurface()) === 'panel' })?.catch?.(() => undefined);
}
