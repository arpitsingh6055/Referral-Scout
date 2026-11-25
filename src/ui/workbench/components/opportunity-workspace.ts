/**
 * Opportunity Workspace — the unified, opportunity-centred control surface.
 * Brings together Overview (fit, eligibility, pre-flight readiness), Application, People (with collision guard),
 * Conversations (LinkedIn + Gmail), Timeline, and Outcome in one place.
 */

import { canonicalCompany } from '../../../shared/domain/job';
import { checkOutreachCollision, deriveOpportunityStage, evaluateReadiness } from '../../../shared/domain/opportunity';
import type { ContactRow, JobRow } from '../../../background/workspace';
import { ago, button, div, input as makeInput, pill, text } from '../dom';
import type { Ctx } from '../shell';

type WorkspaceTab = 'overview' | 'application' | 'people' | 'conversations' | 'timeline' | 'outcome';

let activeTab: WorkspaceTab = 'overview';
let lastJobId: string | null = null;
let draftingForContact: string | null = null;

const ELIGIBILITY_TONE: Record<string, 'green' | 'amber' | 'red'> = {
  eligible: 'green',
  unknown: 'amber',
  ineligible: 'red',
};

const TIER_TONE: Record<string, 'green' | 'violet' | 'grey' | 'red'> = {
  strong: 'green',
  possible: 'violet',
  weak: 'grey',
  blocked: 'red',
};

