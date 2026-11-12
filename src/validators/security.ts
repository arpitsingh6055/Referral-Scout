export function httpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return /^(https?:)$/.test(u.protocol) && !u.username && !u.password && !/[\s\x00-\x1f\x7f]/.test(value);
  } catch {
    return false;
  }
}

export function cleanData(value: string, limit = 300): string {
  return value
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .slice(0, Math.max(0, Math.min(limit, 2048)))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function data(value: string, limit = 300): string {
  return `<data>${cleanData(value, limit)}</data>`;
}

export function trustedExtension(sender: chrome.runtime.MessageSender, id: string): boolean {
  if (sender.id !== id || (sender.frameId ?? 0) !== 0) return false;
  if (!sender.url) return true;
  try {
    const url = new URL(sender.url);
    const extensionProtocols = ['chrome-extension:', 'extension:', 'edge-extension:'];
    return (
      extensionProtocols.includes(url.protocol) &&
      url.hostname === id &&
      (!sender.origin ||
        (() => {
          try {
            const origin = new URL(sender.origin);
            return extensionProtocols.includes(origin.protocol) && origin.hostname === id;
          } catch {
            return false;
          }
        })()) &&
      ['/options.html', '/sidepanel.html', '/onboarding.html', '/service-worker.js'].includes(url.pathname)
    );
  } catch {
    return false;
  }
}

export function trustedSite(sender: chrome.runtime.MessageSender, id: string): boolean {
  if (sender.id !== id || sender.tab?.id === undefined || sender.frameId !== 0 || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === 'https:' &&
      !url.port &&
      ['linkedin.com', 'www.linkedin.com', 'mail.google.com', 'gemini.google.com', 'chatgpt.com'].includes(url.hostname) &&
      (!sender.origin || sender.origin === url.origin)
    );
  } catch {
    return false;
  }
}
