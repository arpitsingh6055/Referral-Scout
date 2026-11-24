/**
 * Profile — the records every answer is drawn from (specification 5.1).
 *
 * These are records, not fields. Someone has more than one degree and more than one job, and collapsing them into
 * "your university" loses whichever one the form in front of the runner is asking about.
 *
 * Each entry shows where it came from. A line a CV parser read is a good suggestion and a poor declaration, and
 * the person needs to be able to tell the two apart before it is typed into a real application.
 */

import { button, card, div, empty, field, icon, input, metric, pill, plural, text } from '../dom';
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
  if (!w) return empty('Loading your profile…', 'One moment.');
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
  page.append(
    card('Documents', {
      sub: 'The CV attached to applications, and what can be read out of it.',
      body: [
        w.cvName
          ? div('row row-compact', [
              div('', [text('div', 'cell-strong', w.cvName), text('div', 'cell-muted', 'Attached to applications that ask for a CV.')]),
              pill('Saved', 'green'),
            ])
          : div('note note-amber', [
              text(
                'p',
                '',
                'No CV saved yet. Upload one in the side panel settings — applications need the file itself, not just the text.',
              ),
            ]),
        w.cv.hasText
          ? div('', [
              div('note note-violet', [
                text(
                  'p',
                  '',
                  w.cv.imported
                    ? 'Your CV has already been read into the records above. Reading it again adds anything new and leaves what you have confirmed alone.'
                    : 'Your CV can be read into education, experience, projects and skills. Everything it finds arrives unverified for you to check — nothing is overwritten.',
                ),
              ]),
              div('inline', [
                button(w.cv.imported ? 'Read my CV again' : 'Read my CV into these records', 'btn btn-primary', () =>
                  ctx.run({ kind: 'workspace', action: 'importCv' }),
                ),
              ]),
            ])
          : null,
      ],
    }),
  );

  return page;
}

export const profileHeader = (ctx: Ctx): { title: string; sub: string; actions: HTMLElement[] } => ({
  title: 'Candidate profile',
  sub: 'The records behind every answer the product gives on your behalf.',
  actions: [button('Answer Bank', 'btn', () => ctx.go('answers'))],
});

export const describeRecords = (n: number): string => plural(n, 'record');
