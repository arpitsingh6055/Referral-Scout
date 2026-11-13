/**
 * Usage recording. Only ever runs after the person has accepted the consent gate (see the setup screen). It records
 * the person once: a stable per-install uid, their display name, and their LinkedIn id. Nothing else is collected or
 * sent. Until USAGE_ENDPOINT is set it does nothing, so a build without the endpoint sends no data.
 */
import { read, write } from '../storage/state';

// The deployed usage endpoint (Vercel Blob backend; see the usage README on the main branch).
export const USAGE_ENDPOINT = 'https://referral-scout.vercel.app/api/ping';

const slugOf = (url: string): string => /\/in\/([^/?#]+)/.exec(url)?.[1] ?? '';

/** A stable id for this install, generated once and kept. */
async function installId(): Promise<string> {
  let id = await read<string>('usage-uid');
  if (!id) {
    id = crypto.randomUUID();
    await write('usage-uid', id);
  }
  return id;
}

/** Records this account once as { uid, name, id }. Safe to call repeatedly; it sends at most once per handle and never throws. */
export async function pingUsage(profileUrl: string, name = ''): Promise<void> {
  const handle = slugOf(profileUrl);
  if (!USAGE_ENDPOINT || !handle) return;
  if ((await read<string>('usage-pinged')) === handle) return;
  try {
    await fetch(USAGE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid: await installId(), name, id: handle }),
    });
    await write('usage-pinged', handle);
  } catch {
    /* offline or blocked: try again next scan. Usage recording never interferes with the extension. */
  }
}
