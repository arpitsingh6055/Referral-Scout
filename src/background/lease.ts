import { mutate } from '../storage/state';
interface Lease {
  owner: string;
  expires: number;
}
export async function acquire(owner: string, now = Date.now()): Promise<boolean> {
  const lease = await mutate<Lease>('lease', old =>
    !old || old.expires <= now || old.owner === owner ? { owner, expires: now + 60000 } : old,
  );
  return lease.owner === owner;
}
export async function renew(owner: string): Promise<boolean> {
  const now = Date.now();
  const lease = await mutate<Lease>('lease', old =>
    old?.owner === owner && old.expires > now ? { owner, expires: now + 60000 } : (old ?? { owner: '', expires: 0 }),
  );
  return lease.owner === owner && lease.expires > now;
}
export async function release(owner: string): Promise<void> {
  await mutate<Lease>('lease', old => (old?.owner === owner ? { owner: '', expires: 0 } : (old ?? { owner: '', expires: 0 })));
}
