import { describe, expect, it } from 'vitest';
import { trustedExtension, trustedSite } from '../src/validators/security';

/**
 * Which senders the background will answer.
 *
 * This is quietly load-bearing: a page missing from the allow-list is rejected without a reply, which reaches the
 * person as "Referral Scout is not running" on a screen that is in fact running perfectly. The workbench case
 * below is here because exactly that happened — the page shipped before its path was allowed.
 */

const ID = 'joffdhhoakghlabfjjhofgceedggdedn';
const from = (pathname: string, over: Partial<chrome.runtime.MessageSender> = {}): chrome.runtime.MessageSender =>
  ({
    id: ID,
    frameId: 0,
    url: `chrome-extension://${ID}${pathname}`,
    origin: `chrome-extension://${ID}`,
    ...over,
  }) as chrome.runtime.MessageSender;

describe('extension pages the background answers', () => {
  it('answers every page the product actually ships', () => {
    for (const page of ['/sidepanel.html', '/workbench.html', '/options.html', '/onboarding.html', '/service-worker.js'])
      expect(trustedExtension(from(page), ID), page).toBe(true);
  });

  it('answers the workbench, which is where the dashboard lives', () => {
    expect(trustedExtension(from('/workbench.html'), ID)).toBe(true);
  });

  it('refuses a page of another extension', () => {
    expect(trustedExtension(from('/workbench.html', { id: 'someotherextensionidaaaaaaaaaaaaa' }), ID)).toBe(false);
    expect(trustedExtension(from('/workbench.html', { url: 'chrome-extension://someother/workbench.html' }), ID)).toBe(false);
  });

  it('refuses a web page pretending to be an extension page', () => {
    expect(trustedExtension(from('/workbench.html', { url: 'https://example.com/workbench.html' }), ID)).toBe(false);
  });

  it('refuses a sub-frame, so an embedded page cannot speak for the panel', () => {
    expect(trustedExtension(from('/sidepanel.html', { frameId: 3 }), ID)).toBe(false);
  });

  it('refuses a page this product does not ship', () => {
    expect(trustedExtension(from('/evil.html'), ID)).toBe(false);
  });
});

describe('content scripts the background answers', () => {
  const site = (url: string, over: Partial<chrome.runtime.MessageSender> = {}): chrome.runtime.MessageSender =>
    ({ id: ID, frameId: 0, tab: { id: 7 }, url, origin: new URL(url).origin, ...over }) as chrome.runtime.MessageSender;

  it('answers the sites the product drives', () => {
    for (const url of ['https://www.linkedin.com/in/x/', 'https://mail.google.com/mail/u/0/', 'https://chatgpt.com/'])
      expect(trustedSite(site(url), ID), url).toBe(true);
  });

  it('refuses any other site, however it is dressed up', () => {
    expect(trustedSite(site('https://linkedin.com.evil.test/'), ID)).toBe(false);
    expect(trustedSite(site('http://mail.google.com/'), ID)).toBe(false);
  });

  it('refuses a sub-frame of a real site', () => {
    expect(trustedSite(site('https://mail.google.com/mail/u/0/', { frameId: 2 }), ID)).toBe(false);
  });
});
