/**
 * Answer Bank — Progressive 3-Tier Personalization & Just-in-Time Capture.
 *
 * Replaces an upfront wall of 40+ corporate interrogation fields with:
 * - Tier 1: Core Essentials (4–5 universal basics with 1-click pill presets & auto-save)
 * - Tier 2: Role & Compensation Preferences (Student / Intern smart-adapted)
 * - Tier 3: Auto-Learned & Advanced Answers (collapsible accordion housing extracted CV facts,
 *   experienced-only questions, optional EEO declarations, and dynamic answers learned from forms)
 */

import { detectCandidateMode, essentialReadiness, type CandidateFact } from '../../../shared/domain/facts';
import { button, card, div, el, emptyState, field, icon, input, metric, pill, searchBar, setFieldError, text } from '../dom';
import type { Ctx } from '../shell';
import type { FactRow } from '../../../background/workspace';

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'grey' }> = {
  verified: { label: 'Saved ✓', tone: 'green' },
  'needs-review': { label: 'From CV · click to confirm', tone: 'amber' },
  stale: { label: 'Confirm again', tone: 'red' },
  empty: { label: 'Ask when needed', tone: 'grey' },
};

const SCOPE_NOTE: Record<string, string> = {
  global: 'Reused everywhere',
  campaign: 'Scoped to this search',
  company: 'Scoped per company',
  job: 'Asked per job',
  country: 'Asked per country (never mixed across borders)',
};

const PLAIN_HELP: Record<string, string> = {
  work_authorization: 'Lets companies confirm you can work legally in this country without extra paperwork.',
  sponsorship: 'Whether an employer must sponsor a visa on your behalf.',
  notice_period: 'How soon you can start — pick “Immediate” if you are a student or free right away.',
  start_date: 'Earliest joining date or “Immediately”.',
  relocate: 'Whether you are open to moving to another city for this role.',
  expected_ctc: 'Students/interns can pick “As per company standard” if unsure.',
  work_mode: 'Remote, hybrid, or on-site preference.',
  preferred_location: 'Primary city or “Remote” for role matching.',
  employment_type: 'Internship, full-time, or contract.',
};

const TIER1_KEYS = ['work_authorization', 'sponsorship', 'notice_period', 'start_date', 'relocate'] as const;
const TIER2_KEYS = ['expected_ctc', 'work_mode', 'preferred_location', 'employment_type'] as const;

let advancedSection: string = 'identity';
let query = '';
let tier3Open = false;

function presetsFor(key: string, country: string, gradEnd?: string): string[] {
  switch (key) {
    case 'work_authorization':
      return [`Authorized to work in ${country}`, 'Need visa sponsorship'];
    case 'sponsorship':
      return ['No', 'Yes'];
    case 'notice_period':
      return gradEnd ? ['Immediate', '15 days', `After ${gradEnd}`] : ['Immediate', '15 days', '30 days', 'Immediately available'];
    case 'start_date':
      return ['Immediately', 'Next month', 'Within 2 weeks'];
    case 'relocate':
      return ['Yes', 'Open within region', 'Remote only'];
    case 'expected_ctc':
      return ['As per company standard', 'Open / negotiable', '₹25,000 / month'];
    case 'work_mode':
      return ['Any (Remote / Hybrid / On-site)', 'Hybrid', 'Remote'];
    case 'employment_type':
      return ['Internship', 'Full-time'];
    default:
      return [];
  }
}

