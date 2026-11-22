import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/storage/state', () => ({
  read: vi.fn(async (key: string) => (key === 'work-window' ? 3 : key === 'network-tab' ? 7 : undefined)),
  write: vi.fn(),
}));
const tabs = { get: vi.fn(), update: vi.fn(), create: vi.fn(), sendMessage: vi.fn(), query: vi.fn(), remove: vi.fn() };
const windows = { update: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn(), getLastFocused: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  tabs.get.mockResolvedValue({ id: 7, windowId: 3, status: 'complete', url: 'https://www.linkedin.com/in/alex/' });
  tabs.update.mockResolvedValue({});
  tabs.sendMessage.mockResolvedValue({ ok: true });
  vi.stubGlobal('chrome', { tabs, windows, scripting: { executeScript: vi.fn() } });
});

it('reuses the LinkedIn tab without pulling its window in front of the user’s work', async () => {
  const { networkTab } = await import('../src/background/network-browser');
  await networkTab('https://www.linkedin.com/in/alex/', new AbortController().signal);
  expect(tabs.update).toHaveBeenCalledWith(7, { url: 'https://www.linkedin.com/in/alex/', active: true });
  expect(windows.update).not.toHaveBeenCalled();
});

it('opens its pages in a separate window that is not focused, so the person keeps their own window', async () => {
  const state = await import('../src/storage/state');
  vi.mocked(state.read).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined); // no old ChatGPT window, no work window yet
  windows.create.mockResolvedValue({ id: 5, tabs: [{ id: 21 }] });
  const { openWorkTab } = await import('../src/background/network-browser');
  expect(await openWorkTab('https://chatgpt.com/')).toBe(21);
  expect(windows.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://chatgpt.com/', focused: false }));
  expect(state.write).toHaveBeenCalledWith('work-window', 5);
  expect(tabs.create).not.toHaveBeenCalled();
});

it('hands focus back to the person’s window when a new work window grabs it', async () => {
  const state = await import('../src/storage/state');
  vi.mocked(state.read).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
  windows.getLastFocused.mockResolvedValue({ id: 1 });
  windows.create.mockResolvedValue({ id: 5, tabs: [{ id: 21 }] });
  windows.update.mockResolvedValue({});
  const { openWorkTab } = await import('../src/background/network-browser');
  await openWorkTab('https://www.linkedin.com/jobs/search-results/');
  expect(windows.update).toHaveBeenCalledWith(1, { focused: true });
});

it('opens ChatGPT as a tab in the same work window instead of a second window, and closes a ChatGPT window left by an older version', async () => {
  const state = await import('../src/storage/state');
  vi.mocked(state.read).mockResolvedValueOnce(44); // the old separate ChatGPT window
  windows.get.mockResolvedValue({ id: 3 });
  windows.remove.mockResolvedValue(undefined);
  tabs.create.mockResolvedValue({ id: 31 });
  const { openWorkTab } = await import('../src/background/network-browser');
  expect(await openWorkTab('https://chatgpt.com/', 'chatgpt')).toBe(31);
  expect(windows.remove).toHaveBeenCalledWith(44);
  expect(tabs.create).toHaveBeenCalledWith({ windowId: 3, url: 'https://chatgpt.com/', active: true });
  expect(windows.create).not.toHaveBeenCalled();
});

it('tidies the work window down to one empty tab when nothing is using it, never while a ChatGPT task is open in it', async () => {
  const state = await import('../src/storage/state');
  const { closeWorkWindow } = await import('../src/background/network-browser');
  tabs.query.mockResolvedValueOnce([
    { id: 7, url: 'https://www.linkedin.com/feed/' },
    { id: 8, url: 'https://chatgpt.com/c/1' },
  ]);
  await closeWorkWindow();
  expect(tabs.remove).not.toHaveBeenCalled();
  tabs.query.mockResolvedValueOnce([
    { id: 7, url: 'https://www.linkedin.com/feed/' },
    { id: 9, url: 'https://www.linkedin.com/jobs/view/1/' },
  ]);
  await closeWorkWindow();
  expect(windows.remove).not.toHaveBeenCalled(); // the window stays, so the next task starts at once
  expect(tabs.remove).toHaveBeenCalledWith([9]);
  expect(tabs.update).toHaveBeenCalledWith(7, { url: 'about:blank' });
  expect(state.write).toHaveBeenCalledWith('work-spare', 7);
});