export function opportunityWorkspace(job: JobRow, ctx: Ctx, onClose?: () => void): HTMLElement {
  if (lastJobId !== job.id) {
    lastJobId = job.id;
    activeTab = 'overview';
    draftingForContact = null;
  }

  const queueTask = ctx.view.queue.find(q => q.jobId === job.id || q.url === job.url);
  const allOutreach = ctx.view.outreach ?? [];
  const jobOutreach = allOutreach.filter(o => o.jobId === job.id);
  const note = ctx.view.opportunityNotes?.[job.id];
  const jobEvents = ctx.view.events.filter(
    e =>
      e.entityId === job.id ||
      (queueTask && e.entityId === queueTask.id) ||
      (canonicalCompany(e.company) === canonicalCompany(job.company) && (!e.title || e.title === job.title)),
  );
  const lifecycle = deriveOpportunityStage({
    job: {
      availability: job.freshness === 'stale' ? 'closed' : 'open',
      userJudgement: job.judgement === 'shortlisted' || job.judgement === 'rejected' ? job.judgement : 'none',
      ...(job.fitAssessed
        ? {
            qualification: {
              eligibility: job.eligibility as 'eligible' | 'ineligible' | 'unknown',
              checks: [],
              fit: job.fit,
              fitEvidence: [],
              preferenceFit: 100,
              preferenceNotes: [],
              sourceConfidence: 0.9,
              freshness: job.freshness as 'fresh' | 'recent' | 'stale' | 'unknown',
              tier: job.tier as 'strong' | 'possible' | 'weak' | 'blocked',
              rejectionReasons: job.rejectionReasons,
              qualifiedAt: Date.now(),
            },
          }
        : {}),
    },
    ...(queueTask ? { application: { state: queueTask.state } } : {}),
    outreach: jobOutreach,
    ...(note ? { note } : {}),
    confirmedEventTypes: jobEvents.filter(e => e.confidence === 'verified').map(e => e.type),
  });

  const pinnedSet = new Set(ctx.view.campaign?.referral.pinnedCompanies ?? []);
  const companyPinned = pinnedSet.has(canonicalCompany(job.company));
  const readiness = ctx.view.readiness ?? evaluateReadiness(ctx.view.facts ?? [], !!ctx.workspace?.cv.hasText);

  const root = div('card opp-workspace');
  root.append(
    div('card-head', [
      div('', [
        text('div', 'card-title', `${job.title} — ${job.company}`),
        text('div', 'card-sub', `${job.location} · ${job.source} · ${job.applyType}`),
      ]),
      div('card-link', [onClose ? button('Close', 'btn-link', onClose) : null]),
    ]),
    div('inline', [
      pill(lifecycle.label, lifecycle.tone),
      lifecycle.isApplying && lifecycle.isNetworking ? pill('Parallel: Applying + Networking', 'blue') : null,
      pill(job.fitAssessed ? `Fit ${job.fit}/100` : 'Fit not assessed', TIER_TONE[job.tier] ?? 'grey'),
      pill(
        job.eligibility === 'eligible' ? 'Eligible' : job.eligibility === 'ineligible' ? 'Not eligible' : 'Eligibility unknown',
        ELIGIBILITY_TONE[job.eligibility] ?? 'grey',
      ),
      companyPinned ? pill('Company pinned', 'violet') : null,
    ]),
  );

  const tabs = div('tabs opp-tabs');
  tabs.setAttribute('role', 'tablist');
  const coKey = canonicalCompany(job.company);
  const companyContacts = (ctx.workspace?.contacts ?? []).filter(c => !c.suppressed && canonicalCompany(c.company ?? '') === coKey);
  const jobConvs = (ctx.view.conversations ?? []).filter(
    c => c.attributedOpportunityIds.includes(job.id) || canonicalCompany(c.companyName ?? '') === coKey,
  );

  for (const [key, label] of [
    ['overview', 'Overview'],
    ['application', queueTask ? `Application (${queueTask.stateLabel})` : 'Application'],
    ['people', `People (${companyContacts.length})`],
    ['conversations', `Conversations (${jobConvs.length})`],
    ['timeline', `Timeline (${jobEvents.length})`],
    ['outcome', 'Outcome'],
  ] as [WorkspaceTab, string][]) {
    const b = button(label, 'tab', () => {
      activeTab = key;
      ctx.redraw();
    });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(activeTab === key));
    tabs.append(b);
  }
  root.append(tabs);

  const body = div('stack');

  if (activeTab === 'overview') {
    if (job.tier === 'blocked') {
      body.append(div('note note-amber', [text('p', '', `Not eligible: ${job.rejectionReasons.join(' ')}`)]));
    }
    if (job.aiWhy) {
      body.append(
        div('note note-violet', [
          text('p', '', `${job.fitSource === 'chatgpt' ? 'ChatGPT assessment' : 'Profile evidence'}: ${job.aiWhy}`),
        ]),
      );
    }
    body.append(text('h3', 'card-title', 'Eligibility & Fit Evidence'));
    if (job.checks.length) {
      for (const c of job.checks) {
        body.append(
          div('rule-row', [
            div('', [text('div', 'rule-name', c.label), text('div', 'rule-note', c.reason)]),
            pill(c.state === 'eligible' ? 'Yes' : c.state === 'ineligible' ? 'No' : 'Unknown', ELIGIBILITY_TONE[c.state] ?? 'grey'),
          ]),
        );
      }
    }
    if (job.evidence.length) {
      for (const e of job.evidence) {
        body.append(
          div('rule-row', [
            div('', [
              text('div', 'rule-name', e.requirement),
              text(
                'div',
                'rule-note',
                e.state === 'met'
                  ? `Matched with ${e.matchedWith ?? 'your profile'}`
                  : e.state === 'missing'
                    ? 'Not found in your profile'
                    : 'Could not be read from the posting',
              ),
            ]),
            pill(
              e.state === 'met' ? 'Met' : e.state === 'missing' ? 'Not found' : 'Unclear',
              e.state === 'met' ? 'green' : e.state === 'missing' ? 'amber' : 'grey',
            ),
          ]),
        );
      }
    } else {
      body.append(text('p', 'cell-muted', 'This posting did not list separate requirements yet.'));
    }

    body.append(
      text('h3', 'card-title', `Pre-Flight Application Readiness (${readiness.score}%)`),
      div(
        'readiness-list',
        readiness.checks.map(rc =>
          div('rule-row', [
            div('', [
              text('div', 'rule-name', rc.label),
              text('div', 'rule-note', rc.ready ? `Verified (${rc.source ?? 'saved'})` : 'Missing — add in Answer Bank or Profile'),
            ]),
            pill(rc.ready ? 'Ready' : 'Missing', rc.ready ? 'green' : 'amber'),
          ]),
        ),
      ),
    );
  } else if (activeTab === 'application') {
    if (queueTask) {
      body.append(
        div('note', [text('p', '', `Status: ${queueTask.stateLabel} · ${queueTask.note}`)]),
        div('inline', [
          queueTask.state === 'needs-you' || queueTask.state === 'uncertain'
            ? button('Resolve in Today / Needs You →', 'btn btn-primary btn-sm', () => ctx.go('needs-you'))
            : null,
          button('View in Application Queue', 'btn btn-sm', () => ctx.go('applications')),
        ]),
      );
    } else {
      body.append(
        div('note', [
          text(
            'p',
            '',
            readiness.ready
              ? 'All pre-flight facts are ready. Queue this application whenever you want the runner to fill it.'
              : `Pre-flight check: ${readiness.missing.length} required fact(s) missing (${readiness.missing.map(m => m.label).join(', ')}). You can still queue it, or fill them in Answer Bank first.`,
          ),
        ]),
        div('inline', [
          !readiness.ready ? button('Complete Answer Bank →', 'btn btn-sm', () => ctx.go('answers')) : null,
          button('Add to application queue', 'btn btn-primary btn-sm', () =>
            ctx.run({
              kind: 'campaign',
              action: 'enqueue',
              jobs: [
                {
                  jobId: job.id,
                  url: job.url,
                  company: job.company,
                  title: job.title,
                  location: job.location,
                  fit: job.fit,
                  route: job.applyType === 'easy-apply' ? 'easy-apply' : job.applyType === 'ats' ? 'external' : 'unknown',
                  source: job.source,
                  ...(job.postedAt ? { postedAt: job.postedAt } : {}),
                },
              ],
            }),
          ),
        ]),
      );
    }
  } else if (activeTab === 'people') {
    if (!companyContacts.length) {
      body.append(
        text('p', 'cell-muted', `No contacts discovered at ${job.company} yet. Launch LinkedIn + Side Panel to find referrers.`),
        button('Find Referrers on LinkedIn →', 'btn btn-sm btn-primary', () => ctx.openPanel(job.url)),
      );
    } else {
      const companyJobIds = new Set((ctx.workspace?.jobs ?? []).filter(j => canonicalCompany(j.company) === coKey).map(j => j.id));
      for (const c of companyContacts) {
        const collision = checkOutreachCollision({
          contact: { id: c.id, name: c.name, ...(c.suppressed ? { suppressed: true } : {}) } as never,
          opportunityId: job.id,
          existingTasks: allOutreach,
          companyJobIds,
        });
        const existingRoleTask = jobOutreach.find(o => o.contactId === c.id);
        body.append(renderContactRow(c, job, collision, existingRoleTask, ctx));
      }
    }
  } else if (activeTab === 'conversations') {
    body.append(div('inline', [button('Sync Gmail Replies', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'gmailSync' }))]));
    if (!jobConvs.length) {
      body.append(text('p', 'cell-muted', 'No LinkedIn or Gmail conversations linked to this opportunity yet.'));
    } else {
      for (const conv of jobConvs) {
        body.append(
          div('conv-card', [
            div('inline', [
              text('strong', '', conv.contactName),
              pill(conv.channel === 'gmail' ? 'Gmail' : 'LinkedIn', 'blue'),
              pill(
                conv.attributionState === 'confirmed'
                  ? 'Role confirmed'
                  : conv.attributionState === 'ambiguous'
                    ? 'Confirm role'
                    : 'Suggested',
                conv.attributionState === 'confirmed' ? 'green' : 'amber',
              ),
              text('span', 'cell-muted', ago(conv.lastMessageAt)),
            ]),
            conv.subject ? text('div', 'cell-strong', conv.subject) : null,
            conv.summary ? text('div', 'cell-muted', conv.summary) : null,
            conv.attributionState !== 'confirmed'
              ? button('Assign to this role', 'btn btn-sm btn-primary', () =>
                  ctx.run({ kind: 'campaign', action: 'confirmConversation', conversationId: conv.id, opportunityId: job.id }),
                )
              : null,
          ]),
        );
      }
    }
  } else if (activeTab === 'timeline') {
    if (!jobEvents.length) {
      body.append(text('p', 'cell-muted', 'No recorded events for this opportunity yet.'));
    } else {
      for (const ev of jobEvents) {
        body.append(
          div('rule-row', [
            div('', [text('div', 'rule-name', ev.type), text('div', 'rule-note', ev.note ?? `${ev.source} · ${ev.confidence}`)]),
            text('span', 'cell-muted', ago(ev.occurredAt)),
          ]),
        );
      }
    }
  } else if (activeTab === 'outcome') {
    const noteInput = makeInput(note?.notes ?? '', {
      placeholder: 'Interview feedback, recruiter notes, or next steps…',
    }) as HTMLInputElement;
    const dateInput = makeInput(note?.interviewDate ?? '', {
      placeholder: 'Interview date (optional, e.g. 2026-12-02)',
    }) as HTMLInputElement;
    let selectedOutcome = note?.outcome;
    body.append(
      text('div', 'cell-muted', 'Record verified interview or final outcomes for this opportunity:'),
      div(
        'inline',
        (['interviewing', 'offer', 'rejected', 'withdrawn'] as const).map(o =>
          button(o.charAt(0).toUpperCase() + o.slice(1), selectedOutcome === o ? 'btn btn-sm btn-primary' : 'btn btn-sm', () => {
            selectedOutcome = o;
            void ctx.run({
              kind: 'campaign',
              action: 'saveOpportunityNote',
              jobId: job.id,
              company: job.company,
              title: job.title,
              outcome: o,
              notes: noteInput.value,
              ...(dateInput.value.trim() ? { interviewDate: dateInput.value.trim() } : {}),
            });
          }),
        ),
      ),
      noteInput,
      dateInput,
      button('Save notes', 'btn btn-sm', () =>
        ctx.run({
          kind: 'campaign',
          action: 'saveOpportunityNote',
          jobId: job.id,
          company: job.company,
          title: job.title,
          ...(selectedOutcome ? { outcome: selectedOutcome } : {}),
          notes: noteInput.value,
          ...(dateInput.value.trim() ? { interviewDate: dateInput.value.trim() } : {}),
        }),
      ),
    );
  }

  root.append(
    body,
    div('inline opp-footer', [
      job.judgement === 'shortlisted'
        ? button('Remove from shortlist', 'btn btn-sm', () =>
            ctx.run({ kind: 'workspace', action: 'judgeJob', id: job.id, judgement: 'none' }),
          )
        : button('Shortlist', 'btn btn-sm btn-primary', () =>
            ctx.run({ kind: 'workspace', action: 'judgeJob', id: job.id, judgement: 'shortlisted' }),
          ),
      queueTask
        ? button('View in queue', 'btn btn-sm', () => ctx.go('applications'))
        : button('Queue application', 'btn btn-sm', () =>
            ctx.run({
              kind: 'campaign',
              action: 'enqueue',
              jobs: [
                {
                  jobId: job.id,
                  url: job.url,
                  company: job.company,
                  title: job.title,
                  location: job.location,
                  fit: job.fit,
                  route: job.applyType === 'easy-apply' ? 'easy-apply' : job.applyType === 'ats' ? 'external' : 'unknown',
                  source: job.source,
                  ...(job.postedAt ? { postedAt: job.postedAt } : {}),
                },
              ],
            }),
          ),
      job.judgement === 'rejected'
        ? button('Restore job', 'btn btn-sm', () => ctx.run({ kind: 'workspace', action: 'judgeJob', id: job.id, judgement: 'none' }))
        : button('Not for me', 'btn btn-sm', () => ctx.run({ kind: 'workspace', action: 'judgeJob', id: job.id, judgement: 'rejected' })),
      ctx.view.campaign
        ? button(companyPinned ? 'Pinned ★' : 'Pin company', companyPinned ? 'btn btn-sm btn-primary' : 'btn btn-sm', () =>
            ctx.run({ kind: 'campaign', action: 'pinCompany', company: job.company, pinned: !companyPinned }),
          )
        : null,
      button('Open posting', 'btn btn-sm', () => ctx.openExternal(job.url)),
    ]),
  );

  return root;
}

