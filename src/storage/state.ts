import { all, get, put, openDatabase } from "./database";
import type { Lead, Job, Campaign, SendLog, ProviderHealth } from "../shared/runtime";
export async function read<T>(id: string): Promise<T | undefined> { return (await get("meta", id))?.value as T | undefined; }
export async function write(id: string, value: unknown): Promise<void> { await put("meta", { id, value }); }
export async function list<T>(prefix: string): Promise<T[]> { return (await all("meta")).filter(v => v.id.startsWith(prefix)).map(v => v.value as T); }
export const leads = () => list<Lead>("lead:");
export const jobs = () => list<Job>("job:");
export const logs = () => list<SendLog>("sendlog:");
export const campaign = () => read<Campaign>("campaign");
export async function event(message: string, level: "info" | "warning" | "error" = "info", jobId: string | null = null): Promise<void> {
  await put("event", { id: crypto.randomUUID(), createdAt: Date.now(), level, message: message.slice(0, 2000), jobId });
}
export async function saveLead(lead: Lead): Promise<void> {
  lead.updatedAt = Date.now(); await write(`lead:${lead.id}`, lead);
  const base = { id: lead.id, createdAt: lead.createdAt, updatedAt: lead.updatedAt, stage: lead.stage };
  await put("company", { ...base, name: lead.name, url: lead.url, domain: lead.domain || null, score: lead.score, breakdown: lead.breakdown });
  if (lead.contact) await put("person", { ...base, companyId: lead.id, name: lead.contact.name, profileUrl: lead.contact.url, title: lead.contact.title, location: lead.contact.location });
  if (lead.email) await put("email", { ...base, personId: lead.id, address: lead.email, method: lead.method, sourceUrl: lead.sourceUrl || null, evidenceQuote: lead.evidence, confirmed: lead.confirmed, mxCheckedAt: lead.mx ? Date.now() : null });
  if (lead.role) await put("role", { ...base, companyId: lead.id, title: lead.role, posted: !lead.suggested, sourceUrl: lead.roles[0]?.source_url ?? null });
  if (lead.draft) await put("draft", { ...base, personId: lead.id, subjectA: lead.draft.subject_a, subjectB: lead.draft.subject_b, body: lead.draft.body, provider: lead.provider, proofPointId: lead.draft.proof_point_id });
}
export const providerHealth = async (provider: string): Promise<ProviderHealth> => await read(`health:${provider}`) ?? { failures: 0, disabledUntil: 0, lastError: "" };
export async function mutate<T>(id: string, fn: (old: T | undefined) => T): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite"), store = tx.objectStore("meta"), request = store.get(id);
    let result: T;
    request.onsuccess = () => { try { result = fn(request.result?.value as T | undefined); store.put({ id, value: result }); } catch (e) { tx.abort(); reject(e); } };
    tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted")); tx.onerror = () => reject(tx.error);
  });
}
