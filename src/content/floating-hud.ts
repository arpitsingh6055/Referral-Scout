/**
 * Isolated Closed-Shadow-DOM Floating HUD for injected host pages (LinkedIn / ATS job forms).
 *
 * Dual-mode on host pages:
 * 1. Form Autofill HUD (`updatePageHud`) when filling LinkedIn/ATS forms.
 * 2. Floating Wayfinding Re-Entry Pill & Quick-Control Drawer (`initInPageWayfindingHud`) whenever an active
 *    Referral Scout mission is running or awaiting review while the Chrome Side Panel is closed
 *    (`!mission.isSidePanelOpen`), routing all 5 drawer controls through typed `HUD_ACTION_*` messages
 *    with event isolation (`stopPropagation`), service-worker wake-up retry, tactile feedback, and a visual
 *    toolbar-pin callout when Chromium/Edge blocks `chrome.sidePanel.open()` from webpage gestures.
 */

import { getCachedActiveMission, readActiveMission, subscribeActiveMission, type ActiveMissionState } from '../shared/progress-store';

export interface PageHudPayload {
  status: 'running' | 'waiting' | 'error' | 'done';
  percent: number;
  label: string;
  detail?: string;
  askCount?: number;
}

const HUD_ACTIONS = {
  SCAN_JOBS: 'HUD_ACTION_SCAN_JOBS',
  FIND_REFERRERS: 'HUD_ACTION_FIND_REFERRERS',
  TOGGLE_ENGINE: 'HUD_ACTION_TOGGLE_ENGINE',
  OPEN_WORKBENCH: 'HUD_ACTION_OPEN_WORKBENCH',
  OPEN_SIDEPANEL: 'HUD_ACTION_OPEN_SIDEPANEL',
} as const;

interface HudActionReply {
  ok?: boolean;
  active?: boolean;
  opened?: boolean;
  needsToolbarClick?: boolean;
  message?: string;
  error?: string;
}

const FONT = "font:500 12.5px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;box-sizing:border-box";

let hostEl: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let cardEl: HTMLElement | null = null;
let drawerEl: HTMLElement | null = null;
let drawerTitleEl: HTMLElement | null = null;
let drawerPctEl: HTMLElement | null = null;
let drawerTickerEl: HTMLElement | null = null;
let drawerStatusEl: HTMLElement | null = null;
let drawerGuideEl: HTMLElement | null = null;
let drawerTrackEl: HTMLElement | null = null;
let drawerFillEl: HTMLElement | null = null;
let drawerPauseBtn: HTMLButtonElement | null = null;
let fillEl: HTMLElement | null = null;
let trackEl: HTMLElement | null = null;
let pctEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let detailEl: HTMLElement | null = null;
let jumpBtn: HTMLButtonElement | null = null;
let closeBtn: HTMLButtonElement | null = null;
let miniPillBtn: HTMLButtonElement | null = null;
let dismissed = false;
let minimized = false;
let drawerOpen = false;
let hasApplyOverride = false;
let currentMode: 'apply' | 'wayfinding' = 'apply';
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let wayfindingInitialized = false;

function showDrawerStatus(msg: string, isError = false): void {
  if (!drawerStatusEl) return;
  clearTimeout(statusTimer);
  drawerStatusEl.textContent = msg.slice(0, 60);
  drawerStatusEl.className = isError ? 'drawer-status is-err' : 'drawer-status is-ok';
  drawerStatusEl.style.display = 'block';
  statusTimer = setTimeout(() => {
    if (drawerStatusEl) drawerStatusEl.style.display = 'none';
  }, 3500);
}

async function sendHudAction(type: string, extra: Record<string, unknown> = {}, allowRetry = true): Promise<HudActionReply> {
  try {
    const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
    if (!runtime?.sendMessage) return { ok: false, error: 'Extension runtime unavailable' };
    const res = (await runtime.sendMessage({ type, ...extra })) as HudActionReply | undefined;
    return res ?? { ok: false, error: 'No response from background' };
  } catch (err) {
    if (allowRetry) {
      await new Promise(r => setTimeout(r, 120));
      return sendHudAction(type, extra, false);
    }
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 56) : 'Action failed' };
  }
}

function withButtonFeedback(btn: HTMLButtonElement, busyLabel: string, idleLabel: string, task: () => Promise<void>): void {
  btn.disabled = true;
  btn.textContent = busyLabel;
  void task().finally(() => {
    btn.disabled = false;
    if (btn.textContent === busyLabel) btn.textContent = idleLabel;
  });
}