it('closes a finished tab, but empties the last tab of the work window instead of closing the window', async () => {
  const state = await import('../src/storage/state');
  const { closeWorkTab } = await import('../src/background/network-browser');
  tabs.get.mockResolvedValue({ id: 31, windowId: 3, url: 'https://chatgpt.com/c/1' });
  tabs.query.mockResolvedValueOnce([{ id: 7 }, { id: 31 }]);
  await closeWorkTab(31);
  expect(tabs.remove).toHaveBeenCalledWith(31);
  tabs.query.mockResolvedValueOnce([{ id: 31 }]);
  await closeWorkTab(31);
  expect(tabs.remove).toHaveBeenCalledTimes(1);
  expect(tabs.update).toHaveBeenCalledWith(31, { url: 'about:blank' });
  expect(state.write).toHaveBeenCalledWith('work-spare', 31);
});

it('reuses the empty tab for the next task instead of opening another', async () => {
  const state = await import('../src/storage/state');
  vi.mocked(state.read).mockImplementation(async (key: string) =>
    key === 'work-window' ? 3 : key === 'work-spare' ? 31 : key === 'network-tab' ? 7 : undefined,
  );
  windows.get.mockResolvedValue({ id: 3 });
  tabs.get.mockResolvedValue({ id: 31, windowId: 3, url: 'about:blank' });
  const { openWorkTab } = await import('../src/background/network-browser');
  expect(await openWorkTab('https://chatgpt.com/', 'chatgpt')).toBe(31);
  expect(tabs.update).toHaveBeenCalledWith(31, { url: 'https://chatgpt.com/', active: true });
  expect(tabs.create).not.toHaveBeenCalled();
  expect(state.write).toHaveBeenCalledWith('work-spare', -1);
  vi.mocked(state.read).mockImplementation(async (key: string) => (key === 'work-window' ? 3 : key === 'network-tab' ? 7 : undefined));
});

describe('reading several job pages at once', () => {
  const urls = Array.from({ length: 10 }, (_, i) => `https://www.linkedin.com/jobs/view/${1000 + i}/`);
  beforeEach(() => {
    let next = 100;
    windows.get.mockResolvedValue({ id: 3 });
    tabs.create.mockImplementation(async () => ({ id: next++ }));
    tabs.remove.mockResolvedValue(undefined);
    tabs.query.mockResolvedValue([{ id: 7 }, { id: 100 }, { id: 101 }, { id: 102 }, { id: 103 }]); // the LinkedIn tab stays
  });

  it('uses at most four background tabs, reads every page, and closes every tab it opened', async () => {
    const { readPagesInParallel } = await import('../src/background/network-browser');
    let inFlight = 0,
      most = 0;
    const got = await readPagesInParallel(
      urls,
      async (_tab, url) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight--;
        return url.slice(-5);
      },
      new AbortController().signal,
      { staggerMs: 0 },
    );
    expect(got.size).toBe(10);
    expect(got.get(urls[3]!)).toBe('1003/');
    expect(most).toBeLessThanOrEqual(4);
    expect(tabs.create).toHaveBeenCalledTimes(4);
    for (const call of tabs.create.mock.calls) expect(call[0]).toMatchObject({ windowId: 3, active: false });
    expect(tabs.remove.mock.calls.map(c => c[0]).sort()).toEqual([100, 101, 102, 103]);
  });

  it('carries on when one page fails, and still closes the tabs', async () => {
    const { readPagesInParallel } = await import('../src/background/network-browser');
    const got = await readPagesInParallel(
      urls.slice(0, 3),
      async (_tab, url) => {
        if (url.includes('1001')) throw new Error('page did not load');
        return 'ok';
      },
      new AbortController().signal,
      { staggerMs: 0 },
    );
    expect([...got.values()]).toEqual(expect.arrayContaining(['ok', undefined]));
    expect(got.size).toBe(3);
    expect(tabs.remove).toHaveBeenCalled();
  });

  it('stops starting new pages when asked to, finishing only those already loading', async () => {
    const { readPagesInParallel } = await import('../src/background/network-browser');
    let done = 0;
    const got = await readPagesInParallel(urls, async () => 'ok', new AbortController().signal, {
      staggerMs: 0,
      shouldStop: async () => done >= 2,
      onDone: () => {
        done++;
      },
    });
    expect(got.size).toBeLessThan(urls.length);
    expect(tabs.remove).toHaveBeenCalled();
  });
});
