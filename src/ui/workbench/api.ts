/**
 * The workbench's only way of reaching the background. Every call returns the whole campaign view, so the side
 * panel and this page can never disagree about what is true.
 */

import type { CampaignRequest, CampaignView } from '../../background/campaign';
import type { WorkspaceRequest, WorkspaceView } from '../../background/workspace';
import type { GmailRequest } from '../../background/gmail';
import type { NetworkRequest, NetworkState } from '../../shared/network';

export type { CampaignView, WorkspaceView };
export type Request = CampaignRequest | WorkspaceRequest;

interface Reply<T> {
  ok: boolean;
  view?: T;
  data?: T;
  /** What the action did, shown to the person so a click is never silent. */
  message?: string;
  error?: string;
}

/** The last message the background sent back, read by the shell after an action. */
export let lastMessage = '';

async function ask<T>(request: unknown): Promise<Reply<T>> {
  const reply = (await chrome.runtime.sendMessage(request).catch(() => undefined)) as Reply<T> | undefined;
  if (!reply) throw new Error('Referral Scout is not running. Reload the extension and try again.');
  if (!reply.ok) throw new Error(reply.error ?? 'Something went wrong.');
  return reply;
}

export async function send(request: CampaignRequest): Promise<CampaignView> {
  const reply = await ask<CampaignView>(request);
  if (!reply.view) throw new Error('Referral Scout returned nothing.');
  return reply.view;
}

export async function sendNetwork(request: NetworkRequest): Promise<NetworkState> {
  const reply = await ask<NetworkState>(request);
  if (!reply.data) throw new Error('Referral Scout returned no connection status.');
  return reply.data;
}

export async function sendWorkspace(request: WorkspaceRequest): Promise<WorkspaceView> {
  const reply = await ask<WorkspaceView>(request);
  if (!reply.view) throw new Error('Referral Scout returned nothing.');
  lastMessage = reply.message ?? '';
  return reply.view;
}

/** Export returns a document rather than a view, so it has its own call. */
export async function exportData(): Promise<string> {
  const reply = await ask<{ json: string }>({ kind: 'workspace', action: 'export' });
  return (reply.view as unknown as { json: string }).json;
}

export const sendGmail = async <T>(request: GmailRequest): Promise<T> => (await ask<T>(request)).data as T;

export const view = (): Promise<CampaignView> => send({ kind: 'campaign', action: 'view' });
export const workspace = (): Promise<WorkspaceView> => sendWorkspace({ kind: 'workspace', action: 'view' });

/** Tests the user's signed-in ChatGPT website session from the dashboard's Connections settings. */
export async function testChatGpt(): Promise<void> {
  const reply = (await chrome.runtime.sendMessage({ kind: 'apply', action: 'testAi' }).catch(() => undefined)) as
    | { ok?: boolean; error?: string }
    | undefined;
  if (!reply) throw new Error('Referral Scout did not respond. Reload the extension and try again.');
  if (!reply.ok) throw new Error(reply.error ?? 'ChatGPT could not be reached. Open chatgpt.com and check your sign-in.');
}
