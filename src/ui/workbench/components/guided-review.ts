/**
 * GuidedReviewWorkspace (Problem 1: Zero-Confusion Post-CV Upload -> AI Review Flow).
 *
 * Replaces raw AI JSON summary dumps with:
 * 1. Seamless 3-Step Live Bridge during CV reading or ChatGPT processing (with Error + Retry handling).
 * 2. Foolproof Step-by-Step Review Wizard with plain-English guidance, one unmistakable primary CTA
 *    per view, visual Before (red strikethrough) -> After (green addition) diff cards, and 1-click apply.
 */

import { button, card, div, el, icon, input, pill, text } from '../dom';
import type { Ctx } from '../shell';
import type { WorkspaceView } from '../api';
import type { AiProfileDraft } from '../../../shared/profile-draft';
import { formatLocation } from '../../../shared/normalizeChatGptProfile';
import type { ReviewProgressSnapshot } from './floating-hud';

interface ReviewSession {
  step: 1 | 2 | 3;
  resolvedConflicts: Set<number>;
  skippedConflicts: Set<number>;
  skippedRoles: Set<number>;
  skippedEdu: Set<number>;
  missingPrompts: string[];
  dismissedPrompts: Set<string>;
  justApproved: boolean;
  lastDraftStamp: string;
}

const session: ReviewSession = {
  step: 1,
  resolvedConflicts: new Set(),
  skippedConflicts: new Set(),
  skippedRoles: new Set(),
  skippedEdu: new Set(),
  missingPrompts: [],
  dismissedPrompts: new Set(),
  justApproved: false,
  lastDraftStamp: '',
};

const emitReviewChanged = (): void => {
  window.dispatchEvent(new CustomEvent('referral-scout-review-change'));
};

export function resetReviewSession(): void {
  session.step = 1;
  session.resolvedConflicts.clear();
  session.skippedConflicts.clear();
  session.skippedRoles.clear();
  session.skippedEdu.clear();
  session.missingPrompts = [];
  session.dismissedPrompts.clear();
  session.justApproved = false;
  session.lastDraftStamp = '';
}

export function getReviewProgressSnapshot(w: WorkspaceView | null): ReviewProgressSnapshot | null {
  if (!w) return null;
  if (w.aiProfileDraft) {
    const totalConflicts = w.aiProfileDraft.conflicts.length;
    const handled = session.resolvedConflicts.size + session.skippedConflicts.size;
    return {
      step: session.step === 3 ? 2 : session.step,
      totalSteps: 3,
      remainingItems: Math.max(0, totalConflicts - handled) + 1,
      justApproved: false,
    };
  }
  if (session.justApproved) {
    return { step: 3, totalSteps: 3, remainingItems: 0, justApproved: true };
  }
  return null;
}

function syncDraftSession(draft: AiProfileDraft | undefined): void {
  if (!draft) return;
  const stamp = `${draft.identity.fullName}:${draft.education.length}:${draft.employment.length}:${draft.conflicts.length}:${draft.skills.length}`;
  if (stamp !== session.lastDraftStamp) {
    session.lastDraftStamp = stamp;
    session.step = draft.conflicts.length || draft.missingInformation.length ? 1 : 2;
    session.resolvedConflicts.clear();
    session.skippedConflicts.clear();
    session.skippedRoles.clear();
    session.skippedEdu.clear();
    session.missingPrompts = [...draft.missingInformation];
    session.dismissedPrompts.clear();
    session.justApproved = false;
  }
}

/* ---------- 3-step live bridge ---------- */
function liveBridgeStage(message: string, phase: 'cv' | 'ai'): number {
  if (phase === 'cv') return 1;
  if (/validating|checking|drafting your structured|completion/i.test(message)) return 3;
  if (/thinking|analysing|request sent|sending|reconciliation|processing/i.test(message)) return 2;
  return 1;
}

