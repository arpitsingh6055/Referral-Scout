/**
 * Standardized UI primitives and safe DOM helpers for the workbench.
 *
 * Built strictly with DOM nodes rather than HTML string concatenation so external job/company/question text can
 * never be parsed as markup. Controls enforce uniform heights (32px / 36px / 40px), accessible focus/ARIA state,
 * skeleton loaders, empty states, search bars, inline field validation, and focus-trapped modals.
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

let actionInFlight = 0;

/** Creates a button matching the design-system height/variant tokens and duplicate-submit protection. */
export function button(label: string, className: string, onClick: () => void | Promise<void>, attrs: Attrs = {}): HTMLButtonElement {
  const allowDuringAction = attrs['data-allow-during-action'] === true;
  const b = el('button', { class: className, type: 'button', ...attrs });
  // Keep the label as its own text node so optional leading icons stay intact during busy updates.
  const labelNode = document.createTextNode(label);
  b.append(labelNode);
  if (actionInFlight > 0 && !allowDuringAction) {
    b.classList.add('action-locked');
    b.setAttribute('aria-disabled', 'true');
  }
  b.addEventListener('click', () => {
    if (b.disabled || (actionInFlight > 0 && !allowDuringAction)) return;
    b.disabled = true;
    actionInFlight += 1;
    let asynchronous = false;
    void Promise.resolve()
      .then(() => {
        const result = onClick();
        if (result && typeof (result as Promise<void>).then === 'function') {
          asynchronous = true;
          const busyLabel = typeof attrs['data-busy-label'] === 'string' ? String(attrs['data-busy-label']) : 'Working…';
          labelNode.nodeValue = busyLabel;
          b.setAttribute('aria-busy', 'true');
          window.dispatchEvent(
            new CustomEvent('referral-scout-action-start', {
              detail: typeof attrs['data-progress'] === 'string' ? String(attrs['data-progress']) : 'Working…',
            }),
          );
          return Promise.resolve(result).finally(() => {
            labelNode.nodeValue = label;
            b.removeAttribute('aria-busy');
            actionInFlight = Math.max(0, actionInFlight - 1);
            if (actionInFlight === 0) window.dispatchEvent(new CustomEvent('referral-scout-action-end'));
          });
        }
        return result;
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : 'That action could not be completed. Please try again.';
        window.dispatchEvent(new CustomEvent('referral-scout-action-error', { detail: message }));
      })
      .finally(() => {
        if (!asynchronous) {
          actionInFlight = Math.max(0, actionInFlight - 1);
          if (actionInFlight === 0) window.dispatchEvent(new CustomEvent('referral-scout-action-end'));
        }
        b.disabled = false;
        b.removeAttribute('aria-busy');
        labelNode.nodeValue = label;
      });
  });
  return b;
}

/** Creates an accessible icon-only button (`sm: 32px` or `md: 36px`) with a required `aria-label`. */
export function iconButton(
  iconName: string,
  ariaLabel: string,
  onClick: () => void | Promise<void>,
  options: { size?: 'sm' | 'md'; variant?: 'ghost' | 'secondary' | 'danger'; allowDuringAction?: boolean } = {},
): HTMLButtonElement {
  const sizeClass = options.size === 'sm' ? 'btn-sm ' : '';
  const variantClass = options.variant === 'danger' ? 'btn-danger ' : options.variant === 'secondary' ? '' : 'btn-ghost ';
  const b = button('', `btn ${variantClass}${sizeClass}btn-icon`.trim(), onClick, {
    'aria-label': ariaLabel,
    title: ariaLabel,
    ...(options.allowDuringAction ? { 'data-allow-during-action': true } : {}),
  });
  b.replaceChildren(icon(iconName, options.size === 'sm' ? 15 : 17));
  return b;
}

/** Runs non-button work (for example, a file chooser) through the shared action feedback and lock guard. */
export async function withActionFeedback<T>(message: string, work: () => Promise<T>): Promise<T> {
  if (actionInFlight > 0) throw new Error('Another Referral Scout action is still running. Please wait for it to finish.');
  actionInFlight += 1;
  window.dispatchEvent(new CustomEvent('referral-scout-action-start', { detail: message || 'Working…' }));
  try {
    return await work();
  } finally {
    actionInFlight = Math.max(0, actionInFlight - 1);
    if (actionInFlight === 0) window.dispatchEvent(new CustomEvent('referral-scout-action-end'));
  }
}

