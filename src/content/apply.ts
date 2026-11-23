/**
 * Runs inside a job application page (LinkedIn or any company or applicant-tracking site), only when the person
 * presses "Fill this application". It reads the form into a compact model, types the answers the background hands
 * it, marks every field it touched, can put everything back, and can press the page's own Next / Continue button.
 * It never presses Submit, Apply or Send, and never touches password or CAPTCHA fields.
 *
 * Injected with chrome.scripting into every frame of the tab; each injection reuses the same instance, so the state
 * needed for Undo survives between calls.
 */
import { buttonRole, sensitivity } from '../shared/fields';
import type { FieldKind, FormField, PageSnapshot } from '../shared/apply';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;
interface Entry {
  kind: FieldKind;
  /** The element(s) behind the field: one control, or every radio / checkbox of a group. */
  els: Control[];
  options?: string[];
}
interface Previous {
  id: string;
  values: { el: Control; value: string; checked?: boolean; files?: FileList | null }[];
}
export interface FillResult {
  id: string;
  ok: boolean;
  note?: string;
}
export interface ApplyApi {
  version: number;
  /** linkedin: read only LinkedIn's Easy Apply window, never the rest of the page (search box, messaging, filters). */
  scan(opts?: { linkedin?: boolean }): Omit<PageSnapshot, 'url' | 'title' | 'actions' | 'controls'> & {
    url: string;
    title: string;
    frames: string[];
    empty: boolean;
    easyApplyOpen?: boolean;
    topChoice?: { checked: boolean; remaining?: number };
    jobMatch?: 'low' | 'medium' | 'high';
    /** Buttons that add one more entry to a list on the form ("Add a role", "Add education"). */
    actions?: { id: string; label: string; section: string; count?: number }[];
    /** Every other button and link that matters on the page, for ChatGPT to choose how to move on. */
    controls?: { id: string; label: string; kind: 'button' | 'submit' | 'link'; final: boolean }[];
  };
  /** Presses one of the "add an entry" buttons the last scan listed, and nothing else. True when it did. */
  press(id: string): boolean;
  /**
   * Presses one of the page's buttons or links the last scan listed (to open a form, move on, close a pop-up).
   * Never one that sends the application, unless final is true (hands-free mode, after every check has passed).
   */
  click(id: string, final?: boolean): { clicked?: string; error?: string };
  /** Hands-free mode only: presses the button that sends the application on the open form. */
  submitFinal(): { clicked?: string; error?: string };
  fill(
    items: { id: string; kind: FieldKind; value: string | string[] }[],
    files: { id: string; name: string; type: string; data: string }[],
  ): Promise<FillResult[]>;
  mark(ids: { id: string; tone: 'done' | 'check' | 'you' }[]): void;
  undo(): number;
  clear(): void;
  next(): { clicked?: string; error?: string };
  /** click=false only reports what it would do, so the background can click in exactly one frame. */
  openEasyApply(click?: boolean): 'opened' | 'external' | 'open' | 'applied' | 'none';
  /** Ticks LinkedIn's "Mark job as a top choice" (only when the person asks; it uses a monthly allowance). */
  markTopChoice(): 'checked' | 'already' | 'none';
  /** Passes LinkedIn's "Job search safety reminder" by pressing its Continue applying. True when it did. */
  passInterstitial(): boolean;
  /** True once the page says the application went through (LinkedIn's "Application sent", a site's thank-you page). */
  submitted(): boolean;
  /** The job's title and company as the page states them, for the referral step after applying. */
  jobMeta(): { title: string; company: string; location: string; companyUrl: string };
  /** On a LinkedIn job list: opens the next Easy Apply job not yet applied to. Returns its job id, or '' when none. */
  openNextJob(): string;
  /** On a LinkedIn job applied for on the company's site: the "Apply on company website" link (its address), pressed when click. */
  externalApply(click?: boolean): string;
  /**
   * On a company's job page: 'form' when an application form is already showing; otherwise presses the control that
   * opens it ("Apply", "Apply for this job", "Apply manually") and says 'opened'. Never a button that sends a form.
   */
  openApplication(click?: boolean): 'form' | 'opened' | 'none';
  /** Declines optional cookies on a site's cookie banner, so it does not cover the form. True when it pressed one. */
  dismissCookies(): boolean;
  /** True when the page asks to sign in or create an account (a password field on a short form). */
  signIn(): boolean;
  /**
   * Attaches the CV where the form has no ordinary upload field: a field the site creates when "Attach" is pressed,
   * or a drag-and-drop area. 'none' when the page asks for no CV this way.
   */
  attachFallback(file: {
    name: string;
    type: string;
    data: string;
  }): Promise<{ ok: boolean; note?: string; how: 'input' | 'drop' | 'none' }>;
}
const VERSION = 13;
const scope = globalThis as typeof globalThis & { __referralScoutApply?: ApplyApi };

