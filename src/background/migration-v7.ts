/**
 * Versioned v6 -> v7 migration:
 * Unifies `NetworkState.applyQueue`, `apply-history`, and `ReferralJob.applied` into the durable
 * `applications` IndexedDB store (`ApplicationTask`).
 *
 * Idempotent and reset-safe (`shouldAbortStaleWrite`). Never drops user data.
 */

import { currentResetGeneration, shouldAbortStaleWrite } from '../storage/database';
import { read, write, mutate } from '../storage/state';
import { allJobs, allTasks, saveTasks } from '../shared/persistence/campaign-store';
import { canonicalJobUrl, dedupeKey } from '../shared/domain/job';
import type { ApplicationTask } from '../shared/state-machines/application-task';
import { networkKey, type NetworkState } from '../shared/network';
import { ensureDefaultCampaignFromNetwork, syncFromNetwork } from './bridge';
import { getNetwork } from './network';

export const V7_MIGRATED_KEY = 'v7-unified-queue-migrated';
const HISTORY_KEY = 'apply-history';

interface LegacyHistoryEntry {
  title: string;
  company: string;
  url: string;
  at: number;
}

export interface MigrationV7Report {
  migratedQueued: number;
  migratedSubmitted: number;
}

const sameUrl = (a: string, b: string): boolean => {
  const ca = canonicalJobUrl(a) ?? a.replace(/\/+$/, '');
  const cb = canonicalJobUrl(b) ?? b.replace(/\/+$/, '');
  return ca === cb;
};

export async function migrateV6ToV7(now = Date.now()): Promise<MigrationV7Report> {
  const capturedGen = currentResetGeneration();
  if (await read<boolean>(V7_MIGRATED_KEY)) {
    return { migratedQueued: 0, migratedSubmitted: 0 };
  }

  await syncFromNetwork(now).catch(() => undefined);
  const campaign = await ensureDefaultCampaignFromNetwork(now).catch(() => null);
  const [network, history, existingTasks, jobs] = await Promise.all([
    getNetwork().catch(() => null),
    read<LegacyHistoryEntry[]>(HISTORY_KEY)
      .then(h => h ?? [])
      .catch(() => [] as LegacyHistoryEntry[]),
    allTasks().catch(() => [] as ApplicationTask[]),
    allJobs().catch(() => []),
  ]);

  if (!campaign) {
    if (!shouldAbortStaleWrite(capturedGen)) await write(V7_MIGRATED_KEY, true);
    return { migratedQueued: 0, migratedSubmitted: 0 };
  }

  const hasTaskForUrl = (url: string): boolean => existingTasks.some(t => sameUrl(t.url, url));
  const findJobForUrl = (url: string) => jobs.find(j => sameUrl(j.canonicalUrl, url));
  const toSave: ApplicationTask[] = [];
  let migratedQueued = 0;
  let migratedSubmitted = 0;

  // 1. Migrate legacy `apply-history` & `referralJobs.applied` -> `submitted` tasks
  const submittedCandidates: { url: string; title: string; company: string; at: number; how: 'site-confirmation' | 'user-confirmed' }[] =
    [];
  for (const h of history) {
    if (h.url)
      submittedCandidates.push({
        url: h.url,
        title: h.title || 'Application',
        company: h.company || 'Company',
        at: h.at || now,
        how: 'site-confirmation',
      });
  }
  for (const r of network?.referralJobs ?? []) {
    if (r.applied && r.url) {
      submittedCandidates.push({ url: r.url, title: r.title, company: r.company, at: r.applied, how: 'user-confirmed' });
    }
  }

  for (const sub of submittedCandidates) {
    if (hasTaskForUrl(sub.url) || toSave.some(t => sameUrl(t.url, sub.url))) continue;
    const job = findJobForUrl(sub.url);
    const key = dedupeKey({
      company: sub.company,
      title: sub.title,
      location: job?.location ?? '',
      canonicalUrl: sub.url,
    });
    toSave.push({
      id: `app:mig:${sub.at}:${migratedSubmitted}:${Math.random().toString(36).slice(2, 6)}`,
      campaignId: campaign.id,
      jobId: job?.id ?? `job:legacy:${migratedSubmitted}`,
      company: sub.company,
      title: sub.title,
      location: job?.location ?? '',
      url: sub.url,
      source: job?.sourceName ?? 'LinkedIn Jobs',
      ats: job?.atsHost ?? '',
      route: job?.applyType === 'easy-apply' ? 'easy-apply' : job?.applyType === 'ats' ? 'external' : 'unknown',
      fit: job?.qualification?.fit ?? 70,
      state: 'submitted',
      note: 'Migrated from application history.',
      attempts: 1,
      createdAt: sub.at,
      updatedAt: sub.at,
      submission: { attemptedAt: sub.at, confirmedAt: sub.at, how: sub.how },
      history: [{ at: sub.at, from: 'queued', to: 'submitted', reason: 'Migrated from prior applied history.' }],
      dedupeKey: key,
    });
    migratedSubmitted++;
  }

  // 2. Migrate legacy `NetworkState.applyQueue` -> `queued` tasks
  const legacyQueue = network?.applyQueue ?? [];
  for (const url of legacyQueue) {
    if (!url || hasTaskForUrl(url) || toSave.some(t => sameUrl(t.url, url))) continue;
    const job = findJobForUrl(url);
    const refJob = (network?.referralJobs ?? []).find(r => sameUrl(r.url, url));
    const company = job?.companyName ?? refJob?.company ?? 'Company';
    const title = job?.title ?? refJob?.title ?? 'Job application';
    const location = job?.location ?? refJob?.location ?? '';
    const key = dedupeKey({ company, title, location, canonicalUrl: url });
    toSave.push({
      id: `app:migq:${now}:${migratedQueued}:${Math.random().toString(36).slice(2, 6)}`,
      campaignId: campaign.id,
      jobId: job?.id ?? `job:legacyq:${migratedQueued}`,
      company,
      title,
      location,
      url,
      source: job?.sourceName ?? 'LinkedIn Jobs',
      ats: job?.atsHost ?? '',
      route: job?.applyType === 'easy-apply' ? 'easy-apply' : job?.applyType === 'ats' ? 'external' : 'unknown',
      fit: job?.qualification?.fit ?? 70,
      state: 'queued',
      note: 'Migrated from side-panel apply queue.',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      history: [{ at: now, from: 'queued', to: 'queued', reason: 'Migrated from legacy applyQueue.' }],
      dedupeKey: key,
    });
    migratedQueued++;
  }

  if (toSave.length && !shouldAbortStaleWrite(capturedGen)) {
    await saveTasks(toSave);
  }
  if (legacyQueue.length && !shouldAbortStaleWrite(capturedGen)) {
    await mutate<NetworkState>(networkKey, old => (old ? { ...old, applyQueue: [] } : old!)).catch(() => undefined);
  }
  if (!shouldAbortStaleWrite(capturedGen)) {
    await write(V7_MIGRATED_KEY, true);
  }
  return { migratedQueued, migratedSubmitted };
}