/* ---------- icons ---------- */
const PATHS: Record<string, string> = {
  home: 'M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4M16 16l5 5',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5M17 11.5a3 3 0 1 0 0-6M18 20c0-2.1-.7-3.8-1.9-5',
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
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6l-12 12',
  chevronRight: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  external: 'M14 5h5v5M10 14 19 5M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v5M12 8h.01',
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

/* ---------- feedback & display primitives ---------- */
export function pill(label: string, tone: 'violet' | 'green' | 'amber' | 'red' | 'blue' | 'grey' = 'violet'): HTMLElement {
  return el('span', { class: tone === 'violet' ? 'pill' : `pill pill-${tone}` }, [label]);
}

export const badge = pill;

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
    div('metric-icon', [icon(iconName, 18)]),
    div('metric-copy', [
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
      div('card-head-copy', [text('div', 'card-title', title), options.sub ? text('div', 'card-sub', options.sub) : null]),
      options.link ? div('card-link', [options.link]) : null,
    ]),
    ...options.body,
  ]);
}

/** Structured empty state with an icon badge, clear explanation, and optional primary CTA. */
export function emptyState(options: { icon?: string; title: string; description: string; action?: HTMLElement | undefined }): HTMLElement {
  return div('empty', [
    div('empty-icon', [icon(options.icon ?? 'search', 20)]),
    text('div', 'empty-title', options.title),
    text('p', 'empty-body', options.description),
    options.action ? div('empty-action', [options.action]) : null,
  ]);
}

export function empty(title: string, body: string, action?: HTMLElement): HTMLElement {
  return emptyState({ title, description: body, action });
}

/** Geometry-matched skeleton block for async surface loading without jarring plain text. */
export function skeleton(width = '100%', height = '14px', radius = 'var(--radius-sm)'): HTMLElement {
  const block = el('span', { class: 'skeleton', 'aria-hidden': 'true' });
  block.style.width = width;
  block.style.height = height;
  block.style.borderRadius = radius;
  return block;
}

/** Initial workbench boot skeleton mirroring metrics + split workspace cards. */
export function pageSkeleton(): HTMLElement {
  const metricCard = () =>
    div('card metric', [
      skeleton('36px', '36px', 'var(--radius-md)'),
      div('stack-xs', [skeleton('84px', '12px'), skeleton('48px', '26px'), skeleton('110px', '11px')]),
    ]);
  const listCard = () =>
    div('card stack', [
      div('stack-xs', [skeleton('160px', '18px'), skeleton('260px', '12px')]),
      div('rows', [
        div('row row-compact', [
          div('stack-xs', [skeleton('210px', '14px'), skeleton('140px', '12px')]),
          skeleton('72px', '22px', '999px'),
        ]),
        div('row row-compact', [
          div('stack-xs', [skeleton('190px', '14px'), skeleton('130px', '12px')]),
          skeleton('72px', '22px', '999px'),
        ]),
        div('row row-compact', [
          div('stack-xs', [skeleton('230px', '14px'), skeleton('120px', '12px')]),
          skeleton('72px', '22px', '999px'),
        ]),
      ]),
    ]);
  const wrap = div('stack', [
    div('page-head', [div('stack-xs', [skeleton('220px', '28px'), skeleton('340px', '14px')])]),
    div('grid metrics', [metricCard(), metricCard(), metricCard(), metricCard()]),
    div('grid split', [listCard(), listCard()]),
  ]);
  wrap.setAttribute('aria-busy', 'true');
  wrap.setAttribute('aria-label', 'Loading workspace');
  return wrap;
}

/** Standardized 36px search bar with leading magnifier and instant clear action. */
export function searchBar(options: {
  placeholder: string;
  value: string;
  ariaLabel: string;
  onInput: (value: string) => void;
}): HTMLElement {
  const box = el('input', {
    class: 'search-input',
    type: 'search',
    value: options.value,
    placeholder: options.placeholder,
    'aria-label': options.ariaLabel,
  });
  const clearBtn = el('button', { class: 'search-clear', type: 'button', 'aria-label': 'Clear search' }, [icon('close', 14)]);
  clearBtn.hidden = !options.value;
  box.addEventListener('input', () => {
    clearBtn.hidden = !box.value;
    options.onInput(box.value);
  });
  clearBtn.addEventListener('click', () => {
    box.value = '';
    clearBtn.hidden = true;
    options.onInput('');
    box.focus();
  });
  return div('search-bar', [icon('search', 15), box, clearBtn]);
}