/* ---------- reading the page ---------- */
const esc = (s: string): string => (typeof globalThis.CSS?.escape === 'function' ? CSS.escape(s) : s.replace(/["\\\]]/g, '\\$&'));
const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const visible = (el: Element): boolean => {
  const h = el as HTMLElement;
  if (h.hidden || h.closest('[hidden],[aria-hidden="true"]')) return false;
  const style = getComputedStyle(h);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return h.getClientRects().length > 0;
};
const textOfIds = (ids: string | null, doc: Document): string =>
  clean(
    (ids ?? '')
      .split(/\s+/)
      .map(id => (id ? doc.getElementById(id)?.textContent : ''))
      .join(' '),
  );
/** The question a control asks, in the words the person sees. */
function labelOf(el: Element): string {
  const doc = el.ownerDocument;
  const by = textOfIds(el.getAttribute('aria-labelledby'), doc);
  if (by) return by;
  const id = el.getAttribute('id');
  if (id) {
    const l = doc.querySelector(`label[for="${esc(id)}"]`);
    if (l && clean(l.textContent)) return clean(l.textContent);
  }
  const wrap = el.closest('label');
  if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  // Many sites put the question in a nearby element rather than a <label>: look upward for the nearest text.
  let node: Element | null = el;
  for (let depth = 0; node && depth < 4; depth++) {
    node = node.parentElement;
    if (!node) break;
    const label = node.querySelector('label, legend, [class*="label" i], [class*="question" i]');
    if (label && !label.contains(el) && clean(label.textContent)) return clean(label.textContent).slice(0, 300);
  }
  return clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title')) || clean(el.getAttribute('name'));
}
/** The text that introduces an element: the nearest earlier sibling (of it or an ancestor) that has text and no fields. */
function precedingText(el: Element, levels = 4): string {
  let box: Element | null = el;
  for (let depth = 0; box && depth < levels; depth++, box = box.parentElement) {
    for (let sib = box.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.matches('script, style, template') || sib.querySelector('input, select, textarea')) break;
      const t = clean(sib.textContent);
      if (t) return t.length <= 300 ? t : '';
    }
  }
  return '';
}
function commonAncestor(els: Element[]): Element {
  let box: Element | null = els[0]!.parentElement;
  while (box && !els.every(e => box!.contains(e))) box = box.parentElement;
  return box ?? els[0]!.ownerDocument.body;
}
function groupLabel(el: Element, group: Element[] = [el]): string {
  const doc = el.ownerDocument;
  const set = el.closest('fieldset, [role="radiogroup"], [role="group"]');
  if (set) {
    const legend = set.querySelector('legend');
    const t = clean(legend?.textContent) || textOfIds(set.getAttribute('aria-labelledby'), doc) || clean(set.getAttribute('aria-label'));
    if (t) return t;
  }
  // No fieldset: the question is the text just before the box that holds all the options (never an option's own label).
  const box = group.length > 1 ? commonAncestor(group) : (el.closest('label') ?? el);
  return precedingText(box) || clean(el.getAttribute('name'));
}
/**
 * Length limits shown next to a field rather than set on it: a "0/400" counter and a "Minimum 20 characters" note
 * (LinkedIn's top-choice message, most ATS text boxes).
 */
function limitsNear(el: Element): { max?: number; min?: number; note: string } {
  let box: Element | null = el.parentElement;
  for (let depth = 0; box && depth < 4; depth++, box = box.parentElement) {
    if (box.querySelectorAll('input, select, textarea, [contenteditable="true"]').length > 1) break;
    // Text pieces joined with spaces: "Minimum 20 characters" and "0/400" are often separate elements.
    const parts: string[] = [];
    const walk = box.ownerDocument.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) parts.push(n.nodeValue ?? '');
    const t = clean(parts.join(' '));
    const counter = t.match(/\b\d{1,5}\s*\/\s*(\d{2,5})\b(?!\s*pages?)/);
    const minimum = t.match(/\b(?:minimum|min\.?|at least)\s*(\d{1,5})\s*characters?\b/i);
    const maximum = t.match(/\b(?:maximum|max\.?|up to)\s*(\d{1,5})\s*characters?\b/i);
    if (counter || minimum || maximum)
      return {
        ...(counter ? { max: Number(counter[1]) } : maximum ? { max: Number(maximum[1]) } : {}),
        ...(minimum ? { min: Number(minimum[1]) } : {}),
        note: [minimum?.[0], maximum?.[0]].filter(Boolean).join('; '),
      };
  }
  return { note: '' };
}
/**
 * The words of one choice ("Yes", "No", "3-5 years"). Not labelOf: LinkedIn gives every radio of a group the QUESTION
 * as its aria-label, leaves its <label> empty and writes the choice in a sibling element, so the choice is read from
 * the text around this one input first, and the aria-label is only the last resort.
 */
const optionLabel = (input: HTMLInputElement): string => {
  const doc = input.ownerDocument;
  const byFor = input.id ? clean(doc.querySelector(`label[for="${esc(input.id)}"]`)?.textContent) : '';
  if (byFor) return byFor;
  const wrap = clean(input.closest('label')?.textContent);
  if (wrap) return wrap;
  const by = textOfIds(input.getAttribute('aria-labelledby'), doc);
  if (by) return by;
  // The largest box around this input that holds no other choice: its text is this choice's words.
  let best = '';
  for (let box = input.parentElement, depth = 0; box && depth < 6; box = box.parentElement, depth++) {
    if (box.matches('fieldset, [role="radiogroup"], [role="group"], form')) break;
    if (box.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 1) break;
    const t = clean(box.textContent);
    if (t) best = t;
  }
  if (best && best.length <= 200) return best;
  return clean(input.getAttribute('aria-label')) || clean(input.value);
};
const isRequired = (el: Element, label: string): boolean =>
  (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || /\*\s*$|\(required\)|\brequired\b/i.test(label);
function sectionOf(el: Element): string {
  // One entry of a repeated list ("Role 1", "Education 2"): named, so the answers for each entry go to the right fields.
  const entry = el.closest('li, [role="listitem"], [role="group"], fieldset');
  const entryName =
    clean(entry?.getAttribute('aria-label')) ||
    clean(entry?.querySelector(':scope > legend')?.textContent) ||
    clean(
      [...(entry?.querySelectorAll('span, h3, h4, p') ?? [])].find(e => /^[a-z][\w ]{1,30}\s\d{1,2}$/i.test(clean(e.textContent)))
        ?.textContent,
    );
  // The nearest heading above it: the closest ancestor (up to eight levels) holding a legend or an h2/h3.
  let heading = '';
  for (let n = el.parentElement, depth = 0; n && depth < 8 && !n.matches('body'); n = n.parentElement, depth++) {
    const h = n.querySelector(':scope > legend') ?? n.querySelector('legend, h2, h3');
    if (h && clean(h.textContent)) {
      heading = clean(h.textContent).slice(0, 120);
      break;
    }
  }
  return [heading, entryName && entryName !== heading ? entryName : ''].filter(Boolean).join(' › ').slice(0, 160);
}
/** Where the application lives: LinkedIn's Easy Apply window, any open dialog with fields, the largest form, or the page. */
// LinkedIn's messaging pop-up. Not any "message" field: LinkedIn's top-choice box is labelled "Include a message...".
const MESSAGING =
  '.msg-overlay-conversation-bubble, .msg-overlay-list-bubble, [class*="msg-overlay" i], [role="dialog"][aria-label^="Messaging" i]';
/** LinkedIn's Easy Apply window, when it is open: a dialog about applying, never the messaging pop-up. */
function easyApplyDialog(doc: Document): Element | null {
  const known = [
    ...doc.querySelectorAll('.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"], [class*="easy-apply" i][role="dialog"]'),
  ].find(visible);
  if (known) return known;
  return (
    [...doc.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')]
      .filter(d => visible(d) && !d.matches(MESSAGING) && !d.closest(MESSAGING))
      .find(d =>
        /\b(apply to|easy apply|submit application|contact info|additional questions|work authori[sz]ation|resume|review your application)\b/i.test(
          clean(d.textContent).slice(0, 4000),
        ),
      ) ?? null
  );
}
function topChoiceBox(root: ParentNode): HTMLInputElement | undefined {
  return [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(c =>
    /top choice/i.test(c.getAttribute('aria-label') ?? labelOf(c)),
  );
}
/**
 * "Add another entry" buttons of a list on the form: a role, a school, a project, a certification, a language, a link.
 * Only these are ever pressed by the extension besides Next; never a button that saves, submits or removes.
 */
const ADD_ENTRY =
  /^(\+\s*)?(add|add another|add (a|an|one) more|add new|new)\s+(a\s+|an\s+|another\s+|new\s+)?(role|experience|work experience|position|job|employment|employer|education|qualification|school|college|degree|course|project|certification|certificate|licen[cs]e|language|skill|award|achievement|honou?r|publication|link|website|social (profile|link)|reference|referee|volunteer(ing)?( experience)?|internship|entry|item|row)s?$|^(\+\s*)?add (more|another)$/i;
function addButtons(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, [role="button"], a[href="#"], a:not([href])')].filter(b => {
    if (!visible(b) || (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true') return false;
    if ((b as HTMLButtonElement).type === 'submit' || b.closest('header, nav, footer')) return false;
    const label = clean(b.getAttribute('aria-label')) || clean(b.textContent);
    return ADD_ENTRY.test(label);
  });
}
/** Labels that move an application on: kept first when a page has many buttons. */
const MOVES_ON = /\b(apply|application|continue|next|proceed|start|submit|review|get started|i[’']?m in|i[’']?m interested)\b/i;
/** A job board's search bar ("What", "Where", Find jobs): never the application, wherever the site puts it. */
function searchForm(f: Element): boolean {
  if (f.matches('[role="search"]') || f.querySelector('input[type="search"]')) return true;
  const fields = [...f.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter(visible);
  if (fields.length > 4) return false;
  const named = fields.some(e =>
    /^(q|what|where|keywords?|search|location|l|query)$|search|keyword/i.test(`${e.getAttribute('name') ?? ''} ${e.id}`),
  );
  const go = [...f.querySelectorAll('button, input[type="submit"]')].some(b =>
    /^(search|find( jobs?)?|go)$/i.test(clean(b.textContent || (b as HTMLInputElement).value)),
  );
  return named || go;
}
function formRoot(doc: Document): Element {
  const has = (e: Element) => [...e.querySelectorAll('input, select, textarea, [contenteditable="true"]')].some(visible);
  const easy = easyApplyDialog(doc);
  if (easy && has(easy)) return easy;
  const dialogs = [...doc.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')].filter(
    d => visible(d) && has(d) && !d.matches(MESSAGING) && !d.closest(MESSAGING),
  );
  if (dialogs.length) return dialogs.at(-1)!;
  // A form may hold no fields yet, only "Add a role" (an empty list): it is still the application. A footer form (a
  // newsletter sign-up) never is.
  const forms = [...doc.querySelectorAll('form')].filter(
    f => (has(f) || addButtons(f).length > 0) && !searchForm(f) && !f.closest('header, nav, footer, [role="search"], [role="contentinfo"]'),
  );
  if (forms.length) {
    const count = (f: Element) => [...f.querySelectorAll('input, select, textarea')].filter(visible).length;
    return forms.sort((a, b) => count(b) - count(a))[0]!;
  }
  return doc.body;
}
function jobText(doc: Document, form: Element): string {
  const parts: string[] = [];
  // An application opened in a window over a list of jobs (Internshala, Naukri, LinkedIn search): the window itself
  // names the job; the page behind it is a list of other jobs.
  if (form !== doc.body && form.tagName !== 'FORM') {
    const copy = form.cloneNode(true) as Element;
    copy.querySelectorAll('script, style, noscript, svg, form, input, select, textarea, button').forEach(e => e.remove());
    const t = clean(copy.textContent);
    if (t.length > 80) parts.push(`APPLICATION WINDOW: ${t.slice(0, 6000)}`);
  }
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? '') as unknown;
      const list = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
      for (const d of list.flatMap(x => (Array.isArray(x?.['@graph']) ? (x['@graph'] as Record<string, unknown>[]) : [x])))
        if (d && d['@type'] === 'JobPosting') {
          const org = d['hiringOrganization'] as { name?: string } | undefined;
          const div = doc.createElement('div');
          div.innerHTML = String(d['description'] ?? '');
          parts.push(`TITLE: ${String(d['title'] ?? '')}`, `COMPANY: ${org?.name ?? ''}`, `DESCRIPTION: ${clean(div.textContent)}`);
        }
    } catch {
      /* not JSON */
    }
  }
  if (!parts.some(p => p.startsWith('DESCRIPTION'))) {
    const linkedin = doc.querySelector(
      '[componentkey^="JobDetails_AboutTheJob_"], .jobs-description__content, .jobs-box__html-content, #job-details, .jobs-description',
    );
    const title = clean(
      doc.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1')?.textContent,
    );
    const company = clean(
      doc.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name')?.textContent,
    );
    if (title) parts.push(`TITLE: ${title}`);
    if (company) parts.push(`COMPANY: ${company}`);
    if (linkedin) parts.push(`DESCRIPTION: ${clean(linkedin.textContent)}`);
    else {
      // A company or ATS page: the page text outside the form is the job description.
      const main = doc.querySelector('main, [role="main"], #content, .content, article') ?? doc.body;
      const copy = main.cloneNode(true) as Element;
      // The site's own header and navigation go; a page header inside the main area (the step's title and
      // instructions, such as "Your qualifications: degrees, diplomas and schooling") stays.
      copy.querySelectorAll('script, style, noscript, svg, nav, footer, form, [role="dialog"]').forEach(e => e.remove());
      if (main === doc.body) copy.querySelectorAll('header').forEach(e => e.remove());
      if (main.contains(form) && form !== main) {
        /* the form itself was removed above */
      }
      parts.push(`PAGE TEXT: ${clean(copy.textContent).slice(0, parts.length ? 3000 : 9000)}`);
    }
  }
  return parts.join('\n').slice(0, 12000);
}
const KEEP = new Set([
  'id',
  'name',
  'type',
  'for',
  'role',
  'aria-label',
  'aria-required',
  'required',
  'placeholder',
  'data-rs-id',
  'value',
  'maxlength',
  'accept',
  'multiple',
]);
function cleanedHtml(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  copy.querySelectorAll('script, style, noscript, svg, img, iframe, video, canvas, link, meta, template').forEach(e => e.remove());
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) if (!KEEP.has(a.name)) el.removeAttribute(a.name);
    if (el.getAttribute('type') === 'hidden') el.remove();
  }
  return copy.innerHTML.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim().slice(0, 16000);
}
const buttonText = (b: Element): string =>
  clean(b.getAttribute('aria-label')) || clean(b.textContent) || clean((b as HTMLInputElement).value);
