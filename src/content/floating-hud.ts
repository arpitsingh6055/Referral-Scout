/**
 * Isolated Closed-Shadow-DOM Floating HUD for injected host pages (LinkedIn / ATS job forms).
 *
 * Dual-mode on host pages:
 * 1. Form Autofill HUD (`updatePageHud`) when filling LinkedIn/ATS forms.
 * 2. Floating Wayfinding Re-Entry Pill (`initInPageWayfindingHud`) whenever an active Referral Scout
 *    mission is running or awaiting review while the Chrome Side Panel is closed (`!mission.isSidePanelOpen`),
 *    allowing 1-click Side Panel recovery directly from the web page without toolbar-icon hunting.
 */

import { getCachedActiveMission, readActiveMission, subscribeActiveMission, type ActiveMissionState } from '../shared/progress-store';

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
let miniPillBtn: HTMLButtonElement | null = null;
let dismissed = false;
let minimized = false;
let hasApplyOverride = false;
let currentMode: 'apply' | 'wayfinding' = 'apply';
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let wayfindingInitialized = false;

function openControlsFromPage(): void {
  try {
    void (globalThis as { chrome?: typeof chrome }).chrome?.runtime
      ?.sendMessage?.({ kind: 'surface', action: 'open-panel' })
      ?.catch?.(() => {
        void (globalThis as { chrome?: typeof chrome }).chrome?.runtime
          ?.sendMessage?.({ type: 'OPEN_SIDE_PANEL' })
          ?.catch?.(() => undefined);
      });
  } catch {
    // Ignore when extension runtime is unavailable in unit tests.
  }
}

function ensureHost(): boolean {
  if (root && document.contains(root.host)) return true;
  if (!document.body || typeof CSSStyleSheet !== 'function') return false;

  const host = document.createElement('referral-scout-hud');
  root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    `:host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;display:block;max-width:calc(100vw - 32px);color-scheme:light dark}` +
      `.box{${FONT};width:336px;max-width:calc(100vw - 32px);background:rgba(15,23,42,0.94);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f8fafc;border:1px solid rgba(148,163,184,0.28);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.34);overflow:hidden}` +
      `.row{display:flex;align-items:center;gap:10px;padding:10px 12px}` +
      `.pct{${FONT};font-variant-numeric:tabular-nums;font-weight:700;font-size:12px;color:#c4b5fd;min-width:34px;text-align:right;flex:none}` +
      `.copy{flex:1;min-width:0}` +
      `.title{${FONT};font-weight:600;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` +
      `.sub{${FONT};font-size:11.5px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}` +
      `.btn{${FONT};border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.14);color:#ffffff;border-radius:7px;padding:5px 9px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap}` +
      `.btn:hover{background:rgba(255,255,255,0.24)}` +
      `.close{${FONT};border:0;background:transparent;color:#94a3b8;font-size:15px;line-height:1;padding:2px 4px;cursor:pointer;border-radius:6px}` +
      `.close:hover{color:#fff;background:rgba(255,255,255,0.12)}` +
      `.track{height:3px;background:rgba(255,255,255,0.12)}` +
      `.fill{display:block;height:100%;background:#7c66ff;transition:width 180ms cubic-bezier(0.16,1,0.3,1)}` +
      `.box.done .fill,.box.done .pct{background:#10b981;color:#6ee7b7}` +
      `.box.done .pct{background:transparent}` +
      `.box.err .fill{background:#ef4444}` +
      `.box.err .pct{color:#fca5a5}` +
      `.mini{${FONT};display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(15,23,42,0.92);color:#f8fafc;border:1px solid rgba(148,163,184,0.32);box-shadow:0 8px 24px rgba(0,0,0,0.28);font-weight:600;font-size:12px;cursor:pointer}`,
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
    if (currentMode === 'wayfinding') {
      openControlsFromPage();
      return;
    }
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
    if (currentMode === 'wayfinding') {
      minimized = true;
      renderWayfinding(getCachedActiveMission());
      return;
    }
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

  miniPillBtn = document.createElement('button');
  miniPillBtn.type = 'button';
  miniPillBtn.className = 'mini';
  miniPillBtn.style.display = 'none';
  miniPillBtn.addEventListener('click', () => {
    minimized = false;
    openControlsFromPage();
    renderWayfinding(getCachedActiveMission());
  });

  root.append(cardEl, miniPillBtn);
  document.body.append(host);
  return true;
}