function renderLiveBridge(phase: 'cv' | 'ai', message: string): HTMLElement {
  const activeStage = liveBridgeStage(message, phase);
  const stages = [
    { n: 1, title: 'Reading CV & LinkedIn structure', detail: 'Parsing roles, dates, degrees and skills locally' },
    { n: 2, title: 'Scoring impact & comparing details', detail: 'Detecting stronger wording and source differences' },
    { n: 3, title: 'Preparing your guided review plan', detail: 'Organizing side-by-side Before / After changes' },
  ];

  return div('guided-bridge', [
    div('guided-bridge-head', [
      div('guided-spinner', [icon('clock', 16)]),
      div('', [
        text('div', 'guided-bridge-title', phase === 'cv' ? 'Reading your CV…' : 'Analyzing CV & preparing review…'),
        text('p', 'guided-bridge-sub', message || 'Nothing is changed in your profile until you confirm.'),
      ]),
    ]),
    div(
      'bridge-steps',
      stages.map(s => {
        const state = s.n < activeStage ? 'done' : s.n === activeStage ? 'active' : 'pending';
        return div(`bridge-step is-${state}`, [
          div('bridge-dot', [state === 'done' ? icon('check', 13) : String(s.n)]),
          div('bridge-copy', [text('div', 'bridge-step-title', s.title), text('p', 'bridge-step-detail', s.detail)]),
          pill(
            state === 'done' ? 'Done' : state === 'active' ? 'In progress' : 'Queued',
            state === 'done' ? 'green' : state === 'active' ? 'violet' : 'grey',
          ),
        ]);
      }),
    ),
  ]);
}

/* ---------- Before -> After diff cards ---------- */
function diffBox(beforeLabel: string, beforeText: string, afterLabel: string, afterText: string, reason?: string): HTMLElement {
  return div('diff-pair', [
    div('diff-side is-before', [
      text('span', 'diff-tag', beforeLabel),
      el('del', { class: 'diff-strike', title: beforeText }, [beforeText || 'Not stated']),
    ]),
    div('diff-arrow', [icon('chevronRight', 15)]),
    div('diff-side is-after', [
      text('span', 'diff-tag', afterLabel),
      el('ins', { class: 'diff-add', title: afterText }, [afterText || 'Not stated']),
    ]),
    reason ? text('p', 'diff-reason', reason) : null,
  ]);
}

function snapshotCard(
  data: {
    fullName?: string;
    email?: string;
    phone?: string;
    location?: string;
    profileUrl?: string;
    rolesCount: number;
    eduCount: number;
    skillsCount: number;
  },
  saved: boolean,
): HTMLElement {
  const fields: [string, string][] = [
    ['Full name', data.fullName || 'Not extracted'],
    ['Email', data.email || 'Not extracted'],
    ['Phone', data.phone || 'Not extracted'],
    ['Location', data.location || 'Not extracted'],
    ['LinkedIn URL', data.profileUrl || 'Not extracted'],
    ['Structured profile', `${data.rolesCount} roles · ${data.eduCount} degrees · ${data.skillsCount} skills`],
  ];
  return div(`snapshot-card${saved ? ' is-saved' : ''}`, [
    div('diff-card-head', [
      text('span', 'diff-field', saved ? 'Identity & Career Snapshot' : 'Identity & Contact Preview (Will Save on Apply)'),
      pill(saved ? 'Saved to Profile ✓' : 'Ready to save', saved ? 'green' : 'violet'),
    ]),
    div(
      'snapshot-grid',
      fields.map(([label, val]) =>
        div('snapshot-cell', [
          text('span', 'snapshot-label', label),
          Object.assign(text('div', `snapshot-val${val === 'Not extracted' ? ' is-muted' : ''}`, val), { title: val }),
        ]),
      ),
    ),
  ]);
}

function quickFillFactKey(prompt: string): string | null {
  if (/\b(e-?mail)\b/i.test(prompt)) return 'email';
  if (/\b(phone|mobile|whatsapp)\b/i.test(prompt)) return 'phone';
  if (/\b(city|location|based)\b/i.test(prompt)) return 'city';
  if (/\b(salary|ctc|compensation|stipend)\b/i.test(prompt)) return 'expected_ctc';
  if (/\b(notice|availability|start)\b/i.test(prompt)) return 'notice_period';
  if (/\b(authori[sz]|visa|sponsorship)\b/i.test(prompt)) return 'work_authorization';
  if (/\b(portfolio|github|website)\b/i.test(prompt)) return 'portfolio_url';
  return null;
}

