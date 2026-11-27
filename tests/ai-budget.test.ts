/**
 * The spending rules. These exist so a job search cannot quietly use up somebody's whole afternoon of ChatGPT,
 * and so that when ChatGPT does refuse, the extension waits instead of hammering a page that will keep refusing.
 */
import { describe, expect, it } from 'vitest';
import {
  COOLDOWNS,
  TIERS,
  budgetLine,
  emptyBudget,
  mayAsk,
  perContactAllowed,
  rankBatchesFor,
  recordCall,
  recordLimitHit,
  recordSuccess,
  thinkingAllowed,
  usage,
} from '../src/shared/ai-budget';
import { aiUnavailable, aiUnavailableNote } from '../src/shared/apply';

const NOW = 1_700_000_000_000;
const spend = (n: number, tier: Parameters<typeof emptyBudget>[0] = 'free', at = NOW) => {
  let b = emptyBudget(tier);
  for (let i = 0; i < n; i++) b = recordCall(b, at + i);
  return b;
};

describe('AI budget', () => {
  it('counts what it has asked and says what is left', () => {
    const b = spend(3, 'free');
    expect(usage(b, NOW)).toMatchObject({ used: 3, allowed: TIERS.free.perWindow, remaining: TIERS.free.perWindow - 3 });
    expect(budgetLine(b, NOW)).toBe('5 of 8 ChatGPT questions left in this stretch.');
  });

  it('stops asking once the window is spent, and says when more is available', () => {
    const b = spend(TIERS.free.perWindow, 'free');
    const verdict = mayAsk(b, NOW);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('budget');
    expect(budgetLine(b, NOW)).toMatch(/budget is used/);
  });

  it('forgets questions once they fall out of the rolling window', () => {
    const b = spend(TIERS.free.perWindow, 'free');
    const later = NOW + TIERS.free.windowMs + 1000;
    expect(usage(b, later).used).toBe(0);
    expect(mayAsk(b, later).ok).toBe(true);
  });

  it('never skips the one-off profile dossier to save a question', () => {
    const b = spend(TIERS.free.perWindow, 'free');
    expect(mayAsk(b, NOW, true).ok).toBe(true);
  });

  it('waits longer the second time ChatGPT refuses in a row', () => {
    const first = recordLimitHit(emptyBudget('go'), NOW);
    expect(first.cooldownUntil).toBe(NOW + COOLDOWNS[0]!);
    expect(mayAsk(first, NOW).ok).toBe(false);
    const second = recordLimitHit(first, NOW);
    expect(second.cooldownUntil).toBe(NOW + COOLDOWNS[1]!);
    expect(second.cooldownUntil! - NOW).toBeGreaterThan(first.cooldownUntil! - NOW);
    // An answer means whatever it was refusing has passed.
    const recovered = recordSuccess(second);
    expect(recovered.cooldownUntil).toBeUndefined();
    expect(mayAsk(recovered, NOW).ok).toBe(true);
  });

  it('says it is waiting, not that it is broken, while cooling down', () => {
    const b = recordLimitHit(emptyBudget('go'), NOW);
    expect(budgetLine(b, NOW)).toMatch(/asked for a break/);
    expect(budgetLine(b, NOW)).toMatch(/saved wording is used/);
  });

  it('allows thinking for the dossier on every plan, and beyond it only where the plan can afford it', () => {
    expect(thinkingAllowed('free', 'BUILD_DOSSIER', true)).toBe(true);
    expect(thinkingAllowed('free', 'FILL_APPLICATION', true)).toBe(false);
    expect(thinkingAllowed('go', 'FILL_APPLICATION', true)).toBe(true);
    // A task that did not want thinking never gets it, whatever the plan.
    expect(thinkingAllowed('plus', 'FILL_APPLICATION', false)).toBe(false);
  });

  it('spends fewer ranking batches and no per-person rewrites on the smaller plans', () => {
    expect(rankBatchesFor('free')).toBe(1);
    expect(rankBatchesFor('plus')).toBe(3);
    expect(perContactAllowed('free')).toBe(false);
    expect(perContactAllowed('go')).toBe(false);
    expect(perContactAllowed('plus')).toBe(true);
    expect(perContactAllowed('api')).toBe(true);
  });

  it('gives every plan a label and a consequence written for the person', () => {
    for (const tier of ['free', 'go', 'plus', 'api'] as const) {
      expect(TIERS[tier].label.length).toBeGreaterThan(3);
      expect(TIERS[tier].blurb).toMatch(/[.!]$/);
      expect(TIERS[tier].perWindow).toBeGreaterThan(0);
    }
  });
});

