import { z } from "zod";
import { controlSchema } from "../shared/commands";
import { trustedExtension, trustedSite } from "../validators/security";
import { handleControl } from "./controls";
import { campaign, read, write } from "../storage/state";
import type { Job, SendLog } from "../shared/runtime";
import { resultSchema } from "../bridge/schemas";
import { inWindow } from "../shared/time";
const authorize = z.strictObject({ kind: z.literal("send.authorize"), requestId: z.uuid(), sendId: z.string().max(500) });
export function registerCampaignMessages(): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    const auth = authorize.safeParse(input);
    if (auth.success && trustedSite(sender, chrome.runtime.id) && sender.url?.startsWith("https://mail.google.com/")) {
      void (async () => {
        const c = await campaign(), log = await read<SendLog>(`sendlog:${auth.data.sendId}`);
        return !!c && c.status === "active" && !c.mock && c.settings.mode === "autopilot" && c.approvedAt > 0 && inWindow(c.settings) && !!log && !log.mock && log.state === "intent" && log.tabId === sender.tab?.id && Date.now() - log.at < 30000;
      })().then(allowed => respond({ allowed })).catch(() => respond({ allowed: false })); return true;
    }
    if (!trustedExtension(sender, chrome.runtime.id)) return false;
    const request = controlSchema.safeParse(input); if (!request.success) return false;
    void handleControl(request.data).then(data => respond({ requestId: request.data.requestId, ok: true, data })).catch((e: unknown) => respond({ requestId: request.data.requestId, ok: false, error: e instanceof Error ? e.message : String(e) })); return true;
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "automation-heartbeat") return;
    if (!port.sender || !trustedSite(port.sender, chrome.runtime.id)) { port.disconnect(); return; }
    port.onMessage.addListener((input: unknown) => {
      const message = z.strictObject({ kind: z.enum(["heartbeat", "result"]), jobId: z.string().max(2000), result: resultSchema.optional() }).safeParse(input); if (!message.success || message.data.kind !== "result" || !message.data.result) return;
      void (async () => {
        const id = message.data.jobId.replace(/:repair$/, ""), job = await read<Job>(`job:${id}`);
        if (job && job.tabId === port.sender?.tab?.id && job.state === "awaiting_reply") await write(`result:${message.data.jobId}`, message.data.result);
      })().catch(() => undefined);
    });
  });
}
