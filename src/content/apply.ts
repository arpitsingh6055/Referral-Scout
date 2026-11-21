/**
 * Runs inside a job application page (LinkedIn or any company or applicant-tracking site), only when the person
 * presses "Fill this application". It reads the form into a compact model, types the answers the background hands
 * it, marks every field it touched, can put everything back, and can press the page's own Next / Continue button.
 * It never presses Submit, Apply or Send, and never touches password or CAPTCHA fields.
 *
 * Injected with chrome.scripting into every frame of the tab; each injection reuses the same instance, so the state
 * needed for Undo survives between calls.
 */
import { buttonRole, sensitivity, type FieldKind, type FormField, type PageSnapshot } from '../shared/apply';

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
  scan(): Omit<PageSnapshot, 'url' | 'title'> & { url: string; title: string; frames: string[]; empty: boolean };
  fill(
    items: { id: string; kind: FieldKind; value: string | string[] }[],
    files: { id: string; name: string; type: string; data: string }[],
  ): Promise<FillResult[]>;
  mark(ids: { id: string; tone: 'done' | 'check' | 'you' }[]): void;
  undo(): number;
  clear(): void;
  next(): { clicked?: string; error?: string };
  openEasyApply(): 'opened' | 'external' | 'open' | 'none';
}
const VERSION = 3;
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
function groupLabel(el: Element): string {
  const doc = el.ownerDocument;
  const group = el.closest('fieldset, [role="radiogroup"], [role="group"]');
  if (group) {
    const legend = group.querySelector('legend');
    const t =
      clean(legend?.textContent) || textOfIds(group.getAttribute('aria-labelledby'), doc) || clean(group.getAttribute('aria-label'));
    if (t) return t;
  }
  // A group without a fieldset: the text just before the first option's container.
  let node: Element | null = el.closest('label')?.parentElement ?? el.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const q = node.querySelector('legend, label:not(:has(input)), [class*="label" i], [class*="question" i], h3, h4, p');
    if (q && !q.querySelector('input') && clean(q.textContent)) return clean(q.textContent).slice(0, 300);
  }
  return clean(el.getAttribute('name'));
}
const optionLabel = (input: HTMLInputElement): string => {
  const own = labelOf(input);
  return own || clean(input.value);
};
const isRequired = (el: Element, label: string): boolean =>
  (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || /\*\s*$|\(required\)|\brequired\b/i.test(label);
function sectionOf(el: Element): string {
  const fs = el.closest('fieldset')?.querySelector('legend');
  if (fs) return clean(fs.textContent).slice(0, 120);
  const heading = el.closest('section, [role="region"], form, div')?.querySelector('h2, h3');
  return clean(heading?.textContent).slice(0, 120);
}
/** Where the application lives: LinkedIn's Easy Apply window, any open dialog with fields, the largest form, or the page. */
function formRoot(doc: Document): Element {
  const has = (e: Element) => [...e.querySelectorAll('input, select, textarea, [contenteditable="true"]')].some(visible);
  const easy = doc.querySelector('.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"], .artdeco-modal.jobs-easy-apply-modal');
  if (easy && has(easy)) return easy;
  const dialogs = [...doc.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')].filter(d => visible(d) && has(d));
  if (dialogs.length) return dialogs.at(-1)!;
  const forms = [...doc.querySelectorAll('form')].filter(has);
  if (forms.length) {
    const count = (f: Element) => [...f.querySelectorAll('input, select, textarea')].filter(visible).length;
    return forms.sort((a, b) => count(b) - count(a))[0]!;
  }
  return doc.body;
}
function jobText(doc: Document, form: Element): string {
  const parts: string[] = [];
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
  if (!parts.length) {
    const linkedin = doc.querySelector('.jobs-description__content, .jobs-box__html-content, #job-details, .jobs-description');
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
      copy.querySelectorAll('script, style, noscript, svg, nav, header, footer, form, [role="dialog"]').forEach(e => e.remove());
      if (main.contains(form) && form !== main) {
        /* the form itself was removed above */
      }
      parts.push(`PAGE TEXT: ${clean(copy.textContent).slice(0, 9000)}`);
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
  const match = text.match(/\bstep \d+ (of|\/) \d+\b/i) ?? text.match(/\b\d+ of \d+\b(?= steps?)/i);
  const heading = clean(root.querySelector('h3, h2')?.textContent).slice(0, 80);
  return (
    [match?.[0], now ? `${Math.round(Number(now))}% complete` : '', heading].filter(Boolean).join(' · ') || clean(doc.title).slice(0, 80)
  );
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
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || el.type === 'date') return iso;
  const [, y, mo, d] = m;
  const p = (el.placeholder || '').toLowerCase();
  if (/^dd/.test(p)) return `${d}/${mo}/${y}`;
  if (/^mm/.test(p)) return `${mo}/${d}/${y}`;
  return iso;
}
async function pickFromList(input: HTMLElement, value: string): Promise<boolean> {
  const doc = input.ownerDocument;
  for (let i = 0; i < 12; i++) {
    await sleep(150);
    const listId = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
    const list = listId ? doc.getElementById(listId) : null;
    const opts = [...(list ?? doc).querySelectorAll('[role="option"]')].filter(visible) as HTMLElement[];
    if (!opts.length) continue;
    const hit = bestMatch(value, opts, o => clean(o.textContent));
    if (hit) {
      hit.scrollIntoView?.({ block: 'nearest' });
      hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      hit.click();
      return true;
    }
    if (i > 6) return false;
  }
  return false;
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
      return { ok: true };
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
      for (const box of entry.els as HTMLInputElement[]) {
        const on = want.has(norm(optionLabel(box)));
        if (box.checked !== on) box.click();
      }
      return { ok: true };
    }
    case 'combobox': {
      const input = first as HTMLInputElement;
      input.focus();
      input.click();
      if ('value' in input) {
        setNative(input, one);
        fire(input, 'input');
      }
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const picked = await pickFromList(input, one);
      if (!picked) return { ok: true, note: 'Typed; check the suggestion it picked.' };
      return { ok: true };
    }
    case 'richtext': {
      first.focus();
      const doc = first.ownerDocument;
      doc.getSelection()?.selectAllChildren(first);
      if (!doc.execCommand('insertText', false, one)) first.textContent = one;
      fire(first, 'input', 'change', 'blur');
      return { ok: true };
    }
    default: {
      const input = first as HTMLInputElement | HTMLTextAreaElement;
      input.focus();
      setNative(input, input instanceof HTMLInputElement && entry.kind === 'date' ? dateFor(input, one) : one);
      fire(input, 'input', 'change');
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      input.blur();
      fire(input, 'blur', 'focusout');
      return { ok: input.value.length > 0 };
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
  const marked = new Set<HTMLElement>();
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
  return {
    version: VERSION,
    scan() {
      const doc = document;
      entries.clear();
      const root = formRoot(doc);
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
        if (el.closest('[data-rs-ignore]') || el.closest('header, nav, footer')) continue;
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
            label = groupLabel(input);
            value = group.find(g => g.checked) ? optionLabel(group.find(g => g.checked)!) : '';
          } else if (type === 'checkbox' && group.length > 1) {
            kind = 'checkboxes';
            els = group;
            options = group.map(optionLabel);
            label = groupLabel(input);
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
                  : 'text';
          if (list.length) options = list;
          label = labelOf(input);
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
        if (!label && kind !== 'file') continue;
        const id = idFor(el);
        entries.set(id, { kind, els, ...(options ? { options } : {}) });
        const help = textOfIds(el.getAttribute('aria-describedby'), doc).slice(0, 200);
        const sensitive = sensitivity({ kind, label, help, inputType: type, name: el.getAttribute('name') ?? '' });
        const max =
          input?.maxLength && input.maxLength > 0
            ? input.maxLength
            : el instanceof HTMLTextAreaElement && el.maxLength > 0
              ? el.maxLength
              : 0;
        form.push({
          id,
          frame: 0,
          kind,
          label: (label || (kind === 'file' ? 'Upload a file' : '')).replace(/\s*\*\s*$/, '').slice(0, 300),
          required: isRequired(el, label),
          ...(options?.length ? { options } : {}),
          ...(value ? { value: value.slice(0, 500) } : {}),
          ...(input?.placeholder ? { placeholder: input.placeholder.slice(0, 120) } : {}),
          ...(help ? { help } : {}),
          ...(sectionOf(el) ? { section: sectionOf(el) } : {}),
          ...(max ? { maxLength: max } : {}),
          ...(input?.accept ? { accept: input.accept } : {}),
          ...(sensitive ? { sensitive } : {}),
        });
      }
      const found = buttons(root.ownerDocument === doc && root !== doc.body ? root : doc.body);
      const captcha = !!doc.querySelector(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, .cf-turnstile',
      );
      const frames = [...doc.querySelectorAll('iframe')]
        .filter(f => visible(f) && f.src && /^https?:/.test(f.src) && f.getBoundingClientRect().height > 150)
        .map(f => f.src)
        .slice(0, 10);
      return {
        url: location.href,
        title: doc.title,
        job: window === window.top ? jobText(doc, root) : '',
        html: form.length ? cleanedHtml(root) : '',
        form,
        step: stepOf(doc, root),
        hasNext: found.some(b => b.role === 'next'),
        hasSubmit: found.some(b => b.role === 'submit'),
        captcha,
        frames,
        empty: !form.length,
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
        await sleep(60);
      }
      for (const f of files) {
        const entry = entries.get(f.id);
        const input = entry?.els[0];
        if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.isConnected) {
          results.push({ id: f.id, ok: false, note: 'The upload field is no longer on the page.' });
          continue;
        }
        record.push({ id: f.id, values: [snapshot(input)] });
        try {
          const dt = new DataTransfer();
          dt.items.add(fromBase64(f.data, f.name, f.type));
          input.files = dt.files;
          fire(input, 'input', 'change');
          results.push({ id: f.id, ok: (input.files?.length ?? 0) > 0 });
        } catch {
          results.push({ id: f.id, ok: false, note: 'This site did not accept the file; attach it yourself.' });
        }
        await sleep(300);
      }
      undo.push(...record);
      return results;
    },
    mark(ids) {
      for (const { id, tone } of ids) {
        const entry = entries.get(id);
        const el = entry?.els[0];
        if (!el?.isConnected) continue;
        const target = (
          entry!.kind === 'radio' || entry!.kind === 'checkboxes' || (el instanceof HTMLInputElement && el.type === 'file')
            ? (el.closest('fieldset, [role="radiogroup"], [role="group"]') ?? el.parentElement ?? el)
            : el
        ) as HTMLElement;
        target.style.setProperty('outline', `2px solid ${MARK[tone]}`, 'important');
        target.style.setProperty('outline-offset', '2px', 'important');
        target.setAttribute('data-rs-marked', tone);
        marked.add(target);
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
      }
      marked.clear();
    },
    next() {
      const root = formRoot(document);
      const all = buttons(root === document.body ? document.body : root);
      const next = all.find(b => b.role === 'next');
      if (!next)
        return {
          error: all.some(b => b.role === 'submit')
            ? 'This is the last step: review it and submit it yourself.'
            : 'No Next or Continue button found.',
        };
      if ((next.el as HTMLButtonElement).disabled || next.el.getAttribute('aria-disabled') === 'true')
        return { error: 'The site’s Next button is disabled: a required field still needs an answer.' };
      undo.splice(0);
      this.clear();
      next.el.click();
      return { clicked: next.label };
    },
    openEasyApply() {
      if (document.querySelector('.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"]')) return 'open';
      const btn = [
        ...document.querySelectorAll('button.jobs-apply-button, .jobs-apply-button--top-card button, button[aria-label*="Apply" i]'),
      ].find(visible) as HTMLButtonElement | undefined;
      if (!btn) return 'none';
      if (!/easy apply/i.test(buttonText(btn))) return 'external';
      btn.click();
      return 'opened';
    },
  };
}
if (!scope.__referralScoutApply || scope.__referralScoutApply.version !== VERSION) scope.__referralScoutApply = create();
