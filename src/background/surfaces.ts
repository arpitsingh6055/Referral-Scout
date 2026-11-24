/**
 * Where the product opens.
 *
 * The full-page workbench is the default surface: it is the one that can show a queue table, a match explanation
 * and an inbox side by side without squeezing them, and it is easier to read for the long stretches this work
 * actually takes. The side panel stays available for quick control while the person is on LinkedIn, because
 * that is the moment a narrow strip beside the page beats a separate tab.
 *
 * Both read the same background state, so neither is a cut-down copy of the other — they are two views of one
 * campaign, and whichever is open is correct.
 */

import { read, write } from '../storage/state';
import { trustedExtension } from '../validators/security';

export type Surface = 'tab' | 'panel';
const SURFACE_KEY = 'default-surface';
const WORKBENCH = 'workbench.html';

export const defaultSurface = async (): Promise<Surface> => (await read<Surface>(SURFACE_KEY)) ?? 'tab';

export async function setDefaultSurface(surface: Surface): Promise<void> {
  await write(SURFACE_KEY, surface);
  // The toolbar click behaviour has to match the choice, or the setting would be a label with nothing behind it.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: surface === 'panel' }).catch(() => undefined);
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
  const id = tabId ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  if (id === undefined) return;
  await chrome.sidePanel.open({ tabId: id }).catch(() => undefined);
}

const MENU_TAB = 'rs-open-tab';
const MENU_PANEL = 'rs-open-panel';

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

export async function installMenus(): Promise<void> {
  if (!chrome.contextMenus) return;
  await new Promise<void>(resolve => chrome.contextMenus.removeAll(() => resolve()));
  chrome.contextMenus.create({ id: MENU_TAB, title: 'Open Referral Scout dashboard', contexts: ['action'] });
  chrome.contextMenus.create({ id: MENU_PANEL, title: 'Open Referral Scout side panel', contexts: ['action'] });
}

/** The side panel's "Open dashboard" button comes through here, so tab reuse works from both surfaces. */
export function registerSurfaceMessages(): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (!input || typeof input !== 'object' || (input as { kind?: unknown }).kind !== 'surface') return false;
    if (!trustedExtension(sender, chrome.runtime.id)) return false;
    const message = input as { action?: string; route?: string; surface?: Surface };
    if (message.action === 'open-tab')
      void openWorkbench(typeof message.route === 'string' ? message.route : '').then(() => respond({ ok: true }));
    else if (message.action === 'open-panel') void openPanel().then(() => respond({ ok: true }));
    else if (message.action === 'set-default' && (message.surface === 'tab' || message.surface === 'panel'))
      void setDefaultSurface(message.surface).then(() => respond({ ok: true }));
    else if (message.action === 'get-default') void defaultSurface().then(surface => respond({ ok: true, surface }));
    else return false;
    return true;
  });
}

export async function applySurfaceBehaviour(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: (await defaultSurface()) === 'panel' }).catch(() => undefined);
}
