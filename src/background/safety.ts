import { campaign, mutate, event, leads, logs } from "../storage/state";
import type { Campaign } from "../shared/runtime";
import type { SendLog } from "../shared/runtime";
export class Halt extends Error {}
export const aborted = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("Paused", "AbortError"); };
export async function notify(message: string): Promise<void> {
  await chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icons/icon48.png"), title: "Cold Contact Pro", message: message.slice(0, 400) }).catch(() => undefined);
}
export async function pause(reason: string, automatic = true): Promise<void> {
  if (await campaign()) await mutate<Campaign>("campaign", old => { if (!old) throw new Error("Campaign missing"); return { ...old, status: "paused", reason, pausedByAlarm: automatic }; });
  chrome.power.releaseKeepAwake(); await event(reason, "warning"); await notify(reason);
}
export async function ensureActive(expected: Campaign, signal: AbortSignal): Promise<Campaign> {
  aborted(signal); const c = await campaign();
  if (!c || c.startedAt !== expected.startedAt || c.status !== "active") throw new DOMException("Campaign is not active", "AbortError");
  return c;
}
export function bounceThreshold(sent: SendLog[], bounced: Set<string>): boolean {
  const ordered = sent.filter(v => v.state === "sent" && !v.mock).sort((a, b) => a.at - b.at);
  const count = (items: SendLog[]) => items.filter(v => bounced.has(v.leadId)).length;
  return count(ordered.slice(0, 10)) >= 2 || (ordered.length >= 20 && count(ordered.slice(-20)) / 20 > 0.1);
}
export async function checkBounces(): Promise<void> {
  if (bounceThreshold(await logs(), new Set((await leads()).filter(l => l.stage === "Bounced").map(l => l.id)))) throw new Halt("Bounce threshold reached. Review recipients before resuming.");
}
