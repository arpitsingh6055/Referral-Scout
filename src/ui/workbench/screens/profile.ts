/**
 * Profile — the records every answer is drawn from (specification 5.1).
 *
 * These are records, not fields. Someone has more than one degree and more than one job, and collapsing them into
 * "your university" loses whichever one the form in front of the runner is asking about.
 *
 * Each entry shows where it came from. A line a CV parser read is a good suggestion and a poor declaration, and
 * the person needs to be able to tell the two apart before it is typed into a real application.
 */

import { ago, button, card, div, el, empty, field, icon, input, metric, pill, plural, text, withActionFeedback } from '../dom';
import { uploadCvForWorkbench } from '../cv-upload';
import type { Ctx } from '../shell';
import type { EducationRecord, EmploymentRecord, ProjectRecord } from '../../../shared/domain/profile';

let editing: string | null = null;

const sourceLabel: Record<string, string> = {
  user: 'You entered this',
  cv: 'Read from your CV',
  profile: 'From your LinkedIn profile',
  model: 'Suggested',
};

const provenance = (p: { source: string; verifiedAt?: number }): HTMLElement =>
  pill(sourceLabel[p.source] ?? p.source, p.verifiedAt ? 'green' : 'amber');

/* ---------- education ---------- */
function educationForm(record: Partial<EducationRecord>, ctx: Ctx): HTMLElement {
  const level = input(record.level ?? '', { placeholder: 'Bachelors, 12th, MBA…' });
  const institution = input(record.institution ?? '', { placeholder: 'Institute of Management Technology' });
  const qualification = input(record.qualification ?? '', { placeholder: 'PGDM' });
  const fieldOf = input(record.field ?? '', { placeholder: 'Marketing' });
  const start = input(record.startDate ?? '', { placeholder: '2026-06', type: 'month' });
  const end = input(record.endDate ?? '', { placeholder: '2028-04', type: 'month' });
  const grade = input(record.grade ?? '', { placeholder: '8.4' });
  const scale = input(record.gradeScale ?? '', { placeholder: 'out of 10' });

  return div('card', [
    text('div', 'card-title', record.id ? 'Edit qualification' : 'Add a qualification'),
    div('form-grid', [
      field('Level', level),
      field('Institution', institution),
      field('Qualification', qualification),
      field('Field of study', fieldOf),
      field('Started', start),
      field('Finished (or expected)', end),
      field('Grade', grade),
      // The scale sits beside the grade because 8.4 out of 10 is not 8.4 percent, and a form will ask for one.
      field('Grade scale', scale),
    ]),
    div('inline', [
      button('Save', 'btn btn-primary', async () => {
        if (!level.value.trim() || !institution.value.trim()) return ctx.fail('A qualification needs at least a level and an institution.');
        await ctx.run({
          kind: 'workspace',
          action: 'education',
          record: {
            ...(record.id ? { id: record.id } : {}),
            level: level.value.trim(),
            institution: institution.value.trim(),
            qualification: qualification.value.trim(),
            field: fieldOf.value.trim(),
            startDate: start.value,
            endDate: end.value,
            grade: grade.value.trim(),
            gradeScale: scale.value.trim(),
          },
        });
        editing = null;
      }),
      button('Cancel', 'btn', () => {
        editing = null;
        ctx.redraw();
      }),
    ]),
  ]);
}

