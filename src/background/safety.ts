import { campaign, write, event, leads, logs } from "../storage/state";
import type { SendLog } from "../shared/runtime";
export class Halt extends Error {}
export const aborted = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("Paused", "AbortError"); };
export async function notify(message: string): Promise<void> {
  await chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icon.png"), title: "Cold Contact Pro", message: message.slice(0, 400) }).catch(() => undefined);
}
export async function pause(reason: string, automatic = true): Promise<void> {
  const c = await campaign(); if (c) { c.status = "paused"; c.reason = reason; c.pausedByAlarm = automatic; await write("campaign", c); }
  chrome.power.releaseKeepAwake(); await event(reason, "warning"); await notify(reason);
}
export function bounceThreshold(sent: SendLog[], bounced: Set<string>): boolean {
  const ordered = sent.filter(v => v.state === "sent" && !v.mock).sort((a, b) => a.at - b.at);
  const count = (items: SendLog[]) => items.filter(v => bounced.has(v.leadId)).length;
  return count(ordered.slice(0, 10)) >= 2 || (ordered.length >= 20 && count(ordered.slice(-20)) / 20 > 0.1);
}
export async function checkBounces(): Promise<void> {
  if (bounceThreshold(await logs(), new Set((await leads()).filter(l => l.stage === "Bounced").map(l => l.id)))) throw new Halt("Bounce threshold reached. Review recipients before resuming.");
}
