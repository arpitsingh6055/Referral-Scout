/**
 * LinkedIn's Easy Apply markup as it stands on 26 November 2026, captured from a live application
 * (job 4492303290, "Product Management Intern"). Everything that used to identify the window is gone:
 *
 *   - the window is a native `<dialog data-testid="dialog" aria-labelledby="dialog-header">`
 *     with no `role="dialog"`, no `aria-modal` and no `.jobs-easy-apply-*` class;
 *   - every class name is hashed (`ekfj5d ekfj5c …`), so no class hook survives;
 *   - fields carry React ids (`_r_1q_`) and no `aria-label`; the question is in `<label for>`;
 *   - a refused step sets no `aria-invalid` and renders no `role="alert"`: the message is a
 *     helper-text node joined to the field by `aria-describedby`;
 *   - the resume step is one radio per stored file, labelled only by `aria-label`, with the date beside it;
 *   - "Mark this job as a top choice" is a `[role="switch"]`, not a checkbox.
 *
 * These tests pin that markup so the next LinkedIn redesign fails here rather than in the panel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplyApi } from '../src/content/apply';

const load = async (): Promise<ApplyApi> => {
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
  delete (globalThis as { __referralScoutApply?: unknown }).__referralScoutApply;
  vi.resetModules();
  await import('../src/content/apply');
  return (globalThis as unknown as { __referralScoutApply: ApplyApi }).__referralScoutApply;
};

/** The page behind the window: a search box, a language picker and a job-alert tick. None belong to the application. */
const PAGE_CHROME = `
  <input id="_r_4_" type="text" placeholder="Search" />
  <label for="_r_q_">Set alert for similar jobs</label><input id="_r_q_" type="checkbox" />
  <label for="_r_n_">Select language</label><select id="_r_n_"><option>English</option></select>
  <button aria-label="Next" data-testid="carousel-inline-right-button"></button>`;

const contactStep = (telValue = '8968771062', helper = '') => `
  ${PAGE_CHROME}
  <dialog data-testid="dialog" aria-labelledby="dialog-header" open class="ekfjwg">
    <h2 id="dialog-header" class="ekfj7j">Apply to Lxme</h2>
    <div role="progressbar" aria-valuenow="25" aria-valuemax="100"></div>
    <span>1/4 pages</span>
    <button type="button" data-dialog-dismiss aria-label="Dismiss"></button>
    <div class="ekfka1">
      <label for="_r_1q_">Email address*</label>
      <select id="_r_1q_" required><option value="sarpit4545@gmail.com" selected>sarpit4545@gmail.com</option></select>
      <label for="_r_1u_">Mobile phone number*</label>
      <input id="_r_1u_" type="tel" required value="${telValue}" aria-describedby="_r_al_-info" />
      ${helper ? `<div data-testid="text-input-helper-text" id="_r_al_-info"><p class="ekfjq5">${helper}</p></div>` : ''}
    </div>
    <button type="button" class="ekfj5d">Next</button>
  </dialog>`;

