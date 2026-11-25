import { networkPageCommand, networkReplySchema, type NetworkPageCommand } from '../shared/network';
import { read, write } from '../storage/state';

export type TabMode = 'background' | 'foreground';
export type ManagedTabPurpose = 'chatgpt_extract' | 'linkedin_scrape' | 'ats_check' | 'user_navigation';

export interface ManagedTabOptions {
  url: string;
  /** Explicit launch intent: `'background'` keeps `active: false` and guards user focus; `'foreground'` focuses intentionally. */
  mode: TabMode;
  purpose: ManagedTabPurpose;
  openerTabId?: number;
  windowId?: number;
  autoCloseOnComplete?: boolean;
  reuseTabId?: number;
}

export interface ManagedTabHandle {
  tabId: number;
  windowId: number | undefined;
  mode: TabMode;
  purpose: ManagedTabPurpose;
  originalTabId?: number;
  originalWindowId?: number;
  releaseFocusGuard: () => void;
  close: () => Promise<void>;
}

const activeBackgroundGuards = new Map<number, () => void>();

/** Releases any active background focus-lock guard for `tabId` (for example right before user escalation). */
export function releaseBackgroundGuard(tabId: number): void {
  activeBackgroundGuards.get(tabId)?.();
}

export async function networkCommand(
  tabId: number,
  input: Partial<NetworkPageCommand> & Pick<NetworkPageCommand, 'action'>,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  const cmd = networkPageCommand.parse({ ...input, kind: 'network.page', requestId: crypto.randomUUID(), deadline: Date.now() + 60000 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      chrome.tabs.sendMessage(tabId, cmd),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('LinkedIn took too long to respond. Open the contact to check what happened.')), 60000);
      }),
    ]);
    const reply = networkReplySchema.parse(raw);
    if (reply.requestId !== cmd.requestId || !reply.ok) throw new Error(reply.error || 'LinkedIn did not answer this request.');
    return reply.data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export async function readyNetworkTab(tabId: number, signal: AbortSignal): Promise<void> {
  let injected = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    signal.throwIfAborted();
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      const url = new URL(tab.url || 'about:blank');
      if (!['www.linkedin.com', 'linkedin.com'].includes(url.hostname) || /login|checkpoint|challenge|authwall/.test(url.pathname))
        throw new Error('Sign in to LinkedIn and resolve any account notice before continuing.');
      try {
        const result = await chrome.tabs.sendMessage(tabId, { kind: 'network.ping' });
        if (result?.ok) return;
      } catch {
        /* inject updated runtime once */
      }
      if (!injected) {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['health.js'] });
        injected = true;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('LinkedIn did not finish loading. Refresh LinkedIn and try again.');
}
/**
 * Pages are opened in one separate "work" window that is never brought to the front, so the
 * person can keep using their own window and tabs while outreach runs.
 */
export async function openWorkTab(url: string, kind: 'linkedin' | 'chatgpt' = 'linkedin', active = false): Promise<number> {
  void kind;
  // One window for everything done in the background, LinkedIn and ChatGPT alike. Tabs default to `active: false` so
  // background work never steals focus, and ChatGPT tabs are closed as soon as their answer is read.
  const stale = await read<number>('chatgpt-window'); // the separate ChatGPT window of earlier versions
  if (stale !== undefined && stale >= 0) {
    await chrome.windows.remove(stale).catch(() => undefined);
    await write('chatgpt-window', -1);
  }
  let windowId = await read<number>('work-window');
  if (windowId !== undefined) {
    try {
      if (windowId < 0) throw new Error('closed');
      await chrome.windows.get(windowId);
    } catch {
      windowId = undefined;
    }
  }
  if (windowId === undefined) {
    // Browsers often ignore focused:false for a NEW window and bring it to the front, so remember where the person
    // was and hand focus straight back.
    let before: { id?: number | undefined } | undefined;
    try {
      before = await chrome.windows.getLastFocused();
    } catch {
      before = undefined; // nothing to hand focus back to
    }
    const created = await chrome.windows.create({ url, focused: false, type: 'normal', width: 1180, height: 860 });
    if (before?.id !== undefined && before.id !== created?.id)
      await chrome.windows.update(before.id, { focused: true }).catch(() => undefined);
    const tabId = created?.tabs?.[0]?.id;
    if (created?.id === undefined || tabId === undefined) throw new Error('Could not open the Referral Scout work window.');
    await write('work-window', created.id);
    return tabId;
  }
  // The work window keeps one empty tab instead of closing (see closeWorkTab): reuse it before opening another.
  await write('work-idle-since', 0);
  const spare = await read<number>('work-spare');
  if (spare !== undefined && spare >= 0) {
    await write('work-spare', -1);
    try {
      if ((await chrome.tabs.get(spare)).windowId === windowId) {
        await chrome.tabs.update(spare, { url, active });
        return spare;
      }
    } catch {
      /* the person closed it */
    }
  }
  const tab = await chrome.tabs.create({ windowId, url, active });
  if (tab.id === undefined) throw new Error('Could not open a tab in the work window.');
  return tab.id;
}
let closing: Promise<unknown> = Promise.resolve();
/**
 * Closes a tab the extension is done with (a ChatGPT answer read, a job page read). The work window always keeps one
 * tab, emptied, so the window is not closed and reopened between tasks: reopening a window is slow and can pull it in
 * front of the person. Closes are done one at a time so two finishing together never close the window.
 */
