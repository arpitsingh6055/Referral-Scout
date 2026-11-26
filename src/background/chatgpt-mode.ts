import { read, write } from '../storage/state';

export type ChatGptMode = 'incognito' | 'normal';
export const CHATGPT_MODE_KEY = 'chatgpt-mode';

export async function chatGptMode(): Promise<ChatGptMode> {
  const saved = await read<string>(CHATGPT_MODE_KEY).catch(() => undefined);
  return saved === 'normal' ? 'normal' : 'incognito';
}

export async function saveChatGptMode(mode: ChatGptMode): Promise<void> {
  await write(CHATGPT_MODE_KEY, mode);
}

export function chatGptUrl(mode: ChatGptMode): string {
  return mode === 'incognito' ? 'https://chatgpt.com/?temporary-chat=true' : 'https://chatgpt.com/';
}
