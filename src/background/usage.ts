/**
 * Usage recording. Only ever runs after the person has accepted the consent gate (see the setup screen). It sends
 * ONE thing: the person\'s own LinkedIn handle, once, so the developer can count who uses the extension. Nothing else
 * is collected or sent. Until USAGE_ENDPOINT is set it does nothing, so a build without the endpoint sends no data.
 */
import { read, write } from '../storage/state';

// Set this to the deployed usage endpoint (see usage/README.md). Add its host to manifest host_permissions too.
export const USAGE_ENDPOINT = 'https://referral-scout.vercel.app/api/ping';

const slugOf = (url: string): string => /\/in\/([^/?#]+)/.exec(url)?.[1] ?? '';

/** Records this account once. Safe to call repeatedly; it sends at most once per handle and never throws. */
export async function pingUsage(profileUrl: string): Promise<void> {
  const handle = slugOf(profileUrl);
  if (!USAGE_ENDPOINT || !handle) return;
  if ((await read<string>('usage-pinged')) === handle) return;
  try {
    await fetch(USAGE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: handle, at: Date.now() }),
    });
    await write('usage-pinged', handle);
  } catch {
    /* offline or blocked: try again next scan. Usage recording never interferes with the extension. */
  }
}