/** A review or confirmation page: headings that say so, or text warning that the next press sends the application. */
function looksFinal(root: Element): boolean {
  const scope = root.ownerDocument.body;
  const headings = [...scope.querySelectorAll('h1, h2, h3, [role="heading"]')].filter(visible).map(h => clean(h.textContent));
  if (
    headings.some(h =>
      /^(review|summary|confirm|preview|verify)\b|\b(review (your|and submit|application)|application (summary|review)|confirm (your )?(details|application|submission))\b/i.test(
        h,
      ),
    )
  )
    return true;
  return /\b(by (clicking|pressing|selecting|choosing) (continue|next|submit|apply)|you('re| are) about to submit|(cannot|can't|won't be able to) (be )?(change|edit)(ed)? (it |your application )?after (you )?submit|once submitted)/i.test(
    clean(root.textContent).slice(0, 6000),
  );
}
function buttons(root: Element): { el: HTMLElement; label: string; role: 'next' | 'submit' | null }[] {
  return [...root.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')]
    .filter(visible)
    .map(el => ({ el: el as HTMLElement, label: buttonText(el), role: buttonRole(buttonText(el)) }))
    .filter(b => b.role !== null);
}
function stepOf(doc: Document, root: Element): string {
  const bar = root.querySelector('[role="progressbar"]');
  const now = bar?.getAttribute('aria-valuenow');
  const text = clean(root.textContent);
  const match =
    text.match(/\bstep \d+ (of|\/) \d+\b/i) ?? text.match(/\b\d+ of \d+\b(?= steps?)/i) ?? text.match(/\b\d+\s*\/\s*\d+ pages?/i);
  const heading = clean(root.querySelector('h3, h2')?.textContent).slice(0, 80);
  return (
    [match?.[0], now ? `${Math.round(Number(now))}% complete` : '', heading].filter(Boolean).join(' · ') || clean(doc.title).slice(0, 80)
  );
}

/**
 * Honeypots: fields a person cannot see or reach, which sites add to catch bots (an application with one filled is
 * quietly discarded). Choices and uploads are exempt: their real inputs are routinely hidden behind styled labels.
 */
function trap(el: Element, type: string): boolean {
  if (type === 'radio' || type === 'checkbox' || type === 'file') return false;
  const h = el as HTMLElement;
  const id = `${el.getAttribute('name') ?? ''} ${el.id}`.toLowerCase();
  if (/honeypot|gotcha|bot.?trap|hp.?field|leave.?(this.?)?(blank|empty)/.test(id)) return true;
  const unreachable = h.tabIndex < 0 || /^(off|nope|false)$/i.test(el.getAttribute('autocomplete') ?? '');
  if (unreachable && /(^|[\s_-])(website|url|fax|homepage|address2_confirm)([\s_-]|$)/.test(id)) return true;
  const r = h.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  if (r.width || r.height) {
    if (r.width <= 1 && r.height <= 1) return true;
    // Pushed far off the page (left: -9999px and the like).
    if (r.right + (view?.scrollX ?? 0) < 0 || r.bottom + (view?.scrollY ?? 0) < 0) return true;
  }
  for (let n: Element | null = el, i = 0; n && i < 5; n = n.parentElement, i++)
    if (view && view.getComputedStyle(n).opacity !== '' && Number(view.getComputedStyle(n).opacity) === 0) return true;
  return false;
}

/* ---------- typing into the page the way a person would ---------- */
function setNative(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}
function fire(el: Element, ...types: string[]): void {
  for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true }));
}
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/**
 * Whether a site kept an uploaded file: no error next to the field, and either the file is still on the field or its
 * name shows nearby (many sites move the file into their own list and clear the field).
 */
async function uploadOutcome(input: HTMLInputElement, name: string): Promise<{ ok: boolean; note?: string }> {
  await sleep(1500);
  let box: Element = input;
  for (let i = 0; i < 4 && box.parentElement && !box.parentElement.matches('form, body'); i++) box = box.parentElement;
  const near = clean(box.textContent);
  if (
    /\b(too large|exceeds|not supported|unsupported|invalid file|wrong (file )?(type|format)|upload failed|could not upload|error uploading)\b/i.test(
      near,
    )
  )
    return { ok: false, note: 'The site refused the file; attach your CV on the page.' };
  const base = name
    .replace(/\.[a-z0-9]+$/i, '')
    .slice(0, 20)
    .toLowerCase();
  if ((input.files?.length ?? 0) > 0 || near.toLowerCase().includes(base)) return { ok: true };
  return { ok: true, note: 'Attached; check the site shows your CV.' };
}
function bestMatch<T>(value: string, items: T[], text: (t: T) => string): T | undefined {
  const v = norm(value);
  return (
    items.find(i => norm(text(i)) === v) ??
    items.find(i => norm(text(i)).startsWith(v) || v.startsWith(norm(text(i)))) ??
    items.find(i => norm(text(i)).includes(v))
  );
}
/** A date written the way the field wants it: YYYY-MM-DD for date inputs, otherwise following the placeholder. */
function dateFor(el: HTMLInputElement, iso: string): string {
  // A month box (type="month") takes YYYY-MM; ChatGPT may give a full date or just the month.
  if (el.type === 'month') return /^(\d{4})-(\d{2})/.exec(iso)?.slice(1, 3).join('-') ?? iso;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || el.type === 'date') return iso;
  const [, y, mo, d] = m;
  const p = (el.placeholder || '').toLowerCase();
  if (/^dd/.test(p)) return `${d}/${mo}/${y}`;
  if (/^mm/.test(p)) return `${mo}/${d}/${y}`;
  return iso;
}
/** Options of an open dropdown: ARIA options, or the class names custom dropdowns (react-select and others) use. */
const OPTION = '[role="option"], [id*="-option-"], [class*="__option"]';
async function pickFromList(input: HTMLElement, value: string): Promise<boolean> {
  const doc = input.ownerDocument;
  for (let i = 0; i < 12; i++) {
    await sleep(150);
    const listId = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
    const list = listId ? doc.getElementById(listId) : null;
    const opts = [...(list ?? doc).querySelectorAll(OPTION)].filter(
      o => visible(o) && !o.querySelector(OPTION) && clean(o.textContent).length > 0,
    ) as HTMLElement[];
    if (!opts.length) continue;
    const hit = bestMatch(value, opts, o => clean(o.textContent));
    if (hit) {
      hit.scrollIntoView?.({ block: 'nearest' });
      for (const type of ['pointerover', 'mouseover', 'pointerdown', 'mousedown'])
        hit.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
      hit.click();
      return true;
    }
    if (i > 6) return false;
  }
  return false;
}
const digits = (v: string): string => v.replace(/\D+/g, '');
/** A pause that varies like a person moving between fields (sites score an instant, evenly spaced fill as a bot). */
const human = (min: number, max: number) => sleep(min + Math.floor(Math.random() * (max - min)));
/** Reads a field back after the site's own scripts had a moment to react (React and masks may revert or reformat). */
async function settled(el: HTMLInputElement | HTMLTextAreaElement, wanted: string): Promise<{ ok: boolean; note?: string }> {
  await sleep(300);
  const now = el.value.trim();
  if (!now) return { ok: false, note: 'The site cleared this field; type it on the page.' };
  const w = wanted.trim();
  if (now === w || now.toLowerCase() === w.toLowerCase()) return { ok: true };
  // A mask reformats ("9876543210" becomes "98765 43210"): the same digits are the same answer.
  if (digits(w).length >= 3 && digits(now) === digits(w)) return { ok: true };
  return { ok: true, note: `The site changed this to “${now.slice(0, 60)}”; check it.` };
}
/** A number field takes digits only: "2+ years" becomes 2, "3.5 yrs" becomes 3.5. */
function numberFrom(v: string): string {
  return /-?\d+(?:\.\d+)?/.exec(v.replace(/,/g, ''))?.[0] ?? '';
}
/** Types into a field key by key, for segmented date boxes and spin buttons that ignore a pasted value. */
async function typeKeys(el: HTMLInputElement, text: string): Promise<void> {
  el.focus();
  setNative(el, '');
  fire(el, 'input');
  for (const ch of text) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
    setNative(el, el.value + ch);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    await sleep(40);
  }
  fire(el, 'change', 'blur');
}
/**
 * A phone box with its own country-code picker next to it: the code goes in the picker (when it offers it) and only
 * the national number in the box, so the code is never typed twice. Returns the value to type.
 */