/** Accessible, focus-trapped confirmation modal with Esc/backdrop dismissal. */
export function confirmModal(options: {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}): Promise<boolean> {
  return new Promise(resolve => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const titleId = `rs-modal-title-${Math.random().toString(36).slice(2, 8)}`;
    const descId = `rs-modal-desc-${Math.random().toString(36).slice(2, 8)}`;

    const backdrop = div('modal-backdrop');
    const dialog = el('div', {
      class: 'modal-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': descId,
    });

    const close = (confirmed: boolean): void => {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      previousFocus?.focus();
      resolve(confirmed);
    };

    const cancelBtn = el('button', { class: 'btn', type: 'button' }, [options.cancelLabel ?? 'Cancel']);
    cancelBtn.addEventListener('click', () => close(false));

    const confirmBtn = el(
      'button',
      {
        class: options.tone === 'danger' ? 'btn btn-danger-solid' : 'btn btn-primary',
        type: 'button',
      },
      [options.confirmLabel ?? 'Confirm'],
    );
    confirmBtn.addEventListener('click', () => close(true));

    const closeIcon = el('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': 'Close dialog' }, [
      icon('close', 16),
    ]);
    closeIcon.addEventListener('click', () => close(false));

    dialog.append(
      div('modal-head', [el('h2', { id: titleId, class: 'modal-title' }, [options.title]), closeIcon]),
      div('modal-body', [el('p', { id: descId, class: 'modal-desc' }, [options.description])]),
      div('modal-foot', [cancelBtn, confirmBtn]),
    );
    backdrop.append(dialog);
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) close(false);
    });

    const focusables = (): HTMLElement[] => [
      ...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'),
    ];

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
        return;
      }
      if (e.key === 'Tab') {
        const list = focusables();
        if (!list.length) return;
        const first = list[0]!;
        const last = list[list.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.body.append(backdrop);
    (options.tone === 'danger' ? cancelBtn : confirmBtn).focus();
  });
}

/* ---------- form controls & preservation ---------- */
export const FIELD_KEY = 'data-k';

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

function keyed<T extends HTMLElement>(node: T, attrs: Attrs): T {
  if (node.getAttribute(FIELD_KEY)) return node;
  const derived = attrs['data-k'] ?? attrs.name ?? attrs['aria-label'];
  if (derived) node.setAttribute(FIELD_KEY, slug(String(derived)));
  return node;
}

export function field(label: string, control: HTMLElement, options: { help?: string; error?: string } = {}): HTMLElement {
  if (!control.getAttribute(FIELD_KEY)) control.setAttribute(FIELD_KEY, slug(label));
  const errorEl = text('span', 'field-error', options.error ?? '');
  errorEl.hidden = !options.error;
  if (options.error) control.classList.add('is-invalid');
  return el('label', { class: 'field' }, [
    text('span', 'field-label', label),
    control,
    options.help ? text('span', 'field-help', options.help) : null,
    errorEl,
  ]);
}

/** Sets or clears inline validation error state directly underneath a field control. */
export function setFieldError(control: HTMLElement, message = ''): void {
  control.classList.toggle('is-invalid', !!message);
  if (message) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
  const err = control.closest('.field')?.querySelector<HTMLElement>('.field-error');
  if (err) {
    err.textContent = message;
    err.hidden = !message;
  }
}

export function input(value: string, attrs: Attrs = {}): HTMLInputElement {
  return keyed(el('input', { class: 'input', value, ...attrs }), attrs);
}

export function select(options: { value: string; label: string }[], value: string, attrs: Attrs = {}): HTMLSelectElement {
  const s = keyed(el('select', { class: 'input', ...attrs }), attrs);
  for (const o of options) s.append(el('option', { value: o.value, selected: o.value === value }, [o.label]));
  return s;
}

