import "./health";
import { commandSchema } from "../shared/commands";
import { runProvider, type LlmStatus } from "./providers";
import { guard } from "./dom";
const pending = new Map<string, LlmStatus>();
let controller = new AbortController();
chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0) ||
      (sender.url && sender.url !== chrome.runtime.getURL("service-worker.js")) ||
      (sender.origin && ![`chrome-extension://${chrome.runtime.id}`, `extension://${chrome.runtime.id}`, `edge-extension://${chrome.runtime.id}`].includes(sender.origin))) return false;
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success || parsed.data.deadline < Date.now() || parsed.data.deadline > Date.now() + 310000) return false;
  const cmd = parsed.data;
  const answer = (data: unknown) => respond({ requestId: cmd.requestId, ok: true, data });
  try {
    if (cmd.kind === "cancel") { controller.abort(); controller = new AbortController(); answer({ cancelled: true }); return false; }
    guard(controller.signal);
    if (cmd.kind === "ping") { answer({ ready: true }); return false; }
    if (cmd.kind === "llm.status") { answer(pending.get(cmd.jobId) ?? { state: "unknown" }); return false; }
    if (cmd.kind !== "llm.run" || location.hostname !== "chatgpt.com") return false;
    if (pending.has(cmd.jobId)) { answer(pending.get(cmd.jobId)); return false; }
    pending.set(cmd.jobId, { state: "running", text: "", sources: [], error: "", notes: [] });
    let port: chrome.runtime.Port | null = null;
    const beat = () => {
      try {
        if (!port) { port = chrome.runtime.connect({ name: "cv-heartbeat" }); port.onDisconnect.addListener(() => { port = null; }); }
        port.postMessage({ jobId: cmd.jobId });
      } catch { port = null; }
    };
    beat(); const timer = setInterval(beat, 20000);
    void runProvider(cmd, controller.signal).then(v => pending.set(cmd.jobId, v)).catch((e: unknown) => pending.set(cmd.jobId, { state: "failed", text: "", sources: [], error: e instanceof Error ? e.message : String(e), notes: [] })).finally(() => { clearInterval(timer); port?.disconnect(); });
    answer({ state: "running" });
  } catch (e) { respond({ requestId: cmd.requestId, ok: false, error: e instanceof Error ? e.message : String(e) }); }
  return false;
});
