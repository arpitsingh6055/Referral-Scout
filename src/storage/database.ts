/*
 * Local storage for the extension, using the browser's built-in IndexedDB. Nothing leaves the computer.
 *   meta         - small named values; the whole outreach state lives under one key
 *   aiJobs       - one record per ChatGPT task, so an interrupted task can be recovered
 *
 * Version 2 adds the campaign layer. These are separate stores rather than more keys under `meta` because the queue
 * must survive a crash mid-write and be read a record at a time: holding hundreds of applications inside one blob
 * means every status change rewrites the lot, and a half-written blob loses the whole queue.
 *   campaigns    - one per search the person set up
 *   jobs         - canonical vacancies, deduplicated across sources, with their provenance
 *   companies    - shared employer identity across jobs and people
 *   profiles     - the candidate record: education, employment, projects, skills, documents
 *   applications - the durable application queue; the source of truth, keyed by applicationId, never by tab
 *   exceptions   - the "Needs you" inbox, shared across applications
 *   facts        - the Answer Bank
 *   contacts     - deduplicated people, one record per person across companies and channels
 *   outreach     - referral/email tasks, one state machine per channel
 *   threads      - Gmail thread metadata for outcome recognition
 *   aiContexts   - per-application provider context, so one application never reads another's answer
 *   events       - append-only outcome ledger
 *   notifications- what the person was told, and whether they have seen it
 *   audit        - local trace of significant changes
 */
export interface Meta {
  id: string;
  value: unknown;
}
export interface AiJobRecord {
  id: string;
  owner: string;
  createdAt: number;
  [key: string]: unknown;
}
/** Every campaign-layer record is stored as-is and keyed by `id`; the shapes live in src/shared. */
export interface Keyed {
  id: string;
  [key: string]: unknown;
}
export interface Records {
  meta: Meta;
  aiJobs: AiJobRecord;
  campaigns: Keyed;
  jobs: Keyed;
  companies: Keyed;
  profiles: Keyed;
  applications: Keyed;
  exceptions: Keyed;
  facts: Keyed;
  contacts: Keyed;
  outreach: Keyed;
  threads: Keyed;
  aiContexts: Keyed;
  events: Keyed;
  notifications: Keyed;
  audit: Keyed;
}
export type Store = keyof Records;
const stores: Store[] = [
  'meta',
  'aiJobs',
  'campaigns',
  'jobs',
  'companies',
  'profiles',
  'applications',
  'exceptions',
  'facts',
  'contacts',
  'outreach',
  'threads',
  'aiContexts',
  'events',
  'notifications',
  'audit',
];
export const DB_NAME = 'cold-contact';
/**
 * 1 - meta and aiJobs only (the per-tab engine).
 * 2 - the campaign layer.
 * 3 - the full entity set of specification 18.
 *
 * Upgrades only ever add stores. Nothing existing is rewritten or dropped, so an upgrade cannot lose the person's
 * saved people, answers or history, and rolling back to the previous build leaves their data readable.
 */
export const DB_VERSION = 3;
let pending: Promise<IDBDatabase> | undefined;

export function openDatabase(): Promise<IDBDatabase> {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of stores)
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        pending = undefined;
      };
      resolve(db);
    };
    request.onerror = () => {
      pending = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      pending = undefined;
      reject(new Error('Storage is busy. Close other Referral Scout windows and try again.'));
    };
  });
  return pending;
}

async function operation<T>(name: Store, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = run(tx.objectStore(name));
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error ?? req.error ?? new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error ?? req.error);
  });
}
export async function put<S extends Store>(store: S, record: Records[S]): Promise<void> {
  await operation(store, 'readwrite', s => s.put(record));
}
export async function get<S extends Store>(store: S, id: string): Promise<Records[S] | undefined> {
  return operation(store, 'readonly', s => s.get(id) as IDBRequest<Records[S] | undefined>);
}
export async function all<S extends Store>(store: S): Promise<Records[S][]> {
  return operation(store, 'readonly', s => s.getAll() as IDBRequest<Records[S][]>);
}
export async function remove(store: Store, id: string): Promise<void> {
  await operation(store, 'readwrite', s => s.delete(id));
}
export async function closeDatabase(): Promise<void> {
  if (pending) (await pending).close();
  pending = undefined;
}
export async function clearDatabase(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    for (const store of stores) tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
