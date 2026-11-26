/**
 * Non-destructive, idempotent v5 -> v6 migration:
 * Ensures existing NetworkState jobs/contacts/referrals are bridged into canonical `campaign-store`
 * records and provisions a default Campaign if the user already has active data, eliminating
 * split-model "No campaign yet" empty states in the companion dashboard.
 */

import { currentResetGeneration, shouldAbortStaleWrite } from '../storage/database';
import { read, write } from '../storage/state';
import { syncFromNetwork, type BridgeReport } from './bridge';

export const V6_MIGRATED_KEY = 'v6-unified-dashboard-migrated';

export async function migrateV5ToV6(now = Date.now()): Promise<BridgeReport> {
  const capturedGen = currentResetGeneration();
  if (await read<boolean>(V6_MIGRATED_KEY)) {
    return { jobsAdded: 0, jobsUpdated: 0, contactsAdded: 0 };
  }
  const report = await syncFromNetwork(now).catch(() => ({ jobsAdded: 0, jobsUpdated: 0, contactsAdded: 0 }));
  if (!shouldAbortStaleWrite(capturedGen)) {
    await write(V6_MIGRATED_KEY, true);
  }
  return report;
}