function phoneFor(input: HTMLElement, value: string): string {
  const m = /^\s*(?:\+|00)(\d{1,3})[\s\-().]*(.*)$/.exec(value);
  if (!m) return value;
  const [, code, rest] = m;
  const national = rest!.replace(/[^\d]/g, '');
  let box: Element | null = input.parentElement;
  for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
    const picker = [...box.querySelectorAll('select')].find(
      sel => sel !== input && [...sel.options].some(o => new RegExp(`\\+\\s?${code}\\b`).test(o.textContent ?? '')),
    );
    if (picker) {
      const opt = [...picker.options].find(o => new RegExp(`\\+\\s?${code}\\b`).test(o.textContent ?? ''))!;
      setNative(picker, opt.value);
      fire(picker, 'input', 'change');
      return national;
    }
    // A flag picker (intl-tel-input and similar) already showing this code next to the box.
    const shown = [...box.querySelectorAll('div, span, button')].find(
      e => !e.contains(input) && new RegExp(`^\\+\\s?${code}$`).test(clean(e.textContent)),
    );
    if (shown) return national;
  }
  return value;
}
async function fillOne(entry: Entry, value: string | string[]): Promise<{ ok: boolean; note?: string }> {
  const first = entry.els[0]!;
  const one = Array.isArray(value) ? (value[0] ?? '') : value;
  first.scrollIntoView?.({ block: 'center' });
  switch (entry.kind) {
    case 'select': {
      const sel = first as HTMLSelectElement;
      const opt = bestMatch(one, [...sel.options], o => clean(o.textContent));
      if (!opt) return { ok: false, note: 'That option is not in the list.' };
      sel.focus();
      setNative(sel, opt.value);
      fire(sel, 'input', 'change', 'blur');
      await sleep(200);
      return sel.value === opt.value ? { ok: true } : { ok: false, note: 'The site did not keep this choice; pick it on the page.' };
    }
    case 'radio': {
      const radios = entry.els as HTMLInputElement[];
      const hit = bestMatch(one, radios, r => optionLabel(r));
      if (!hit) return { ok: false, note: 'That option is not on the page.' };
      if (!hit.checked) hit.click();
      if (!hit.checked) {
        hit.checked = true;
        fire(hit, 'input', 'change');
      }
      return { ok: true };
    }
    case 'checkbox': {
      const box = first as HTMLInputElement;
      const want = one === 'true';
      if (box.checked !== want) box.click();
      return { ok: box.checked === want };
    }
    case 'checkboxes': {
      const want = new Set((Array.isArray(value) ? value : [value]).map(norm));
      const boxes = entry.els as HTMLInputElement[];
      for (const box of boxes) {
        const on = want.has(norm(optionLabel(box)));
        if (box.checked !== on) box.click();
      }
      return boxes.every(b => b.checked === want.has(norm(optionLabel(b))))
        ? { ok: true }
        : { ok: false, note: 'Some choices did not stick; check them on the page.' };
    }
    case 'combobox': {
      const input = first as HTMLInputElement;
      // Custom dropdowns (react-select on Greenhouse, Lever's and Workday's own) open on a press of their outer box,
      // not on the input: press that, then type, and try a shorter search if the full answer lists nothing.
      const control =
        (input.closest('[class*="control"], [class*="Control"], [data-automation-id*="select"]') as HTMLElement | null) ??
        input.parentElement ??
        input;
      const open = () => {
        for (const type of ['pointerdown', 'mousedown'])
          control.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        input.focus();
        input.click();
      };
      const type = (text: string) => {
        if (!('value' in input)) return;
        setNative(input, text);
        fire(input, 'input');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
      };
      const shown = () => {
        const box = input.closest('[class*="container"], [class*="Container"]') ?? control;
        const text = clean(box.textContent).toLowerCase();
        return !!one && text.includes(one.toLowerCase().slice(0, 30));
      };
      open();
      type(one);
      let picked = await pickFromList(input, one);
      const word = one.split(/[\s,(/-]+/).find(w => w.length > 1);
      if (!picked && word && word !== one) {
        open();
        type(word);
        picked = await pickFromList(input, one);
      }
      if (!picked && 'value' in input) {
        // Some lists highlight the first match and choose it on Enter.
        open();
        type(one);
        await sleep(300);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        await sleep(200);
        picked = shown() && !input.value.trim();
      }
      if (picked) {
        await sleep(200);
        // The choice shows in the box (react-select clears its input and shows the value beside it).
        return shown() || (input as HTMLInputElement).value?.trim()
          ? { ok: true }
          : { ok: true, note: 'Chosen; check it shows on the page.' };
      }
      // A box with a plain suggestion list (a datalist) accepts typed text; a real dropdown needs a chosen option.
      if (input instanceof HTMLInputElement && input.list && input.value.trim()) return { ok: true };
      return { ok: false, note: 'Typed, but no option from its list was chosen; choose one on the page.' };
    }
    case 'richtext': {
      first.focus();
      const doc = first.ownerDocument;
      doc.getSelection()?.selectAllChildren(first);
      if (!doc.execCommand('insertText', false, one)) first.textContent = one;
      fire(first, 'input', 'change', 'blur');
      await sleep(300);
      return clean(first.textContent).includes(clean(one).slice(0, 40))
        ? { ok: true }
        : { ok: false, note: 'The editor did not keep the text; paste it on the page.' };
    }
    default: {
      const input = first as HTMLInputElement | HTMLTextAreaElement;
      let text = one;
      if (input instanceof HTMLInputElement) {
        if (entry.kind === 'number' || input.type === 'number' || input.getAttribute('role') === 'spinbutton') {
          text = numberFrom(one);
          if (!text) return { ok: false, note: 'This field takes a number; type it on the page.' };
        } else if (entry.kind === 'date') text = dateFor(input, one);
        else if (entry.kind === 'tel' || /\b(phone|mobile)\b/i.test(labelOf(input))) text = phoneFor(input, one);
        // Segmented date parts (Workday's MM / YYYY boxes) and spin buttons listen to keys, not a pasted value.
        if (input.getAttribute('role') === 'spinbutton') {
          await typeKeys(input, text);
          return settled(input, text);
        }
      }
      // A tag box ("Type one and press Enter", or a box with its own Add button): one item at a time, each confirmed.
      // Only a button right beside this box counts (not one elsewhere in the same entry), and only on a text box.
      const addBtn = [...(input.parentElement?.children ?? [])].find(
        (b): b is HTMLButtonElement => b instanceof HTMLButtonElement && /^add$/i.test(clean(b.textContent)),
      );
      if (
        input instanceof HTMLInputElement &&
        (input.type === 'text' || input.type === '') &&
        (addBtn || /press enter|then enter|hit enter/i.test(input.placeholder))
      ) {
        const items = text
          .split(/\s*[,;|\n]\s*/)
          .map(t => t.trim())
          .filter(Boolean)
          .slice(0, 15);
        for (const item of items) {
          input.focus();
          setNative(input, item);
          fire(input, 'input');
          for (const type of ['keydown', 'keypress', 'keyup'])
            input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
          if (addBtn && input.value.trim()) addBtn.click();
          await sleep(150);
        }
        const box = clean(input.closest('div')?.parentElement?.textContent).toLowerCase();
        const kept = items.filter(i => box.includes(i.toLowerCase())).length;
        return kept === items.length
          ? { ok: true }
          : {
              ok: kept > 0,
              note: kept
                ? `${kept} of ${items.length} added; add the rest on the page.`
                : 'The site did not take these; add them on the page.',
            };
      }
      // A date picker's box is often read-only so only its calendar can set it: set it directly, then restore.
      const locked = input.readOnly;
      if (locked) input.readOnly = false;
      input.focus();
      setNative(input, text);
      fire(input, 'input', 'change');
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      input.blur();
      fire(input, 'blur', 'focusout');
      if (locked) input.readOnly = true;
      return settled(input, text);
    }
  }
}
function fromBase64(data: string, name: string, type: string): File {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type, lastModified: Date.now() });
}