describe('carrying on without ChatGPT', () => {
  it('tells a reason about ChatGPT apart from a fault in this form', () => {
    expect(aiUnavailable('ChatGPT reports a usage limit. No retry was sent.')).toBe('limit');
    expect(aiUnavailable('Sign in to ChatGPT to continue')).toBe('signed-out');
    expect(aiUnavailable('The OpenAI API could not be reached.')).toBe('unreachable');
    // A fault about the answer itself is not a reason to carry on regardless.
    expect(aiUnavailable('ChatGPT’s answer could not be read.')).toBeNull();
    expect(aiUnavailable('No application form fields were found yet.')).toBeNull();
  });

  it('says what was still filled and what is waiting, rather than only what failed', () => {
    const note = aiUnavailableNote('limit', 3);
    expect(note).toMatch(/usage limit/);
    expect(note).toMatch(/saved answers cover is filled/);
    expect(note).toMatch(/3 questions are listed for you/);
    expect(aiUnavailableNote('signed-out', 1)).toMatch(/1 question is listed for you/);
    // Nothing left over: no dangling clause about zero questions.
    expect(aiUnavailableNote('unreachable', 0)).not.toMatch(/listed for you/);
  });

  it('the budget refusal reads as a reason to wait, and is understood as one', () => {
    const b = recordLimitHit(emptyBudget('free'), NOW);
    // askChatGpt throws budgetLine(); that sentence must classify as "unavailable" so the fill degrades.
    expect(aiUnavailable(budgetLine(b, NOW))).toBe('limit');
  });
});

describe('prompt size', () => {
  it('sends the dossier once instead of the raw CV on every step of a form', async () => {
    const { fillPrompt, emptyApplyProfile } = await import('../src/shared/apply');
    const field = (id: string, label: string) => ({
      id,
      frame: 0,
      kind: 'text' as const,
      label,
      required: true,
      value: '',
      section: '',
    });
    const page = {
      url: 'https://jobs.example.com/apply',
      title: 'Apply',
      step: '2/4 pages',
      job: 'A job description. '.repeat(400),
      form: [field('a', 'Full name'), field('b', 'Notice period')],
      actions: [],
      controls: [],
      hasNext: true,
      hasSubmit: false,
      captcha: false,
      frames: [],
      empty: false,
      html: '',
    } as unknown as Parameters<typeof fillPrompt>[0]['page'];

    // Eighty saved answers, only one of which this step could use.
    const profile = emptyApplyProfile();
    for (let i = 0; i < 80; i++) profile.answers[`question ${i}`] = `answer ${i}`;
    const { questionKey } = await import('../src/shared/apply');
    profile.answers[questionKey('Notice period')] = '30 days';

    const prompt = fillPrompt({
      page,
      background: 'BACKGROUND',
      roles: ['PM'],
      profile,
      name: 'Arpit',
      linkedinUrl: 'https://linkedin.com/in/x',
      photo: false,
    });
    // The answer this step needs is there.
    expect(prompt).toContain('30 days');
    // The seventy-nine that belong to other forms are not all dragged along.
    // Counted with a boundary: "answer 1" is a substring of "answer 19".
    const carried = [...Array(80).keys()].filter(i => new RegExp(`answer ${i}\\b`).test(prompt)).length;
    expect(carried).toBeLessThanOrEqual(30);
    expect(carried).toBeLessThan(80);
  });
});