function syncDrawer(mission: ActiveMissionState): void {
  if (!drawerEl || !hostEl) return;
  hostEl.dataset.rsDrawerOpen = String(drawerOpen);
  drawerEl.style.display = drawerOpen ? 'block' : 'none';
  if (!drawerOpen) return;

  const pct = Math.max(0, Math.min(100, Math.round(mission.percent || 25)));
  if (drawerTitleEl) drawerTitleEl.textContent = mission.stageLabel || 'Referral Scout';
  if (drawerPctEl) drawerPctEl.textContent = `${pct}%`;
  if (drawerTickerEl) drawerTickerEl.textContent = mission.liveSummary || 'Synced with Referral Scout';
  if (drawerFillEl) drawerFillEl.style.width = `${pct}%`;
  if (drawerTrackEl) drawerTrackEl.className = mission.active ? 'track is-running' : 'track';
  if (drawerPauseBtn && !drawerPauseBtn.disabled) {
    drawerPauseBtn.textContent = mission.active ? 'Pause Engine' : 'Resume Engine';
  }
}

/** Toggles the instant on-page Shadow-DOM Quick-Control Drawer on LinkedIn. */
export function toggleQuickControlDrawer(force?: boolean): boolean {
  drawerOpen = force !== undefined ? force : !drawerOpen;
  if (drawerOpen) minimized = false;
  if (!ensureHost()) return drawerOpen;
  renderWayfinding(getCachedActiveMission());
  return drawerOpen;
}

