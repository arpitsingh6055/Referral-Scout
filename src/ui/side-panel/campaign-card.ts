/**
 * The campaign card at the top of the side panel.
 *
 * The side panel is narrow, so it is a control surface rather than a dashboard (specification 3.1): campaign
 * status, what needs the person, one primary action and a way into the full workbench. The desktop queue table
 * is deliberately not squeezed in here — a six-column table at 360px is unreadable, and the spec says so.
 *
 * It renders nothing at all until a campaign exists, so the panel is unchanged for anyone who has not started one.
 */

import type { CampaignView } from '../../background/campaign';
import type { CampaignRequest } from '../../background/campaign';
import { errorText } from '../render';
import { notify } from '../core';

const WORKBENCH = 'workbench.html';
let lastCampaignSignature = '';

function el(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function ask(request: CampaignRequest): Promise<CampaignView | null> {
  const reply = (await chrome.runtime.sendMessage(request).catch(() => undefined)) as
    { ok?: boolean; view?: CampaignView; error?: string } | undefined;
  if (reply && !reply.ok && reply.error) throw new Error(reply.error);
  return reply?.ok && reply.view ? reply.view : null;
}

export const openWorkbench = (hash = ''): void => {
  // Reuse the dashboard tab if one is already open, rather than stacking copies.
  void chrome.runtime.sendMessage({ kind: 'surface', action: 'open-tab', route: hash }).catch(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`${WORKBENCH}${hash ? `#${hash}` : ''}`) });
  });
};

/**
 * Draws the card into `host`, replacing whatever was there. Returns quietly if the background has no campaign or
 * cannot be reached: the rest of the panel must keep working either way.
 */
export async function renderCampaignCard(host: HTMLElement, force = false): Promise<void> {
  const view = await ask({ kind: 'campaign', action: 'view' }).catch(() => null);
  const sig = JSON.stringify(view);
  if (!force && host.childElementCount > 0 && sig === lastCampaignSignature) return;
  lastCampaignSignature = sig;
  // Before a campaign exists there is still somewhere to go: without this the dashboard would have no entry
  // point at all, which is exactly how the new workbench stayed invisible in the first build.
  if (!view?.campaign) {
    const start = el('section', 'rs-campaign');
    start.append(
      el('div', 'rs-campaign-head', 'Set up your search'),
      el('p', 'rs-campaign-next', 'Create a campaign once and Referral Scout builds the job queue and the referral list for you.'),
    );
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn primary';
    open.textContent = 'Open dashboard';
    open.addEventListener('click', () => openWorkbench('setup'));
    const actions = el('div', 'rs-campaign-actions');
    actions.append(open);
    start.append(actions);
    host.replaceChildren(start);
    return;
  }
  const { campaign, counts, inboxCounts } = view;
  const running = campaign.status === 'running' || campaign.status === 'stopping';
  const mode = campaign.application.mode ?? 'guided';
  const modeLabel = mode === 'autopilot' ? 'Autopilot' : mode === 'discover' ? 'Discover only' : 'Guided';

  const card = el('section', 'rs-campaign');
  card.setAttribute('aria-label', 'Campaign');
  card.setAttribute('aria-live', 'polite');

  const head = el('div', 'rs-campaign-head');
  const state = el('span', `rs-campaign-state ${running ? 'is-running' : inboxCounts.open ? 'is-attention' : 'is-paused'}`);
  state.textContent = running ? `Running · ${modeLabel}` : inboxCounts.open ? `Needs you · ${modeLabel}` : `Paused · ${modeLabel}`;
  head.append(el('span', 'rs-campaign-name', campaign.name), state);

  // Stacked chips rather than a row of metric cards: at this width a row wraps into something unreadable.
  const chips = el('div', 'rs-campaign-chips');
  for (const [label, value] of [
    ['Queued', counts.queued],
    ['Running', counts.running],
    ['Submitted', counts.submitted],
    ['Needs you', inboxCounts.open],
  ] as const) {
    const chip = el('span', value && label === 'Needs you' ? 'rs-chip rs-chip-amber' : 'rs-chip');
    chip.append(el('b', '', String(value)), el('span', '', label));
    chips.append(chip);
  }

  const next = view.queue.find(q => q.state === 'opening' || q.state === 'filling') ?? view.queue.find(q => q.state === 'queued');
  const line = el(
    'p',
    'rs-campaign-next',
    counts.uncertain
      ? `${counts.uncertain} submission${counts.uncertain === 1 ? '' : 's'} need checking.`
      : inboxCounts.open
        ? `${inboxCounts.blocked} application${inboxCounts.blocked === 1 ? '' : 's'} waiting on you.`
        : next
          ? `Next: ${next.company} · ${next.title}`
          : 'Nothing left in the queue.',
  );

  const actions = el('div', 'rs-campaign-actions');
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'btn primary';
  const hasQueuedApplications = counts.queued > 0;
  primary.textContent = inboxCounts.open
    ? 'Review what needs you'
    : running
      ? 'Pause application queue'
      : hasQueuedApplications
        ? campaign.status === 'paused'
          ? 'Resume application queue'
          : 'Start application queue'
        : 'Find jobs';
  primary.addEventListener('click', () => {
    if (inboxCounts.open) {
      openWorkbench('needs-you');
      return;
    }
    if (!running && !hasQueuedApplications) {
      openWorkbench('jobs');
      return;
    }
    primary.disabled = true;
    const control = running ? 'pause' : campaign.status === 'paused' ? 'resume' : 'start';
    void ask({ kind: 'campaign', action: 'control', control })
      .then(() => {
        notify('success', running ? 'Application queue paused.' : 'Application queue started.');
        return renderCampaignCard(host, true);
      })
      .catch(error => notify('error', errorText(error)))
      .finally(() => {
        primary.disabled = false;
      });
  });

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn';
  open.textContent = 'Mission';
  open.addEventListener('click', () => openWorkbench('setup'));

  actions.append(primary, open);
  card.append(head, chips, line, actions);
  host.replaceChildren(card);
}
