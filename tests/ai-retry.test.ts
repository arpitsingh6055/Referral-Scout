import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { aiJobId, askChatGpt } from '../src/background/network-ai';
import { put } from '../src/storage/database';
import { clearDatabase, closeDatabase } from '../src/storage/database';

const PROMPT = 'Return ONLY one JSON object.';
const OWNER = 'https://www.linkedin.com/in/student/';
const KIND = 'BUILD_DOSSIER' as const;

async function seed(stage: string, trace: string[], tab = 7): Promise<string> {
  const id = await aiJobId(PROMPT, KIND, OWNER);
  const job = { id, kind: KIND, owner: OWNER, tab, prompt: PROMPT, createdAt: 1, updatedAt: 1, stage, error: 'The complete prompt did not survive ChatGPT hydration. It was NOT sent.', trace: trace.map((s, i) => ({ at: i, stage: s })) };
  await put('meta', { id: `network-ai:${id}`, value: job });
  return id;
}

let executed = false;
const tabs = { create: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn(), sendMessage: vi.fn() };

beforeEach(() => {
  executed = false;
  tabs.create.mockReset().mockResolvedValue({ id: 99 });
  tabs.get.mockReset().mockImplementation(async (id: number) => ({ id, url: 'https://chatgpt.com/' }));
  tabs.update.mockReset().mockResolvedValue({});
  tabs.remove.mockReset().mockResolvedValue(undefined);
  tabs.sendMessage.mockReset().mockImplementation(async (_tab: number, m: { action?: string; kind: string; index?: number }) => {
    if (m.kind === 'network.ai.ping') return { ok: true, ready: true, documentId: 'doc' };
    if (m.action === 'status') return executed ? { state: 'response_extracted', text: '{"schemaVersion":2}', documentId: 'doc' } : { state: 'unknown' };
    if (m.action === 'begin') return { ok: true, documentId: 'doc' };
    if (m.action === 'part') return { ok: true, index: m.index, documentId: 'doc' };
    if (m.action === 'execute') { executed = true; return { ok: true, documentId: 'doc', state: 'running' }; }
    return undefined;
  });
  // The work window is opened once; its first tab is counted through the same tabs.create mock.
  vi.stubGlobal('chrome', { runtime: { id: 'abc', onMessage: { addListener: vi.fn() } }, tabs, windows: { get: vi.fn().mockRejectedValue(new Error('gone')), create: vi.fn(async () => ({ id: 1, tabs: [await tabs.create()] })) } });
});
afterEach(async () => { await clearDatabase(); await closeDatabase(); vi.unstubAllGlobals(); });

it('retries a task that failed before anything was sent, in a fresh tab, instead of replaying the old error forever', async () => {
  await seed('failed', ['queued', 'tab_opened', 'current_document_ready', 'prompt_inserted']);
  const reply = await askChatGpt(PROMPT, new AbortController().signal, KIND, OWNER);
  expect(reply).toBe('{"schemaVersion":2}');
  expect(tabs.create).toHaveBeenCalledTimes(1);   // fresh tab, so the old content-script record cannot interfere
  expect(tabs.remove).toHaveBeenCalledWith(7);    // the stale tab with the unsent draft is closed
});

it('never resends a task whose message may already have been submitted', async () => {
  await seed('failed', ['queued', 'tab_opened', 'send_clicked']);
  await expect(askChatGpt(PROMPT, new AbortController().signal, KIND, OWNER)).rejects.toThrow(/Recover reply/i);
  expect(tabs.create).not.toHaveBeenCalled();
  const sent = tabs.sendMessage.mock.calls.map(c => (c[1] as { action?: string }).action);
  expect(sent).toEqual(['status']);               // it only looked; it never began or executed a new submission
});

it('recovers a reply that is already on screen when the send could not be verified', async () => {
  await seed('uncertain', ['queued', 'tab_opened', 'send_clicked']);
  tabs.sendMessage.mockReset().mockImplementation(async (_t: number, m: { action?: string }) =>
    m.action === 'status' ? { state: 'unknown', foundUserTurn: true, replyText: '{"schemaVersion":2}', documentId: 'doc' } : undefined);
  await expect(askChatGpt(PROMPT, new AbortController().signal, KIND, OWNER)).resolves.toBe('{"schemaVersion":2}');
  expect(tabs.create).not.toHaveBeenCalled();
});
