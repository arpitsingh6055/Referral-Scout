import { networkPageCommand, networkReplySchema, type NetworkPageCommand } from '../shared/network';
import { read, write } from '../storage/state';

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
export async function openWorkTab(url: string, kind: 'linkedin' | 'chatgpt' = 'linkedin'): Promise<number> {
  void kind;
  // One window for everything done in the background, LinkedIn and ChatGPT alike. Steps run one at a time, each tab is
  // brought to the front of that window while it is used, and ChatGPT tabs are closed as soon as their answer is read.
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
    const created = await chrome.windows.create({ url, focused: false, type: 'normal', width: 1180, height: 860 });
    const tabId = created?.tabs?.[0]?.id;
    if (created?.id === undefined || tabId === undefined) throw new Error('Could not open the Referral Scout work window.');
    await write('work-window', created.id);
    return tabId;
  }
  const tab = await chrome.tabs.create({ windowId, url, active: true });
  if (tab.id === undefined) throw new Error('Could not open a tab in the work window.');
  return tab.id;
}
/** Closes the work window once nothing is using it. A ChatGPT task still open in it keeps it alive. */
export async function closeWorkWindow(): Promise<void> {
  const windowId = await read<number>('work-window');
  if (windowId === undefined || windowId < 0) return;
  try {
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs.some(t => /^https:\/\/chatgpt\.com\//.test(t.url ?? ''))) return;
    await chrome.windows.remove(windowId);
  } catch {
    /* already closed by the person */
  }
  await write('work-window', -1);
}
/** Shows a tab inside the work window without focusing that window. */
export async function showWorkTab(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
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
    id = await openWorkTab(url);
    await write('network-tab', id);
  } else await chrome.tabs.update(id, { url, active: true }); // active inside the work window only; the window itself is never focused
  await readyNetworkTab(id, signal);
  return id;
}
