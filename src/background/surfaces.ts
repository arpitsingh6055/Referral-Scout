/**
 * Where the product opens.
 *
 * Fresh installs open the side panel first because it is the natural extension entry point. The panel stays
 * intentionally small: its first-run screen explains the next action and hands longer setup to the full dashboard.
 * The dashboard owns profile preparation, CV review, campaigns and detailed work; both surfaces share the same
 * background storage, and the user can change the toolbar default at any time.
 */

import { publishActiveMission, readActiveMission, type MissionSurface } from '../shared/progress-store';
import { read, write } from '../storage/state';
import { trustedExtension } from '../validators/security';
import { focusManagedTab, openManagedTab } from './network-browser';

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
    await openManagedTab({
      url: route ? url : '',
      mode: 'foreground',
      purpose: 'user_navigation',
      reuseTabId: existing.id,
      ...(existing.windowId !== undefined ? { windowId: existing.windowId } : {}),
    });
    return;
  }
  await openManagedTab({ url, mode: 'foreground', purpose: 'user_navigation' });
}

export async function openPanel(tabId?: number): Promise<boolean> {
  const activeTab =
    tabId !== undefined
      ? await chrome.tabs.get(tabId).catch(() => undefined)
      : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const id = tabId ?? activeTab?.id;
  const windowId = activeTab?.windowId;
  if (id !== undefined) {
    try {
      await chrome.sidePanel.open({ tabId: id });
      return true;
    } catch {
      // Fall back to windowId below if tab-level open is rejected.
    }
  }
  if (windowId !== undefined) {
    try {
      await chrome.sidePanel.open({ windowId });
      return true;
    } catch {
      return false;
    }
  }
  return false;
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
    const handle = await openManagedTab({
      url: '',
      mode: 'foreground',
      purpose: 'user_navigation',
      reuseTabId: tabId,
      ...(windowId !== undefined ? { windowId } : {}),
    });
    tabId = handle.tabId;
    windowId = handle.windowId;
  } else {
    const handle = await openManagedTab({ url, mode: 'foreground', purpose: 'user_navigation' }).catch(() => undefined);
    tabId = handle?.tabId;
    windowId = handle?.windowId;
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

/** Focuses an existing LinkedIn tab (or opens one) without touching the Side Panel gesture flow. */
export async function focusLinkedInTab(
  targetUrl?: string,
  preferredTabId?: number,
): Promise<{ focused: boolean; tabId?: number; windowId?: number }> {
  if (preferredTabId !== undefined) {
    const focused = await focusManagedTab(preferredTabId, targetUrl ? safeLinkedInUrl(targetUrl) : undefined);
    if (focused) {
      const tab = await chrome.tabs.get(preferredTabId).catch(() => undefined);
      return {
        focused: true,
        ...(tab?.id !== undefined ? { tabId: tab.id } : {}),
        ...(tab?.windowId !== undefined ? { windowId: tab.windowId } : {}),
      };
    }
  }
  const url = safeLinkedInUrl(targetUrl);
  const existingTabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/*', 'https://linkedin.com/*'] }).catch(() => []);
  const matching = targetUrl && existingTabs.find(t => t.url === url) ? existingTabs.find(t => t.url === url) : existingTabs[0];
  if (matching?.id !== undefined) {
    const handle = await openManagedTab({
      url: targetUrl ? url : '',
      mode: 'foreground',
      purpose: 'user_navigation',
      reuseTabId: matching.id,
      ...(matching.windowId !== undefined ? { windowId: matching.windowId } : {}),
    }).catch(() => undefined);
    return {
      focused: !!handle,
      ...(handle?.tabId !== undefined ? { tabId: handle.tabId } : {}),
      ...(handle?.windowId !== undefined ? { windowId: handle.windowId } : {}),
    };
  }
  const handle = await openManagedTab({ url, mode: 'foreground', purpose: 'user_navigation' }).catch(() => undefined);
  return {
    focused: !!handle,
    ...(handle?.tabId !== undefined ? { tabId: handle.tabId } : {}),
    ...(handle?.windowId !== undefined ? { windowId: handle.windowId } : {}),
  };
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
    void defaultSurface().then(surface => (surface === 'panel' ? void openPanel(tab.id) : openWorkbench()));
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

const openSidePanelPorts = new Set<chrome.runtime.Port>();

/** Tracks Side Panel open/close lifetime via `runtime.connect({ name: 'sidepanel-lifecycle' })`. */
export function registerSidePanelLifecycle(): void {
  chrome.runtime?.onConnect?.addListener(port => {
    if (port.name !== 'sidepanel-lifecycle') return;
    if (port.sender?.id && port.sender.id !== chrome.runtime.id) return;
    openSidePanelPorts.add(port);
    void publishActiveMission({ isSidePanelOpen: true });
    port.onDisconnect.addListener(() => {
      openSidePanelPorts.delete(port);
      void publishActiveMission({ isSidePanelOpen: openSidePanelPorts.size > 0 });
    });
  });
}

export const isSidePanelOpen = (): boolean => openSidePanelPorts.size > 0;

/**
 * Unified NavigationCoordinator (`summonActiveWorkspace`): jumps straight back to whichever surface
 * currently owns the mission (`workbench` route OR the active LinkedIn/ATS tab + Side Panel).
 */
export async function summonActiveWorkspace(surfaceOverride?: MissionSurface, senderTabId?: number): Promise<{ opened: boolean }> {
  const mission = await readActiveMission();
  const targetSurface = surfaceOverride ?? mission.recommendedSurface;
  if (targetSurface === 'workbench') {
    await openWorkbench(mission.activeRoute || 'overview');
    return { opened: true };
  }
  const targetTabId = senderTabId ?? mission.activeTabId;
  if (targetTabId !== undefined) {
    const focused = await focusManagedTab(targetTabId, mission.activeTabUrl || DEFAULT_LINKEDIN_URL);
    if (focused) {
      await openPanel(targetTabId);
      return { opened: true };
    }
  }
  return openLinkedInWithSidePanel(mission.activeTabUrl || DEFAULT_LINKEDIN_URL);
}

/** The side panel's "Open dashboard" button comes through here, so tab reuse works from both surfaces. */
export function registerSurfaceMessages(): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (!input || typeof input !== 'object') return false;
    if (!trustedExtension(sender, chrome.runtime.id)) return false;

    const rawType = (input as { type?: unknown }).type;
    if (rawType === 'OPEN_SIDE_PANEL') {
      const tabId = sender.tab?.id;
      void openPanel(tabId).then(opened => respond({ ok: true, opened }));
      return true;
    }

    if ((input as { kind?: unknown }).kind !== 'surface') return false;
    const message = input as {
      action?: string;
      route?: string;
      url?: string;
      tabId?: number;
      surface?: Surface | MissionSurface;
    };
    if (message.action === 'open-tab')
      void openWorkbench(typeof message.route === 'string' ? message.route : '').then(() => respond({ ok: true }));
    else if (message.action === 'summon-controls') {
      void (async () => {
        const openedPanel = await openPanel(sender.tab?.id);
        if (openedPanel) {
          respond({ ok: true, surface: 'panel' });
          return;
        }
        await openWorkbench('jobs');
        respond({ ok: true, surface: 'workbench' });
      })();
    } else if (message.action === 'open-panel') {
      if (typeof message.url === 'string' && message.url) {
        void openLinkedInWithSidePanel(message.url).then(res => respond({ ok: true, ...res }));
      } else {
        void openPanel(sender.tab?.id).then(opened => respond({ ok: true, opened }));
      }
    } else if (message.action === 'open-linkedin-panel')
      void openLinkedInWithSidePanel(typeof message.url === 'string' ? message.url : undefined).then(res => respond({ ok: true, ...res }));
    else if (message.action === 'focus-linkedin-tab')
      void focusLinkedInTab(
        typeof message.url === 'string' ? message.url : undefined,
        typeof message.tabId === 'number' ? message.tabId : undefined,
      ).then(res => respond({ ok: true, ...res }));
    else if (message.action === 'focus-tab')
      void focusManagedTab(
        typeof message.tabId === 'number' ? message.tabId : undefined,
        typeof message.url === 'string' ? message.url : undefined,
      ).then(focused => respond({ ok: true, focused }));
    else if (message.action === 'summon-workspace') {
      const override =
        message.surface === 'workbench' || message.surface === 'linkedin_tab' || message.surface === 'ats_tab'
          ? message.surface
          : undefined;
      void summonActiveWorkspace(override, sender.tab?.id).then(res => respond({ ok: true, ...res }));
    } else if (message.action === 'set-default' && (message.surface === 'tab' || message.surface === 'panel'))
      void setDefaultSurface(message.surface).then(() => respond({ ok: true }));
    else if (message.action === 'get-default') void defaultSurface().then(surface => respond({ ok: true, surface }));
    else return false;
    return true;
  });
}

export async function applySurfaceBehaviour(): Promise<void> {
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: (await defaultSurface()) === 'panel' })?.catch?.(() => undefined);
}
