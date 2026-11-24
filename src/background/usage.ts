/**
 * Optional usage reporting. It runs only after the person explicitly opts in. It records one stable per-install uid,
 * display name and LinkedIn handle per account so the developer can count users. Profile/CV contents, jobs, contacts
 * and messages are not part of this usage record.
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