function renderQuickFillPrompts(prompts: string[], ctx: Ctx): HTMLElement | null {
  const active = prompts.filter(p => !session.dismissedPrompts.has(p)).slice(0, 3);
  if (!active.length) return null;
  return div('quick-fill-box', [
    text('div', 'field-label', 'Optional quick-fill details ChatGPT noticed missing'),
    div(
      'quick-fill-list',
      active.map(prompt => {
        const factKey = quickFillFactKey(prompt);
        const box = input('', { placeholder: `Enter answer for “${prompt}”…`, 'aria-label': prompt });
        return div('quick-fill-row', [
          div('', [
            text('div', 'rule-name', prompt),
            text('span', 'field-help', factKey ? 'Saves straight to Answer Bank' : 'Saves to Profile Summary'),
          ]),
          factKey
            ? div('inline', [
                box,
                button('Save', 'btn btn-sm btn-primary', async () => {
                  const val = box.value.trim();
                  if (!val) return;
                  await ctx.run({ kind: 'workspace', action: 'saveFact', key: factKey, value: val });
                  session.dismissedPrompts.add(prompt);
                  ctx.redraw();
                }),
                button('Skip', 'btn btn-sm btn-ghost', () => {
                  session.dismissedPrompts.add(prompt);
                  ctx.redraw();
                }),
              ])
            : div('inline', [
                button('Add in Profile →', 'btn btn-sm', () => {
                  session.dismissedPrompts.add(prompt);
                  ctx.go('profile');
                }),
                button('Skip', 'btn btn-sm btn-ghost', () => {
                  session.dismissedPrompts.add(prompt);
                  ctx.redraw();
                }),
              ]),
        ]);
      }),
    ),
  ]);
}

function stepHeader(activeStep: 1 | 2 | 3): HTMLElement {
  const labels: [1 | 2 | 3, string][] = [
    [1, '1. Resolve differences'],
    [2, '2. Apply improvements'],
    [3, '3. Ready'],
  ];
  return div('wizard-steps', [
    ...labels.map(([num, label]) => {
      const state = num < activeStep ? 'done' : num === activeStep ? 'active' : 'pending';
      return div(`wizard-step is-${state}`, [
        div('wizard-step-dot', [state === 'done' ? icon('check', 13) : String(num)]),
        text('span', 'wizard-step-label', label),
      ]);
    }),
  ]);
}

/* ---------- main workspace component ---------- */
export interface GuidedReviewOptions {
  /** Compact variant used inside Welcome setup alongside search campaign setup. */
  variant?: 'profile' | 'welcome';
  cvInputId?: string;
  cvLiveMessage?: string;
  aiError?: string;
  busyMessage?: string;
  onApprovedNext?: () => void;
}

