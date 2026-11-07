import { read, write } from "../storage/state";
import { commandSchema, replySchema, type CommandInput } from "../shared/commands";
import { httpUrl } from "../validators/security";
import { Halt, aborted } from "./safety";
export async function delay(ms: number, signal: AbortSignal): Promise<void> {
  aborted(signal); await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(new DOMException("Paused", "AbortError")); }; signal.addEventListener("abort", cancel, { once: true });
  });
}
export async function command(tabId: number, input: CommandInput, signal: AbortSignal, timeout = 60000): Promise<unknown> {
  aborted(signal); const message = commandSchema.parse({ ...input, requestId: crypto.randomUUID(), deadline: Date.now() + timeout });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { void chrome.tabs.sendMessage(tabId, { kind: "cancel", requestId: crypto.randomUUID(), deadline: Date.now() + 10000 }).catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const raw: unknown = await Promise.race([chrome.tabs.sendMessage(tabId, message), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Page command timed out")), timeout); })]);
    aborted(signal); const response = replySchema.parse(raw);
    if (response.requestId !== message.requestId) throw new Error("Mismatched page response");
    if (!response.ok) { if (response.error?.startsWith("HALT:")) throw new Halt(response.error); throw new Error(response.error ?? "Page command failed"); }
    return response.data;
  } finally { if (timer) clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}
async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["health.js"] });
}
export async function openPage(key: string, url: string, signal: AbortSignal, fresh = false): Promise<number> {
  aborted(signal); if (!httpUrl(url)) throw new Error("Unsafe navigation URL");
  const windowKey = key === "gemini" || key === "chatgpt" ? key : "automation";
  let windowId = await read<number>(`window:${windowKey}`);
  if (windowId !== undefined) { try { await chrome.windows.update(windowId, { state: "normal", focused: true }); } catch { windowId = undefined; } }
  if (windowId === undefined) {
    const win = await chrome.windows.create({ type: "normal", state: "normal", width: 980, height: 760, focused: true, url: "about:blank" });
    if (win?.id === undefined) throw new Error("Cannot create automation window"); windowId = win.id; await write(`window:${windowKey}`, windowId);
  }
  let tabId = await read<number>(`tab:${key}`);
  if (tabId !== undefined && !fresh) {
    try { const tab = await chrome.tabs.get(tabId); if (tab.windowId !== windowId) tabId = undefined; } catch { tabId = undefined; }
  }
  if (fresh && tabId !== undefined) { await chrome.tabs.remove(tabId).catch(() => undefined); tabId = undefined; }
  if (tabId === undefined) {
    const tab = await chrome.tabs.create({ windowId, url, active: true }); if (tab.id === undefined) throw new Error("No tab ID"); tabId = tab.id; await write(`tab:${key}`, tabId);
  } else { const tab = await chrome.tabs.get(tabId); if (tab.url !== url) await chrome.tabs.update(tabId, { url, active: true }); else await chrome.tabs.update(tabId, { active: true }); }
  if(tabId === undefined) throw new Error("No automation tab ID");
  const end = Date.now() + 30000;
  let injected = false;
  while (Date.now() < end) {
    await delay(500, signal); const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      if (tab.url && new URL(tab.url).hostname !== new URL(url).hostname) throw new Halt("Signed out or redirected to another host; inspect the automation window");
      try { await command(tabId, { kind: "ping" }, signal, 1500); return tabId; } catch (e) {
        if (e instanceof Halt) throw e;
        if (!injected) { await injectContentScript(tabId).catch(() => undefined); injected = true; }
      }
    }
  }
  throw new Error("Page did not become ready; reload the extension and site tabs");
}

export async function waitForPage(tabId: number, url: string, signal: AbortSignal): Promise<number> {
  const end = Date.now() + 30000;
  let injected = false;
  while (Date.now() < end) {
    await delay(500, signal);
    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== "complete") continue;
    if (tab.url && new URL(tab.url).hostname !== new URL(url).hostname)
      throw new Halt("ChatGPT navigation was redirected; sign in to ChatGPT and try again");
    try { await command(tabId, { kind: "ping" }, signal, 1500); return tabId; } catch (e) {
      if (e instanceof Halt) throw e;
      if (!injected) { await injectContentScript(tabId).catch(() => undefined); injected = true; }
    }
  }
  throw new Error("ChatGPT did not become ready; reload the extension and try again");
}