/* ---------- employment ---------- */
function employmentForm(record: Partial<EmploymentRecord>, ctx: Ctx): HTMLElement {
  const employer = input(record.employer ?? '', { placeholder: 'TBX' });
  const title = input(record.title ?? '', { placeholder: 'Product Intern' });
  const location = input(record.location ?? '', { placeholder: 'Gurugram' });
  const start = input(record.startDate ?? '', { type: 'month' });
  const end = input(record.endDate ?? '', { type: 'month' });
  const current = input('', { type: 'checkbox', ...(record.current ? { checked: true } : {}) });
  const achievements = input((record.achievements ?? []).join(' · '), { placeholder: 'Grew activation 12% · Shipped onboarding revamp' });
  const technologies = input((record.technologies ?? []).join(', '), { placeholder: 'SQL, Mixpanel, Figma' });

  return div('card', [
    text('div', 'card-title', record.id ? 'Edit role' : 'Add a role'),
    div('form-grid', [
      field('Employer', employer),
      field('Title', title),
      field('Location', location),
      field('Still here', current),
      field('Started', start),
      field('Finished', end),
    ]),
    field('Achievements (separated by ·)', achievements),
    field('Tools and technologies (comma separated)', technologies),
    div('note note-violet', [
      text(
        'p',
        '',
        'Achievements with numbers in them are what outreach drafts are checked against, so a figure here is a figure the product will let a message claim.',
      ),
    ]),
    div('inline', [
      button('Save', 'btn btn-primary', async () => {
        if (!employer.value.trim() || !title.value.trim()) return ctx.fail('A role needs an employer and a title.');
        await ctx.run({
          kind: 'workspace',
          action: 'employment',
          record: {
            ...(record.id ? { id: record.id } : {}),
            employer: employer.value.trim(),
            title: title.value.trim(),
            location: location.value.trim(),
            startDate: start.value,
            endDate: end.value,
            current: (current as HTMLInputElement).checked,
            achievements: achievements.value
              .split('·')
              .map(a => a.trim())
              .filter(Boolean),
            technologies: technologies.value
              .split(',')
              .map(t => t.trim())
              .filter(Boolean),
            responsibilities: record.responsibilities ?? [],
          },
        });
        editing = null;
      }),
      button('Cancel', 'btn', () => {
        editing = null;
        ctx.redraw();
      }),
    ]),
  ]);
}

/* ---------- projects ---------- */
function projectForm(record: Partial<ProjectRecord>, ctx: Ctx): HTMLElement {
  const name = input(record.name ?? '', { placeholder: 'Campus placement tracker' });
  const summary = input(record.summary ?? '', { placeholder: 'What it was and what came of it' });
  const role = input(record.role ?? '', { placeholder: 'Product lead' });
  const skills = input((record.skills ?? []).join(', '), { placeholder: 'Research, SQL, Figma' });

  return div('card', [
    text('div', 'card-title', record.id ? 'Edit project' : 'Add a project'),
    div('form-grid', [field('Name', name), field('Your role', role)]),
    field('Summary', summary),
    field('Skills used (comma separated)', skills),
    div('inline', [
      button('Save', 'btn btn-primary', async () => {
        if (!name.value.trim()) return ctx.fail('A project needs a name.');
        await ctx.run({
          kind: 'workspace',
          action: 'project',
          record: {
            ...(record.id ? { id: record.id } : {}),
            name: name.value.trim(),
            summary: summary.value.trim(),
            role: role.value.trim(),
            skills: skills.value
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
            outcomes: record.outcomes ?? [],
            links: record.links ?? [],
          },
        });
        editing = null;
      }),
      button('Cancel', 'btn', () => {
        editing = null;
        ctx.redraw();
      }),
    ]),
  ]);
}

