/**
 * Non-destructive, idempotent v4 -> v5 migration:
 * 1. Backfills `NetworkState.lastRun` from existing `jobSearch` / `referralJobs` / `contacts`.
 * 2. Reconciles `apply-history` entries into `referralJobs[].applied` so the Pipeline board
 *    and Jobs tab share one source of truth without losing existing manual flags or history.
 */

import { canonicalJobUrl } from '../shared/domain/job';
import { deriveRunSummary } from '../shared/run-summary';
import { currentResetGeneration, shouldAbortStaleWrite } from '../storage/database';
import { read, write } from '../storage/state';
import { HISTORY_KEY } from './apply';
import { getNetwork, updateNetwork } from './network';

export const V5_MIGRATED_KEY = 'v5-run-apply-migrated';

export async function migrateV4ToV5(now = Date.now()): Promise<{ syncedApplied: number; backfilledRun: boolean }> {
  const capturedGen = currentResetGeneration();
  if (await read<boolean>(V5_MIGRATED_KEY)) return { syncedApplied: 0, backfilledRun: false };

  const [network, history] = await Promise.all([
    getNetwork().catch(() => null),
    read<{ title: string; company: string; url: string; at: number }[]>(HISTORY_KEY)
      .then(h => h ?? [])
      .catch(() => []),
  ]);
  if (shouldAbortStaleWrite(capturedGen)) return { syncedApplied: 0, backfilledRun: false };
  if (!network) {
    await write(V5_MIGRATED_KEY, true);
    return { syncedApplied: 0, backfilledRun: false };
  }

  const historyByUrl = new Map<string, number>();
  for (const h of history) {
    const key = canonicalJobUrl(h.url) ?? h.url.replace(/\/+$/, '');
    const prev = historyByUrl.get(key) ?? 0;
    if (h.at > prev) historyByUrl.set(key, h.at);
  }

  let syncedApplied = 0;
  let backfilledRun = false;

  await updateNetwork(s => {
    const jobs = (s.referralJobs ?? []).map(j => {
      const key = canonicalJobUrl(j.url) ?? j.url.replace(/\/+$/, '');
      const histAt = historyByUrl.get(key);
      if (histAt && !j.applied) {
        syncedApplied += 1;
        return { ...j, applied: histAt };
      }
      return j;
    });
    const next = { ...s, referralJobs: jobs };
    if (!next.lastRun) {
      const derived = deriveRunSummary(next, now);
      if (derived) {
        next.lastRun = derived;
        backfilledRun = true;
      }
    }
    return next;
  });

  if (!shouldAbortStaleWrite(capturedGen)) {
    await write(V5_MIGRATED_KEY, true);
  }
  return { syncedApplied, backfilledRun };
}
