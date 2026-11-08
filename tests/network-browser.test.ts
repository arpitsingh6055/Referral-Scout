import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/storage/state', () => ({ read: vi.fn().mockResolvedValue(7), write: vi.fn() }));
const tabs = { get: vi.fn(), update: vi.fn(), create: vi.fn(), sendMessage: vi.fn() };
const windows = { update: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  tabs.get.mockResolvedValue({ id: 7, windowId: 3, status: 'complete', url: 'https://www.linkedin.com/in/alex/' });
  tabs.update.mockResolvedValue({}); tabs.sendMessage.mockResolvedValue({ ok: true });
  vi.stubGlobal('chrome', { tabs, windows, scripting: { executeScript: vi.fn() } });
});

it('reuses the LinkedIn tab without pulling its window in front of the user’s work', async () => {
  const { networkTab } = await import('../src/background/network-browser');
  await networkTab('https://www.linkedin.com/in/alex/', new AbortController().signal);
  expect(tabs.update).toHaveBeenCalledWith(7, { url: 'https://www.linkedin.com/in/alex/', active: true });
  expect(windows.update).not.toHaveBeenCalled();
});