function smartRow(fact: FactRow, ctx: Ctx, options: { country: string; gradEnd?: string; compact?: boolean }): HTMLElement {
  const box = input(fact.value, {
    placeholder: fact.selfDeclared ? 'Optional · yours to declare' : 'Leave blank until a form asks, or pick a preset',
    'aria-label': fact.label,
  });
  const liveTag = pill((STATUS[fact.status] ?? STATUS.empty!).label, (STATUS[fact.status] ?? STATUS.empty!).tone);
  let lastSaved = fact.value.trim();

  const saveValue = async (explicit?: string, fromBlur = false): Promise<void> => {
    const value = (explicit ?? box.value).trim();
    if (!value) {
      if (fromBlur) return;
      setFieldError(box, 'Enter a value before saving.');
      box.focus();
      ctx.fail('Enter a value before saving, or choose Clear to remove it.');
      return;
    }
    if (fromBlur && value === lastSaved) return;
    setFieldError(box);
    box.value = value;
    lastSaved = value;
    liveTag.textContent = 'Saving…';
    await ctx.run({ kind: 'workspace', action: 'saveFact', key: fact.key, value });
  };

  box.addEventListener('input', () => setFieldError(box));
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveValue();
    }
  });
  box.addEventListener('blur', () => {
    const clean = box.value.trim();
    if (clean && clean !== lastSaved) void saveValue(clean, true);
  });

  const presets = presetsFor(fact.key, options.country, options.gradEnd);
  const presetStrip = presets.length
    ? div(
        'preset-strip',
        presets.map(preset => {
          const active = fact.value.trim().toLowerCase() === preset.toLowerCase();
          return button(preset, active ? 'preset-chip is-selected' : 'preset-chip', () => saveValue(preset));
        }),
      )
    : null;

  const helperText = PLAIN_HELP[fact.key] ?? SCOPE_NOTE[fact.scope] ?? fact.scope;

  if (options.compact) {
    return div('row row-queue', [
      div('', [text('div', 'cell-strong', fact.label), text('div', 'cell-muted', SCOPE_NOTE[fact.scope] ?? fact.scope)]),
      div('', [box]),
      div('col-hide', [liveTag]),
      div('col-hide', [
        fact.provenance ? text('div', 'cell-muted', fact.provenance) : text('div', 'cell-muted', fact.source ? `From: ${fact.source}` : ''),
      ]),
      div(''),
      div('inline', [
        button('Save', 'btn btn-sm', () => saveValue()),
        fact.value
          ? button('Clear', 'btn btn-sm btn-ghost', () => ctx.run({ kind: 'workspace', action: 'clearFact', key: fact.key }))
          : null,
      ]),
    ]);
  }

  return div('smart-answer-row', [
    div('smart-answer-head', [
      div('', [text('div', 'cell-strong', fact.label), text('p', 'field-help', helperText)]),
      div('inline', [liveTag, text('span', 'cell-muted', SCOPE_NOTE[fact.scope] ?? fact.scope)]),
    ]),
    presetStrip,
    div('smart-answer-input-row', [
      box,
      div('inline', [
        button('Save', 'btn btn-sm btn-primary', () => saveValue()),
        fact.value
          ? button('Clear', 'btn btn-sm btn-ghost', () => ctx.run({ kind: 'workspace', action: 'clearFact', key: fact.key }))
          : null,
      ]),
    ]),
  ]);
}

