import { get, put, openDatabase } from './database';
export async function read<T>(id: string): Promise<T | undefined> {
  return (await get('meta', id))?.value as T | undefined;
}
export async function write(id: string, value: unknown): Promise<void> {
  await put('meta', { id, value });
}
/** Read, change and save one value in a single transaction, so two updates can never overwrite each other. */
export async function mutate<T>(id: string, fn: (old: T | undefined) => T): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite'),
      store = tx.objectStore('meta'),
      request = store.get(id);
    let result: T;
    request.onsuccess = () => {
      try {
        result = fn(request.result?.value as T | undefined);
        store.put({ id, value: result });
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}