/** Shows or updates the isolated page overlay HUD; auto-dismisses cleanly 8s after `done`. */
export function updatePageHud(payload: PageHudPayload): void {
  clearTimeout(hideTimer);
  currentMode = 'apply';
  hasApplyOverride = payload.status !== 'done';
  if (payload.status === 'running') dismissed = false;
  if (dismissed || !ensureHost() || !cardEl || !fillEl || !pctEl || !titleEl || !detailEl || !jumpBtn || !miniPillBtn) return;

  miniPillBtn.style.display = 'none';
  cardEl.style.display = 'block';
  cardEl.className = `box${payload.status === 'done' ? ' done' : payload.status === 'error' ? ' err' : ''}`;
  const pct = Math.max(0, Math.min(100, Math.round(payload.percent)));
  pctEl.textContent = `${pct}%`;
  fillEl.style.width = `${pct}%`;
  titleEl.textContent = payload.label;
  detailEl.textContent =
    payload.detail ?? (payload.status === 'waiting' ? 'Click Next gap to jump to highlighted field' : 'Referral Scout Autofill');
  jumpBtn.textContent = 'Next gap';
  jumpBtn.hidden = payload.status === 'running' && !(payload.askCount && payload.askCount > 0);

  if (payload.status === 'done') {
    hideTimer = setTimeout(() => {
      hasApplyOverride = false;
      if (cardEl) cardEl.style.display = 'none';
      renderWayfinding(getCachedActiveMission());
    }, 8000);
  }
}

/** Renders or hides the non-intrusive Shadow DOM Re-Entry Pill when the Side Panel is closed on a host tab. */
export function renderWayfinding(mission: ActiveMissionState): void {
  if (hasApplyOverride) return;
  const shouldShow = !mission.isSidePanelOpen && (mission.active || mission.pendingBlockerCount > 0);
  if (!shouldShow) {
    if (cardEl) cardEl.style.display = 'none';
    if (miniPillBtn) miniPillBtn.style.display = 'none';
    return;
  }
  if (!ensureHost() || !cardEl || !fillEl || !pctEl || !titleEl || !detailEl || !jumpBtn || !miniPillBtn) return;
  currentMode = 'wayfinding';
  const pct = Math.max(0, Math.min(100, Math.round(mission.percent || 25)));

  if (minimized) {
    cardEl.style.display = 'none';
    miniPillBtn.style.display = 'inline-flex';
    miniPillBtn.textContent = `RS · ${pct}% Open Controls →`;
    return;
  }

  miniPillBtn.style.display = 'none';
  cardEl.style.display = 'block';
  cardEl.className = 'box';
  pctEl.textContent = `${pct}%`;
  fillEl.style.width = `${pct}%`;
  titleEl.textContent = `RS · ${mission.stageLabel}`;
  detailEl.textContent = `${mission.liveSummary} · Side Panel closed`;
  jumpBtn.hidden = false;
  jumpBtn.textContent = 'Open Controls →';
}

/** Boots the cross-surface in-page wayfinding pill on LinkedIn & supported ATS domains. */
export function initInPageWayfindingHud(): void {
  if (wayfindingInitialized || typeof document === 'undefined' || typeof location === 'undefined') return;
  if (location.protocol === 'chrome-extension:' || location.protocol === 'about:') return;
  wayfindingInitialized = true;
  void readActiveMission()
    .then(renderWayfinding)
    .catch(() => undefined);
  subscribeActiveMission(renderWayfinding);
}
