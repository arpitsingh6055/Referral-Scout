/**
 * Where the AI spending record lives. The rules are in `shared/ai-budget`, which knows nothing about the browser;
 * this is the thin layer that reads and writes them, kept apart from the ChatGPT driver so that anything needing
 * to know the person's plan does not have to pull in the whole tab-driving machinery to find out.
 */
import { read, write } from '../storage/state';
import { type AiBudget, type AiTier, TIERS, emptyBudget } from '../shared/ai-budget';

export const AI_BUDGET_KEY = 'ai-budget';

export async function aiBudget(): Promise<AiBudget> {
  const saved = await read<AiBudget | null>(AI_BUDGET_KEY).catch(() => null);
  if (!saved || typeof saved !== 'object' || !TIERS[saved.tier]) return emptyBudget(await inferredTier());
  return { ...emptyBudget(saved.tier), ...saved };
}

export async function saveAiBudget(b: AiBudget): Promise<void> {
  await write(AI_BUDGET_KEY, b).catch(() => undefined);
}

export async function setAiTier(tier: AiTier): Promise<AiBudget> {
  const next = { ...(await aiBudget()), tier };
  await saveAiBudget(next);
  return next;
}

/** With an API key saved, that is the plan whatever was picked before it. */
async function inferredTier(): Promise<AiTier> {
  const api = await read<{ key?: string; model?: string } | null>('llm-api').catch(() => null);
  return api && api.key && api.model ? 'api' : 'free';
}
