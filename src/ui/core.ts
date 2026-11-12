/** Side panel foundations: shared state, small DOM helpers, notifications, buttons and form fields. */
import { type Kit } from './pipeline';
import { appRoot, element, errorText } from './render';
import { type ContactState, type NetworkRequest, type NetworkState } from '../shared/network';
import { createToaster, type ToastKind } from './toast';

export type Tab = 'home' | 'referrals' | 'people' | 'saved' | 'activity' | 'setup';
export const ui = {
  tab: 'home' as Tab,
  filter: 'all',
  open: new Set<string>(),
  /** Set when the last company finishes being searched, until the person has seen the summary. */
  done: null as { people: number; companies: number } | null,
};
export const root = appRoot();
/** What every screen shares: whether something is in progress, whether the person is typing, and the state last drawn. */
export const flags = {
  busy: false,
  dirty: false,
  spoke: false,
  last: null as NetworkState | null,
  signature: '',
  uid: 0,
  maintenance: [] as HTMLElement[],
};
/** The main screen registers how to redraw, so helpers here can ask for it without importing it. */
export let redraw: (s: NetworkState) => void = () => undefined;
export const onRedraw = (fn: (s: NetworkState) => void): void => {
  redraw = fn;
};
export const rerender = (s: NetworkState): void => redraw(s);
export const alertBox = element('div');
alertBox.hidden = true;
export const page = element('div');
root.append(alertBox, page);
export const toaster = createToaster(document.body);

/* ---------- small helpers ---------- */
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const result = element(tag, text);
  result.className = className;
  return result;
}
/* Line icons drawn here, so the panel loads nothing from outside. */
export const ICONS = {
  home: 'M4 11l8-7 8 7M6 10v9h4v-5h4v5h4v-9',
  jobs: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 19c0-3 2.7-5 6-5s6 2 6 5M16 5.2a3 3 0 010 5.6M17.5 14.3c2 .6 3.5 2.3 3.5 4.7',
  saved: 'M7 4h10v16l-5-4-5 4z',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
  check: 'M5 12l4 4 10-10',
};
export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(NS, 'svg'),
    path = document.createElementNS(NS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}