describe('LinkedIn Easy Apply, 2026 markup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the application window although it is a plain <dialog> with hashed classes and no role', async () => {
    document.body.innerHTML = contactStep();
    const api = await load();
    const snap = api.scan({ linkedin: true });
    expect(snap.step).toContain('Apply to Lxme');
    expect(snap.hasNext).toBe(true);
    expect(snap.hasSubmit).toBe(false);
  });

  it('says where the person is once, using the site\u2019s own counter rather than repeating it as a percentage', async () => {
    document.body.innerHTML = contactStep();
    const api = await load();
    const step = api.scan({ linkedin: true }).step;
    expect(step).toBe('1/4 pages \u00b7 Apply to Lxme');
    expect(step).not.toContain('%');
  });

  it('falls back to the progress bar when the site shows no counter', async () => {
    document.body.innerHTML = contactStep().replace('<span>1/4 pages</span>', '');
    const api = await load();
    expect(api.scan({ linkedin: true }).step).toBe('25% complete \u00b7 Apply to Lxme');
  });

  it('reads only the application’s own fields, never the page’s search box, language picker or job alert', async () => {
    document.body.innerHTML = contactStep();
    const api = await load();
    const labels = api.scan({ linkedin: true }).form.map(f => f.label);
    expect(labels).toContain('Email address');
    expect(labels).toContain('Mobile phone number');
    expect(labels.join(' ')).not.toMatch(/search|language|alert/i);
  });

  it('reports the site’s own complaint, which it shows with no aria-invalid and no role="alert"', async () => {
    document.body.innerHTML = contactStep('', 'Please enter a valid phone number');
    const api = await load();
    const errs = api.fieldErrors();
    expect(errs.some(e => e.message === 'Please enter a valid phone number')).toBe(true);
    expect(errs.some(e => /phone/i.test(e.label))).toBe(true);
  });

  it('does not mistake an ordinary hint for a complaint', async () => {
    document.body.innerHTML = contactStep('8968771062', 'Select or upload a resume in DOC, DOCX or PDF format under 2MB');
    const api = await load();
    expect(api.fieldErrors()).toEqual([]);
  });

  const resumeStep = (checkedIndex = -1) => `
    <dialog data-testid="dialog" aria-labelledby="dialog-header" open>
      <h2 id="dialog-header">Apply to Lxme</h2>
      <div role="progressbar" aria-valuenow="50" aria-valuemax="100"></div>
      <p>Resume*</p>
      ${[
        ['Arpit_Singh_CV.pdf', '11/26/2026'],
        ['arpit_singh_resume.pdf', '5/8/2026'],
        ['RESUME_ARPIT.pdf', '12/5/2025'],
      ]
        .map(
          ([name, date], i) =>
            `<div><input type="radio" name="radio-group-_r_1v_" id="r${i}" aria-label="${name}"${
              i === checkedIndex ? ' checked' : ''
            } /><span>PDF ${name} ${date}</span></div>`,
        )
        .join('')}
      <button type="button">Back</button><button type="button">Next</button>
    </dialog>`;

  it('picks the most recently uploaded resume when the person has not chosen one', async () => {
    document.body.innerHTML = resumeStep();
    const api = await load();
    expect(api.ensureResumeSelected()).toBe('selected');
    const picked = document.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    expect(picked?.getAttribute('aria-label')).toBe('Arpit_Singh_CV.pdf');
  });

  it('leaves a resume the person already chose alone, even an older one', async () => {
    document.body.innerHTML = resumeStep(2);
    const api = await load();
    expect(api.ensureResumeSelected()).toBe('already');
    expect(document.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.getAttribute('aria-label')).toBe('RESUME_ARPIT.pdf');
  });

  it('finds "Mark this job as a top choice" now that it is a switch rather than a checkbox', async () => {
    document.body.innerHTML = `
      <dialog data-testid="dialog" aria-labelledby="dialog-header" open>
        <h2 id="dialog-header">Apply to Lxme</h2>
        <div role="progressbar" aria-valuenow="75" aria-valuemax="100"></div>
        <div role="switch" aria-checked="false" aria-label="Mark this job as a top choice"></div>
        <label for="_r_x_">Why do you want this role?*</label><textarea id="_r_x_" required></textarea>
        <button type="button">Review</button>
      </dialog>`;
    const api = await load();
    expect(api.scan({ linkedin: true }).topChoice).toEqual({ checked: false });
    // The switch is flipped by LinkedIn's own code, which does not run here, so the press itself is what is checked.
    const sw = document.querySelector<HTMLElement>('[role="switch"]')!;
    let pressed = 0;
    sw.addEventListener('click', () => (pressed += 1));
    expect(api.markTopChoice()).toBe('checked');
    expect(pressed).toBe(1);
    sw.setAttribute('aria-checked', 'true');
    expect(api.markTopChoice()).toBe('already');
  });

  it('treats a step with nothing to fill as one to move on from, not an empty form', async () => {
    document.body.innerHTML = `
      <dialog data-testid="dialog" aria-labelledby="dialog-header" open>
        <h2 id="dialog-header">Apply to Lxme</h2>
        <div role="progressbar" aria-valuenow="75" aria-valuemax="100"></div>
        <span>3/4 pages</span><p>Mark this job as a top choice (Optional)</p>
        <button type="button">Back</button><button type="button">Review</button>
      </dialog>`;
    const api = await load();
    const snap = api.scan({ linkedin: true });
    expect(snap.form).toEqual([]);
    expect(snap.hasNext).toBe(true);
    expect(snap.empty).toBe(true);
  });
});