export function answers(ctx: Ctx): HTMLElement {
  const w = ctx.workspace;
  if (!w)
    return emptyState({
      icon: 'alert',
      title: 'Your answers could not be loaded',
      description: 'Something interrupted loading your Answer Bank. Try refreshing.',
      action: button('Retry', 'btn btn-primary', () => ctx.refresh()),
    });

  const page = div('stack');
  const byKey = new Map(w.facts.map(f => [f.key, f]));
  const stale = w.facts.filter(f => f.status === 'stale').length;
  const country = w.profile.identity.country?.trim() || ctx.view.campaign?.location?.split(',').pop()?.trim() || 'India';
  const persona = w.persona ?? detectCandidateMode(w.profile, ctx.view.campaign?.employmentType);
  const learned = w.learnedAnswers ?? [];

  const toDomainFacts = (rows: FactRow[]): CandidateFact[] =>
    rows
      .filter(f => f.value.trim())
      .map(f => ({
        id: `fact:${f.key}:global`,
        canonicalKey: f.key,
        displayLabel: f.label,
        value: f.value,
        dataType: 'text',
        source: (f.source as CandidateFact['source']) ?? 'user',
        confidence: f.status === 'verified' ? 1 : 0.6,
        scope: f.scope as CandidateFact['scope'],
        verifiedAt: f.status === 'stale' ? 0 : Date.now(),
        updatedAt: Date.now(),
        reusePolicy: 'auto',
      }));
  const readiness = w.essentialReadiness ?? essentialReadiness(toDomainFacts(w.facts));
  const savedTotal = w.facts.filter(f => f.value.trim()).length;

  /* Top safety-net callout */
  page.append(
    div('banner banner-note', [
      icon('info', 18),
      el('div', { class: 'banner-copy' }, [
        text('strong', '', 'You don’t need to fill everything now. '),
        text(
          'span',
          '',
          'Fill the 4–5 essentials below (takes ~30s). If a job ever asks something new, Referral Scout pauses once and remembers it forever.',
        ),
      ]),
    ]),
  );

  /* Smart Persona Banner: Student / Internship Detection */
  if (persona.mode === 'student-intern') {
    page.append(
      div('student-preset-card', [
        div('', [
          div('inline', [pill('Student / Fresher Mode Active', 'violet'), text('span', 'cell-muted', persona.reason)]),
          text('div', 'rule-name', 'Skip corporate notice-period & salary fields with 1-click safe defaults.'),
          text(
            'p',
            'field-help',
            `Pre-fills Notice Period ("Immediate"), Current Salary ("N/A (Student)"), Country work authorization (${country}), and Fresher experience without touching anything you already typed.`,
          ),
        ]),
        button('Apply Student Smart-Defaults →', 'btn btn-primary', () => ctx.run({ kind: 'workspace', action: 'applyStudentDefaults' }), {
          'data-busy-label': 'Applying defaults…',
        }),
      ]),
    );
  }

  /* 4 Encouraging, Non-Punitive Metrics */
  page.append(
    div('grid metrics', [
      metric(
        'check',
        'Tier 1 essentials',
        `${readiness.complete}/${readiness.total}`,
        readiness.complete >= readiness.total ? 'ready for 90% of forms' : 'quick presets below',
        readiness.complete >= readiness.total,
      ),
      metric('person', 'Pre-filled from CV', savedTotal, 'identity, education & skills synced'),
      metric('star', 'Auto-learned', learned.length, learned.length ? 'captured from real applications' : 'learns as you apply'),
      metric('clock', 'Need refresh', stale, stale ? 'pay / dates go stale over time' : 'nothing out of date'),
    ]),
  );

  /* TIER 1: Core Essentials */
  const tier1Facts = TIER1_KEYS.map(k => byKey.get(k)).filter((f): f is FactRow => !!f);
  const tier1Card = card('Tier 1 · Core Essentials (~30 seconds)', {
    sub: 'The universal questions nearly every application asks. Pick a quick chip or type once.',
    link: pill(`${readiness.complete}/${readiness.total} ready`, readiness.complete >= readiness.total ? 'green' : 'amber'),
    body: [
      div(
        'stack-xs',
        tier1Facts.map(f => smartRow(f, ctx, { country, ...(persona.gradEnd ? { gradEnd: persona.gradEnd } : {}) })),
      ),
    ],
  });
  tier1Card.dataset.hudTarget = 'answers';

  /* TIER 2: Role & Compensation Preferences */
  const tier2Facts = TIER2_KEYS.map(k => byKey.get(k)).filter((f): f is FactRow => !!f);
  const tier2Card = card('Tier 2 · Role & Compensation Preferences', {
    sub:
      persona.mode === 'student-intern'
        ? 'Tailored for students & interns — Current Salary & Corporate Employer fields stay tucked away in Tier 3.'
        : 'Helps pre-fill location, compensation expectations, and work-mode filters.',
    body: [
      div(
        'stack-xs',
        tier2Facts.map(f => smartRow(f, ctx, { country, ...(persona.gradEnd ? { gradEnd: persona.gradEnd } : {}) })),
      ),
    ],
  });

  page.append(div('grid split-wide', [tier1Card, tier2Card]));

  /* TIER 3: Collapsible Learned, Extracted & Advanced Answers */
  const tier12Set = new Set<string>([...TIER1_KEYS, ...TIER2_KEYS]);
  const tier3Facts = w.facts.filter(f => !tier12Set.has(f.key));

  const tabs = div('tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Advanced Answer sections');
  for (const s of w.factSections) {
    const sectionItems = tier3Facts.filter(f => f.section === s.section);
    if (!sectionItems.length) continue;
    const filledInSec = sectionItems.filter(f => f.value.trim()).length;
    const b = button(`${s.label} ${filledInSec}/${sectionItems.length}`, 'tab', () => {
      advancedSection = s.section;
      tier3Open = true;
      ctx.redraw();
    });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(advancedSection === s.section));
    tabs.append(b);
  }

  const rowsHost = div('rows');
  const drawTier3 = (): void => {
    const q = query.trim().toLowerCase();
    const list = q
      ? w.facts.filter(f => `${f.label} ${f.value} ${SCOPE_NOTE[f.scope] ?? f.scope}`.toLowerCase().includes(q))
      : tier3Facts.filter(f => f.section === advancedSection);
    rowsHost.replaceChildren(
      ...(list.length
        ? list.map(f => smartRow(f, ctx, { country, compact: true }))
        : [text('p', 'cell-muted', 'No answers in this section yet — Referral Scout fills these as you apply.')]),
    );
  };
  drawTier3();

  const learnedBlock = learned.length
    ? div('stack-xs', [
        text('div', 'field-label', `Auto-learned from your past applications (${learned.length})`),
        div(
          'rows',
          learned
            .filter(item => !query.trim() || `${item.label} ${item.value}`.toLowerCase().includes(query.trim().toLowerCase()))
            .map(item =>
              div('row row-compact', [
                div('', [text('div', 'cell-strong', item.label), text('div', 'cell-muted', item.value)]),
                button('Forget', 'btn btn-sm btn-ghost', () =>
                  ctx.run({ kind: 'workspace', action: 'clearLearnedAnswer', label: item.label }),
                ),
              ]),
            ),
        ),
      ])
    : text('p', 'cell-muted', 'New form questions you answer during real applications appear here automatically.');

  const tier3Body = div('stack', [
    div('filter-bar', [
      tabs,
      searchBar({
        placeholder: 'Search all answers…',
        value: query,
        ariaLabel: 'Search Answer Bank',
        onInput: val => {
          query = val;
          tier3Open = true;
          drawTier3();
        },
      }),
    ]),
    rowsHost,
    learnedBlock,
  ]);

  const accordion = el('details', { class: 'review-details card', ...(tier3Open || query.trim() ? { open: true } : {}) }, [
    el('summary', {}, [
      `Tier 3 · Auto-Learned, Profile & Advanced Answers (${tier3Facts.length + learned.length} items — click to inspect or edit)`,
    ]),
    tier3Body,
  ]);
  accordion.addEventListener('toggle', () => {
    tier3Open = accordion.open;
  });
  page.append(accordion);

  page.append(
    div('grid split', [
      card('How reuse works safely', {
        body: [
          div('note', [
            text(
              'p',
              '',
              'Equivalent wordings share one answer (e.g. “PIN code” = “ZIP code”), while current vs. expected pay and different countries are kept strictly separate.',
            ),
          ]),
          div('note note-violet', [
            text(
              'p',
              '',
              'Diversity, disability, veteran, and legal declarations are never inferred from your CV — only you can fill them if a form asks.',
            ),
          ]),
        ],
      }),
      card('Items that need periodic refresh', {
        sub: 'Pay, notice period, and start dates are flagged when stale.',
        body: [
          stale
            ? div(
                'rows',
                w.facts
                  .filter(f => f.status === 'stale')
                  .map(f =>
                    div('row row-compact', [
                      div('', [text('div', 'cell-strong', f.label), text('div', 'cell-muted', f.value)]),
                      pill('Confirm again', 'red'),
                    ]),
                  ),
              )
            : text('p', 'cell-muted', 'Everything saved is current — nothing needs re-confirming right now.'),
        ],
      }),
    ]),
  );

  return page;
}

export const answersHeader = (ctx: Ctx): { title: string; sub: string; actions: HTMLElement[] } => ({
  title: 'Answer Bank',
  sub: 'Fill only what forms actually ask upfront; everything else is inferred from your profile or learned once when needed.',
  actions: [button('Profile', 'btn', () => ctx.go('profile')), button('Needs you', 'btn', () => ctx.go('needs-you'))],
});

export const emptyField = field;