function ensureHost(): boolean {
  if (root && document.contains(root.host)) return true;
  if (!document.body || typeof CSSStyleSheet !== 'function') return false;

  hostEl = document.createElement('referral-scout-hud');
  hostEl.dataset.rsDrawerOpen = String(drawerOpen);
  root = hostEl.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    `:host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:10px;max-width:calc(100vw - 32px);color-scheme:light dark}` +
      `@keyframes rs-cd-stripe{from{background-position:0 0}to{background-position:24px 0}}` +
      `@keyframes rs-cd-sheen{0%{transform:translateX(-100%)}100%{transform:translateX(220%)}}` +
      `@keyframes rs-cd-radar{0%{box-shadow:0 0 0 0 rgba(124,102,255,0.6)}70%{box-shadow:0 0 0 7px rgba(124,102,255,0)}100%{box-shadow:0 0 0 0 rgba(124,102,255,0)}}` +
      `@keyframes rs-cd-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}` +
      `.box,.drawer{${FONT};width:348px;max-width:calc(100vw - 32px);background:rgba(15,23,42,0.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#f8fafc;border:1px solid rgba(148,163,184,0.28);border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,0.38);overflow:hidden}` +
      `.row{display:flex;align-items:center;gap:10px;padding:10px 12px}` +
      `.pct{${FONT};font-variant-numeric:tabular-nums;font-weight:700;font-size:12px;color:#c4b5fd;min-width:34px;text-align:right;flex:none}` +
      `.copy{flex:1;min-width:0}` +
      `.title{${FONT};font-weight:600;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` +
      `.sub{${FONT};font-size:11.5px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}` +
      `.btn{${FONT};border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.12);color:#ffffff;border-radius:7px;padding:6px 9px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background 140ms ease}` +
      `.btn:hover:not(:disabled){background:rgba(255,255,255,0.22)}` +
      `.btn:disabled{opacity:0.65;cursor:default}` +
      `.btn-primary{background:#6d54ff;border-color:#7c66ff;color:#ffffff}` +
      `.btn-primary:hover:not(:disabled){background:#7c66ff}` +
      `.close{${FONT};border:0;background:transparent;color:#94a3b8;font-size:15px;line-height:1;padding:2px 6px;cursor:pointer;border-radius:6px}` +
      `.close:hover{color:#fff;background:rgba(255,255,255,0.12)}` +
      `.track{position:relative;height:4px;background:rgba(255,255,255,0.12);overflow:hidden}` +
      `.fill{display:block;position:relative;height:100%;background:#7c66ff;transition:width 220ms cubic-bezier(0.16,1,0.3,1);overflow:hidden}` +
      `.track.is-running .fill{background-image:repeating-linear-gradient(-45deg,#7c66ff 0 6px,#9380ff 6px 12px);background-size:24px 24px;animation:rs-cd-stripe 1s linear infinite}` +
      `.track.is-running .fill::after{content:'';position:absolute;inset:0;width:45%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent);animation:rs-cd-sheen 1.6s ease-in-out infinite}` +
      `.box.done .fill,.box.done .pct{background:#10b981;color:#6ee7b7}` +
      `.box.done .pct{background:transparent}` +
      `.box.err .fill{background:#ef4444}` +
      `.box.err .pct{color:#fca5a5}` +
      `.mini{${FONT};display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(15,23,42,0.92);color:#f8fafc;border:1px solid rgba(148,163,184,0.32);box-shadow:0 8px 24px rgba(0,0,0,0.28);font-weight:600;font-size:12px;cursor:pointer}` +
      `.drawer-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(148,163,184,0.16)}` +
      `.drawer-badge{${FONT};width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#5e43f3,#7c66ff);color:#fff;font-weight:800;font-size:10px;display:grid;place-items:center;flex:none}` +
      `.drawer-radar{width:7px;height:7px;border-radius:50%;background:#34d399;flex:none;animation:rs-cd-radar 1.8s infinite}` +
      `.drawer-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}` +
      `.drawer-ticker{${FONT};font-size:12px;color:#cbd5e1}` +
      `.drawer-status{${FONT};font-size:11.5px;padding:6px 8px;border-radius:7px;display:none}` +
      `.drawer-status.is-ok{background:rgba(16,185,129,0.18);color:#6ee7b7;border:1px solid rgba(16,185,129,0.35)}` +
      `.drawer-status.is-err{background:rgba(239,68,68,0.18);color:#fca5a5;border:1px solid rgba(239,68,68,0.35)}` +
      `.drawer-guide{${FONT};font-size:11.5px;padding:8px 10px;border-radius:8px;background:rgba(124,102,255,0.2);border:1px solid rgba(124,102,255,0.45);color:#ede9fe;display:none;line-height:1.4}` +
      `.drawer-guide-arrow{display:inline-block;margin-right:4px;animation:rs-cd-bounce 1.2s ease-in-out infinite}` +
      `.drawer-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}` +
      `.drawer-foot{display:flex;flex-direction:column;gap:6px;padding-top:4px;border-top:1px solid rgba(148,163,184,0.14)}` +
      `.drawer-hint{${FONT};font-size:11px;color:#94a3b8;text-align:center}` +
      `@media (prefers-reduced-motion: reduce){.track.is-running .fill,.track.is-running .fill::after,.drawer-radar,.drawer-guide-arrow{animation:none!important}}`,
  );
  root.adoptedStyleSheets = [sheet];

  const stopBubble = (el: HTMLElement): void => {
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('click', e => e.stopPropagation());
  };

  /* --- Expanded Quick-Control Drawer --- */
  drawerEl = document.createElement('section');
  drawerEl.className = 'drawer';
  drawerEl.setAttribute('aria-label', 'Referral Scout Quick Controls');
  drawerEl.style.display = 'none';
  stopBubble(drawerEl);

  const dHead = document.createElement('div');
  dHead.className = 'drawer-head';
  const dBadge = document.createElement('span');
  dBadge.className = 'drawer-badge';
  dBadge.textContent = 'RS';
  const dRadar = document.createElement('span');
  dRadar.className = 'drawer-radar';
  dRadar.setAttribute('aria-hidden', 'true');
  drawerTitleEl = document.createElement('div');
  drawerTitleEl.className = 'title copy';
  drawerPctEl = document.createElement('span');
  drawerPctEl.className = 'pct';
  const dClose = document.createElement('button');
  dClose.type = 'button';
  dClose.className = 'close';
  dClose.setAttribute('aria-label', 'Close quick controls');
  dClose.textContent = '▾';
  dClose.addEventListener('click', e => {
    e.stopPropagation();
    drawerOpen = false;
    renderWayfinding(getCachedActiveMission());
  });
  dHead.append(dBadge, dRadar, drawerTitleEl, drawerPctEl, dClose);

  drawerTrackEl = document.createElement('div');
  drawerTrackEl.className = 'track';
  drawerFillEl = document.createElement('span');
  drawerFillEl.className = 'fill';
  drawerTrackEl.append(drawerFillEl);

  const dBody = document.createElement('div');
  dBody.className = 'drawer-body';
  drawerTickerEl = document.createElement('div');
  drawerTickerEl.className = 'drawer-ticker';

  drawerStatusEl = document.createElement('div');
  drawerStatusEl.className = 'drawer-status';
  drawerStatusEl.setAttribute('role', 'status');

  drawerGuideEl = document.createElement('div');
  drawerGuideEl.className = 'drawer-guide';
  const guideArrow = document.createElement('span');
  guideArrow.className = 'drawer-guide-arrow';
  guideArrow.textContent = '↑';
  const guideText = document.createElement('span');
  guideText.textContent =
    'Click the RS icon in your top-right browser toolbar to pin & open the Side Panel, or use Open Full Workbench below.';
  drawerGuideEl.append(guideArrow, guideText);

  const dGrid = document.createElement('div');
  dGrid.className = 'drawer-grid';

  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'btn';
  scanBtn.textContent = 'Scan Jobs on Page';
  scanBtn.addEventListener('click', e => {
    e.stopPropagation();
    withButtonFeedback(scanBtn, 'Scanning…', 'Scan Jobs on Page', async () => {
      const reply = await sendHudAction(HUD_ACTIONS.SCAN_JOBS);
      showDrawerStatus(reply.ok ? (reply.message ?? 'Scanning LinkedIn jobs…') : (reply.error ?? 'Could not start scan'), !reply.ok);
    });
  });

  const refsBtn = document.createElement('button');
  refsBtn.type = 'button';
  refsBtn.className = 'btn';
  refsBtn.textContent = 'Find Referrers';
  refsBtn.addEventListener('click', e => {
    e.stopPropagation();
    withButtonFeedback(refsBtn, 'Opening…', 'Find Referrers', async () => {
      const reply = await sendHudAction(HUD_ACTIONS.FIND_REFERRERS);
      showDrawerStatus(reply.ok ? (reply.message ?? 'Opened Referrers') : (reply.error ?? 'Could not open Referrers'), !reply.ok);
    });
  });

  drawerPauseBtn = document.createElement('button');
  drawerPauseBtn.type = 'button';
  drawerPauseBtn.className = 'btn';
  drawerPauseBtn.textContent = 'Pause Engine';
  drawerPauseBtn.addEventListener('click', e => {
    e.stopPropagation();
    const currentlyActive = getCachedActiveMission().active;
    const busy = currentlyActive ? 'Pausing…' : 'Resuming…';
    const fallbackIdle = currentlyActive ? 'Pause Engine' : 'Resume Engine';
    withButtonFeedback(drawerPauseBtn!, busy, fallbackIdle, async () => {
      const reply = await sendHudAction(HUD_ACTIONS.TOGGLE_ENGINE);
      if (reply.ok && typeof reply.active === 'boolean' && drawerPauseBtn) {
        drawerPauseBtn.textContent = reply.active ? 'Pause Engine' : 'Resume Engine';
      }
      showDrawerStatus(reply.ok ? (reply.message ?? 'Updated engine') : (reply.error ?? 'Toggle failed'), !reply.ok);
    });
  });

  const panelBtn = document.createElement('button');
  panelBtn.type = 'button';
  panelBtn.className = 'btn';
  panelBtn.textContent = 'Open Side Panel';
  panelBtn.addEventListener('click', e => {
    e.stopPropagation();
    withButtonFeedback(panelBtn, 'Opening…', 'Open Side Panel', async () => {
      const reply = await sendHudAction(HUD_ACTIONS.OPEN_SIDEPANEL);
      if (reply.ok && reply.opened) {
        if (drawerGuideEl) drawerGuideEl.style.display = 'none';
        showDrawerStatus('Side Panel opened ✓');
      } else {
        if (drawerGuideEl) drawerGuideEl.style.display = 'block';
        showDrawerStatus('Click RS icon in toolbar ↑');
      }
    });
  });

  dGrid.append(scanBtn, refsBtn, drawerPauseBtn, panelBtn);

  const workbenchBtn = document.createElement('button');
  workbenchBtn.type = 'button';
  workbenchBtn.className = 'btn btn-primary';
  workbenchBtn.textContent = 'Open Full Workbench →';
  workbenchBtn.addEventListener('click', e => {
    e.stopPropagation();
    withButtonFeedback(workbenchBtn, 'Opening…', 'Open Full Workbench →', async () => {
      const reply = await sendHudAction(HUD_ACTIONS.OPEN_WORKBENCH, { route: 'jobs' });
      showDrawerStatus(reply.ok ? (reply.message ?? 'Workbench focused ✓') : (reply.error ?? 'Could not open Workbench'), !reply.ok);
    });
  });

  const hint = document.createElement('div');
  hint.className = 'drawer-hint';
  hint.textContent = 'Or click the RS icon in your browser toolbar';

  const dFoot = document.createElement('div');
  dFoot.className = 'drawer-foot';
  dFoot.append(workbenchBtn, hint);

  dBody.append(drawerTickerEl, drawerStatusEl, drawerGuideEl, dGrid, dFoot);
  drawerEl.append(dHead, drawerTrackEl, dBody);

  /* --- Compact Bottom Pill / Card --- */
  cardEl = document.createElement('div');
  cardEl.className = 'box';
  stopBubble(cardEl);

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
  jumpBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (currentMode === 'wayfinding') {
      toggleQuickControlDrawer();
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
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (currentMode === 'wayfinding') {
      drawerOpen = false;
      minimized = true;
      renderWayfinding(getCachedActiveMission());
      return;
    }
    dismissed = true;
    cardEl!.style.display = 'none';
  });

  row.append(pctEl, copy, jumpBtn, closeBtn);
  trackEl = document.createElement('div');
  trackEl.className = 'track';
  fillEl = document.createElement('span');
  fillEl.className = 'fill';
  trackEl.append(fillEl);

  cardEl.append(row, trackEl);

  miniPillBtn = document.createElement('button');
  miniPillBtn.type = 'button';
  miniPillBtn.className = 'mini';
  miniPillBtn.style.display = 'none';
  miniPillBtn.addEventListener('click', e => {
    e.stopPropagation();
    minimized = false;
    toggleQuickControlDrawer(true);
  });

  root.append(drawerEl, cardEl, miniPillBtn);
  document.body.append(hostEl);
  return true;
}