/* ---------- the instance ---------- */
function create(): ApplyApi {
  const token = Math.random().toString(36).slice(2, 7);
  let counter = 0;
  const entries = new Map<string, Entry>();
  const undo: Previous[] = [];
  /** The "add an entry" buttons the last scan found: the only buttons press() will ever touch. */
  const addable = new Set<string>();
  /** The page's other buttons and links from the last scan: the only ones click() will touch. */
  const clickable = new Set<string>();
  const marked = new Set<HTMLElement>();
  // The form area the last scan read; Next is only ever looked for inside it.
  let lastRoot: Element | null = null;
  const idFor = (el: Element): string => {
    const old = el.getAttribute('data-rs-id');
    if (old) return old;
    const id = `rs${token}${++counter}`;
    el.setAttribute('data-rs-id', id);
    return id;
  };
  const snapshot = (el: Control): Previous['values'][number] =>
    el instanceof HTMLInputElement
      ? { el, value: el.value, checked: el.checked, ...(el.type === 'file' ? { files: el.files } : {}) }
      : el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        ? { el, value: el.value }
        : { el, value: el.textContent ?? '' };
  const MARK = { done: '#16a34a', check: '#d97706', you: '#2563eb' } as const;
  // Colour is not the only signal: each tone also has its own line style and a hover note.
  const LINE = { done: 'solid', check: 'dashed', you: 'dotted' } as const;
  const NOTE = {
    done: 'Filled by Referral Scout',
    check: 'Filled by Referral Scout: please check this one',
    you: 'Referral Scout left this for you',
  } as const;
  return {
    version: VERSION,
    scan(opts) {
      const doc = document;
      entries.clear();
      const easy = opts?.linkedin ? easyApplyDialog(doc) : null;
      if (opts?.linkedin && !easy) {
        lastRoot = null;
        return {
          url: location.href,
          title: doc.title,
          job: window === window.top ? jobText(doc, doc.body) : '',
          html: '',
          form: [],
          step: '',
          hasNext: false,
          hasSubmit: false,
          captcha: false,
          frames: [],
          empty: true,
          easyApplyOpen: false,
        };
      }
      const root = easy ?? formRoot(doc);
      lastRoot = root;
      const form: FormField[] = [];
      const seenGroups = new Set<string>();
      const controls = [
        ...root.querySelectorAll('input, select, textarea, [contenteditable="true"], [role="combobox"]:not(input)'),
      ] as Control[];
      for (const el of controls) {
        const input = el instanceof HTMLInputElement ? el : null;
        const type = (input?.type ?? '').toLowerCase();
        if (input && ['hidden', 'submit', 'button', 'reset', 'image', 'search'].includes(type)) continue;
        if ((el as HTMLInputElement).disabled) continue;
        if (type !== 'file' && !visible(el)) {
          // Custom radios and checkboxes hide the real input behind a styled label.
          if (!(input && (type === 'radio' || type === 'checkbox') && el.closest('label') && visible(el.closest('label')!))) continue;
        }
        const inForm = el.closest('form');
        if (
          el.closest('[data-rs-ignore]') ||
          el.closest('header, nav, footer, [role="search"], [role="banner"]') ||
          el.closest(MESSAGING) ||
          (inForm && inForm !== root && searchForm(inForm))
        )
          continue;
        if (trap(el, type)) continue; // a field people cannot see, there to catch bots
        let kind: FieldKind;
        let els: Control[] = [el];
        let label: string;
        let options: string[] | undefined;
        let value = '';
        if (input && (type === 'radio' || type === 'checkbox')) {
          const groupKey = input.name ? `${type}:${input.name}` : '';
          const group = groupKey
            ? ([...root.querySelectorAll(`input[type="${type}"][name="${esc(input.name)}"]`)] as HTMLInputElement[])
            : type === 'radio'
              ? ([
                  ...(el.closest('fieldset, [role="radiogroup"]') ?? el.parentElement!).querySelectorAll('input[type="radio"]'),
                ] as HTMLInputElement[])
              : [input];
          if (groupKey && seenGroups.has(groupKey)) continue;
          if (groupKey) seenGroups.add(groupKey);
          if (type === 'radio' && group.length > 1) {
            if (group.some(g => g !== input && g.getAttribute('data-rs-id') && entries.has(g.getAttribute('data-rs-id')!))) continue;
            kind = 'radio';
            els = group;
            options = group.map(optionLabel);
            label = groupLabel(input, group);
            value = group.find(g => g.checked) ? optionLabel(group.find(g => g.checked)!) : '';
          } else if (type === 'checkbox' && group.length > 1) {
            kind = 'checkboxes';
            els = group;
            options = group.map(optionLabel);
            label = groupLabel(input, group);
            value = group
              .filter(g => g.checked)
              .map(optionLabel)
              .join(', ');
          } else {
            kind = type === 'radio' ? 'radio' : 'checkbox';
            label = labelOf(input);
            if (kind === 'radio') options = [optionLabel(input)];
            value = input.checked ? 'true' : '';
          }
        } else if (el instanceof HTMLSelectElement) {
          kind = 'select';
          options = [...el.options].map(o => clean(o.textContent)).filter(t => t && !/^(select|choose|--|please select)/i.test(t));
          label = labelOf(el);
          const chosen = el.selectedOptions[0];
          value =
            chosen && el.value && !/^(select|choose|--|please select)/i.test(clean(chosen.textContent)) ? clean(chosen.textContent) : '';
        } else if (el instanceof HTMLTextAreaElement) {
          kind = 'textarea';
          label = labelOf(el);
          value = el.value;
        } else if (input) {
          const list = input.list ? [...input.list.options].map(o => clean(o.value || o.textContent)) : [];
          kind =
            type === 'file'
              ? 'file'
              : input.getAttribute('role') === 'combobox' || input.getAttribute('aria-autocomplete') === 'list' || list.length
                ? 'combobox'
                : type === 'email' || type === 'tel' || type === 'url' || type === 'number' || type === 'date'
                  ? (type as FieldKind)
                  : type === 'month'
                    ? 'date'
                    : 'text';
          if (list.length) options = list;
          label = labelOf(input);
          // Segmented dates (Workday: separate Month / Day / Year spin buttons) name only the part; add the question.
          if (input.getAttribute('role') === 'spinbutton') {
            kind = 'number';
            const part = clean(input.getAttribute('aria-label')) || label;
            const group = input.closest('fieldset, [role="group"]');
            const question = clean(group?.querySelector('legend, label')?.textContent) || precedingText(group ?? input, 4);
            if (question && !question.toLowerCase().includes(part.toLowerCase())) label = `${question} (${part})`;
          }
          value = type === 'file' ? (input.files?.[0]?.name ?? '') : input.value;
        } else if (el.getAttribute('contenteditable') === 'true') {
          kind = 'richtext';
          label = labelOf(el);
          value = clean(el.textContent);
        } else {
          kind = 'combobox';
          label = labelOf(el);
          value = clean(el.textContent);
        }
        if (kind === 'file' && (!label || /^(upload( a)?( file)?|browse|choose( a)? file|attach( file)?|select file)$/i.test(label))) {
          const heading = precedingText(el.closest('label') ?? el, 5);
          if (heading) label = label ? `${heading} (${label})` : heading;
        }
        if (!label && kind !== 'file') continue;
        const id = idFor(el);
        entries.set(id, { kind, els, ...(options ? { options } : {}) });
        const near = kind === 'text' || kind === 'textarea' || kind === 'richtext' ? limitsNear(el) : { note: '' };
        const help = [textOfIds(el.getAttribute('aria-describedby'), doc), near.note].filter(Boolean).join(' · ').slice(0, 200);
        const sensitive = sensitivity({ kind, label, help, inputType: type, name: el.getAttribute('name') ?? '' });
        const max =
          input?.maxLength && input.maxLength > 0
            ? input.maxLength
            : el instanceof HTMLTextAreaElement && el.maxLength > 0
              ? el.maxLength
              : (near.max ?? 0);
        form.push({
          id,
          frame: 0,
          kind,
          label: (label || (kind === 'file' ? 'Upload a file' : '')).replace(/\s*\*\s*$/, '').slice(0, 300),
          required: isRequired(el, label),
          ...(options?.length ? { options } : {}),
          ...(value ? { value: value.slice(0, 500) } : {}),
          ...(el.getAttribute('placeholder') ? { placeholder: el.getAttribute('placeholder')!.slice(0, 160) } : {}),
          ...(help ? { help } : {}),
          ...(sectionOf(el) ? { section: sectionOf(el) } : {}),
          ...(max ? { maxLength: max } : {}),
          ...(near.min || (input?.minLength ?? 0) > 0 || (el instanceof HTMLTextAreaElement && el.minLength > 0)
            ? { minLength: near.min || (input?.minLength && input.minLength > 0 ? input.minLength : (el as HTMLTextAreaElement).minLength) }
            : {}),
          ...(input?.accept ? { accept: input.accept } : {}),
          ...(sensitive ? { sensitive } : {}),
        });
      }
      const found = buttons(root.ownerDocument === doc && root !== doc.body ? root : doc.body);
      // A security check counts only where the application is, not a newsletter box in the footer.
      const captcha = [
        ...doc.querySelectorAll(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, .cf-turnstile',
        ),
      ].some(c => !c.closest('footer, [role="contentinfo"]') && (root === doc.body || root.contains(c) || !c.closest('form')));
      const adds = opts?.linkedin ? [] : addButtons(root.tagName === 'FORM' ? root : (root.closest('main') ?? root));
      const actions = adds.map(b => {
        const near = clean(b.parentElement?.textContent).match(/(?:^|\D)(\d+)\s+of\s+\d+\b/);
        return {
          id: idFor(b),
          label: (clean(b.getAttribute('aria-label')) || clean(b.textContent)).slice(0, 80),
          section: sectionOf(b),
          ...(near ? { count: Number(near[1]) } : {}),
        };
      });
      addable.clear();
      for (const b of adds) addable.add(b.getAttribute('data-rs-id')!);
      // The page's buttons and links (the form's, any open window's, and the main area's), not the site's menus.
      clickable.clear();
      const pageControls: { id: string; label: string; kind: 'button' | 'submit' | 'link'; final: boolean }[] = [];
      if (!opts?.linkedin) {
        // Open windows first, then the form, then the main area: on a job board the list of other jobs comes before the
        // job's own Apply button, so buttons that move an application on are kept ahead of the rest.
        const area = [
          ...doc.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]'),
          root,
          ...doc.querySelectorAll('main, [role="main"]'),
          doc.body,
        ];
        const seen = new Set<Element>();
        const perLabel = new Map<string, number>();
        const found: { b: HTMLElement; label: string; rank: number }[] = [];
        for (const scope of area)
          for (const b of scope.querySelectorAll<HTMLElement>(
            'button, a[href], [role="button"], input[type="submit"], input[type="button"], [aria-expanded="false"], [tabindex="0"][class*="tile" i], [tabindex="0"][class*="card" i], [tabindex="0"][class*="item" i]',
          )) {
            if (seen.has(b) || found.length >= 400) continue;
            seen.add(b);
            if (!visible(b) || (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true') continue;
            if (b.closest('header, nav, footer, [role="navigation"], [role="contentinfo"]') || b.closest(MESSAGING)) continue;
            const label = buttonText(b).slice(0, 80);
            if (!label || addable.has(b.getAttribute('data-rs-id') ?? '')) continue;
            // "Apply with LinkedIn" on a company site hands the application to another site (and its sign-in); on that
            // site itself ("Apply with Indeed" on Indeed) it is the site's own apply button.
            const via = /\bapply (?:with|using|via|through) (\w+)/i.exec(label)?.[1]?.toLowerCase();
            if (via && !location.host.toLowerCase().includes(via)) continue;
            // The same label twenty times (a bookmark on every job card) says nothing new after the second.
            const n = (perLabel.get(label.toLowerCase()) ?? 0) + 1;
            perLabel.set(label.toLowerCase(), n);
            if (n > 2) continue;
            const rank = MOVES_ON.test(label) ? 0 : b.closest('[role="dialog"], dialog, [aria-modal="true"], form') ? 1 : 2;
            found.push({ b, label, rank });
          }
        for (const { b, label } of found.sort((x, y) => x.rank - y.rank).slice(0, 40)) {
          const kind = b instanceof HTMLAnchorElement ? 'link' : (b as HTMLButtonElement).type === 'submit' ? 'submit' : 'button';
          pageControls.push({ id: idFor(b), label, kind, final: buttonRole(label) === 'submit' });
          clickable.add(b.getAttribute('data-rs-id')!);
        }
      }
      const frames = [...doc.querySelectorAll('iframe')]
        .filter(f => visible(f) && f.src && /^https?:/.test(f.src) && f.getBoundingClientRect().height > 150)
        .map(f => f.src)
        .slice(0, 10);
      return {
        url: location.href,
        title: doc.title,
        job: window === window.top ? jobText(doc, root) : '',
        // The step's own markup also goes along when it holds only list buttons: its headings and help text say what
        // the list is for ("Degrees, diplomas and schooling, highest first").
        html: form.length || actions.length ? cleanedHtml(root) : '',
        form,
        step: stepOf(doc, root),
        hasNext: found.some(b => b.role === 'next'),
        hasSubmit: found.some(b => b.role === 'submit'),
        captcha,
        frames,
        empty: !form.length && !actions.length,
        ...(actions.length ? { actions } : {}),
        ...(pageControls.length ? { controls: pageControls } : {}),
        ...(opts?.linkedin ? { easyApplyOpen: true } : {}),
        ...(() => {
          const box = topChoiceBox(root);
          if (!box) return {};
          const left = clean(root.textContent).match(/mark (\d+) more jobs? as (a )?top choice/i);
          // LinkedIn's own "Job match is low / medium / high" on the job, so a top choice is not spent on a poor fit.
          const match = clean(doc.body.textContent)
            .match(/job match is (low|medium|high)/i)?.[1]
            ?.toLowerCase() as 'low' | 'medium' | 'high' | undefined;
          return {
            topChoice: { checked: box.checked, ...(left ? { remaining: Number(left[1]) } : {}) },
            ...(match ? { jobMatch: match } : {}),
          };
        })(),
      };
    },
    async fill(items, files) {
      const results: FillResult[] = [];
      const record: Previous[] = [];
      for (const item of items) {
        const entry = entries.get(item.id);
        if (!entry || !entry.els[0]?.isConnected) {
          results.push({ id: item.id, ok: false, note: 'The field is no longer on the page.' });
          continue;
        }
        record.push({ id: item.id, values: entry.els.map(snapshot) });
        try {
          const r = await fillOne(entry, item.value);
          results.push({ id: item.id, ...r });
        } catch (e) {
          results.push({ id: item.id, ok: false, note: e instanceof Error ? e.message.slice(0, 120) : 'Could not type here.' });
        }
        // Long answers take a person longer to write; short ones are a quick move to the next box.
        const len = (Array.isArray(item.value) ? item.value.join(' ') : item.value).length;
        await human(len > 200 ? 600 : 150, len > 200 ? 1200 : 600);
      }
      for (const f of files) {
        const entry = entries.get(f.id);
        const input = entry?.els[0];
        if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.isConnected) {
          results.push({ id: f.id, ok: false, note: 'The upload field is no longer on the page.' });
          continue;
        }
        record.push({ id: f.id, values: [snapshot(input)] });
        await human(800, 1500);
        try {
          const dt = new DataTransfer();
          dt.items.add(fromBase64(f.data, f.name, f.type));
          input.files = dt.files;
          fire(input, 'input', 'change');
          results.push({ id: f.id, ...(await uploadOutcome(input, f.name)) });
        } catch {
          results.push({ id: f.id, ok: false, note: 'This site did not accept the file; attach it yourself.' });
        }
      }
      undo.push(...record);
      return results;
    },
    mark(ids) {
      let first: HTMLElement | null = null;
      for (const { id, tone } of ids) {
        const entry = entries.get(id);
        const el = entry?.els[0];
        if (!el?.isConnected) continue;
        const target = (
          entry!.kind === 'radio' || entry!.kind === 'checkboxes' || (el instanceof HTMLInputElement && el.type === 'file')
            ? (el.closest('fieldset, [role="radiogroup"], [role="group"]') ?? el.parentElement ?? el)
            : el
        ) as HTMLElement;
        target.style.setProperty('outline', `${tone === 'done' ? 2 : 3}px ${LINE[tone]} ${MARK[tone]}`, 'important');
        if (!target.hasAttribute('data-rs-title')) target.setAttribute('data-rs-title', target.getAttribute('title') ?? '');
        target.setAttribute('title', NOTE[tone]);
        if (tone === 'you' && !first && el instanceof HTMLElement) first = el;
        target.style.setProperty('outline-offset', '2px', 'important');
        target.setAttribute('data-rs-marked', tone);
        marked.add(target);
      }
      // Take the person straight to the first question left for them, without scrolling the page under them twice.
      if (first) {
        try {
          (first as HTMLElement).scrollIntoView({ block: 'center' });
          (first as HTMLElement).focus({ preventScroll: true });
        } catch {
          /* a page can block focus; the outline still shows the way */
        }
      }
    },
    undo() {
      let count = 0;
      for (const prev of undo.splice(0).reverse()) {
        for (const v of prev.values) {
          const el = v.el;
          if (!el.isConnected) continue;
          if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
            if (el.checked === !!v.checked) continue;
            // A chosen radio cannot be un-chosen by clicking it again: clear it directly.
            if (el.type === 'radio' && !v.checked) {
              el.checked = false;
              fire(el, 'input', 'change');
            } else el.click();
          } else if (el instanceof HTMLInputElement && el.type === 'file') {
            try {
              el.files = v.files ?? new DataTransfer().files;
              fire(el, 'change');
            } catch {
              /* some sites lock the input after upload */
            }
          } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            setNative(el, v.value);
            fire(el, 'input', 'change', 'blur');
          } else {
            el.textContent = v.value;
            fire(el, 'input');
          }
        }
        count++;
      }
      this.clear();
      return count;
    },
    clear() {
      for (const el of marked) {
        el.style.removeProperty('outline');
        el.style.removeProperty('outline-offset');
        el.removeAttribute('data-rs-marked');
        if (el.hasAttribute('data-rs-title')) {
          const old = el.getAttribute('data-rs-title') ?? '';
          if (old) el.setAttribute('title', old);
          else el.removeAttribute('title');
          el.removeAttribute('data-rs-title');
        }
      }
      marked.clear();
    },
    next() {
      const root = lastRoot?.isConnected ? lastRoot : formRoot(document);
      if (root === document.body && !document.querySelector('form')) return { error: 'No application form is open on this page.' };
      const all = buttons(root);
      const next = all.find(b => b.role === 'next');
      if (!next)
        return {
          error: all.some(b => b.role === 'submit')
            ? 'This is the last step: review it and submit it yourself.'
            : 'No Next or Continue button found.',
        };
      if ((next.el as HTMLButtonElement).disabled || next.el.getAttribute('aria-disabled') === 'true')
        return { error: 'The site’s Next button is disabled: a required field still needs an answer.' };
      // A few sites label the button that sends the application "Continue" or "Next", usually on a review page. Outside
      // LinkedIn's Easy Apply (whose buttons are known), such a page is never moved on from: the person submits it.
      if (!easyApplyDialog(document) && looksFinal(root))
        return { error: 'This looks like the final review page: check it and submit it yourself.' };
      undo.splice(0);
      this.clear();
      next.el.click();
      return { clicked: next.label };
    },
    submitFinal() {
      const root = lastRoot?.isConnected ? lastRoot : formRoot(document);
      const send = buttons(root).find(b => b.role === 'submit');
      if (!send) return { error: 'No button that sends the application was found.' };
      if ((send.el as HTMLButtonElement).disabled || send.el.getAttribute('aria-disabled') === 'true')
        return { error: 'The site’s Submit button is disabled: something required is still missing.' };
      undo.splice(0);
      this.clear();
      send.el.scrollIntoView({ block: 'center' });
      send.el.click();
      return { clicked: send.label };
    },
    submitted() {
      const SENT =
        /\b(your application (was|has been) (sent|submitted|received)|application sent|application (has been |was |is )?(submitted|received|complete(d)?)|thank(s| you),? for (your )?(appl(ying|ication)|submi(tting|ssion)|interest in (joining|working))|thanks for applying|we('ve| have) (received|got) your (application|resume|cv)|successfully (applied|submitted)|submission (received|successful|complete)|you('re| are) all set|you applied\b|we('ll| will) (be in touch|review your application|get back to you))/i;
      // LinkedIn: the Easy Apply window is replaced by a short "Application sent" window, and the job shows "Applied".
      for (const d of document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]'))
        if (visible(d) && SENT.test(clean(d.textContent).slice(0, 600))) return true;
      if (easyApplyDialog(document)) return false; // still filling
      // Any site: a thank-you page or message in the main part of the page (not a whole page of other jobs).
      const main = document.querySelector('main, [role="main"], #content, article') ?? document.body;
      const text = clean((main as HTMLElement).innerText || main.textContent).slice(0, 4000);
      return SENT.test(text) && !buttons(main).some(b => b.role === 'submit' && !/^apply/i.test(b.label));
    },
    jobMeta() {
      const doc = document;
      let title = '',
        company = '',
        location = '',
        companyUrl = '';
      for (const sc of doc.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const data = JSON.parse(sc.textContent ?? '') as unknown;
          const list = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
          for (const d of list.flatMap(x => (Array.isArray(x?.['@graph']) ? (x['@graph'] as Record<string, unknown>[]) : [x])))
            if (d?.['@type'] === 'JobPosting') {
              title ||= clean(String(d['title'] ?? ''));
              company ||= clean(String((d['hiringOrganization'] as { name?: string } | undefined)?.name ?? ''));
              const place = (d['jobLocation'] as { address?: { addressLocality?: string } } | undefined)?.address?.addressLocality;
              location ||= clean(place ?? '');
            }
        } catch {
          /* not JSON */
        }
      }
      if (/(^|\.)linkedin\.com$/.test(window.location.hostname) || / \| LinkedIn$/.test(doc.title)) {
        // "Management Intern | QuickFlo | LinkedIn" and the Easy Apply window's "Apply to QuickFlo".
        const parts = doc.title
          .replace(/^\(\d+\)\s*/, '')
          .split(' | ')
          .map(clean);
        if (parts.length >= 3 && parts.at(-1) === 'LinkedIn') {
          title ||= parts[0]!;
          company ||= parts[1]!;
        }
        const apply = clean(easyApplyDialog(doc)?.querySelector('h2, h1')?.textContent).match(/^apply to (.+)$/i);
        company ||= apply?.[1] ?? '';
        const link = [...doc.querySelectorAll<HTMLAnchorElement>('main a[href*="/company/"]')].find(a => /\/company\/[^/?#]+/.test(a.href));
        const slug = link && /\/company\/([^/?#]+)/.exec(link.href)?.[1];
        if (slug) companyUrl = `https://www.linkedin.com/company/${slug}/`;
      }
      if (!company) company = clean(doc.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content);
      if (!title)
        title =
          clean(doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content) || clean(doc.querySelector('h1')?.textContent);
      return { title: title.slice(0, 200), company: company.slice(0, 200), location: location.slice(0, 200), companyUrl };
    },
    passInterstitial() {
      // Only a notice about the application itself, never a form: it has a "Continue applying" button and no fields.
      for (const d of document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')) {
        if (!visible(d) || d.querySelector('input:not([type="hidden"]), select, textarea')) continue;
        const go = [...d.querySelectorAll<HTMLElement>('button, a')].find(
          b => visible(b) && /^continue applying$|^continue to (the )?application$|^apply anyway$/i.test(buttonText(b)),
        );
        if (go) {
          go.click();
          return true;
        }
      }
      return false;
    },
    markTopChoice() {
      const root = easyApplyDialog(document) ?? document;
      const box = topChoiceBox(root);
      if (!box) return 'none';
      if (box.checked) return 'already';
      box.click();
      return box.checked ? 'checked' : 'none';
    },
    externalApply(click = true) {
      const cards = '[componentkey^="job-card-component-ref-"], [data-job-id], .job-card-container, .jobs-search-results-list';
      const links = [...document.querySelectorAll<HTMLElement>('a[href], button')].filter(b => visible(b) && !b.closest(cards));
      const name = (b: HTMLElement) => clean(b.getAttribute('aria-label')) || clean(b.textContent);
      // Checked live (22 Nov 2026): <a aria-label="Apply on company website" target="_blank" href="/safety/go/?url=...">Apply</a>.
      const link =
        links.find(b => /^apply on (the )?company('s)? (web)?site/i.test(name(b))) ??
        links.find(b => /^apply( now)?$/i.test(name(b)) && /\/safety\/go\/|\/redir\//.test(b.getAttribute('href') ?? ''));
      if (!link) return '';
      const href = link instanceof HTMLAnchorElement ? link.href : 'button';
      if (click) link.click();
      return href;
    },
    openApplication(click = true) {
      const fields = [
        ...document.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]):not([type="search"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]), select, textarea',
        ),
      ].filter(visible);
      if (fields.length >= 3 || fields.some(f => (f as HTMLInputElement).type === 'file')) return 'form';
      const OPEN =
        /^(apply|apply now|apply here|apply online|apply for (this|the) (job|position|role|opening)|apply to (this|the) (job|position|role)|apply for job|apply manually|start (my |your )?application|begin (my |your )?application|i'?m interested|submit (your |my )?(cv|resume))$/i;
      const name = (b: HTMLElement) =>
        (clean(b.getAttribute('aria-label')) || clean(b.textContent) || clean((b as HTMLInputElement).value)).replace(/[›→>]+$/, '').trim();
      const controls = [
        ...document.querySelectorAll<HTMLElement>('a, button, [role="button"], input[type="button"], input[type="submit"]'),
      ].filter(visible);
      const pick = controls.find(b => {
        if (!OPEN.test(name(b)) || b.hasAttribute('data-rs-opened')) return false; // each control is pressed once
        // Signing in through another account (LinkedIn, Indeed, Google) or a resume autofill is never chosen for the person.
        if (/linkedin|indeed|google|facebook|seek|autofill/i.test(`${name(b)} ${b.getAttribute('href') ?? ''}`)) return false;
        // A button inside a form that already holds fields would send that form: never pressed.
        const form = b.closest('form');
        return !(form && [...form.querySelectorAll('input:not([type="hidden"]), select, textarea')].some(visible));
      });
      if (!pick) return 'none';
      if (click) {
        pick.setAttribute('data-rs-opened', '1');
        pick.scrollIntoView({ block: 'center' });
        pick.click();
      }
      return 'opened';
    },
    dismissCookies() {
      const REJECT =
        /^(reject all|reject( all)? (non-essential|optional|additional)( cookies)?|reject cookies|decline( all)?( cookies)?|deny( all)?|refuse all|necessary (cookies )?only|only (necessary|essential|required)( cookies)?|use (only )?(necessary|essential) cookies( only)?|essential (cookies )?only|continue without accepting|allow (only )?(necessary|essential|required)( cookies)?)$/i;
      const b = [...document.querySelectorAll<HTMLElement>('button, a[role="button"], [role="button"]')].find(
        x => visible(x) && REJECT.test(clean(x.textContent) || clean(x.getAttribute('aria-label'))),
      );
      if (!b) return false;
      b.click();
      return true;
    },
    async attachFallback(file) {
      const RESUME = /\b(resume|résumé|cv|curriculum vitae)\b/i;
      const around = (e: Element) => clean(`${e.textContent ?? ''} ${e.parentElement?.parentElement?.textContent ?? ''}`).slice(0, 400);
      const free = () =>
        [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].find(i => !i.disabled && !(i.files?.length ?? 0));
      let input = free();
      if (!input) {
        // Pressing "Attach" makes many sites add their file field. A script's press can never open the file picker
        // (Chrome requires a real click for that), so this only reveals the field.
        const attach = [...document.querySelectorAll<HTMLElement>('button, a, [role="button"], label')].find(
          b =>
            visible(b) &&
            /\b(attach|upload|browse)\b|\b(choose|select|add) (a |your )?(file|resume|cv)\b/i.test(
              `${clean(b.textContent)} ${b.getAttribute('aria-label') ?? ''}`,
            ) &&
            !b.closest('form button[type="submit"]') &&
            RESUME.test(around(b)),
        );
        if (attach) {
          attach.click();
          await sleep(900);
          input = free();
        }
      }
      const blob = fromBase64(file.data, file.name, file.type);
      if (input && RESUME.test(around(input))) {
        const dt = new DataTransfer();
        dt.items.add(blob);
        input.files = dt.files;
        fire(input, 'input', 'change');
        return { ...(await uploadOutcome(input, file.name)), how: 'input' };
      }
      // A drag-and-drop area for the CV: the file is dropped onto it the way a person would.
      const zone = [...document.querySelectorAll<HTMLElement>('div, section, label')].find(z => {
        const t = clean(z.textContent);
        return (
          visible(z) &&
          t.length < 300 &&
          /drag (and|&) drop|drop (your |a )?(file|resume|cv)|drop files? here/i.test(t) &&
          RESUME.test(around(z))
        );
      });
      if (!zone) return { ok: false, how: 'none' };
      const dt = new DataTransfer();
      dt.items.add(blob);
      for (const type of ['dragenter', 'dragover', 'drop'])
        zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      await sleep(1500);
      const base = file.name
        .replace(/\.[a-z0-9]+$/i, '')
        .slice(0, 20)
        .toLowerCase();
      return clean(zone.parentElement?.textContent ?? zone.textContent)
        .toLowerCase()
        .includes(base)
        ? { ok: true, how: 'drop' }
        : { ok: false, note: 'Your CV could not be dropped into this site’s upload area; attach it on the page.', how: 'drop' };
    },
    signIn() {
      const all = [
        ...document.querySelectorAll<HTMLInputElement>(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea',
        ),
      ].filter(visible);
      const pw = all.filter(i => i instanceof HTMLInputElement && i.type === 'password');
      return pw.length > 0 && all.length - pw.length <= 4;
    },
    press(id) {
      if (!addable.has(id)) return false;
      const b = document.querySelector<HTMLElement>(`[data-rs-id="${esc(id)}"]`);
      // Checked again at the moment of pressing: still an "add an entry" button, still enabled, never a submit.
      if (!b || !visible(b) || (b as HTMLButtonElement).disabled || (b as HTMLButtonElement).type === 'submit') return false;
      if (!ADD_ENTRY.test(clean(b.getAttribute('aria-label')) || clean(b.textContent))) return false;
      b.scrollIntoView({ block: 'center' });
      b.click();
      return true;
    },
    click(id, final = false) {
      if (!clickable.has(id)) return { error: 'That button is no longer on the page.' };
      const b = document.querySelector<HTMLElement>(`[data-rs-id="${esc(id)}"]`);
      if (!b || !visible(b) || (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true')
        return { error: 'That button is no longer on the page, or it is disabled.' };
      const label = buttonText(b);
      // Sending the application is the person's own act, unless they chose hands-free and every check passed.
      const sends =
        buttonRole(label) === 'submit' || (looksFinal(b.closest('form') ?? document.body) && (b as HTMLButtonElement).type === 'submit');
      if (sends && !final) return { error: `"${label}" would send the application: that is left to you.` };
      // A link to another site (a job board's "apply with" partner, an ad) is never followed.
      if (b instanceof HTMLAnchorElement && b.host && b.host !== location.host && !/apply|application|career|job/i.test(b.href))
        return { error: 'That link leads to another site.' };
      undo.splice(0);
      this.clear();
      b.scrollIntoView({ block: 'center' });
      b.click();
      return { clicked: label };
    },
    openNextJob() {
      const current = new URL(location.href).searchParams.get('currentJobId') ?? /\/jobs\/view\/(\d+)/.exec(location.pathname)?.[1] ?? '';
      const card = nextJobCard(document, current);
      if (!card) return '';
      const link = card.el.querySelector<HTMLElement>('a[href*="/jobs/view/"], a[href*="currentJobId="]') ?? card.el;
      link.scrollIntoView({ block: 'center' });
      link.click();
      return card.id;
    },
    openEasyApply(click = true) {
      if (easyApplyDialog(document)) return 'open';
      // Only real buttons and links count. LinkedIn's job cards in the results list are clickable boxes that also say
      // "Easy Apply" (pressing one only re-selects the job), and the "Easy Apply" search filter is a toggle.
      const controls = [...document.querySelectorAll<HTMLElement>('button, a')].filter(
        b =>
          visible(b) &&
          !b.hasAttribute('aria-pressed') &&
          !b.closest('[componentkey^="job-card-component-ref-"], [data-job-id], .job-card-container, .jobs-search-results-list') &&
          !b.closest('[role="radiogroup"], [aria-label*="filter" i], .search-reusables__filter-list'),
      );
      const label = (b: HTMLElement) => clean(b.getAttribute('aria-label'));
      const own = (b: HTMLElement) => clean(b.textContent);
      const easy =
        controls.find(b => /^easy apply to\b/i.test(label(b))) ?? controls.find(b => /^easy apply$/i.test(own(b)) && !b.closest('form'));
      if (easy) {
        if (click) easy.click();
        return 'opened';
      }
      if (controls.some(b => /^apply( now)?$|^apply (on|to) (company|this)/i.test(label(b) || own(b)))) return 'external';
      // Already applied: LinkedIn replaces the button with "Applied 2 hours ago" / "Application submitted".
      // Only the job's own details count, not the results list (whose cards can say "Applied" for other jobs).
      const main = (document.querySelector('main') ?? document.body).cloneNode(true) as Element;
      main
        .querySelectorAll('[componentkey^="job-card-component-ref-"], [data-job-id], .jobs-search-results-list, script, style')
        .forEach(e => e.remove());
      // No word boundaries: textContent runs lines together ("Product ManagerApplied 2 days ago").
      return /applied \d+\s*\w+ ago|applied on \w+|application submitted|\byou applied/i.test(clean(main.textContent).slice(0, 6000))
        ? 'applied'
        : 'none';
    },
  };
}
/** The job cards of a LinkedIn results list with their job ids, in page order. */
function jobCards(doc: Document): { el: HTMLElement; id: string; text: string }[] {
  const cards = [...doc.querySelectorAll<HTMLElement>('[componentkey^="job-card-component-ref-"], [data-job-id]')];
  const seen = new Set<string>();
  const out: { el: HTMLElement; id: string; text: string }[] = [];
  for (const el of cards) {
    const id =
      /(\d{5,})/.exec(el.getAttribute('componentkey') ?? '')?.[1] ??
      /^\d+$/.exec(el.getAttribute('data-job-id') ?? '')?.[0] ??
      /currentJobId=(\d+)|\/jobs\/view\/(\d+)/
        .exec(el.querySelector('a[href]')?.getAttribute('href') ?? '')
        ?.slice(1)
        .find(Boolean) ??
      '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ el, id, text: clean(el.textContent) });
  }
  return out;
}
/** Picks the next card to open: Easy Apply, not marked Applied, and after the job now shown when there is one. */
function nextJobCard(doc: Document, currentId: string): { el: HTMLElement; id: string } | null {
  const cards = jobCards(doc);
  const at = cards.findIndex(c => c.id === currentId);
  const open = (c: { text: string; id: string }) =>
    c.id !== currentId && /easy apply/i.test(c.text) && !/applied/i.test(c.text.replace(/easy apply/gi, '')); // card text runs words together
  return [...cards.slice(at + 1), ...cards.slice(0, Math.max(at, 0))].find(open) ?? null;
}
if (!scope.__referralScoutApply || scope.__referralScoutApply.version !== VERSION) scope.__referralScoutApply = create();
