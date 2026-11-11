/*
 * Local storage for the extension, using the browser's built-in IndexedDB. Nothing leaves the computer.
 *   meta   - small named values; the whole outreach state lives under one key
 *   aiJobs - one record per ChatGPT task, so an interrupted task can be recovered
 */
export interface Meta { id: string; value: unknown }
export interface AiJobRecord { id: string; owner: string; createdAt: number; [key: string]: unknown }
export interface Records { meta: Meta; aiJobs: AiJobRecord }
export type Store = keyof Records;
const stores: Store[] = ["meta", "aiJobs"];
export const DB_NAME = "cold-contact";
let pending: Promise<IDBDatabase> | undefined;

export function openDatabase(): Promise<IDBDatabase> {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of stores) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); pending = undefined; };
      resolve(db);
    };
    request.onerror = () => { pending = undefined; reject(request.error); };
    request.onblocked = () => { pending = undefined; reject(new Error("Storage is busy. Close other Referral Scout windows and try again.")); };
  });
  return pending;
}

async function operation<T>(name: Store, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = run(tx.objectStore(name));
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error ?? req.error ?? new Error("Transaction aborted"));
    tx.onerror = () => reject(tx.error ?? req.error);
  });
}
export async function put<S extends Store>(store: S, record: Records[S]): Promise<void> { await operation(store, "readwrite", s => s.put(record)); }
export async function get<S extends Store>(store: S, id: string): Promise<Records[S] | undefined> {
  return operation(store, "readonly", s => s.get(id) as IDBRequest<Records[S] | undefined>);
}
export async function all<S extends Store>(store: S): Promise<Records[S][]> {
  return operation(store, "readonly", s => s.getAll() as IDBRequest<Records[S][]>);
}
export async function remove(store: Store, id: string): Promise<void> { await operation(store, "readwrite", s => s.delete(id)); }
export async function closeDatabase(): Promise<void> { if (pending) (await pending).close(); pending = undefined; }
export async function clearDatabase(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    for (const store of stores) tx.objectStore(store).clear();
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
  });
}