export interface FormSnapshot {
  values: Map<string, string>;
  defaults: Map<string, string>;
  dirty: Set<string>;
  checked: Map<string, boolean>;
  checkedDefaults: Map<string, boolean>;
  focusKey?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  scrollY: number;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const controls = (root: ParentNode): Control[] => [
  ...root.querySelectorAll<Control>(`input[${FIELD_KEY}], textarea[${FIELD_KEY}], select[${FIELD_KEY}]`),
];

export function isEditing(root: ParentNode): boolean {
  const active = document.activeElement;
  if (!active || !(root as Element).contains?.(active)) return false;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
}

export function snapshotForm(root: ParentNode): FormSnapshot {
  const snap: FormSnapshot = {
    values: new Map(),
    defaults: new Map(),
    dirty: new Set(),
    checked: new Map(),
    checkedDefaults: new Map(),
    scrollY: window.scrollY,
  };
  const active = document.activeElement;
  for (const node of controls(root)) {
    const key = node.getAttribute(FIELD_KEY)!;
    if (node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio')) {
      snap.checked.set(key, node.checked);
      snap.checkedDefaults.set(key, node.defaultChecked);
      if (node.checked !== node.defaultChecked) snap.dirty.add(key);
    } else {
      const def = node instanceof HTMLSelectElement ? ([...node.options].find(o => o.defaultSelected)?.value ?? '') : node.defaultValue;
      snap.values.set(key, node.value);
      snap.defaults.set(key, def);
      if (node.value !== def) snap.dirty.add(key);
    }
    if (node === active) {
      snap.focusKey = key;
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
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

export function restoreForm(root: ParentNode, snap: FormSnapshot): void {
  for (const node of controls(root)) {
    const key = node.getAttribute(FIELD_KEY)!;
    if (node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio')) {
      const was = snap.checked.get(key);
      // Only restore checkboxes the user actually modified while preserving backend-driven default updates.
      if (snap.dirty.has(key) && was !== undefined && node.defaultChecked === snap.checkedDefaults.get(key)) {
        node.checked = was;
      }
      continue;
    }
    const was = snap.values.get(key);
    const prevDef = snap.defaults.get(key);
    const fresh = node instanceof HTMLSelectElement ? node.value : node.defaultValue;
    // Never overwrite a clean control or a backend-populated value (e.g., "" -> "ARPIT SINGH" after AI approval).
    if (snap.dirty.has(key) && was !== undefined && was !== node.value && prevDef === fresh) {
      node.value = was;
    }
    if (key === snap.focusKey) {
      node.focus({ preventScroll: true });
      if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && snap.selectionStart != null) {
        try {
          node.setSelectionRange(snap.selectionStart, snap.selectionEnd ?? snap.selectionStart);
        } catch {
          // Input type does not support caret placement.
        }
      }
    }
  }
  if (snap.scrollY) window.scrollTo({ top: snap.scrollY });
}

function safeHttpUrl(rawUrl: string | undefined | null): { href: string; host: string } | null {
  if (!rawUrl) return null;
  if (typeof URL === 'function') {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      return { href: u.href, host: u.hostname };
    } catch {
      return null;
    }
  }
  const m = /^(https?:\/\/([^/?#\s]+)\S*)$/i.exec(rawUrl.trim());
  return m ? { href: m[1]!, host: m[2]! } : null;
}

/** Validated external link opening in a new tab with rel="noopener noreferrer", or plain text if URL is missing/invalid. */
export function externalLink(label: string, rawUrl: string | undefined | null, className = 'cell-link'): HTMLElement {
  const parsed = safeHttpUrl(rawUrl);
  if (!parsed) return text('span', className, label);
  return el(
    'a',
    {
      href: parsed.href,
      target: '_blank',
      rel: 'noopener noreferrer',
      class: className,
      title: `${label} (${parsed.host})`,
    },
    [label],
  );
}

/** One-click copy-link button with accessible status feedback. */
export function copyLinkButton(rawUrl: string | undefined | null, label = 'Copy link'): HTMLElement | null {
  const parsed = safeHttpUrl(rawUrl);
  if (!parsed) return null;
  const b = el(
    'button',
    { type: 'button', class: 'btn btn-sm btn-ghost', title: `Copy ${parsed.href}`, 'aria-label': `${label}: ${parsed.href}` },
    [label],
  );
  b.addEventListener('click', () => {
    void navigator.clipboard?.writeText(parsed.href).then(
      () => {
        b.textContent = 'Copied ✓';
        setTimeout(() => {
          b.textContent = label;
        }, 1800);
      },
      () => undefined,
    );
  });
  return b;
}

/** Recoverable error state replacing dead-end "reload the extension" messages. */
export function errorStateWithRetry(title: string, detail: string, onRetry: () => void | Promise<void>): HTMLElement {
  return el('div', { class: 'empty', role: 'status' }, [
    icon('alert', 24),
    text('h3', 'empty-title', title),
    text('p', 'empty-desc', detail || 'Something interrupted loading this view. Try again to refresh your local data.'),
    button('Retry', 'btn btn-primary', onRetry),
  ]);
}

export { preserveViewportState, shouldSkipRenderWhileEditing } from '../render';

/** Accessible pagination bar for large datasets (1,000+ rows). */
export function paginateControls(total: number, page: number, pageSize: number, onChange: (nextPage: number) => void): HTMLElement | null {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);
  return div('pager-bar', [
    text('span', 'cell-muted', `Showing ${start}–${end} of ${total}`),
    div('inline', [
      button('Previous', 'btn btn-sm', () => onChange(safePage - 1), { disabled: safePage <= 1 }),
      text('span', 'cell-muted', `Page ${safePage} of ${totalPages}`),
      button('Next', 'btn btn-sm', () => onChange(safePage + 1), { disabled: safePage >= totalPages }),
    ]),
  ]);
}
