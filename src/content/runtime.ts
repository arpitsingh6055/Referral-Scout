import "./health";
import { commandSchema } from "../shared/commands";
import { runProvider, type LlmStatus } from "./providers";
import { readLinkedIn } from "./linkedin";
import { fillCompose, sendCompose, draftSaved } from "./gmail-compose";
import { findMessage, scanMessages } from "./gmail";
import { guard } from "./dom";
import { messageData } from "../parsers/gmail";
let controller = new AbortController();
const running = new Map<string, LlmStatus>();
let port: chrome.runtime.Port | null = null;
function heartbeat(jobId: string): void {
  try { port ??= chrome.runtime.connect({ name: "automation-heartbeat" }); port.onDisconnect.addListener(() => { port = null; }); port.postMessage({ kind: "heartbeat", jobId }); } catch { port = null; }
}
function background(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (sender.origin && sender.origin !== `chrome-extension://${chrome.runtime.id}`) return false;
  return !sender.url || sender.url === chrome.runtime.getURL("service-worker.js");
}
chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  if (!background(sender)) return false;
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success || parsed.data.deadline < Date.now() || parsed.data.deadline > Date.now() + 310000) return false;
  const cmd = parsed.data;
  const answer = (ok: boolean, data?: unknown, error?: string) => respond({ requestId: cmd.requestId, ok, ...(data === undefined ? {} : { data }), ...(error ? { error: error.slice(0, 2000) } : {}) });
  if (cmd.kind === "cancel") { controller.abort(); controller = new AbortController(); answer(true, { cancelled: true }); return false; }
  const signal = controller.signal;
  if (cmd.kind === "llm.status") { heartbeat(cmd.jobId); answer(true, running.get(cmd.jobId) ?? { state: "unknown" }); return false; }
  if (cmd.kind === "llm.run") {
    if (running.has(cmd.jobId)) { answer(true, running.get(cmd.jobId)); return false; }
    running.set(cmd.jobId, { state: "running", text: "", sources: [], error: "", notes: [] });
    heartbeat(cmd.jobId); const beat = setInterval(() => heartbeat(cmd.jobId), 20000);
    void runProvider(cmd, signal).then(result => running.set(cmd.jobId, result)).catch((e: unknown) => running.set(cmd.jobId, { state: "failed", text: "", sources: [], error: e instanceof Error ? e.message : String(e), notes: [] })).finally(() => {
      clearInterval(beat); heartbeat(cmd.jobId); try { port?.postMessage({ kind: "result", jobId: cmd.jobId, result: running.get(cmd.jobId) }); } catch { /* next tick polls status */ }
    });
    answer(true, { state: "running" }); return false;
  }
  const beat = setInterval(() => heartbeat("page-action"), 20000);
  void (async () => {
    guard(signal);
    switch (cmd.kind) {
      case "ping": return { ready: true };
      case "linkedin.read": return readLinkedIn(cmd.page, signal);
      case "gmail.fill": return fillCompose(cmd, signal);
      case "gmail.send": return sendCompose(cmd, signal);
      case "gmail.saved": return draftSaved(signal);
      case "gmail.find": return findMessage(cmd.subject, cmd.email, cmd.folder, signal);
      case "gmail.scan": return scanMessages(signal);
      case "gmail.message": return messageData(document);
    }
  })().then(value => answer(true, value)).catch((e: unknown) => answer(false, undefined, e instanceof Error ? e.message : String(e))).finally(() => clearInterval(beat));
  return true;
});
