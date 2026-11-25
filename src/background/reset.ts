/**
 * Single authoritative reset for all locally stored extension state across both the side panel and the main dashboard.
 */

import { clearDatabase } from '../storage/database';
import { abortAllApply } from './apply';
import { resetNetworkRuntime } from './network';
import { saveApiConfig } from './network-ai';
import { stopRunnerAndWait } from './runner';
import { applySurfaceBehaviour } from './surfaces';
import { clearAllProgressTasks } from '../shared/progress-store';
import { clearProfileSnapshot } from './profileStorage';

/** Stops active background work and atomically clears all local IndexedDB stores across every surface. */
export async function clearAllLocalData(): Promise<void> {
  await stopRunnerAndWait();
  abortAllApply();
  await resetNetworkRuntime();
  await saveApiConfig(null);
  await clearDatabase();
  await clearAllProgressTasks();
  await clearProfileSnapshot();
  await applySurfaceBehaviour().catch(() => undefined);
  try {
    void chrome.runtime?.sendMessage?.({ kind: 'ui.cleared' })?.catch?.(() => undefined);
  } catch {
    // No listeners or test runtime without sendMessage.
  }
}
