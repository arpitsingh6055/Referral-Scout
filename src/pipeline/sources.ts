import { sourceContainsEmail, mxValid } from "../validators/email";
import { read, write } from "../storage/state";
import { httpUrl } from "../validators/security";
import { delay } from "../background/browser";
export async function confirmSource(url: string, address: string, signal: AbortSignal): Promise<{ confirmed: boolean; text: string }> {
  if (!httpUrl(url) || !url.startsWith("https://") || !await chrome.permissions.contains({ origins: ["https://*/*"] })) return { confirmed: false, text: "" };
  const winId = await read<number>("window:automation");
  const tab = await chrome.tabs.create({ ...(winId === undefined ? {} : { windowId: winId }), url, active: true });
  if (tab.id === undefined) throw new Error("Cannot open cited source");
  try {
    for (let n = 0; n < 40; n++) { await delay(500, signal); if ((await chrome.tabs.get(tab.id)).status === "complete") break; }
    const current = await chrome.tabs.get(tab.id); if (!current.url?.startsWith("https://")) return { confirmed: false, text: "" };
    const outputs = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ text: document.body.innerText.slice(0, 300000), links: [...document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]')].map(a => a.getAttribute("href") ?? "") }) });
    const value = outputs[0]?.result; return { confirmed: !!value && sourceContainsEmail(value.text, value.links, address), text: value?.text ?? "" };
  } finally { await chrome.tabs.remove(tab.id).catch(() => undefined); }
}
export async function checkMx(domain: string, signal: AbortSignal): Promise<boolean> {
  const old = await read<{ at: number; ok: boolean }>(`mx:${domain}`); if (old && Date.now() - old.at < 86400000) return old.ok;
  const timed = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, { signal: timed, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("DNS lookup failed"); const value: unknown = await response.json(); const ok = mxValid(value); await write(`mx:${domain}`, { at: Date.now(), ok }); return ok;
}
