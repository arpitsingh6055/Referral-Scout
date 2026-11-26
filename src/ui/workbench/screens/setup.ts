/**
 * Screen 06 — campaign setup and automation rules (specification 16.8).
 *
 * Short on purpose. Specification 5.4 and 24 both warn against a setup wall: a long form before the person has
 * seen a single job is the fastest way to lose them, and most of what a long form would ask can be learned when
 * the queue actually runs into it. So this screen asks for the goal and the rules, and nothing else.
 */

import { button, card, div, el, field, input, pill, select, setFieldError, text } from '../dom';
import { send, sendNetwork, sendWorkspace } from '../api';
import { defaultSettings } from '../../../shared/network';
import { AUTOPILOT_RISK_DISCLOSURE, HARD_DAILY_CAP } from '../../../shared/autopilot';
import type { MissionMode } from '../../../shared/domain/campaign';
import type { StrategyOrder } from '../../../shared/apply-status';
import type { Ctx } from '../shell';

export function setup(ctx: Ctx): HTMLElement {
  const c = ctx.view.campaign;
  const existing = !!c;

  const name = input(c?.name ?? '', { placeholder: 'Product internship search' });
  const roles = input(c?.targetRoles.join(', ') ?? '', { placeholder: 'Product Management Intern, Business Analyst' });
  const location = input(c?.location ?? '', { placeholder: 'India' });
  roles.addEventListener('input', () => setFieldError(roles));
  location.addEventListener('input', () => setFieldError(location));
  const employment = select(
    [
      { value: 'internship', label: 'Internship' },
      { value: 'full-time', label: 'Full-time' },
      { value: 'part-time', label: 'Part-time' },
      { value: 'contract', label: 'Contract' },
      { value: 'any', label: 'Any' },
    ],
    c?.employmentType ?? 'internship',
  );
  const currentMode: MissionMode = c?.application.mode ?? (c?.application.submitPolicy === 'auto' ? 'autopilot' : 'guided');
  const missionMode = select(
    [
      { value: 'discover', label: 'Discover only (find and rank jobs, no applying)' },
      { value: 'guided', label: 'Guided (default — fills forms, you review & press Submit)' },
      { value: 'autopilot', label: 'Autopilot (opt-in — auto-submits when every gate passes)' },
    ],
    currentMode,
  );
  const minFit = input(String(c?.application.minFit ?? 60), { type: 'number', min: '0', max: '100' });
  const dailyTarget = input(String(Math.min(c?.application.dailyTarget ?? 15, HARD_DAILY_CAP)), {
    type: 'number',
    min: '0',
    max: String(HARD_DAILY_CAP),
  });
  const autoAdmit = select(
    [
      { value: 'false', label: 'Manual — only jobs I shortlist or queue' },
      { value: 'true', label: 'Automatic — queue shortlisted & matching jobs' },
    ],
    String(c?.application.autoAdmit ?? false),
  );
  const strategyOrder = select(
    [
      { value: 'parallel', label: 'In parallel (recommended — apply & find referrers together)' },
      { value: 'referral-first', label: 'Ask a referrer first, then apply' },
      { value: 'apply-first', label: 'Apply first, then find referrers' },
    ],
    c?.application.strategyOrder ?? 'parallel',
  );
  const referralTrigger = select(
    [
      { value: 'on-queue', label: 'When a job enters the queue (default)' },
      { value: 'on-submit', label: 'After application is submitted' },
      { value: 'never', label: 'Manual only' },
    ],
    c?.application.referralTrigger ?? 'on-queue',
  );
  const activeHoursSelect = select(
    [
      { value: 'any', label: 'Anytime (24 hours)' },
      { value: 'daytime', label: 'Daytime only (08:00 – 22:00)' },
    ],
    c?.application.activeHours ? 'daytime' : 'any',
  );
  const weeklyBudget = input(String(c?.referral.weeklyBudget ?? 80), { type: 'number', min: '0', max: '500' });
  const maxPerCompany = input(String(c?.referral.maxPerCompany ?? 3), { type: 'number', min: '1', max: '5' });
  const concurrency = select(
    [
      { value: '1', label: 'One application at a time' },
      { value: '2', label: 'Two at a time (after testing)' },
    ],
    String(c?.application.concurrency ?? 1),
  );

  const optInCheck = el('input', { type: 'checkbox' }) as HTMLInputElement;
  optInCheck.checked = !!c?.application.autopilotOptInAt;
  const consentCheck = el('input', { type: 'checkbox' }) as HTMLInputElement;
  consentCheck.checked = !!c?.application.allowConsentAutoTick;
  const preflightApproved = !!c?.application.preflightApprovedAt;

  const autopilotBox = div('stack', []);
  const samples = (ctx.view.queue?.length ? ctx.view.queue : []).slice(0, 3);
  const sampleFacts = (ctx.view.facts ?? []).filter(f => f.value.trim()).slice(0, 4);
  const preflightCard = div('note note-violet', [
    text('strong', '', preflightApproved ? 'Pre-flight Preview approved' : 'One-time Pre-flight Preview'),
    text(
      'p',
      '',
      samples.length
        ? `Sample applications ready: ${samples.map(s => `${s.company} (${s.title})`).join(', ')}.`
        : 'Queue or shortlist 2–3 jobs to preview exact answers before Autopilot submits.',
    ),
    text(
      'p',
      'field-help',
      sampleFacts.length
        ? `Answers used from your bank: ${sampleFacts.map(f => `${f.canonicalKey}: ${f.value}`).join(' · ')}`
        : 'Answers will come from your Profile and Answer Bank. Unanswered required questions always pause for you.',
    ),
    preflightApproved
      ? pill('Pre-flight approved', 'green')
      : button('Approve Pre-flight Preview', 'btn btn-sm btn-primary', async () => {
          if (!c) {
            ctx.fail('Save your Mission first before approving Pre-flight Preview.');
            return;
          }
          await ctx.run({ kind: 'campaign', action: 'rules', preflightApprove: true });
          ctx.inform('Pre-flight Preview approved.');
        }),
  ]);

  autopilotBox.append(
    div('note note-amber', [
      text('strong', '', 'Autopilot safety & LinkedIn terms'),
      text('p', '', AUTOPILOT_RISK_DISCLOSURE),
      el('label', { class: 'inline' }, [optInCheck, text('span', '', 'I understand the risks and want to enable Autopilot.')]),
      el('label', { class: 'inline' }, [
        consentCheck,
        text('span', '', 'Allow Autopilot to tick required privacy/terms checkboxes (off by default).'),
      ]),
    ]),
    preflightCard,
  );
  autopilotBox.hidden = missionMode.value !== 'autopilot';
  missionMode.addEventListener('change', () => {
    autopilotBox.hidden = missionMode.value !== 'autopilot';
  });

  const save = button(existing ? 'Save mission' : 'Create mission', 'btn btn-primary btn-lg', async () => {
    const targetRoles = roles.value
      .split(/[\n;,]+/)
      .map(r => r.trim())
      .filter(Boolean);
    setFieldError(roles);
    setFieldError(location);
    if (!targetRoles.length) {
      setFieldError(roles, 'Enter at least one target role.');
      roles.focus();
      ctx.fail('Give at least one target role and a location.');
      return;
    }
    if (!location.value.trim()) {
      setFieldError(location, 'Enter a location or “Remote”.');
      location.focus();
      ctx.fail('Give at least one target role and a location.');
      return;
    }
    const chosenMode = missionMode.value as MissionMode;
    if (chosenMode === 'autopilot' && !optInCheck.checked) {
      ctx.fail('Tick the Autopilot risk acknowledgment box before enabling Autopilot.');
      optInCheck.focus();
      return;
    }
    try {
      await send({
        kind: 'campaign',
        action: existing ? 'update' : 'create',
        name: name.value.trim() || `${targetRoles[0]} search`,
        targetRoles,
        location: location.value.trim(),
        employmentType: employment.value,
      });
      const warnings: string[] = [];
      try {
        await send({
          kind: 'campaign',
          action: 'rules',
          mode: chosenMode,
          minFit: Number(minFit.value),
          autoAdmit: autoAdmit.value === 'true',
          dailyTarget: Math.min(HARD_DAILY_CAP, Math.max(0, Number(dailyTarget.value))),
          weeklyBudget: Number(weeklyBudget.value),
          maxPerCompany: Number(maxPerCompany.value),
          submitPolicy: chosenMode === 'autopilot' ? 'auto' : 'review',
          strategyOrder: strategyOrder.value as StrategyOrder,
          referralTrigger: referralTrigger.value as 'on-queue' | 'on-submit' | 'never',
          activeHours: activeHoursSelect.value === 'daytime' ? { start: 8, end: 22 } : null,
          ...(chosenMode === 'autopilot' && optInCheck.checked ? { autopilotOptIn: true } : {}),
          allowConsentAutoTick: consentCheck.checked,
          concurrency: Number(concurrency.value) === 2 ? 2 : 1,
        });
      } catch {
        warnings.push('The mission target was saved, but its automation rules were not. Reopen Mission to check them.');
      }
      const preferredEmployment = employment.value === 'any' ? ['internship', 'full-time', 'part-time', 'contract'] : [employment.value];
      const legacyEmployment = employment.value === 'internship' || employment.value === 'full-time' ? employment.value : 'any';
      try {
        await sendWorkspace({
          kind: 'workspace',
          action: 'preferences',
          targetRoleFamilies: targetRoles,
          locations: [location.value.trim()],
          employmentTypes: preferredEmployment,
        });
      } catch {
        warnings.push('Candidate profile search preferences could not be synchronised.');
      }
      try {
        const previous = await sendNetwork({ kind: 'network', action: 'status' });
        const parsedWeekly = Number(weeklyBudget.value);
        const weeklyInvites =
          Number.isFinite(parsedWeekly) && parsedWeekly > 0 ? Math.round(parsedWeekly) : (previous.settings?.weeklyInvites ?? null);
        await sendNetwork({
          kind: 'network',
          action: 'save',
          target: targetRoles[0]!,
          location: location.value.trim(),
          template: previous.template,
          settings: { ...(previous.settings ?? defaultSettings), roles: targetRoles, employmentType: legacyEmployment, weeklyInvites },
        });
      } catch {
        warnings.push('Side-panel referral preferences could not be synchronised.');
      }
      await ctx.refresh();
      ctx.go('overview');
      ctx.inform(
        warnings.length
          ? `Mission saved with follow-up needed: ${warnings.join(' ')}`
          : 'Mission settings saved across job discovery, applications, and referrals.',
      );
    } catch (error) {
      ctx.fail(error instanceof Error ? error.message : 'The mission could not be saved. Please try again.');
    }
  });

  const form = card(existing ? 'Mission' : 'Create your mission', {
    sub: 'One setup controls job discovery, application mode, daily cap, and referral strategy.',
    body: [
      div('form-grid', [
        field('Mission name', name),
        field('Location', location),
        field('Target roles', roles),
        field('Employment type', employment),
        field('Minimum fit to queue a job (0–100)', minFit),
        field(`Daily application cap (max ${HARD_DAILY_CAP})`, dailyTarget),
        field('Weekly referral invitations', weeklyBudget),
        field('Most contacts per company', maxPerCompany),
      ]),
      div('note note-violet', [
        text('p', '', 'Everything here can be changed while your mission is running. Any missing answer pauses only that application.'),
      ]),
    ],
  });

  const rules = card('Mode & Automation', {
    sub: 'Choose how much of the daily loop runs on its own.',
    body: [
      div('', [field('Mission mode', missionMode)]),
      autopilotBox,
      div('', [field('Adding shortlisted jobs to queue', autoAdmit)]),
      div('', [field('Referral & apply order', strategyOrder)]),
      div('', [field('When to search for referrers', referralTrigger)]),
      div('', [field('Active hours', activeHoursSelect)]),
      div('', [field('How many at once', concurrency)]),
      div('rule-row', [
        div('', [text('div', 'rule-name', 'Gmail outcome sync'), text('div', 'rule-note', 'Match replies to applications and contacts')]),
        pill(ctx.workspace?.connections.gmail ? 'Connected' : 'Not connected', ctx.workspace?.connections.gmail ? 'green' : 'grey'),
      ]),
      div('rule-row', [
        div('', [
          text('div', 'rule-name', 'Automatic outreach'),
          text('div', 'rule-note', 'Use the weekly budget and contact order without asking each time'),
        ]),
        pill(ctx.workspace?.outreachAutomatic ? 'On' : 'Off', ctx.workspace?.outreachAutomatic ? 'green' : 'grey'),
      ]),
      div('', [save]),
    ],
  });

  return div('grid split-wide', [form, rules]);
}

export const setupHeader = (): { title: string; sub: string } => ({
  title: 'Mission',
  sub: 'Set your roles, daily cap, referral strategy, and Guided vs. Autopilot mode.',
});