export function guidedReviewWorkspace(ctx: Ctx, options: GuidedReviewOptions = {}): HTMLElement | null {
  const w = ctx.workspace;
  if (!w) return null;

  const wrapper = el('section', { class: 'guided-review-host', 'data-hud-target': 'cv-review' });

  /* LinkedIn prerequisite note stays clear without dead-end copy */
  if (!w.connections.linkedin) {
    wrapper.append(
      card('Step 2: CV & AI Profile Review', {
        sub: 'Read your LinkedIn profile above first so Referral Scout can compare and organize your CV accurately.',
        body: [
          div('note note-violet', [
            text('p', '', 'Once LinkedIn is connected, upload your PDF or DOCX CV here for a guided 3-step review.'),
          ]),
        ],
      }),
    );
    return wrapper;
  }

  /* Seamless Live Status Bridge during CV parsing OR ChatGPT analysis */
  if (options.cvLiveMessage) {
    wrapper.append(
      card('Step 1 of 3: Preparing Your CV', {
        sub: 'Extracting text and formatting from your document.',
        body: [renderLiveBridge('cv', options.cvLiveMessage)],
      }),
    );
    return wrapper;
  }

  if (ctx.busyAction === 'workspace:processProfileWithChatGPT') {
    wrapper.append(
      card('AI Review in Progress', {
        sub: 'Your signed-in ChatGPT session is organizing your CV and comparing it against LinkedIn.',
        body: [renderLiveBridge('ai', options.busyMessage ?? 'Analyzing your CV and LinkedIn evidence…')],
      }),
    );
    return wrapper;
  }

  if (!w.cv.hasText) {
    wrapper.append(
      card('Step 2: Upload Your CV for Guided Setup', {
        sub: 'Add a PDF or DOCX CV and AI will highlight improvements, fix discrepancies, and fill your profile in 1 click.',
        link: pill('Optional · Recommended', 'violet'),
        body: [
          div('guided-hero-summary', [
            div('guided-hero-item', [icon('check', 15), text('span', '', 'Stored strictly on this device in your browser')]),
            div('guided-hero-item', [icon('check', 15), text('span', '', 'Instant side-by-side Before / After diff review')]),
          ]),
          options.cvInputId
            ? div('inline', [el('label', { class: 'btn btn-primary btn-lg', for: options.cvInputId }, ['Upload PDF or DOCX CV →'])])
            : div('note note-violet', [text('p', '', 'Choose Upload CV in the Documents section below to begin guided review.')]),
        ],
      }),
    );
    return wrapper;
  }

  const draft = w.aiProfileDraft;
  syncDraftSession(draft);

  /* Error recovery if AI reconciliation timed out or returned malformed output */
  if (options.aiError && !draft) {
    wrapper.append(
      card('AI Review Needed Another Try', {
        sub: 'Nothing in your profile was changed. Check that ChatGPT is signed in and retry below.',
        body: [
          div('banner banner-error', [icon('alert', 18), el('span', { class: 'banner-copy' }, [options.aiError])]),
          div('inline', [
            button(
              'Retry AI Review →',
              'btn btn-primary btn-lg',
              () => {
                session.justApproved = false;
                return ctx.run({ kind: 'workspace', action: 'processProfileWithChatGPT' });
              },
              { 'data-busy-label': 'Retrying analysis…' },
            ),
            button('Open ChatGPT', 'btn', () => ctx.openExternal('https://chatgpt.com/')),
          ]),
        ],
      }),
    );
    return wrapper;
  }

  /* Post-CV Upload -> Zero-confusion next action before AI draft exists */
  if (!draft && !session.justApproved && !w.cv.imported) {
    wrapper.append(
      card(`CV Ready${w.cvName ? `: ${w.cvName}` : ''}`, {
        sub: 'Next step: run a 1-click AI check to compare your CV with LinkedIn and prepare side-by-side improvements.',
        link: pill('Step 1 of 3', 'violet'),
        body: [
          div('guided-hero-summary', [
            div('guided-hero-item', [icon('check', 15), text('span', '', 'Nothing is auto-overwritten without your click')]),
            div('guided-hero-item', [icon('check', 15), text('span', '', 'Exact Before / After changes highlighted')]),
            div('guided-hero-item', [icon('check', 15), text('span', '', 'Takes ~20–45s via your ChatGPT session')]),
          ]),
          div('inline', [
            button(
              'Start Guided AI Review →',
              'btn btn-primary btn-lg',
              () => ctx.run({ kind: 'workspace', action: 'processProfileWithChatGPT' }),
              {
                'data-busy-label': 'Preparing AI Review…',
                'data-progress': 'Starting guided AI analysis of your CV & LinkedIn…',
              },
            ),
            options.variant === 'welcome' ? button('Skip for now', 'btn btn-ghost', () => ctx.go('overview')) : null,
          ]),
        ],
      }),
    );
    return wrapper;
  }

  /* Step 3: Celebratory completion right after applying draft (or already imported without pending draft) */
  if (!draft) {
    const missingCount = w.completeness.missing.length;
    const primaryCta = options.onApprovedNext
      ? button('Continue to Search Goal →', 'btn btn-primary btn-lg', options.onApprovedNext)
      : missingCount
        ? button(`Finish ${missingCount} Core Answer${missingCount === 1 ? '' : 's'} →`, 'btn btn-primary btn-lg', () => ctx.go('answers'))
        : button(ctx.view.campaign ? 'Review Matching Jobs →' : 'Create Search Campaign →', 'btn btn-primary btn-lg', () =>
            ctx.go(ctx.view.campaign ? 'jobs' : 'welcome'),
          );

    wrapper.append(
      card('Step 3 of 3: Saved to Your Profile ✓', {
        sub: session.justApproved
          ? 'Your Name, Email, Contact Details, Roles, Education and Skills are durably saved in your Candidate Profile and Answer Bank.'
          : 'Your CV has been reconciled with LinkedIn. Re-run anytime after uploading a newer CV.',
        link: pill('Saved to Profile ✓', 'green'),
        body: [
          snapshotCard(
            {
              ...(w.profile.identity.fullName ? { fullName: w.profile.identity.fullName } : {}),
              ...(w.profile.identity.email ? { email: w.profile.identity.email } : {}),
              ...(w.profile.identity.phone ? { phone: w.profile.identity.phone } : {}),
              location: formatLocation(w.profile.identity),
              ...(w.profile.identity.profileUrl ? { profileUrl: w.profile.identity.profileUrl } : {}),
              rolesCount: w.profile.employment.length,
              eduCount: w.profile.education.length,
              skillsCount: w.profile.skills.length,
            },
            true,
          ),
          renderQuickFillPrompts(session.missingPrompts, ctx),
          div('inline', [
            primaryCta,
            button(
              'Re-run AI Review',
              'btn btn-ghost',
              () => {
                session.justApproved = false;
                return ctx.run({ kind: 'workspace', action: 'processProfileWithChatGPT' });
              },
              { 'data-busy-label': 'Re-analyzing…' },
            ),
          ]),
        ],
      }),
    );
    return wrapper;
  }

  /* Active Guided 3-Step Review when `draft` exists */
  const p = w.profile;
  const conflicts = draft.conflicts;
  const step = session.step === 3 ? 2 : session.step;

  if (options.variant === 'welcome') {
    wrapper.append(
      card('AI Review Ready (1–2 minutes)', {
        sub: `${conflicts.length ? `${conflicts.length} differences found · ` : ''}${draft.employment.length} roles, ${draft.education.length} degrees, ${draft.skills.length} skills ready for your 1-click confirmation.`,
        link: pill('Ready to review', 'amber'),
        body: [
          stepHeader(1),
          div('inline', [
            button('Open Guided Review →', 'btn btn-primary btn-lg', () => {
              ctx.go('profile');
            }),
            button('Re-analyze CV', 'btn btn-ghost', () => ctx.run({ kind: 'workspace', action: 'processProfileWithChatGPT' })),
          ]),
        ],
      }),
    );
    return wrapper;
  }

  if (step === 1) {
    const handledCount = session.resolvedConflicts.size + session.skippedConflicts.size;
    const conflictCards = conflicts.length
      ? conflicts.map((c, idx) => {
          const accepted = session.resolvedConflicts.has(idx);
          const skipped = session.skippedConflicts.has(idx);
          return div(`diff-card${accepted ? ' is-accepted' : skipped ? ' is-skipped' : ''}`, [
            div('diff-card-head', [
              text('span', 'diff-field', c.field || 'Profile detail'),
              accepted ? pill('Using CV value', 'green') : skipped ? pill('Skipped', 'grey') : pill('Review', 'amber'),
            ]),
            diffBox(
              'Before · LinkedIn',
              c.linkedinValue || 'Not stated on LinkedIn',
              'After · Your CV (Priority)',
              c.cvValue || 'Not stated in CV',
              c.resolution,
            ),
            div('diff-card-actions', [
              button(accepted ? 'Accepted CV value' : 'Accept CV Change', accepted ? 'btn btn-sm' : 'btn btn-sm btn-primary', () => {
                session.resolvedConflicts.add(idx);
                session.skippedConflicts.delete(idx);
                emitReviewChanged();
                ctx.redraw();
              }),
              button(skipped ? 'Skipped' : 'Skip', 'btn btn-sm btn-ghost', () => {
                session.skippedConflicts.add(idx);
                session.resolvedConflicts.delete(idx);
                emitReviewChanged();
                ctx.redraw();
              }),
            ]),
          ]);
        })
      : [
          div('note note-green', [
            text('p', '', 'No discrepancies found between your CV and LinkedIn profile. Both sources align cleanly.'),
          ]),
        ];

    const missingBlock = draft.missingInformation.length
      ? div('note note-amber', [
          text('strong', '', `${draft.missingInformation.length} details still absent from your CV`),
          text('p', 'field-help', draft.missingInformation.slice(0, 4).join(' · ')),
        ])
      : null;

    wrapper.append(
      card('Step 1 of 3: Confirm Differences (Before → After)', {
        sub: conflicts.length
          ? `${handledCount} of ${conflicts.length} reviewed. Your CV takes priority wherever LinkedIn was outdated.`
          : 'Quick check passed. Continue to inspect the structured improvements AI prepared for your profile.',
        link: pill('Step 1 of 3', 'violet'),
        body: [
          stepHeader(1),
          ...conflictCards,
          missingBlock,
          div('wizard-foot', [
            button(conflicts.length ? 'Confirm & Review Improvements →' : 'Continue to Improvements →', 'btn btn-primary btn-lg', () => {
              conflicts.forEach((_, idx) => {
                if (!session.skippedConflicts.has(idx)) session.resolvedConflicts.add(idx);
              });
              session.step = 2;
              emitReviewChanged();
              ctx.redraw();
            }),
            button('Skip step', 'btn btn-ghost', () => {
              session.step = 2;
              emitReviewChanged();
              ctx.redraw();
            }),
          ]),
        ],
      }),
    );
    return wrapper;
  }

  /* Step 2: Before -> After Structured Additions Preview + Per-Item Include/Skip + 1-Click Apply */
  const includedRolesCount = draft.employment.filter((_, i) => !session.skippedRoles.has(i)).length;
  const includedEduCount = draft.education.filter((_, i) => !session.skippedEdu.has(i)).length;
  const newProjCount = draft.projects.length;
  const newSkillsCount = draft.skills.length;

  const previewItems: HTMLElement[] = [
    snapshotCard(
      {
        fullName: draft.identity.fullName || p.identity.fullName || '',
        email: draft.identity.email || p.identity.email || '',
        phone: draft.identity.phone || p.identity.phone || '',
        location: formatLocation(draft.identity) || formatLocation(p.identity),
        profileUrl: draft.identity.profileUrl || p.identity.profileUrl || '',
        rolesCount: includedRolesCount,
        eduCount: includedEduCount,
        skillsCount: newSkillsCount,
      },
      false,
    ),
    div('diff-summary-grid', [
      div('diff-summary-cell', [
        text('span', 'diff-tag', 'Current Profile (Before)'),
        text('div', 'diff-summary-val', `${p.employment.length} roles · ${p.education.length} degrees · ${p.skills.length} skills`),
      ]),
      div('diff-summary-cell is-after', [
        text('span', 'diff-tag', 'Selected Additions (After)'),
        text(
          'div',
          'diff-summary-val',
          `+${includedRolesCount} roles · +${includedEduCount} degrees · +${newProjCount} projects · +${newSkillsCount} skills`,
        ),
      ]),
    ]),
  ];

  draft.employment.slice(0, 4).forEach((role, idx) => {
    const skipped = session.skippedRoles.has(idx);
    previewItems.push(
      div(`diff-card${skipped ? ' is-skipped' : ' is-accepted'}`, [
        div('diff-card-head', [
          text('span', 'diff-field', `${role.title} — ${role.employer}`),
          div('inline', [
            pill(`${role.startDate || 'Date ?'}–${role.current ? 'Present' : role.endDate || 'Date ?'}`, skipped ? 'grey' : 'green'),
            button(skipped ? 'Include' : 'Skip', skipped ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost', () => {
              if (skipped) session.skippedRoles.delete(idx);
              else session.skippedRoles.add(idx);
              emitReviewChanged();
              ctx.redraw();
            }),
          ]),
        ]),
        role.achievements.length
          ? diffBox(
              'Raw CV bullet text',
              role.responsibilities[0] || 'Unstructured experience bullet',
              'Structured Achievement Highlight',
              role.achievements.slice(0, 2).join(' · '),
            )
          : text('p', 'field-help', role.responsibilities.slice(0, 2).join(' · ') || 'Role details captured from your CV.'),
        role.technologies.length
          ? div(
              'chips',
              role.technologies.slice(0, 6).map(t => pill(t, 'grey')),
            )
          : null,
      ]),
    );
  });

  draft.education.slice(0, 3).forEach((edu, idx) => {
    const skipped = session.skippedEdu.has(idx);
    previewItems.push(
      div(`diff-card${skipped ? ' is-skipped' : ''}`, [
        div('diff-card-head', [
          text('span', 'diff-field', `${edu.qualification || edu.level} — ${edu.institution}`),
          div('inline', [
            pill([edu.startDate, edu.endDate].filter(Boolean).join('–') || 'Education', 'grey'),
            button(skipped ? 'Include' : 'Skip', skipped ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost', () => {
              if (skipped) session.skippedEdu.delete(idx);
              else session.skippedEdu.add(idx);
              emitReviewChanged();
              ctx.redraw();
            }),
          ]),
        ]),
        edu.grade ? text('p', 'field-help', `Grade captured: ${edu.grade}${edu.gradeScale ? ` (${edu.gradeScale})` : ''}`) : null,
      ]),
    );
  });

  if (draft.narrative.strengths || draft.narrative.careerGoal) {
    previewItems.push(
      div('note note-violet', [
        text('strong', '', 'AI Profile Summary'),
        draft.narrative.strengths ? text('p', 'field-help', draft.narrative.strengths) : null,
        draft.narrative.careerGoal ? text('p', 'field-help', `Target direction: ${draft.narrative.careerGoal}`) : null,
      ]),
    );
  }

  if (draft.skills.length) {
    previewItems.push(
      div('stack-xs', [
        text('div', 'field-label', `Verified skills to add (${draft.skills.length})`),
        div(
          'chips',
          draft.skills.slice(0, 16).map(s => pill(s, 'violet')),
        ),
      ]),
    );
  }

  wrapper.append(
    card('Step 2 of 3: Accept & Apply Improvements', {
      sub: 'Everything below will be saved to your Candidate Profile so you can review or edit anytime — no manual copying needed.',
      link: pill('Step 2 of 3', 'violet'),
      body: [
        stepHeader(2),
        ...previewItems,
        div('wizard-foot', [
          button(
            ctx.busyAction === 'workspace:approveAiProfileDraft' ? 'Applying changes…' : 'Accept & Apply Changes →',
            'btn btn-primary btn-lg',
            async () => {
              session.missingPrompts = [...draft.missingInformation];
              const skippedEmp = [...session.skippedRoles];
              const skippedEdu = [...session.skippedEdu];
              await ctx.run({
                kind: 'workspace',
                action: 'approveAiProfileDraft',
                ...(skippedEmp.length ? { skippedEmploymentIndexes: skippedEmp } : {}),
                ...(skippedEdu.length ? { skippedEducationIndexes: skippedEdu } : {}),
              });
              session.justApproved = true;
              session.step = 3;
              emitReviewChanged();
              ctx.redraw();
            },
            {
              disabled: ctx.busyAction === 'workspace:approveAiProfileDraft',
              'aria-busy': ctx.busyAction === 'workspace:approveAiProfileDraft',
              'data-busy-label': 'Applying to profile…',
              'data-progress': 'Saving verified improvements to your Candidate Profile…',
            },
          ),
          button('← Back', 'btn', () => {
            session.step = 1;
            emitReviewChanged();
            ctx.redraw();
          }),
          button('Re-analyze CV', 'btn btn-ghost', () => ctx.run({ kind: 'workspace', action: 'processProfileWithChatGPT' }), {
            disabled: !!ctx.busyAction,
          }),
        ]),
      ],
    }),
  );

  return wrapper;
}
