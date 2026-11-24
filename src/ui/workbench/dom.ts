/**
 * Small DOM helpers for the workbench.
 *
 * Everything is built from real elements and text nodes rather than HTML strings. That is not a style preference:
 * job titles, company names and form questions all come from pages the product does not control, and the one way
 * to guarantee none of it is ever parsed as markup is never to concatenate it into HTML.
 */

export type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export const div = (className: string, children: (Node | string | null | undefined | false)[] = []): HTMLDivElement =>
  el('div', { class: className }, children);

export const text = (tag: keyof HTMLElementTagNameMap, className: string, content: string): HTMLElement =>
  el(tag as 'div', { class: className, text: content });

export function button(label: string, className: string, onClick: () => void | Promise<void>, attrs: Attrs = {}): HTMLButtonElement {
  const b = el('button', { class: className, type: 'button', ...attrs }, [label]);
  b.addEventListener('click', () => {
    // A button that fires twice can send a second application. Disabling while the work runs is the cheap guard.
    if (b.disabled) return;
    b.disabled = true;
    void Promise.resolve(onClick()).finally(() => {
      b.disabled = false;
    });
  });
  return b;
}

/* ---------- icons ---------- */
const PATHS: Record<string, string> = {
  home: 'M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M4 5h16M4 10h16M4 15h16M4 20h10',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  briefcase: 'M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5M17 11.5a3 3 0 1 0 0-6M18 20c0-2.1-.7-3.8-1.9-5',
  bell: 'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6M9.5 19a2.5 2.5 0 0 0 5 0',
  activity: 'M3 12h4l3 7 4-14 3 7h4',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.3 1a8 8 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a8 8 0 0 0-1.7 1l-2.3-1-2 3.4L6.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 1.7 1l.4 2.5h4l.4-2.5a8 8 0 0 0 1.7-1l2.3 1 2-3.4z',
  check: 'm4 12.5 5 5 11-11',
  alert: 'M12 4v9m0 3.5v.5M12 3 2 20h20z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3.5 2',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4',
  star: 'm12 4 2.4 5 5.6.8-4 4 1 5.5-5-2.7-5 2.7 1-5.5-4-4 5.6-.8z',
  plus: 'M12 5v14M5 12h14',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
};

export function icon(name: keyof typeof PATHS | string, size = 18): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? PATHS.list!);
  svg.append(path);
  return svg;
}

/* ---------- formatting ---------- */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Status always carries a word, never colour alone (specification 16.9): a red pill and an amber pill are the
 * same pill to a person who cannot tell them apart.
 */
export function pill(label: string, tone: 'violet' | 'green' | 'amber' | 'red' | 'blue' | 'grey' = 'violet'): HTMLElement {
  return el('span', { class: tone === 'violet' ? 'pill' : `pill pill-${tone}` }, [label]);
}

/**
 * A progress bar is drawn only for verified steps. When the site gives no step count there is no bar — a bar that
 * advances on elapsed time teaches the person that the screen is guessing.
 */
export function progress(percent: number | null, label: string, tone: 'violet' | 'green' | 'amber' = 'violet'): HTMLElement {
  if (percent === null) return el('span', { class: 'bar-none' }, [label]);
  const bar = div(tone === 'green' ? 'bar bar-done' : tone === 'amber' ? 'bar bar-wait' : 'bar', [
    el('span', { style: `width:${Math.max(0, Math.min(100, percent))}%` }),
  ]);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuenow', String(percent));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-label', label);
  return bar;
}

export function metric(iconName: string, label: string, value: string | number, note?: string, good = false): HTMLElement {
  return div('card metric', [
    div('metric-icon', [icon(iconName, 19)]),
    div('', [
      text('div', 'metric-label', label),
      text('div', 'metric-value', String(value)),
      note ? text('div', good ? 'metric-note good' : 'metric-note', note) : null,
    ]),
  ]);
}

export function card(
  title: string,
  options: { sub?: string | undefined; link?: HTMLElement | undefined; body: (Node | string | null | false)[] },
): HTMLElement {
  return div('card', [
    div('card-head', [
      div('', [text('div', 'card-title', title), options.sub ? text('div', 'card-sub', options.sub) : null]),
      options.link ? div('card-link', [options.link]) : null,
    ]),
    ...options.body,
  ]);
}

