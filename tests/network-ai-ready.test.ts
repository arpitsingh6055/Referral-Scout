import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('accepts background messages without sender URL and waits through replaced ChatGPT composer', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'abc',
      getURL: (s: string) => `chrome-extension://abc/${s}`,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  });
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div>';
  await import('../src/content/network-ai');
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]![0];
  const ping = (sender: chrome.runtime.MessageSender = { id: 'abc' }) => {
    const reply = vi.fn();
    listener({ kind: 'network.ai.ping' }, sender, reply);
    return reply;
  };
  expect(ping()).toHaveBeenCalledWith(expect.objectContaining({ ok: true, ready: false }));
  vi.advanceTimersByTime(4000);
  document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div>';
  expect(ping()).toHaveBeenCalledWith(expect.objectContaining({ ready: false }));
  vi.advanceTimersByTime(4000);
  expect(ping()).toHaveBeenCalledWith(expect.objectContaining({ ready: true }));
  document.body.innerHTML = '';
  expect(ping()).toHaveBeenCalledWith(expect.objectContaining({ ready: false }));
  expect(ping({ id: 'abc', url: 'https://chatgpt.com/', tab: { id: 1 } as chrome.tabs.Tab })).not.toHaveBeenCalled();
  expect(ping({ id: 'other' })).not.toHaveBeenCalled();
});