/** Shows or updates the isolated page overlay HUD; auto-dismisses cleanly 8s after `done`. */
export function updatePageHud(payload: PageHudPayload): void {
  clearTimeout(hideTimer);
  currentMode = 'apply';
  hasApplyOverride = payload.status !== 'done';
  if (payload.status === 'running') dismissed = false;
  if (dismissed || !ensureHost() || !cardEl || !fillEl || !pctEl || !titleEl || !detailEl || !jumpBtn || !miniPillBtn) return;

  if (drawerEl) drawerEl.style.display = 'none';
  miniPillBtn.style.display = 'none';
  cardEl.style.display = 'block';
  cardEl.className = `box${payload.status === 'done' ? ' done' : payload.status === 'error' ? ' err' : ''}`;
  if (trackEl) trackEl.className = payload.status === 'running' ? 'track is-running' : 'track';
  const pct = Math.max(0, Math.min(100, Math.round(payload.percent)));
  pctEl.textContent = `${pct}%`;
  fillEl.style.width = `${pct}%`;
  titleEl.textContent = payload.label;
  detailEl.textContent =
    payload.detail ?? (payload.status === 'waiting' ? 'Click Next gap to jump to highlighted field' : 'Referral Scout Autofill');
  jumpBtn.textContent = 'Next gap';
  jumpBtn.hidden = payload.status === 'error' || payload.status === 'done' || !(payload.askCount && payload.askCount > 0);

  if (payload.status === 'done') {
    hideTimer = setTimeout(() => {
      hasApplyOverride = false;
      if (cardEl) cardEl.style.display = 'none';
      renderWayfinding(getCachedActiveMission());
    }, 8000);
  }
}

