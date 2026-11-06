import { networkPageCommand, networkReplySchema, type NetworkPageCommand } from "../shared/network";
import { read, write } from "../storage/state";

export async function networkCommand(tabId: number, input: Partial<NetworkPageCommand> & Pick<NetworkPageCommand, "action">, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const cmd = networkPageCommand.parse({ ...input, kind: "network.page", requestId: crypto.randomUUID(), deadline: Date.now() + 60000 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([chrome.tabs.sendMessage(tabId, cmd), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("LinkedIn took too long to respond. Open the contact to check what happened.")), 60000); })]);
    const reply = networkReplySchema.parse(raw);
    if (reply.requestId !== cmd.requestId || !reply.ok) throw new Error(reply.error || "LinkedIn did not answer this request.");
    return reply.data;
  } finally { if (timer) clearTimeout(timer); }
}
export async function readyNetworkTab(tabId: number, signal: AbortSignal): Promise<void> {
  let injected = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    signal.throwIfAborted();
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      const url = new URL(tab.url || "about:blank");
      if (!["www.linkedin.com", "linkedin.com"].includes(url.hostname) || /login|checkpoint|challenge|authwall/.test(url.pathname)) throw new Error("Sign in to LinkedIn and resolve any account notice before continuing.");
      try { const result = await chrome.tabs.sendMessage(tabId, { kind: "network.ping" }); if (result?.ok) return; } catch { /* inject updated runtime once */ }
      if (!injected) { await chrome.scripting.executeScript({ target: { tabId }, files: ["health.js"] }); injected = true; }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("LinkedIn did not finish loading. Refresh LinkedIn and try again.");
}
export async function networkTab(url: string, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  let id = await read<number>("network-tab");
  if (id !== undefined) { try { await chrome.tabs.get(id); } catch { id = undefined; } }
  if (id === undefined) {
    const tab = await chrome.tabs.create({ url, active: true }); id = tab.id;
    if (id === undefined) throw new Error("Could not open LinkedIn.");
    await write("network-tab", id);
  } else { const existing = await chrome.tabs.get(id); await chrome.tabs.update(id, { url, active: true }); await chrome.windows.update(existing.windowId, { focused: true }); }
  await readyNetworkTab(id, signal); return id;
}
