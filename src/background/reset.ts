/**
 * Single authoritative reset for all locally stored extension state across both the side panel and the main dashboard.
 */

import { beginResetGeneration, clearDatabase, finishResetGeneration } from '../storage/database';
import { abortAllApply } from './apply';
import { resetNetworkRuntime } from './network';
import { closeWorkWindow } from './network-browser';
import { saveApiConfig } from './network-ai';
import { stopRunnerAndWait } from './runner';
import { applySurfaceBehaviour } from './surfaces';
import { clearAllProgressTasks } from '../shared/progress-store';
import { clearProfileSnapshot } from './profileStorage';

/**
 * Stops active background work, bumps the reset generation mutex so pending debounced writes cannot
 * resurrect cleared state, and atomically clears IndexedDB, `chrome.storage.local`, and `chrome.storage.session`.
 */
export async function clearAllLocalData(): Promise<void> {
  beginResetGeneration();
  try {
    await stopRunnerAndWait();
    abortAllApply();
    await resetNetworkRuntime();
    await closeWorkWindow().catch(() => undefined);
    await saveApiConfig(null);
    await clearDatabase();
    await Promise.resolve(chrome.alarms?.clearAll?.()).catch(() => undefined);
    await Promise.resolve(chrome.storage?.local?.clear?.()).catch(() => undefined);
    await Promise.resolve(chrome.storage?.session?.clear?.()).catch(() => undefined);
    await clearAllProgressTasks();
    await clearProfileSnapshot();
    await applySurfaceBehaviour().catch(() => undefined);
    try {
      void chrome.runtime?.sendMessage?.({ kind: 'ui.cleared' })?.catch?.(() => undefined);
    } catch {
      // No listeners or test runtime without sendMessage.
    }
  } finally {
    finishResetGeneration();
  }
}