/** Renders or hides the non-intrusive Shadow DOM Re-Entry Pill & Quick-Control Drawer on host tabs. */
export function renderWayfinding(mission: ActiveMissionState): void {
  if (hasApplyOverride) return;
  const shouldShow = !mission.isSidePanelOpen && (mission.active || mission.pendingBlockerCount > 0);
  if (!shouldShow) {
    drawerOpen = false;
    if (hostEl) hostEl.dataset.rsDrawerOpen = 'false';
    if (drawerEl) drawerEl.style.display = 'none';
    if (cardEl) cardEl.style.display = 'none';
    if (miniPillBtn) miniPillBtn.style.display = 'none';
    return;
  }
  if (!ensureHost() || !cardEl || !fillEl || !pctEl || !titleEl || !detailEl || !jumpBtn || !miniPillBtn) return;
  currentMode = 'wayfinding';
  const pct = Math.max(0, Math.min(100, Math.round(mission.percent || 25)));

  syncDrawer(mission);

  if (minimized) {
    cardEl.style.display = 'none';
    miniPillBtn.style.display = 'inline-flex';
    miniPillBtn.textContent = `RS · ${pct}% Open Controls →`;
    return;
  }

  miniPillBtn.style.display = 'none';
  cardEl.style.display = 'block';
  cardEl.className = 'box';
  if (trackEl) trackEl.className = mission.active ? 'track is-running' : 'track';
  pctEl.textContent = `${pct}%`;
  fillEl.style.width = `${pct}%`;
  titleEl.textContent = `RS · ${mission.stageLabel}`;
  detailEl.textContent = `${mission.liveSummary} · Side Panel closed`;
  jumpBtn.hidden = false;
  jumpBtn.textContent = drawerOpen ? 'Hide Controls ▾' : 'Open Controls →';
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
