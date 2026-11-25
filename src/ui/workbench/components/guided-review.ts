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
import type { EducationRecord, EmploymentRecord, ProjectRecord, StructuredMissingPrompt } from '../../../shared/domain/profile';
import { formatLocation, sanitizeMissingInformation } from '../../../shared/normalizeChatGptProfile';
import { getCachedProgressTasks } from '../../../shared/progress-store';
import type { ReviewProgressSnapshot } from './floating-hud';

interface ReviewSession {
  step: 1 | 2 | 3;
  resolvedConflicts: Set<number>;
  skippedConflicts: Set<number>;
  skippedRoles: Set<number>;
  skippedEdu: Set<number>;
  missingPrompts: StructuredMissingPrompt[];
  mergeNotes: string[];
  dismissedPrompts: Set<string>;
  expandedSections: Set<string>;
  inlineEditKey: string | null;
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
  mergeNotes: [],
  dismissedPrompts: new Set(),
  expandedSections: new Set(['employment', 'skills']),
  inlineEditKey: null,
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
  session.mergeNotes = [];
  session.dismissedPrompts.clear();
  session.expandedSections = new Set(['employment', 'skills']);
  session.inlineEditKey = null;
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

function draftGapInfo(draft: AiProfileDraft): {
  structuredMissing: StructuredMissingPrompt[];
  mergeNotes: string[];
} {
  const rich = draft as WorkspaceView['aiProfileDraft'];
  if (rich && Array.isArray(rich.structuredMissing) && Array.isArray(rich.mergeNotes)) {
    return { structuredMissing: rich.structuredMissing, mergeNotes: rich.mergeNotes };
  }
  const clean = sanitizeMissingInformation(draft.missingInformation, {
    identity: draft.identity,
    employment: draft.employment,
    education: draft.education,
    projects: draft.projects,
  });
  return { structuredMissing: clean.structuredMissing, mergeNotes: clean.mergeNotes };
}

function syncDraftSession(draft: AiProfileDraft | undefined): void {
  if (!draft) return;
  const stamp = `${draft.identity.fullName}:${draft.education.length}:${draft.employment.length}:${draft.conflicts.length}:${draft.skills.length}`;
  if (stamp !== session.lastDraftStamp) {
    session.lastDraftStamp = stamp;
    // Skip Step 1 whenever sources agree instead of trapping users on optional missing fields.
    session.step = draft.conflicts.length > 0 ? 1 : 2;
    session.resolvedConflicts.clear();
    session.skippedConflicts.clear();
    session.skippedRoles.clear();
    session.skippedEdu.clear();
    const info = draftGapInfo(draft);
    session.missingPrompts = info.structuredMissing;
    session.mergeNotes = info.mergeNotes;
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
    projectsCount?: number;
    skillsCount: number;
  },
  mode: 'preview' | 'draft' | 'finalized',
): HTMLElement {
  const fields: [string, string][] = [
    ['Full name', data.fullName || 'Not extracted'],
    ['Email', data.email || 'Not extracted'],
    ['Phone', data.phone || 'Not extracted'],
    ['Location', data.location || 'Not extracted'],
    ['LinkedIn URL', data.profileUrl || 'Not extracted'],
    [
      'Sections ready to inspect',
      `${data.rolesCount} experience · ${data.eduCount} education · ${data.projectsCount ?? 0} projects · ${data.skillsCount} skills`,
    ],
  ];
  const saved = mode !== 'preview';
  return div(`snapshot-card${saved ? ' is-saved' : ''}`, [
    div('diff-card-head', [
      text('span', 'diff-field', saved ? 'Identity & Contact Snapshot' : 'Identity & Contact Preview (Saves as Draft)'),
      mode === 'finalized'
        ? pill('Finalized & Verified ✓', 'green')
        : mode === 'draft'
          ? pill('Saved to Profile ✓', 'green')
          : pill('Ready to save draft', 'violet'),
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

function renderRoleQuickEdit(role: Partial<EmploymentRecord>, ctx: Ctx): HTMLElement {
  const employer = input(role.employer ?? '', { placeholder: 'Employer' });
  const title = input(role.title ?? '', { placeholder: 'Role title' });
  const startDate = input(role.startDate ?? '', { placeholder: 'YYYY-MM' });
  const endDate = input(role.endDate ?? '', { placeholder: 'YYYY-MM or Present' });
  const achievements = input((role.achievements ?? []).join(' · '), { placeholder: 'Key measurable outcomes (separated by ·)' });

  return div('review-inline-editor', [
    div('form-grid', [employer, title, startDate, endDate]),
    achievements,
    div('inline', [
      button('Save role', 'btn btn-sm btn-primary', async () => {
        if (!employer.value.trim() || !title.value.trim()) {
          ctx.fail('Enter both employer and role title.');
          return;
        }
        await ctx.run({
          kind: 'workspace',
          action: 'employment',
          record: {
            ...(role.id ? { id: role.id } : {}),
            employer: employer.value.trim(),
            title: title.value.trim(),
            ...(role.location ? { location: role.location } : {}),
            startDate: startDate.value.trim(),
            endDate: endDate.value.trim(),
            current: role.current ?? /present/i.test(endDate.value),
            achievements: achievements.value
              .split('·')
              .map(v => v.trim())
              .filter(Boolean),
            technologies: role.technologies ?? [],
            responsibilities: role.responsibilities ?? [],
          },
        });
        session.inlineEditKey = null;
        ctx.redraw();
      }),
      button('Cancel', 'btn btn-sm btn-ghost', () => {
        session.inlineEditKey = null;
        ctx.redraw();
      }),
    ]),
  ]);
}

function renderEduQuickEdit(edu: Partial<EducationRecord>, ctx: Ctx): HTMLElement {
  const institution = input(edu.institution ?? '', { placeholder: 'Institution' });
  const qualification = input(edu.qualification ?? edu.level ?? '', { placeholder: 'Degree / Qualification' });
  const endDate = input(edu.endDate ?? '', { placeholder: 'End YYYY-MM' });
  const grade = input(edu.grade ?? '', { placeholder: 'Grade / CGPA' });

  return div('review-inline-editor', [
    div('form-grid', [institution, qualification, endDate, grade]),
    div('inline', [
      button('Save degree', 'btn btn-sm btn-primary', async () => {
        if (!institution.value.trim() || !qualification.value.trim()) {
          ctx.fail('Enter both institution and qualification.');
          return;
        }
        await ctx.run({
          kind: 'workspace',
          action: 'education',
          record: {
            ...(edu.id ? { id: edu.id } : {}),
            level: edu.level || qualification.value.trim(),
            institution: institution.value.trim(),
            qualification: qualification.value.trim(),
            ...(edu.field ? { field: edu.field } : {}),
            ...(edu.startDate ? { startDate: edu.startDate } : {}),
            endDate: endDate.value.trim(),
            grade: grade.value.trim(),
            ...(edu.gradeScale ? { gradeScale: edu.gradeScale } : {}),
          },
        });
        session.inlineEditKey = null;
        ctx.redraw();
      }),
      button('Cancel', 'btn btn-sm btn-ghost', () => {
        session.inlineEditKey = null;
        ctx.redraw();
      }),
    ]),
  ]);
}

function renderProjQuickEdit(proj: Partial<ProjectRecord>, ctx: Ctx): HTMLElement {
  const name = input(proj.name ?? '', { placeholder: 'Project title' });
  const summary = input(proj.summary ?? '', { placeholder: 'Outcome or technical stack' });
  return div('review-inline-editor', [
    div('form-grid', [name, summary]),
    div('inline', [
      button('Save project', 'btn btn-sm btn-primary', async () => {
        if (!name.value.trim()) {
          ctx.fail('Enter a project name.');
          return;
        }
        await ctx.run({
          kind: 'workspace',
          action: 'project',
          record: {
            ...(proj.id ? { id: proj.id } : {}),
            name: name.value.trim(),
            summary: summary.value.trim(),
            skills: proj.skills ?? [],
            outcomes: proj.outcomes ?? [],
            links: proj.links ?? [],
          },
        });
        session.inlineEditKey = null;
        ctx.redraw();
      }),
      button('Cancel', 'btn btn-sm btn-ghost', () => {
        session.inlineEditKey = null;
        ctx.redraw();
      }),
    ]),
  ]);
}

function accordionSection(
  key: 'employment' | 'education' | 'projects' | 'skills',
  summaryLabel: string,
  bodyNodes: (HTMLElement | null)[],
): HTMLElement {
  const detailsEl = el(
    'details',
    {
      class: 'review-details review-section-accordion',
      'data-review-accordion': key,
      ...(session.expandedSections.has(key) ? { open: true } : {}),
    },
    [el('summary', {}, [summaryLabel]), div('stack-xs review-section-body', bodyNodes)],
  );
  detailsEl.addEventListener('toggle', () => {
    if (detailsEl.open) session.expandedSections.add(key);
    else session.expandedSections.delete(key);
  });
  return detailsEl;
}

function renderExpandableProfileSections(w: WorkspaceView, ctx: Ctx): HTMLElement {
  const p = w.profile;

  /* 1. Work Experience */
  const empBody: (HTMLElement | null)[] = p.employment.length
    ? p.employment.map(role =>
        session.inlineEditKey === `emp:${role.id}`
          ? renderRoleQuickEdit(role, ctx)
          : div('review-item-row', [
              div('review-item-copy', [
                text('div', 'cell-strong', `${role.title} — ${role.employer}`),
                text(
                  'div',
                  'cell-muted',
                  [
                    [role.startDate || 'Date ?', role.current ? 'Present' : role.endDate || 'Date ?'].join(' – '),
                    role.achievements[0] || role.responsibilities[0] || '',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ]),
              div('inline', [
                button('Edit', 'btn btn-sm btn-ghost', () => {
                  session.expandedSections.add('employment');
                  session.inlineEditKey = `emp:${role.id}`;
                  ctx.redraw();
                }),
                button('Remove', 'btn btn-sm btn-ghost', () =>
                  ctx.run({ kind: 'workspace', action: 'removeRecord', list: 'employment', id: role.id }),
                ),
              ]),
            ]),
      )
    : [text('p', 'cell-muted', 'No roles extracted yet.')];
  if (session.inlineEditKey === 'emp:new') empBody.push(renderRoleQuickEdit({}, ctx));
  empBody.push(
    div('inline', [
      button('+ Add Role', 'btn btn-sm', () => {
        session.expandedSections.add('employment');
        session.inlineEditKey = 'emp:new';
        ctx.redraw();
      }),
    ]),
  );

  /* 2. Education */
  const eduBody: (HTMLElement | null)[] = p.education.length
    ? p.education.map(edu =>
        session.inlineEditKey === `edu:${edu.id}`
          ? renderEduQuickEdit(edu, ctx)
          : div('review-item-row', [
              div('review-item-copy', [
                text('div', 'cell-strong', `${edu.qualification || edu.level} — ${edu.institution}`),
                text(
                  'div',
                  'cell-muted',
                  [[edu.startDate, edu.endDate].filter(Boolean).join(' – '), edu.grade ? `Grade: ${edu.grade}` : '']
                    .filter(Boolean)
                    .join(' · ') || 'Dates & grade optional',
                ),
              ]),
              div('inline', [
                button('Edit', 'btn btn-sm btn-ghost', () => {
                  session.expandedSections.add('education');
                  session.inlineEditKey = `edu:${edu.id}`;
                  ctx.redraw();
                }),
                button('Remove', 'btn btn-sm btn-ghost', () =>
                  ctx.run({ kind: 'workspace', action: 'removeRecord', list: 'education', id: edu.id }),
                ),
              ]),
            ]),
      )
    : [text('p', 'cell-muted', 'No education records extracted yet.')];
  if (session.inlineEditKey === 'edu:new') eduBody.push(renderEduQuickEdit({}, ctx));
  eduBody.push(
    div('inline', [
      button('+ Add Degree', 'btn btn-sm', () => {
        session.expandedSections.add('education');
        session.inlineEditKey = 'edu:new';
        ctx.redraw();
      }),
    ]),
  );

  /* 3. Projects */
  const projBody: (HTMLElement | null)[] = p.projects.length
    ? p.projects.map(proj =>
        session.inlineEditKey === `proj:${proj.id}`
          ? renderProjQuickEdit(proj, ctx)
          : div('review-item-row', [
              div('review-item-copy', [
                text('div', 'cell-strong', proj.name),
                proj.summary ? text('div', 'cell-muted', proj.summary) : null,
              ]),
              div('inline', [
                button('Edit', 'btn btn-sm btn-ghost', () => {
                  session.expandedSections.add('projects');
                  session.inlineEditKey = `proj:${proj.id}`;
                  ctx.redraw();
                }),
                button('Remove', 'btn btn-sm btn-ghost', () =>
                  ctx.run({ kind: 'workspace', action: 'removeRecord', list: 'projects', id: proj.id }),
                ),
              ]),
            ]),
      )
    : [text('p', 'cell-muted', 'No projects extracted.')];
  if (session.inlineEditKey === 'proj:new') projBody.push(renderProjQuickEdit({}, ctx));
  projBody.push(
    div('inline', [
      button('+ Add Project', 'btn btn-sm', () => {
        session.expandedSections.add('projects');
        session.inlineEditKey = 'proj:new';
        ctx.redraw();
      }),
    ]),
  );

  /* 4. Skills (removable chips + inline add) */
  const newSkillInput = input('', { placeholder: 'Add a skill (e.g. Python, SQL)…', 'aria-label': 'Add extracted skill' });
  const addSkill = async (): Promise<void> => {
    const clean = newSkillInput.value.trim();
    if (!clean) return;
    const nextSkills = [...new Set([...p.skills.map(s => s.skill), clean])];
    await ctx.run({ kind: 'workspace', action: 'skills', skills: nextSkills });
    newSkillInput.value = '';
  };
  const skillChips = div(
    'chips',
    p.skills.map(s =>
      el('span', { class: 'skill-chip' }, [
        s.skill,
        el(
          'button',
          {
            type: 'button',
            class: 'skill-chip-remove',
            'aria-label': `Remove ${s.skill}`,
            title: `Remove ${s.skill}`,
          },
          ['×'],
        ),
      ]),
    ),
  );
  // Wire remove buttons reliably.
  p.skills.forEach((s, i) => {
    const btn = skillChips.children[i]?.querySelector('button');
    btn?.addEventListener('click', () => {
      void ctx.run({ kind: 'workspace', action: 'removeRecord', list: 'skills', id: s.id });
    });
  });

  const skillsBody: HTMLElement[] = [
    p.skills.length ? skillChips : text('p', 'cell-muted', 'No skills extracted yet.'),
    div('inline', [newSkillInput, button('+ Add Skill', 'btn btn-sm', addSkill)]),
  ];

  return div('stack-xs', [
    accordionSection('employment', `Experience Roles (${p.employment.length}) — inspect or edit`, empBody),
    accordionSection('education', `Education (${p.education.length} degrees) — inspect or edit`, eduBody),
    accordionSection('projects', `Projects (${p.projects.length}) — inspect or edit`, projBody),
    accordionSection('skills', `Skills (${p.skills.length}) — add or remove`, skillsBody),
  ]);
}

function renderCleanPromptsAndMergeNotes(
  prompts: readonly StructuredMissingPrompt[],
  mergeNotes: readonly string[],
  ctx: Ctx,
): HTMLElement | null {
  const active = prompts.filter(p => !session.dismissedPrompts.has(p.id)).slice(0, 4);
  if (!active.length && !mergeNotes.length) return null;

  const box = div('stack-xs', [
    mergeNotes.length
      ? div('note note-green', [
          icon('check', 15),
          text('span', '', `Merged CV + LinkedIn cleanly ✓ · ${mergeNotes.slice(0, 2).join(' · ')}`),
        ])
      : null,
  ]);

  if (active.length) {
    const promptRows = div(
      'quick-fill-list',
      active.map(item => {
        const inp = input('', { placeholder: item.inputPlaceholder, 'aria-label': item.shortLabel });
        const dismiss = async (): Promise<void> => {
          session.dismissedPrompts.add(item.id);
          await ctx.run({ kind: 'workspace', action: 'dismissReviewPrompt', promptId: item.id });
        };
        return div('quick-fill-row', [
          div('', [text('div', 'rule-name', item.shortLabel), text('span', 'field-help', item.helperQuestion)]),
          item.suggestedAction === 'inline-fact' && item.factKey
            ? div('inline', [
                inp,
                button('Save', 'btn btn-sm btn-primary', async () => {
                  const val = inp.value.trim();
                  if (!val) return;
                  await ctx.run({ kind: 'workspace', action: 'saveFact', key: item.factKey!, value: val });
                  await dismiss();
                }),
                button('Skip', 'btn btn-sm btn-ghost', dismiss),
              ])
            : div('inline', [
                button(`Open ${item.targetSection} →`, 'btn btn-sm', () => {
                  if (item.targetSection === 'employment' || item.targetSection === 'education' || item.targetSection === 'projects') {
                    session.expandedSections.add(item.targetSection);
                    const first =
                      item.targetSection === 'employment'
                        ? ctx.workspace?.profile.employment.find(
                            r => !item.targetHint || r.employer.toLowerCase().includes(item.targetHint.toLowerCase()),
                          )
                        : item.targetSection === 'education'
                          ? ctx.workspace?.profile.education.find(
                              e => !item.targetHint || e.institution.toLowerCase().includes(item.targetHint.toLowerCase()),
                            )
                          : ctx.workspace?.profile.projects.find(
                              p => !item.targetHint || p.name.toLowerCase().includes(item.targetHint.toLowerCase()),
                            );
                    if (first) {
                      session.inlineEditKey =
                        item.targetSection === 'employment'
                          ? `emp:${first.id}`
                          : item.targetSection === 'education'
                            ? `edu:${first.id}`
                            : `proj:${first.id}`;
                    }
                    ctx.redraw();
                  } else {
                    void dismiss();
                  }
                }),
                button('Skip', 'btn btn-sm btn-ghost', dismiss),
              ]),
        ]);
      }),
    );
    box.append(
      el('details', { class: 'review-details', open: true }, [
        el('summary', {}, [`Optional clarifications (${active.length}) — fill now or skip anytime`]),
        div('quick-fill-box', [promptRows]),
      ]),
    );
  }

  return box;
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

  const persistedAi = getCachedProgressTasks().cv_ai_review;
  const aiRunningCrossTab = persistedAi?.status === 'running' && !w.aiProfileDraft && !options.aiError;
  if (ctx.busyAction === 'workspace:processProfileWithChatGPT' || aiRunningCrossTab) {
    wrapper.append(
      card('AI Review in Progress', {
        sub: 'ChatGPT is comparing your CV with LinkedIn and organizing changes safely.',
        link: button('Open ChatGPT tab', 'btn btn-sm', () => ctx.openExternal('https://chatgpt.com/')),
        body: [
          renderLiveBridge(
            'ai',
            options.busyMessage || persistedAi?.detail || persistedAi?.label || 'Analyzing your CV and LinkedIn details…',
          ),
        ],
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

  /* Step 3: Resumable Draft Review OR Finalized Profile Ceremony */
  if (!draft) {
    const reviewStatus = w.reviewMeta?.status ?? (session.justApproved ? 'draft' : 'finalized');
    const isFinalized = reviewStatus === 'finalized' && !session.justApproved;
    const isDraft = reviewStatus === 'draft' || session.justApproved;
    const activePrompts = (w.reviewMeta?.pendingPrompts ?? session.missingPrompts).filter(p => !session.dismissedPrompts.has(p.id));
    const mergeNotes = w.reviewMeta?.mergeNotes ?? session.mergeNotes;

    const primaryCta = options.onApprovedNext
      ? button('Next: Set Target Role →', 'btn btn-primary btn-lg', options.onApprovedNext)
      : !ctx.view.campaign
        ? button('Next: Set Target Role →', 'btn btn-primary btn-lg', () => ctx.go('welcome'))
        : w.jobs.length
          ? button('Next: Review Top Jobs →', 'btn btn-primary btn-lg', () => ctx.go('jobs'))
          : button('Next: Find Jobs on LinkedIn →', 'btn btn-primary btn-lg', () =>
              ctx.runNetwork({ kind: 'network', action: 'findJobs' }),
            );

    const cardTitle = session.justApproved
      ? 'Step 3 of 3: Saved to Your Profile ✓'
      : isDraft
        ? 'Profile Draft — Review & Finalize'
        : 'Finalized & Ready ✓';

    const cardSub = isDraft
      ? 'Saved as Draft. Inspect or edit your roles, degrees & skills below, then click Finalize Profile ✓ to confirm.'
      : 'Your CV and LinkedIn profile are verified and synced across matching and autofill.';

    wrapper.append(
      card(cardTitle, {
        sub: cardSub,
        link: pill(
          session.justApproved ? 'Saved to Profile ✓' : isDraft ? 'Draft — Needs Final Sign-Off' : 'Finalized & Ready ✓',
          isDraft && !session.justApproved ? 'amber' : 'green',
        ),
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
              projectsCount: w.profile.projects.length,
              skillsCount: w.profile.skills.length,
            },
            isFinalized ? 'finalized' : 'draft',
          ),
          isDraft ? renderExpandableProfileSections(w, ctx) : null,
          renderCleanPromptsAndMergeNotes(activePrompts, mergeNotes, ctx),
          div('inline', [
            isDraft
              ? button('Finalize Profile ✓', 'btn btn-primary btn-lg', async () => {
                  await ctx.run({ kind: 'workspace', action: 'finalizeProfile' });
                  session.justApproved = false;
                  emitReviewChanged();
                })
              : primaryCta,
            isDraft
              ? button('Save Draft', 'btn', () => ctx.inform('Draft saved — resume review anytime from Profile or the bottom bar.'))
              : button('Re-open AI Review / Edit', 'btn', () => ctx.run({ kind: 'workspace', action: 'reopenProfileReview' })),
            isDraft && options.onApprovedNext ? button('Next: Set Target Role →', 'btn', options.onApprovedNext) : null,
            options.cvInputId ? el('label', { class: 'btn', for: options.cvInputId }, ['Replace CV']) : null,
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

  const approveDraftNow = async (): Promise<void> => {
    const info = draftGapInfo(draft);
    session.missingPrompts = info.structuredMissing;
    session.mergeNotes = info.mergeNotes;
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
  };

  /* Active Guided 3-Step Review when `draft` exists */
  const p = w.profile;
  const conflicts = draft.conflicts;
  const step = session.step === 3 ? 2 : session.step;

  if (options.variant === 'welcome') {
    wrapper.append(
      card('AI Review Ready (Under 30 seconds)', {
        sub: `${conflicts.length ? `${conflicts.length} differences to glance over · ` : ''}${draft.employment.length} roles, ${draft.education.length} degrees and ${draft.skills.length} skills extracted.`,
        link: pill('Ready to confirm', 'amber'),
        body: [
          stepHeader(1),
          div('inline', [
            button('Looks Good — Save All →', 'btn btn-primary btn-lg', approveDraftNow, {
              disabled: ctx.busyAction === 'workspace:approveAiProfileDraft',
              'data-busy-label': 'Saving profile…',
            }),
            button('Inspect Before Saving', 'btn', () => {
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
      : [div('note note-green', [text('p', '', 'No differences found between your CV and LinkedIn profile.')])];

    wrapper.append(
      card('Step 1 of 3: Confirm Differences (Before → After)', {
        sub: conflicts.length
          ? `${handledCount} of ${conflicts.length} reviewed. Your CV takes priority wherever LinkedIn differed.`
          : 'Your CV and LinkedIn agree cleanly.',
        link: pill('Step 1 of 3', 'violet'),
        body: [
          stepHeader(1),
          ...conflictCards,
          div('wizard-foot', [
            button(conflicts.length ? 'Confirm & Review Improvements →' : 'Continue to Improvements →', 'btn btn-primary btn-lg', () => {
              conflicts.forEach((_, idx) => {
                if (!session.skippedConflicts.has(idx)) session.resolvedConflicts.add(idx);
              });
              session.step = 2;
              emitReviewChanged();
              ctx.redraw();
            }),
            button('Looks Good — Save All Now', 'btn', approveDraftNow, {
              disabled: ctx.busyAction === 'workspace:approveAiProfileDraft',
              'data-busy-label': 'Saving profile…',
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

  /* Step 2: Scannable Must-Confirm Snapshot + Fast-Path CTA + Progressive Disclosure for Roles/Degrees */
  const includedRolesCount = draft.employment.filter((_, i) => !session.skippedRoles.has(i)).length;
  const includedEduCount = draft.education.filter((_, i) => !session.skippedEdu.has(i)).length;
  const newProjCount = draft.projects.length;
  const newSkillsCount = draft.skills.length;

  const detailCards: HTMLElement[] = [
    div('diff-summary-grid', [
      div('diff-summary-cell', [
        text('span', 'diff-tag', 'Current Profile (Before)'),
        text('div', 'diff-summary-val', `${p.employment.length} roles · ${p.education.length} degrees · ${p.skills.length} skills`),
      ]),
      div('diff-summary-cell is-after', [
        text('span', 'diff-tag', 'Additions Ready (After)'),
        text(
          'div',
          'diff-summary-val',
          `+${includedRolesCount} roles · +${includedEduCount} degrees · +${newProjCount} projects · +${newSkillsCount} skills`,
        ),
      ]),
    ]),
  ];

  draft.employment.forEach((role, idx) => {
    const skipped = session.skippedRoles.has(idx);
    detailCards.push(
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
              'Original CV bullet',
              role.responsibilities[0] || 'Experience bullet from CV',
              'Highlighted Achievement',
              role.achievements.slice(0, 2).join(' · '),
            )
          : text('p', 'field-help', role.responsibilities.slice(0, 2).join(' · ') || 'Role details captured from your CV.'),
        role.technologies.length
          ? div(
              'chips',
              role.technologies.map(t => pill(t, 'grey')),
            )
          : null,
      ]),
    );
  });

  draft.education.forEach((edu, idx) => {
    const skipped = session.skippedEdu.has(idx);
    detailCards.push(
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

  draft.projects.forEach(proj => {
    detailCards.push(
      div('diff-card is-accepted', [
        div('diff-card-head', [text('span', 'diff-field', proj.name), pill('Project', 'violet')]),
        proj.summary ? text('p', 'field-help', proj.summary) : null,
      ]),
    );
  });

  if (draft.skills.length) {
    detailCards.push(
      div('stack-xs', [
        text('div', 'field-label', `Skills extracted (${draft.skills.length})`),
        div(
          'chips',
          draft.skills.map(s => pill(s, 'violet')),
        ),
      ]),
    );
  }

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
        projectsCount: newProjCount,
        skillsCount: newSkillsCount,
      },
      'preview',
    ),
    draft.narrative.strengths || draft.narrative.careerGoal
      ? div('note note-violet', [
          text('strong', '', 'AI Career Summary'),
          draft.narrative.strengths ? text('p', 'field-help', draft.narrative.strengths) : null,
          draft.narrative.careerGoal ? text('p', 'field-help', `Target direction: ${draft.narrative.careerGoal}`) : null,
        ])
      : el('div', { style: 'display:none' }),
    el('details', { class: 'review-details' }, [
      el('summary', {}, [
        `Inspect or customize roles, degrees & skills (+${includedRolesCount} roles, +${includedEduCount} degrees, +${newSkillsCount} skills)`,
      ]),
      div('stack', detailCards),
    ]),
  ];

  wrapper.append(
    card('Step 2 of 3: Accept & Apply Improvements', {
      sub: 'Confirm your contact snapshot below to save everything into your profile and unlock job matching.',
      link: pill('Step 2 of 3', 'violet'),
      body: [
        stepHeader(2),
        ...previewItems,
        div('wizard-foot', [
          button(
            ctx.busyAction === 'workspace:approveAiProfileDraft' ? 'Applying changes…' : 'Accept & Apply Changes →',
            'btn btn-primary btn-lg',
            approveDraftNow,
            {
              disabled: ctx.busyAction === 'workspace:approveAiProfileDraft',
              'aria-busy': ctx.busyAction === 'workspace:approveAiProfileDraft',
              'data-busy-label': 'Applying to profile…',
              'data-progress': 'Saving verified details to your Candidate Profile…',
            },
          ),
          conflicts.length
            ? button('← Back to differences', 'btn', () => {
                session.step = 1;
                emitReviewChanged();
                ctx.redraw();
              })
            : null,
          button('Re-analyze CV', 'btn btn-ghost', () => ctx.run({ kind: 'workspace', action: 'processProfileWithChatGPT' }), {
            disabled: !!ctx.busyAction,
          }),
        ]),
      ],
    }),
  );

  return wrapper;
}