function renderContactRow(
  c: ContactRow,
  job: JobRow,
  collision: ReturnType<typeof checkOutreachCollision>,
  existingRoleTask: NonNullable<Ctx['view']['outreach']>[number] | undefined,
  ctx: Ctx,
): HTMLElement {
  const wrap = div('conv-card');
  wrap.append(
    div('inline', [
      text('strong', '', c.name),
      text('span', 'cell-muted', `${c.role ?? 'Role unknown'} · ${c.relationship}`),
      existingRoleTask ? pill(existingRoleTask.state, existingRoleTask.state === 'approved' ? 'green' : 'violet') : null,
    ]),
  );
  if (collision.warning) {
    wrap.append(div('note note-amber', [text('p', '', collision.warning)]));
  }
  const actions = div('inline');
  if (existingRoleTask?.state === 'draft-ready') {
    actions.append(
      button('Approve draft', 'btn btn-sm btn-primary', () =>
        ctx.run({ kind: 'campaign', action: 'approveOutreach', outreachId: existingRoleTask.id }),
      ),
    );
  } else if (!collision.blocked) {
    actions.append(
      button(draftingForContact === c.id ? 'Cancel draft' : 'Draft Outreach', 'btn btn-sm btn-primary', () => {
        draftingForContact = draftingForContact === c.id ? null : c.id;
        ctx.redraw();
      }),
    );
  }
  if (c.profileUrl) {
    actions.append(button('Open profile', 'btn btn-sm', () => ctx.openExternal(c.profileUrl!)));
  }
  wrap.append(actions);

  if (draftingForContact === c.id) {
    const first = c.name.split(' ')[0] ?? c.name;
    const msgInput = makeInput(
      `Hi ${first}, I'm applying for the ${job.title} role at ${job.company} and noticed your work there. Would love to connect!`,
      { placeholder: 'Write your role-specific outreach note…' },
    ) as HTMLInputElement;
    wrap.append(
      div('inline', [
        msgInput,
        button('Save draft', 'btn btn-sm btn-primary', () => {
          draftingForContact = null;
          return ctx.run({
            kind: 'campaign',
            action: 'createOutreachDraft',
            contactId: c.id,
            opportunityId: job.id,
            channel: 'linkedin-invite',
            message: msgInput.value,
            allowMultiRole: !collision.blocked && !!collision.warning,
          });
        }),
      ]),
    );
  }
  return wrap;
}
