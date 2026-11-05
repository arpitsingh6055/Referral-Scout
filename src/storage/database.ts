import type { Records, Store } from "../shared/types";
const stores: Store[] = ["company", "person", "email", "role", "draft", "send", "event", "meta"];
export const DB_NAME = "cold-contact-pro";
let pending: Promise<IDBDatabase> | undefined;

export function openDatabase(): Promise<IDBDatabase> {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of stores) {
        const store = request.result.createObjectStore(name, { keyPath: "id" });
        if (name !== "meta") store.createIndex("createdAt", "createdAt");
        if (!["meta", "event"].includes(name)) store.createIndex("stage", "stage");
        if (["person", "role", "send"].includes(name)) store.createIndex("companyId", "companyId");
        if (["email", "draft", "send"].includes(name)) store.createIndex("personId", "personId");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); pending = undefined; };
      resolve(db);
    };
    request.onerror = () => { pending = undefined; reject(request.error); };
    request.onblocked = () => { pending = undefined; reject(new Error("Database upgrade blocked; close other extension pages")); };
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
export async function put<S extends Store>(store: S, record: Records[S]): Promise<void> {
  await operation(store, "readwrite", s => s.put(record));
}
export async function get<S extends Store>(store: S, id: string): Promise<Records[S] | undefined> {
  return operation(store, "readonly", s => s.get(id) as IDBRequest<Records[S] | undefined>);
}
export async function all<S extends Store>(store: S): Promise<Records[S][]> {
  return operation(store, "readonly", s => s.getAll() as IDBRequest<Records[S][]>);
}
export async function closeDatabase(): Promise<void> { if (pending) (await pending).close(); pending = undefined; }
export async function clearDatabase(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    for (const store of stores) tx.objectStore(store).clear();
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
  });
}