export const csv = (v: string): string[] =>
  v
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
export const optional = (v: string): number | null => (v.trim() ? Number(v) : null);
export const pad = (n: number): string => String(n).padStart(2, '0');
export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map(n => n[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
export const when = (t?: number): string =>
  t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet';
export function ago(t: number): string {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
export function link(text: string, url: string, className = ''): HTMLAnchorElement {
  const a = node('a', text, className);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
export async function request(data: NetworkRequest): Promise<NetworkState> {
  const reply = (await chrome.runtime.sendMessage(data)) as { ok: boolean; data?: NetworkState; error?: string };
  if (!reply?.ok || !reply.data) throw new Error(reply?.error || 'The extension did not respond. Reload it and retry.');
  return reply.data;
}

/* ---------- feedback: toasts for everything, a banner for errors ---------- */
export function notify(kind: ToastKind, message: string): void {
  flags.spoke = true;
  toaster.show(kind, message);
  if (kind === 'error') {
    const dismiss = node('button', 'Dismiss', 'btn sm ghost');
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => {
      alertBox.hidden = true;
    });
    alertBox.className = 'alert';
    alertBox.setAttribute('role', 'alert');
    alertBox.replaceChildren(node('span', message), dismiss);
    alertBox.hidden = false;
  } else alertBox.hidden = true;
}
export const withHint = (m: string): string =>
  /cannot be verified|uncertain|did not return the required|Recover reply/i.test(m) && !/Stuck\?/.test(m)
    ? `${m} Your reply may already be in ChatGPT: open Setup, then "Personalise with ChatGPT", then "Stuck? Recover a ChatGPT reply".`
    : m;
export const aiSteps: [string, string][] = [
  ['queued', 'Preparing the ChatGPT task'],
  ['tab_opened', 'ChatGPT tab opened, waiting for the page'],
  ['current_document_ready', 'ChatGPT page is ready'],
  ['composer_stable', 'Composer is ready'],
  ['prompt_inserted', 'Prompt pasted, checking it is complete'],
  ['insertion_verified', 'Prompt verified, sending it'],
  ['send_clicked', 'Sent, waiting for ChatGPT to accept it'],
  ['user_turn_verified', 'ChatGPT received it, waiting for the reply'],
  ['assistant_streaming', 'ChatGPT is writing the reply'],
  ['completion_verified', 'Reply finished, reading it'],
  ['response_extracted', 'Reply received, validating it'],
];
export async function withProgress<T>(title: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now(),
    toast = toaster.show('progress', `${title}…`);
  flags.spoke = true;
  const poll = setInterval(() => {
    void request({ kind: 'network', action: 'diagnostics' })
      .then(d => {
        const jobs = (d as NetworkState & { diagnostics?: { stage: string; updatedAt: number }[] }).diagnostics ?? [];
        const latest = jobs.filter(j => j.updatedAt >= started - 2000).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (!latest) return;
        const i = aiSteps.findIndex(([k]) => k === latest.stage);
        if (i >= 0) toast.update(`${title}: step ${i + 1} of ${aiSteps.length}. ${aiSteps[i]![1]}…`, 'progress');
      })
      .catch(() => undefined);
  }, 1500);
  try {
    return await run();
  } finally {
    clearInterval(poll);
    toast.close();
  }
}
export function button(text: string, action: () => Promise<void>, className = 'btn', done?: string): HTMLButtonElement {
  const b = node('button', text, className);
  b.type = 'button';
  b.addEventListener('click', () => {
    if (flags.busy) return;
    flags.busy = true;
    b.disabled = true;
    alertBox.hidden = true;
    flags.spoke = false;
    void action()
      .then(() => {
        if (!flags.spoke) notify('success', done ?? `${text}: done.`);
      })
      .catch(e => notify('error', withHint(errorText(e))))
      .finally(() => {
        flags.busy = false;
        b.disabled = false;
      });
  });
  return b;
}
export async function act(data: NetworkRequest, done?: string): Promise<void> {
  const state = await request(data);
  rerender(state);
  notify('success', done ?? (state.status || 'Done.'));
}

export const kit: Kit = { node, button, act };

/* ---------- form building blocks ---------- */
export interface FieldOptions {
  label: string;
  value: string;
  help?: string;
  multiline?: boolean;
  rows?: number;
  type?: string;
  min?: string;
  max?: string;
}
export function field(o: FieldOptions): { wrap: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const id = `f${++flags.uid}`,
    wrap = node('div', '', 'field'),
    label = node('label', o.label, 'field-label');
  label.htmlFor = id;
  const input = o.multiline ? node('textarea', '', 'input') : node('input', '', 'input');
  input.id = id;
  input.value = o.value;
  input.autocomplete = 'off';
  if (input instanceof HTMLTextAreaElement) input.rows = o.rows ?? 3;
  if (input instanceof HTMLInputElement) {
    input.type = o.type ?? 'text';
    if (o.min) input.min = o.min;
    if (o.max) input.max = o.max;
  }
  input.addEventListener('input', () => {
    flags.dirty = true;
  });
  wrap.append(label, input);
  if (o.help) wrap.append(node('p', o.help, 'field-help'));
  return { wrap, input };
}
export function choice(
  label: string,
  value: string,
  options: [string, string][],
  help?: string,
): { wrap: HTMLElement; input: HTMLSelectElement } {
  const id = `f${++flags.uid}`,
    wrap = node('div', '', 'field'),
    l = node('label', label, 'field-label');
  l.htmlFor = id;
  const input = node('select', '', 'input');
  input.id = id;
  for (const [v, name] of options) {
    const opt = node('option', name);
    opt.value = v;
    input.append(opt);
  }
  input.value = value;
  input.addEventListener('change', () => {
    flags.dirty = true;
  });
  wrap.append(l, input);
  if (help) wrap.append(node('p', help, 'field-help'));
  return { wrap, input };
}
export function accordion(key: string, title: string, badge?: string): { box: HTMLDetailsElement; body: HTMLElement } {
  const box = node('details', '', 'acc'),
    summary = node('summary'),
    body = node('div', '', 'acc-body');
  summary.append(node('span', title));
  if (badge) summary.append(node('span', badge, 'chip'));
  box.append(summary, body);
  box.open = ui.open.has(key);
  box.addEventListener('toggle', () => {
    if (box.open) ui.open.add(key);
    else ui.open.delete(key);
  });
  return { box, body };
}
export const bubble = (label: string, text: string, over = false, counter = ''): HTMLElement => {
  const wrap = node('div', '', 'preview'),
    head = node('div', '', 'bubble-label');
  head.append(node('span', label), node('span', counter, over ? 'over' : ''));
  wrap.append(head, node('div', text, 'bubble'));
  return wrap;
};

export const stateLabels: Record<ContactState, string> = {
  found: 'Not contacted',
  shortlisted: 'Queued',
  requesting: 'Inviting',
  pending: 'Invited',
  connected: 'Accepted',
  messaging: 'Sending',
  messaged: 'Introduced',
  attention: 'Needs you',
  skipped: 'Skipped',
  review: 'Needs approval',
};
export const categoryLabels: Record<string, string> = {
  recruiter: 'Recruiter',
  leader: 'Team leader',
  founder: 'Founder',
  senior: 'Senior',
  peer: 'Same team',
  employee: 'Works there',
};