export function empty(title: string, body: string, action?: HTMLElement): HTMLElement {
  return div('empty', [
    text('div', 'empty-title', title),
    text('p', '', body),
    action ? div('', [el('div', { style: 'height:16px' }), action]) : null,
  ]);
}

/**
 * Every form control carries a stable key. Re-rendering replaces the DOM, and without a key there is no way to
 * put the person's caret and half-typed text back where they were — which is the difference between a screen
 * that updates underneath you and one that eats what you are typing.
 */
export const FIELD_KEY = 'data-k';

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

function keyed<T extends HTMLElement>(node: T, attrs: Attrs): T {
  if (node.getAttribute(FIELD_KEY)) return node;
  const derived = attrs['data-k'] ?? attrs['aria-label'] ?? attrs.name ?? attrs.placeholder;
  if (derived) node.setAttribute(FIELD_KEY, slug(String(derived)));
  return node;
}

export function field(label: string, input: HTMLElement): HTMLElement {
  // A control inside a labelled field inherits the label as its key when it has none of its own.
  if (!input.getAttribute(FIELD_KEY)) input.setAttribute(FIELD_KEY, slug(label));
  return el('label', { class: 'field' }, [text('span', 'field-label', label), input]);
}

export function input(value: string, attrs: Attrs = {}): HTMLInputElement {
  return keyed(el('input', { class: 'input', value, ...attrs }), attrs);
}

export function select(options: { value: string; label: string }[], value: string, attrs: Attrs = {}): HTMLSelectElement {
  const s = keyed(el('select', { class: 'input', ...attrs }), attrs);
  for (const o of options) s.append(el('option', { value: o.value, selected: o.value === value }, [o.label]));
  return s;
}

/* ---------- keeping what the person typed ---------- */
export interface FormSnapshot {
  values: Map<string, string>;
  checked: Map<string, boolean>;
  focusKey?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  scrollY: number;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const controls = (root: ParentNode): Control[] => [
  ...root.querySelectorAll<Control>(`input[${FIELD_KEY}], textarea[${FIELD_KEY}], select[${FIELD_KEY}]`),
];

/** True while the person is in a form control, so a background refresh can wait rather than interrupt them. */
export function isEditing(root: ParentNode): boolean {
  const active = document.activeElement;
  if (!active || !(root as Element).contains?.(active)) return false;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
}

/** Records what is on screen and where the caret is, immediately before the DOM is replaced. */
export function snapshotForm(root: ParentNode): FormSnapshot {
  const snap: FormSnapshot = { values: new Map(), checked: new Map(), scrollY: window.scrollY };
  const active = document.activeElement;
  for (const node of controls(root)) {
    const key = node.getAttribute(FIELD_KEY)!;
    if (node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio')) snap.checked.set(key, node.checked);
    else snap.values.set(key, node.value);
    if (node === active) {
      snap.focusKey = key;
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        // Selection is unavailable on some input types (date, number); reading it there throws.
        try {
          snap.selectionStart = node.selectionStart;
          snap.selectionEnd = node.selectionEnd;
        } catch {
          snap.selectionStart = null;
        }
      }
    }
  }
  return snap;
}

/**
 * Puts the person's own text back after a re-render.
 *
 * A control whose fresh value differs from what was on screen has been edited but not saved, so the edit wins —
 * discarding it would silently throw away typing. A control the person never touched takes the new value, which
 * is how saved changes and background updates still show up.
 */
export function restoreForm(root: ParentNode, snap: FormSnapshot): void {
  for (const node of controls(root)) {
    const key = node.getAttribute(FIELD_KEY)!;
    if (node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio')) {
      const was = snap.checked.get(key);
      if (was !== undefined && was !== node.defaultChecked) node.checked = was;
      continue;
    }
    const was = snap.values.get(key);
    // A select's options are rebuilt from fresh state, so only text controls carry an unsaved edit forward.
    const fresh = node instanceof HTMLSelectElement ? node.value : node.defaultValue;
    if (was !== undefined && was !== node.value && was !== fresh) node.value = was;
    if (key === snap.focusKey) {
      node.focus({ preventScroll: true });
      if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && snap.selectionStart != null) {
        try {
          node.setSelectionRange(snap.selectionStart, snap.selectionEnd ?? snap.selectionStart);
        } catch {
          // Not every input type supports a caret position; focus alone is enough there.
        }
      }
    }
  }
  if (snap.scrollY) window.scrollTo({ top: snap.scrollY });
}
