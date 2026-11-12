import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/storage/state', () => ({
  read: vi.fn(async (key: string) => (key === 'work-window' ? 3 : key === 'network-tab' ? 7 : undefined)),
  write: vi.fn(),
}));
const tabs = { get: vi.fn(), update: vi.fn(), create: vi.fn(), sendMessage: vi.fn(), query: vi.fn() };
const windows = { update: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn() };

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

it('closes the work window when nothing is using it, but never while a ChatGPT task is still open in it', async () => {
  const { closeWorkWindow } = await import('../src/background/network-browser');
  tabs.query.mockResolvedValueOnce([{ url: 'https://www.linkedin.com/feed/' }, { url: 'https://chatgpt.com/c/1' }]);
  await closeWorkWindow();
  expect(windows.remove).not.toHaveBeenCalled();
  tabs.query.mockResolvedValueOnce([{ url: 'https://www.linkedin.com/feed/' }]);
  await closeWorkWindow();
  expect(windows.remove).toHaveBeenCalledWith(3);
});