export function closeWorkTab(tabId: number): Promise<void> {
  const run = closing.then(async () => {
    try {
      const tab = await chrome.tabs.get(tabId);
      const windowId = await read<number>('work-window');
      if (windowId !== undefined && tab.windowId === windowId && (await chrome.tabs.query({ windowId })).length <= 1) {
        await chrome.tabs.update(tabId, { url: 'about:blank' });
        await write('work-spare', tabId);
        if ((await read<number>('network-tab')) === tabId) await write('network-tab', -1);
        return;
      }
      await chrome.tabs.remove(tabId);
    } catch {
      /* already closed */
    }
  });
  closing = run.catch(() => undefined);
  return run;
}
/**
 * Tidies the work window once nothing is using it: every tab is closed except one, which is emptied and kept so the
 * next task starts at once instead of opening a new window. A ChatGPT task still open in it is left alone.
 */
const IDLE_CLOSE_MS = 30 * 60000;
export async function closeWorkWindow(): Promise<void> {
  const windowId = await read<number>('work-window');
  if (windowId === undefined || windowId < 0) return;
  try {
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs.some(t => /^https:\/\/chatgpt\.com\//.test(t.url ?? ''))) return;
    if (tabs.length === 1 && tabs[0]!.url === 'about:blank') {
      // Already tidy. After half an hour with nothing to do, close the window itself; the next task opens a new one.
      const since = (await read<number>('work-idle-since')) ?? 0;
      if (!since) await write('work-idle-since', Date.now());
      else if (Date.now() - since > IDLE_CLOSE_MS) {
        await chrome.windows.remove(windowId).catch(() => undefined);
        await write('work-window', -1);
        await write('work-spare', -1);
        await write('work-idle-since', 0);
      }
      return;
    }
    await write('work-idle-since', 0);
    const [keep, ...rest] = tabs;
    if (rest.length) await chrome.tabs.remove(rest.map(t => t.id!).filter(id => id !== undefined));
    if (keep?.id !== undefined) {
      await chrome.tabs.update(keep.id, { url: 'about:blank' });
      await write('work-spare', keep.id);
    }
    await write('network-tab', -1);
  } catch {
    await write('work-window', -1); // closed by the person
  }
}
/** Legacy hook retained for API compatibility: background tasks must never steal foreground focus mid-run. */
export async function showWorkTab(_tabId: number): Promise<void> {
  // Intentionally a no-op so automated LinkedIn/ChatGPT workers stay silent unless user explicitly clicks Inspect Tab.
}

/**
 * Centralized intent-aware TabOrchestrator.
 *
 * - `mode: 'background'` captures the user's active tab/window, forces `active: false`, installs a focus-lock
 *   guard against script/redirect focus hijacks, and cleans up via `handle.close()`.
 * - `mode: 'foreground'` explicitly focuses/opens the target tab and its window for user-initiated navigation.
 */
export async function openManagedTab(options: ManagedTabOptions): Promise<ManagedTabHandle> {
  if (options.mode === 'foreground') {
    if (options.reuseTabId !== undefined) {
      releaseBackgroundGuard(options.reuseTabId);
      const updated = await chrome.tabs.update(options.reuseTabId, {
        active: true,
        ...(options.url ? { url: options.url } : {}),
      });
      const existing = updated ?? (await chrome.tabs.get(options.reuseTabId).catch(() => undefined));
      const winId = existing?.windowId ?? options.windowId;
      if (winId !== undefined) await chrome.windows.update(winId, { focused: true }).catch(() => undefined);
      return {
        tabId: options.reuseTabId,
        windowId: winId,
        mode: 'foreground',
        purpose: options.purpose,
        releaseFocusGuard: () => undefined,
        close: async () => {
          await closeWorkTab(options.reuseTabId!);
        },
      };
    }

    let targetWindowId = options.windowId;
    if (targetWindowId === undefined) {
      const win =
        (await chrome.windows.getLastFocused?.({ windowTypes: ['normal'] }).catch(() => undefined)) ??
        (await chrome.windows.getAll?.({ windowTypes: ['normal'] }).catch(() => []))?.[0];
      targetWindowId = win?.id;
    }
    const created = await chrome.tabs.create({
      url: options.url,
      active: true,
      ...(targetWindowId !== undefined ? { windowId: targetWindowId } : {}),
      ...(options.openerTabId !== undefined ? { openerTabId: options.openerTabId } : {}),
    });
    if (created.id === undefined) throw new Error('Could not open browser tab.');
    const winId = created.windowId ?? targetWindowId;
    if (winId !== undefined) await chrome.windows.update(winId, { focused: true }).catch(() => undefined);
    return {
      tabId: created.id,
      windowId: winId,
      mode: 'foreground',
      purpose: options.purpose,
      releaseFocusGuard: () => undefined,
      close: async () => {
        await chrome.tabs.remove(created.id!).catch(() => undefined);
      },
    };
  }

  // `mode: 'background'`: capture current user focus before opening or reusing any worker tab.
  const activeTabs = await chrome.tabs.query?.({ active: true, lastFocusedWindow: true }).catch(() => []);
  const originalTabId = activeTabs?.[0]?.id;
  const focusedWin = await chrome.windows.getLastFocused?.().catch(() => undefined);
  const originalWindowId = focusedWin?.id ?? activeTabs?.[0]?.windowId;

  let tabId: number;
  let windowId = options.windowId;
  if (options.reuseTabId !== undefined) {
    await chrome.tabs.update(options.reuseTabId, { url: options.url, active: false });
    tabId = options.reuseTabId;
    windowId ??= (await chrome.tabs.get(tabId).catch(() => undefined))?.windowId;
  } else if (options.windowId !== undefined || options.openerTabId !== undefined) {
    const created = await chrome.tabs.create({
      url: options.url,
      active: false,
      ...(options.windowId !== undefined ? { windowId: options.windowId } : {}),
      ...(options.openerTabId !== undefined ? { openerTabId: options.openerTabId } : {}),
    });
    if (created.id === undefined) throw new Error('Could not open background worker tab.');
    tabId = created.id;
    windowId = created.windowId ?? options.windowId;
  } else {
    const kind = options.purpose === 'chatgpt_extract' ? 'chatgpt' : 'linkedin';
    tabId = await openWorkTab(options.url, kind, false);
    windowId = (await read<number>('work-window')) ?? undefined;
  }

  // Re-assert user's active tab/window if creation caused any focus jitter.
  if (originalWindowId !== undefined && originalWindowId !== windowId) {
    await chrome.windows.update(originalWindowId, { focused: true }).catch(() => undefined);
  }
  if (originalTabId !== undefined && originalTabId !== tabId) {
    await chrome.tabs.update(originalTabId, { active: true }).catch(() => undefined);
  }

  let released = false;
  const onActivated = (info: { tabId: number; windowId: number }): void => {
    if (released || info.tabId !== tabId) return;
    if (originalTabId !== undefined && originalTabId !== tabId) {
      void chrome.tabs.update(originalTabId, { active: true }).catch(() => undefined);
    }
    if (originalWindowId !== undefined && originalWindowId !== windowId) {
      void chrome.windows.update(originalWindowId, { focused: true }).catch(() => undefined);
    }
  };
  const onRemoved = (removedId: number): void => {
    if (removedId === tabId) releaseFocusGuard();
  };
  const releaseFocusGuard = (): void => {
    if (released) return;
    released = true;
    activeBackgroundGuards.delete(tabId);
    chrome.tabs.onActivated?.removeListener?.(onActivated);
    chrome.tabs.onRemoved?.removeListener?.(onRemoved);
  };

  releaseBackgroundGuard(tabId);
  activeBackgroundGuards.set(tabId, releaseFocusGuard);
  chrome.tabs.onActivated?.addListener?.(onActivated);
  chrome.tabs.onRemoved?.addListener?.(onRemoved);

  return {
    tabId,
    windowId,
    mode: 'background',
    purpose: options.purpose,
    ...(originalTabId !== undefined ? { originalTabId } : {}),
    ...(originalWindowId !== undefined ? { originalWindowId } : {}),
    releaseFocusGuard,
    close: async () => {
      releaseFocusGuard();
      const workWin = await read<number>('work-window');
      if (workWin !== undefined && workWin === windowId) await closeWorkTab(tabId);
      else await chrome.tabs.remove(tabId).catch(() => undefined);
    },
  };
}

/** Intentionally brings a background worker tab (e.g., on human intervention / Inspect Tab) to the foreground. */
export async function focusManagedTab(tabId?: number, fallbackUrl?: string): Promise<boolean> {
  if (tabId !== undefined) {
    releaseBackgroundGuard(tabId);
    const existing = await chrome.tabs.get(tabId).catch(() => undefined);
    if (existing?.id !== undefined) {
      await openManagedTab({
        url: existing.url ?? '',
        mode: 'foreground',
        purpose: 'user_navigation',
        reuseTabId: existing.id,
        ...(existing.windowId !== undefined ? { windowId: existing.windowId } : {}),
      });
      return true;
    }
  }
  if (fallbackUrl) {
    await openManagedTab({ url: fallbackUrl, mode: 'foreground', purpose: 'user_navigation' });
    return true;
  }
  return false;
}

export async function networkTab(url: string, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  let id = await read<number>('network-tab');
  // Only reuse a tab that lives in the work window. A tab left in the person's own window (from an older version) is never taken over.
  if (id !== undefined) {
    try {
      if ((await chrome.tabs.get(id)).windowId !== (await read<number>('work-window'))) id = undefined;
    } catch {
      id = undefined;
    }
  }
  if (id === undefined) {
    id = await openWorkTab(url, 'linkedin', false);
    await write('network-tab', id);
  } else await chrome.tabs.update(id, { url, active: false });
  await readyNetworkTab(id, signal);
  return id;
}

/** How many read-only pages (job descriptions) are loaded at the same time. Kept small: a person browsing in a few tabs. */
export const PARALLEL_PAGES = 4;
/**
 * Loads several LinkedIn pages at once, each in its own extra tab of the work window, reads each with `readPage`, and
 * closes those tabs at the end - whatever happens. For read-only visits such as job descriptions: nothing is clicked or
 * sent. Tabs start a moment apart and are opened one at a time, so only one work window is ever created. A page that
 * fails gives `undefined` instead of stopping the others. `shouldStop` is checked before each new page is started;
 * pages already loading are finished.
 */
export async function readPagesInParallel<T>(
  urls: string[],
  readPage: (tabId: number, url: string) => Promise<T>,
  signal: AbortSignal,
  options: {
    concurrency?: number;
    staggerMs?: number;
    shouldStop?: () => Promise<boolean>;
    onDone?: (url: string, result: T | undefined) => Promise<unknown> | void;
  } = {},
): Promise<Map<string, T | undefined>> {
  const results = new Map<string, T | undefined>();
  if (!urls.length) return results;
  const queue = [...urls],
    opened: number[] = [],
    workers = Math.max(1, Math.min(options.concurrency ?? PARALLEL_PAGES, urls.length)),
    stagger = options.staggerMs ?? 900;
  let stopped = false,
    opening: Promise<unknown> = Promise.resolve();
  const next = async (): Promise<string | undefined> => {
    if (stopped || signal.aborted) return undefined;
    if (options.shouldStop && (await options.shouldStop())) {
      stopped = true;
      return undefined;
    }
    return queue.shift();
  };
  // One tab opens at a time, so the work window is created at most once even when it does not exist yet.
  const openTab = (url: string): Promise<number> => {
    const tab = opening.then(() => openWorkTab(url, 'linkedin', false));
    opening = tab.catch(() => undefined);
    return tab;
  };
  const worker = async (index: number): Promise<void> => {
    if (index) await new Promise(resolve => setTimeout(resolve, index * stagger));
    let tabId: number | undefined;
    for (let url = await next(); url !== undefined; url = await next()) {
      let result: T | undefined;
      try {
        if (tabId === undefined) {
          tabId = await openTab(url);
          opened.push(tabId);
        } else await chrome.tabs.update(tabId, { url });
        await readyNetworkTab(tabId, signal);
        result = await readPage(tabId, url);
      } catch (error) {
        if (signal.aborted) throw error;
        result = undefined; // one unreadable page never stops the rest
      }
      results.set(url, result);
      await options.onDone?.(url, result);
    }
  };
  try {
    await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
  } finally {
    for (const id of opened) await closeWorkTab(id);
  }
  return results;
}