/* ---------- the screen ---------- */
export function profile(ctx: Ctx): HTMLElement {
  const w = ctx.workspace;
  if (!w) return empty('Your profile could not be loaded', 'The message above says why. Reload the extension, then reopen this page.');
  const p = w.profile;

  const page = div('stack');

  page.append(
    div('grid metrics', [
      metric('person', 'Qualifications', p.education.length, p.education.length ? 'recorded' : 'add your degree'),
      metric(
        'briefcase',
        'Roles',
        p.employment.length,
        w.yearsExperience !== undefined ? `${w.yearsExperience} years total` : 'add your experience',
      ),
      metric('star', 'Skills', p.skills.length, p.skills.length ? 'used for matching' : 'needed for matching'),
      metric(
        'check',
        'Core answers',
        `${w.completeness.complete}/${w.completeness.total}`,
        w.completeness.missing.length ? 'some still missing' : 'all confirmed',
        !w.completeness.missing.length,
      ),
    ]),
  );

  if (w.conflicts.length)
    page.append(
      div('banner banner-error', [
        icon('alert', 18),
        `Two sources disagree about your ${w.conflicts.map(c => c.label.toLowerCase()).join(' and ')}. Open the records below and correct the wrong one — a form will ask for this.`,
      ]),
    );

  /* LinkedIn connection and profile read stay available in the dashboard, not only in the side panel. */
  page.append(
    card('LinkedIn profile', {
      sub: w.connections.linkedin
        ? `Your profile was last captured ${w.linkedinProfileCapturedAt ? ago(w.linkedinProfileCapturedAt) : 'previously'} from the LinkedIn session in this browser. Refresh it when your LinkedIn details change.`
        : 'Sign in on LinkedIn in this browser, then read your profile here. Referral Scout never asks for your password.',
      body: [
        div('inline', [
          pill(w.connections.linkedin ? 'Profile read' : 'Not read yet', w.connections.linkedin ? 'green' : 'amber'),
          w.connections.linkedin ? text('span', 'cell-muted', `Last available profile: ${w.linkedinProfileName || p.identity.fullName || 'LinkedIn member'}`) : null,
        ]),
        div('inline', w.connections.linkedin
          ? [
              button(ctx.busyAction === 'network:import' ? 'Reading profile…' : 'Refresh LinkedIn profile', 'btn btn-primary', () => ctx.runNetwork({ kind: 'network', action: 'import' }), { disabled: ctx.busyAction === 'network:import', 'aria-busy': ctx.busyAction === 'network:import' }),
              button('Open LinkedIn', 'btn', () => ctx.openExternal('https://www.linkedin.com/')),
            ]
          : [
              button('Open LinkedIn to sign in', 'btn btn-primary', () => ctx.openExternal('https://www.linkedin.com/login')),
              button(ctx.busyAction === 'network:import' ? 'Reading profile…' : "I've signed in — read profile", 'btn btn-primary', () => ctx.runNetwork({ kind: 'network', action: 'import' }), { disabled: ctx.busyAction === 'network:import', 'aria-busy': ctx.busyAction === 'network:import' }),
            ]),
        ctx.busyAction === 'network:import'
          ? text('p', 'field-help', 'This can take a little while. Referral Scout is reading your own profile in a separate work tab; you can keep this dashboard open.')
          : null,
      ],
    }),
  );

  /* ChatGPT is the reconciliation layer: source captures never become candidate records until the user approves. */
  if (w.connections.linkedin && w.cv.hasText) {
    const draft = w.aiProfileDraft;
    page.append(card('ChatGPT profile review', {
      sub: 'Your CV takes priority when it disagrees with LinkedIn. Nothing is added to your candidate profile until you approve this draft.',
      body: [
        draft
          ? div('stack', [
              pill('Draft ready · not saved to profile', 'amber'),
              text('p', 'field-help', `${draft.identity.fullName || 'Candidate'} · ${draft.education.length} education records · ${draft.employment.length} roles · ${draft.projects.length} projects · ${draft.skills.length} skills`),
              draft.conflicts.length ? div('note note-amber', [text('strong', '', `${draft.conflicts.length} source discrepancies found`), ...draft.conflicts.slice(0, 5).map(c => text('p', 'field-help', `${c.field}: CV — ${c.cvValue || 'not stated'} · LinkedIn — ${c.linkedinValue || 'not stated'}. ${c.resolution}`))]) : text('p', 'field-help', 'No explicit CV/LinkedIn conflicts were detected.'),
              draft.missingInformation.length ? text('p', 'field-help', `Needs your input: ${draft.missingInformation.slice(0, 5).join('; ')}`) : null,
              ...draft.education.slice(0, 3).map(e => text('p', 'field-help', `Education: ${e.qualification || e.level} · ${e.institution} · ${e.startDate || 'date not stated'}–${e.endDate || 'date not stated'}`)),
              ...draft.employment.slice(0, 3).map(e => text('p', 'field-help', `Experience: ${e.title} · ${e.employer} · ${e.startDate || 'date not stated'}–${e.current ? 'Present' : e.endDate || 'date not stated'}`)),
              ...draft.skills.slice(0, 12).map(skill => pill(skill, 'grey')),
              div('inline', [
                button(ctx.busyAction === 'workspace:approveAiProfileDraft' ? 'Creating profile suggestions…' : 'Approve and create profile suggestions', 'btn btn-primary', () => ctx.run({ kind: 'workspace', action: 'approveAiProfileDraft' }), { disabled: ctx.busyAction === 'workspace:approveAiProfileDraft', 'aria-busy': ctx.busyAction === 'workspace:approveAiProfileDraft' }),
                button('Reprocess sources', 'btn', () => ctx.run({ kind: 'workspace', action: 'processProfileWithChatGPT' }), { disabled: !!ctx.busyAction, 'aria-busy': ctx.busyAction === 'workspace:processProfileWithChatGPT' }),
              ]),
              text('p', 'field-help', 'Approved records remain marked as AI suggestions. Verify dates, grades, titles and achievements before using them in applications.'),
            ])
          : div('stack', [
              text('p', 'field-help', 'LinkedIn and CV are saved as separate source evidence. Ask ChatGPT to reconcile them into a structured draft before anything enters your candidate profile.'),
              button(ctx.busyAction === 'workspace:processProfileWithChatGPT' ? 'ChatGPT is reconciling…' : w.cv.imported ? 'Reconcile updated CV + LinkedIn' : 'Ask ChatGPT to reconcile CV + LinkedIn', 'btn btn-primary', () => ctx.run({ kind: 'workspace', action: 'processProfileWithChatGPT' }), { disabled: ctx.busyAction === 'workspace:processProfileWithChatGPT', 'aria-busy': ctx.busyAction === 'workspace:processProfileWithChatGPT' }),
            ]),
      ],
    }));
  }

  /* identity */
  const fullName = input(p.identity.fullName ?? '');
  const email = input(p.identity.email ?? '', { type: 'email' });
  const phone = input(p.identity.phone ?? '');
  const city = input(p.identity.city ?? '');
  const state = input(p.identity.state ?? '');
  const country = input(p.identity.country ?? '');
  const address = input(p.identity.address ?? '');
  const postalCode = input(p.identity.postalCode ?? '');

  page.append(
    card('Identity and contact', {
      sub: 'The details most forms ask for first.',
      body: [
        div('form-grid', [
          field('Full name', fullName),
          field('Email', email),
          field('Phone', phone),
          field('Current city', city),
          field('State', state),
          field('Country', country),
          field('Address', address),
          field('PIN / postal code', postalCode),
        ]),
        div('inline', [
          button('Save', 'btn btn-primary', () =>
            ctx.run({
              kind: 'workspace',
              action: 'identity',
              identity: {
                fullName: fullName.value.trim(),
                email: email.value.trim(),
                phone: phone.value.trim(),
                city: city.value.trim(),
                state: state.value.trim(),
                country: country.value.trim(),
                address: address.value.trim(),
                postalCode: postalCode.value.trim(),
              },
            }),
          ),
        ]),
      ],
    }),
  );

  /* education */
  page.append(
    card('Education', {
      sub: 'Keep each qualification separate; forms ask about one at a time.',
      link: button('Add', 'btn-link', () => {
        editing = 'education:new';
        ctx.redraw();
      }),
      body: [
        editing === 'education:new' ? educationForm({}, ctx) : null,
        p.education.length
          ? div(
              'rows',
              p.education.map(e =>
                editing === `education:${e.id}`
                  ? educationForm(e, ctx)
                  : div('row row-compact', [
                      div('', [
                        text('div', 'cell-strong', `${e.qualification || e.level} — ${e.institution}`),
                        text(
                          'div',
                          'cell-muted',
                          [e.field, e.endDate, e.grade ? `${e.grade}${e.gradeScale ? ` ${e.gradeScale}` : ''}` : '']
                            .filter(Boolean)
                            .join(' · '),
                        ),
                      ]),
                      div('inline', [
                        provenance(e.provenance),
                        button('Edit', 'btn btn-sm', () => {
                          editing = `education:${e.id}`;
                          ctx.redraw();
                        }),
                        button('Remove', 'btn btn-sm', () =>
                          ctx.run({ kind: 'workspace', action: 'removeRecord', list: 'education', id: e.id }),
                        ),
                      ]),
                    ]),
              ),
            )
          : text('p', 'cell-muted', 'Nothing recorded yet.'),
      ],
    }),
  );

  /* employment */
  page.append(
    card('Work experience', {
      sub:
        w.yearsExperience !== undefined
          ? `${w.yearsExperience} years in total, worked out from these dates.`
          : 'Years of experience are worked out from these dates.',
      link: button('Add', 'btn-link', () => {
        editing = 'employment:new';
        ctx.redraw();
      }),
      body: [
        editing === 'employment:new' ? employmentForm({}, ctx) : null,
        p.employment.length
          ? div(
              'rows',
              p.employment.map(e =>
                editing === `employment:${e.id}`
                  ? employmentForm(e, ctx)
                  : div('row row-compact', [
                      div('', [
                        text('div', 'cell-strong', `${e.title} — ${e.employer}`),
                        text(
                          'div',
                          'cell-muted',
                          [e.location, `${e.startDate ?? '?'} to ${e.current ? 'now' : (e.endDate ?? '?')}`].filter(Boolean).join(' · '),
                        ),
                      ]),
                      div('inline', [
                        provenance(e.provenance),
                        button('Edit', 'btn btn-sm', () => {
                          editing = `employment:${e.id}`;
                          ctx.redraw();
                        }),
                        button('Remove', 'btn btn-sm', () =>
                          ctx.run({ kind: 'workspace', action: 'removeRecord', list: 'employment', id: e.id }),
                        ),
                      ]),
                    ]),
              ),
            )
          : text('p', 'cell-muted', 'Nothing recorded yet.'),
      ],
    }),
  );

  /* projects */
  page.append(
    card('Projects', {
      sub: 'What written answers draw their examples from.',
      link: button('Add', 'btn-link', () => {
        editing = 'project:new';
        ctx.redraw();
      }),
      body: [
        editing === 'project:new' ? projectForm({}, ctx) : null,
        p.projects.length
          ? div(
              'rows',
              p.projects.map(e =>
                editing === `project:${e.id}`
                  ? projectForm(e, ctx)
                  : div('row row-compact', [
                      div('', [text('div', 'cell-strong', e.name), text('div', 'cell-muted', e.summary ?? e.skills.join(', '))]),
                      div('inline', [
                        provenance(e.provenance),
                        button('Edit', 'btn btn-sm', () => {
                          editing = `project:${e.id}`;
                          ctx.redraw();
                        }),
                        button('Remove', 'btn btn-sm', () =>
                          ctx.run({ kind: 'workspace', action: 'removeRecord', list: 'projects', id: e.id }),
                        ),
                      ]),
                    ]),
              ),
            )
          : text('p', 'cell-muted', 'Nothing recorded yet.'),
      ],
    }),
  );

  /* skills */
  const skills = input(p.skills.map(s => s.skill).join(', '), { placeholder: 'SQL, product analytics, user research, Figma' });
  page.append(
    card('Skills', {
      sub: 'What job requirements are matched against. Without these, nothing can be scored.',
      body: [
        field('Skills (comma separated)', skills),
        div('inline', [
          button('Save skills', 'btn btn-primary', () =>
            ctx.run({
              kind: 'workspace',
              action: 'skills',
              skills: skills.value
                .split(',')
                .map(s => s.trim())
                .filter(Boolean),
            }),
          ),
          button('Re-check my jobs', 'btn', () => ctx.run({ kind: 'workspace', action: 'requalify' })),
        ]),
      ],
    }),
  );

  /* preferences and eligibility */
  const locations = input(p.preferences.locations.join(', '), { placeholder: 'Bengaluru, Gurugram, Remote' });
  const expected = input(p.preferences.expectedCompensation ?? '', { placeholder: '₹25,000 / month' });
  const authorised = input(p.eligibility.authorisedIn.join(', '), { placeholder: 'India' });
  const sponsorship = input('', { type: 'checkbox', ...(p.eligibility.needsSponsorship ? { checked: true } : {}) });

  page.append(
    div('grid split', [
      card('Preferences', {
        sub: 'Used to rank jobs, and to answer the questions forms ask about what you want.',
        body: [
          field('Preferred locations (comma separated)', locations),
          field('Expected salary or stipend', expected),
          div('inline', [
            button('Save preferences', 'btn btn-primary', () =>
              ctx.run({
                kind: 'workspace',
                action: 'preferences',
                locations: locations.value
                  .split(',')
                  .map(l => l.trim())
                  .filter(Boolean),
                expectedCompensation: expected.value.trim(),
              }),
            ),
          ]),
        ],
      }),
      card('Eligibility', {
        sub: 'Where you may work. This is a gate on which jobs are worth applying for.',
        body: [
          field('Countries you can work in (comma separated)', authorised),
          field('I need visa sponsorship', sponsorship),
          div('note note-amber', [
            text(
              'p',
              '',
              'A posting that says nothing about sponsorship is left as unknown, never assumed in your favour. A declaration on a real application has to be yours.',
            ),
          ]),
          div('inline', [
            button('Save eligibility', 'btn btn-primary', () =>
              ctx.run({
                kind: 'workspace',
                action: 'eligibility',
                authorisedIn: authorised.value
                  .split(',')
                  .map(a => a.trim())
                  .filter(Boolean),
                needsSponsorship: (sponsorship as HTMLInputElement).checked,
              }),
            ),
          ]),
        ],
      }),
    ]),
  );

  /* documents */
  const cvFile = el('input', {
    type: 'file',
    accept: '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    class: 'setup-file',
    'aria-label': 'Choose CV file',
  });
  cvFile.id = 'profile-cv-file';
  cvFile.addEventListener('change', () => {
    const file = cvFile.files?.[0];
    if (!file) return;
    cvFile.disabled = true;
    void withActionFeedback(`Reading ${file.name} and saving it on this device…`, async () => {
      const message = await uploadCvForWorkbench(file);
      await ctx.refresh();
      ctx.inform(message);
    })
      .catch(error => ctx.fail(error instanceof Error ? error.message : 'The CV could not be read.'))
      .finally(() => {
        cvFile.disabled = false;
        cvFile.value = '';
      });
  });
  page.append(
    card('Documents', {
      sub: 'Upload your CV here. The file is stored in this browser and attached only to applications you choose to fill.',
      body: [
        w.cvName
          ? div('row row-compact', [
              div('', [text('div', 'cell-strong', w.cvName), text('div', 'cell-muted', 'Saved in this browser · used when an application asks for a CV.')]),
              pill('Saved', 'green'),
            ])
          : div('note note-amber', [text('p', '', 'No CV saved yet. Add a PDF or DOCX to improve job matching and application autofill. This is optional.')]),
        w.connections.linkedin
          ? div('inline', [
              el('label', { class: 'btn', for: 'profile-cv-file' }, [w.cvName ? 'Replace CV' : 'Upload CV']),
              cvFile,
            ])
          : div('note note-violet', [
              text('p', '', 'Read your own LinkedIn profile first so the CV is associated with the right candidate. You can skip the CV entirely and add it later.'),
            ]),
        w.cv.hasText
          ? div('', [
              div('note note-violet', [
                text(
                  'p',
                  '',
                  w.aiProfileDraft
                    ? 'ChatGPT has prepared a draft. Review source conflicts and approve it before records are added.'
                    : 'Your CV is saved as source evidence. ChatGPT will reconcile it with LinkedIn and prepare a draft; nothing is added automatically.',
                ),
              ]),
              div('inline', [
                w.cvName
                  ? button('Delete CV', 'btn btn-danger', async () => {
                      if (confirm('Delete your CV and its extracted text from this device?'))
                        await ctx.runNetwork({ kind: 'network', action: 'deleteCv' });
                    })
                  : null,
              ]),
            ])
          : null,
        w.cvName && !w.cv.hasText
          ? button('Delete CV', 'btn btn-danger', async () => {
              if (confirm('Delete your CV from this device?')) await ctx.runNetwork({ kind: 'network', action: 'deleteCv' });
            })
          : null,
      ],
    }),
  );

  return page;
}

export const profileHeader = (ctx: Ctx): { title: string; sub: string; actions: HTMLElement[] } => ({
  title: 'Candidate profile',
  sub: 'Review the information Referral Scout uses before it matches jobs or prepares applications.',
  actions: [button('Answer Bank', 'btn', () => ctx.go('answers'))],
});

export const describeRecords = (n: number): string => plural(n, 'record');
