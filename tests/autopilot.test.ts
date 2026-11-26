import { describe, expect, it } from 'vitest';
import {
  evaluateAutopilotGates,
  HARD_DAILY_CAP,
  isReliableAutopilotRoute,
  nextRandomGapMs,
  withinActiveHoursWindow,
} from '../src/shared/autopilot';
import { newCampaign, type Campaign } from '../src/shared/domain/campaign';

function makeAutopilotCampaign(overrides: Partial<Campaign['application']> = {}, omit: (keyof Campaign['application'])[] = []): Campaign {
  const c = newCampaign({
    name: 'Test Mission',
    targetRoles: ['Software Engineer'],
    location: 'Bengaluru',
  });
  const app: Campaign['application'] = {
    ...c.application,
    mode: 'autopilot',
    submitPolicy: 'auto',
    autopilotOptInAt: 1_700_000_000_000,
    preflightApprovedAt: 1_700_000_001_000,
    dailyTarget: 15,
    minFit: 60,
    ...overrides,
  };
  for (const k of omit) delete app[k];
  return {
    ...c,
    status: 'running',
    application: app,
  };
}

const baseTask = {
  fit: 82,
  route: 'easy-apply' as const,
  ats: 'linkedin',
  url: 'https://www.linkedin.com/jobs/view/123456/',
};

describe('Autopilot gates and route reliability', () => {
  it('allows Easy Apply and reliable ATS hosts, blocks complex or unknown routes', () => {
    expect(isReliableAutopilotRoute('easy-apply', '', 'https://www.linkedin.com/jobs/view/1/')).toBe(true);
    expect(isReliableAutopilotRoute('external', 'boards.greenhouse.io')).toBe(true);
    expect(isReliableAutopilotRoute('external', 'jobs.lever.co')).toBe(true);
    expect(isReliableAutopilotRoute('external', 'jobs.ashbyhq.com')).toBe(true);
    expect(isReliableAutopilotRoute('external', 'myworkdayjobs.com')).toBe(false);
    expect(isReliableAutopilotRoute('external', 'icims.com')).toBe(false);
    expect(isReliableAutopilotRoute('unknown', '')).toBe(false);
    expect(isReliableAutopilotRoute('email', '')).toBe(false);
  });

  it('passes when all Autopilot gates are satisfied', () => {
    const campaign = makeAutopilotCampaign();
    const res = evaluateAutopilotGates({ campaign, task: baseTask, doneToday: 3 });
    expect(res).toEqual({ ok: true });
  });

  it('blocks in Guided mode or when opt-in / pre-flight is missing', () => {
    expect(
      evaluateAutopilotGates({
        campaign: makeAutopilotCampaign({ mode: 'guided' }),
        task: baseTask,
        doneToday: 0,
      }),
    ).toMatchObject({ ok: false, code: 'mode-not-autopilot' });

    expect(
      evaluateAutopilotGates({
        campaign: makeAutopilotCampaign({}, ['autopilotOptInAt']),
        task: baseTask,
        doneToday: 0,
      }),
    ).toMatchObject({ ok: false, code: 'opt-in-required' });

    expect(
      evaluateAutopilotGates({
        campaign: makeAutopilotCampaign({}, ['preflightApprovedAt']),
        task: baseTask,
        doneToday: 0,
      }),
    ).toMatchObject({ ok: false, code: 'preflight-required' });
  });

  it('enforces daily cap and hard ceiling, failure streak, and active hours', () => {
    expect(
      evaluateAutopilotGates({
        campaign: makeAutopilotCampaign({ dailyTarget: 10 }),
        task: baseTask,
        doneToday: 10,
      }),
    ).toMatchObject({ ok: false, code: 'daily-cap' });

    expect(
      evaluateAutopilotGates({
        campaign: makeAutopilotCampaign({ dailyTarget: 99 }),
        task: baseTask,
        doneToday: HARD_DAILY_CAP,
      }),
    ).toMatchObject({ ok: false, code: 'daily-cap' });

    expect(
      evaluateAutopilotGates({
        campaign: makeAutopilotCampaign({ failureStreak: 3 }),
        task: baseTask,
        doneToday: 1,
      }),
    ).toMatchObject({ ok: false, code: 'failure-streak' });

    const twoAm = new Date(2026, 10, 26, 2, 0, 0).getTime();
    expect(withinActiveHoursWindow({ start: 8, end: 22 }, twoAm)).toBe(false);
    expect(
      evaluateAutopilotGates({
        campaign: makeAutopilotCampaign({ activeHours: { start: 8, end: 22 } }),
        task: baseTask,
        doneToday: 1,
        now: twoAm,
      }),
    ).toMatchObject({ ok: false, code: 'outside-active-hours' });
  });

  it('blocks on captcha, login wall, upload error, missing required, or sensitive/legal fields', () => {
    const campaign = makeAutopilotCampaign();
    expect(evaluateAutopilotGates({ campaign, task: baseTask, doneToday: 0, hasCaptcha: true })).toMatchObject({
      ok: false,
      code: 'captcha',
    });
    expect(evaluateAutopilotGates({ campaign, task: baseTask, doneToday: 0, hasLoginWall: true })).toMatchObject({
      ok: false,
      code: 'login-wall',
    });
    expect(evaluateAutopilotGates({ campaign, task: baseTask, doneToday: 0, hasUploadError: true })).toMatchObject({
      ok: false,
      code: 'upload-error',
    });
    expect(evaluateAutopilotGates({ campaign, task: baseTask, doneToday: 0, hasMissingRequired: true })).toMatchObject({
      ok: false,
      code: 'missing-required',
    });
    expect(evaluateAutopilotGates({ campaign, task: baseTask, doneToday: 0, hasSensitiveOrLegalUnanswered: true })).toMatchObject({
      ok: false,
      code: 'sensitive-or-legal',
    });
  });

  it('generates randomized pacing gaps within [45s, 120s]', () => {
    expect(nextRandomGapMs(0)).toBe(45_000);
    expect(nextRandomGapMs(1)).toBe(120_000);
    expect(nextRandomGapMs(0.5)).toBe(82_500);
  });
});
