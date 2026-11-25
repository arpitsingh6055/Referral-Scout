/**
 * Isolated Closed-Shadow-DOM Floating HUD for injected host pages (LinkedIn / ATS job forms).
 *
 * Uses a custom tag (`referral-scout-hud`), `attachShadow({ mode: 'closed' })`, and constructable
 * `CSSStyleSheet` (`:host { all: initial; ... z-index: 2147483647 }`) so host CSS (LinkedIn,
 * Greenhouse, Lever, Workday, or Tailwind resets) cannot alter typography, sizing, or stacking, and
 * ad-blocker `div[style*="z-index"]` rules do not match it.
 */

export interface PageHudPayload {
  status: 'running' | 'waiting' | 'error' | 'done';
  percent: number;
  label: string;
  detail?: string;
  askCount?: number;
}

const FONT = "font:500 12.5px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;box-sizing:border-box";

let root: ShadowRoot | null = null;
let cardEl: HTMLElement | null = null;
let fillEl: HTMLElement | null = null;
let pctEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let detailEl: HTMLElement | null = null;
let jumpBtn: HTMLButtonElement | null = null;
let closeBtn: HTMLButtonElement | null = null;
let dismissed = false;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function ensureHost(): boolean {
  if (root && document.contains(root.host)) return true;
  if (!document.body || typeof CSSStyleSheet !== 'function') return false;

  const host = document.createElement('referral-scout-hud');
  root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    `:host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;display:block;max-width:calc(100vw - 32px);color-scheme:light dark}` +
      `.box{${FONT};width:312px;max-width:calc(100vw - 32px);background:rgba(15,23,42,0.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f8fafc;border:1px solid rgba(148,163,184,0.28);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.34);overflow:hidden}` +
      `.row{display:flex;align-items:center;gap:10px;padding:10px 12px}` +
      `.pct{${FONT};font-variant-numeric:tabular-nums;font-weight:700;font-size:12px;color:#c4b5fd;min-width:34px;text-align:right;flex:none}` +
      `.copy{flex:1;min-width:0}` +
      `.title{${FONT};font-weight:600;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` +
      `.sub{${FONT};font-size:11.5px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}` +
      `.btn{${FONT};border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.12);color:#ffffff;border-radius:7px;padding:5px 9px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap}` +
      `.btn:hover{background:rgba(255,255,255,0.2)}` +
      `.close{${FONT};border:0;background:transparent;color:#94a3b8;font-size:15px;line-height:1;padding:2px 4px;cursor:pointer;border-radius:6px}` +
      `.close:hover{color:#fff;background:rgba(255,255,255,0.12)}` +
      `.track{height:3px;background:rgba(255,255,255,0.12)}` +
      `.fill{display:block;height:100%;background:#7c66ff;transition:width 180ms cubic-bezier(0.16,1,0.3,1)}` +
      `.box.done .fill,.box.done .pct{background:#10b981;color:#6ee7b7}` +
      `.box.done .pct{background:transparent}` +
      `.box.err .fill{background:#ef4444}` +
      `.box.err .pct{color:#fca5a5}`,
  );
  root.adoptedStyleSheets = [sheet];

  cardEl = document.createElement('div');
  cardEl.className = 'box';

  const row = document.createElement('div');
  row.className = 'row';

  pctEl = document.createElement('span');
  pctEl.className = 'pct';

  const copy = document.createElement('div');
  copy.className = 'copy';
  titleEl = document.createElement('div');
  titleEl.className = 'title';
  detailEl = document.createElement('div');
  detailEl.className = 'sub';
  copy.append(titleEl, detailEl);

  jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.className = 'btn';
  jumpBtn.textContent = 'Next gap';
  jumpBtn.addEventListener('click', () => {
    const target = document.querySelector<HTMLElement>('[data-rs-mark="you"], [data-rs-mark="check"]');
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    target?.focus?.({ preventScroll: true });
  });

  closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Hide progress overlay');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    dismissed = true;
    cardEl!.style.display = 'none';
  });

  row.append(pctEl, copy, jumpBtn, closeBtn);
  const track = document.createElement('div');
  track.className = 'track';
  fillEl = document.createElement('span');
  fillEl.className = 'fill';
  track.append(fillEl);

  cardEl.append(row, track);
  root.append(cardEl);
  document.body.append(host);
  return true;
}

/** Shows or updates the isolated page overlay HUD; auto-dismisses cleanly 8s after `done`. */
export function updatePageHud(payload: PageHudPayload): void {
  clearTimeout(hideTimer);
  if (payload.status === 'running') dismissed = false;
  if (dismissed || !ensureHost() || !cardEl || !fillEl || !pctEl || !titleEl || !detailEl || !jumpBtn) return;

  cardEl.style.display = 'block';
  cardEl.className = `box${payload.status === 'done' ? ' done' : payload.status === 'error' ? ' err' : ''}`;
  const pct = Math.max(0, Math.min(100, Math.round(payload.percent)));
  pctEl.textContent = `${pct}%`;
  fillEl.style.width = `${pct}%`;
  titleEl.textContent = payload.label;
  detailEl.textContent =
    payload.detail ?? (payload.status === 'waiting' ? 'Click Next gap to jump to highlighted field' : 'Referral Scout Autofill');
  jumpBtn.hidden = payload.status === 'running' && !(payload.askCount && payload.askCount > 0);

  if (payload.status === 'done') {
    hideTimer = setTimeout(() => {
      if (cardEl) cardEl.style.display = 'none';
    }, 8000);
  }
}
