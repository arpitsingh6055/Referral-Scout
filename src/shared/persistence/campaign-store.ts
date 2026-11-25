/**
 * Typed access to the campaign-layer stores.
 *
 * `change` is the important one: it reads, modifies and writes a record inside a single IndexedDB transaction. The
 * queue runner, the exception inbox and the side panel can all touch the same application at the same moment, and a
 * read-then-write done in two steps loses whichever change finished first. For the queue that would mean a state
 * transition disappearing — which is exactly the kind of lost fact that turns into a duplicate submission.
 */

import {
  openDatabase,
  all,
  get,
  put,
  remove,
  currentResetGeneration,
  shouldAbortStaleWrite,
  type Records,
  type Store,
  type Keyed,
} from '../../storage/database';
import type { ApplicationTask } from '../state-machines/application-task';
import type { ApplicationException } from '../domain/exceptions';
import type { CandidateFact } from '../domain/facts';
import type { Campaign } from '../domain/campaign';
import { canonicalCompany, type Company, type Job } from '../domain/job';
import { emptyProfile, touch, type CandidateProfile } from '../domain/profile';
import type { Contact, OutreachTask } from '../domain/outreach';
import type { AIContext, AuditEvent, GmailThread, Notification } from '../domain/system';

type CampaignStore = Extract<
  Store,
  | 'campaigns'
  | 'jobs'
  | 'companies'
  | 'profiles'
  | 'applications'
  | 'exceptions'
  | 'facts'
  | 'contacts'
  | 'outreach'
  | 'threads'
  | 'aiContexts'
  | 'events'
  | 'notifications'
  | 'audit'
>;

/** Read, change and save one record in a single transaction. Returning undefined from `fn` leaves it untouched. */
export async function change<T extends { id: string }>(
  store: CampaignStore,
  id: string,
  fn: (old: T | undefined) => T | undefined,
): Promise<T | undefined> {
  const capturedGen = currentResetGeneration();
  const db = await openDatabase();
  if (shouldAbortStaleWrite(capturedGen)) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const request = os.get(id);
    let result: T | undefined;
    request.onsuccess = () => {
      try {
        if (shouldAbortStaleWrite(capturedGen)) {
          tx.abort();
          resolve(undefined);
          return;
        }
        result = fn(request.result as T | undefined);
        if (result) os.put(result as unknown as Records[CampaignStore]);
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => (shouldAbortStaleWrite(capturedGen) ? resolve(undefined) : reject(tx.error ?? new Error('Transaction aborted')));
    tx.onerror = () => reject(tx.error);
  });
}

/** Writes several records of one store together, so a grouped change cannot land half-applied. */
export async function putMany<T extends { id: string }>(store: CampaignStore, records: readonly T[]): Promise<void> {
  if (!records.length) return;
  const capturedGen = currentResetGeneration();
  const db = await openDatabase();
  if (shouldAbortStaleWrite(capturedGen)) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const r of records) os.put(r as unknown as Records[CampaignStore]);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

const list = async <T>(store: CampaignStore): Promise<T[]> => (await all(store)) as unknown as T[];
const one = async <T>(store: CampaignStore, id: string): Promise<T | undefined> => (await get(store, id)) as unknown as T | undefined;
const save = async <T extends { id: string }>(store: CampaignStore, record: T): Promise<void> => put(store, record as unknown as Keyed);

/* ---------- campaigns ---------- */
export const allCampaigns = (): Promise<Campaign[]> => list<Campaign>('campaigns');
export const getCampaign = (id: string): Promise<Campaign | undefined> => one<Campaign>('campaigns', id);
export const saveCampaign = (c: Campaign): Promise<void> => save('campaigns', c);
export const changeCampaign = (id: string, fn: (c: Campaign | undefined) => Campaign | undefined): Promise<Campaign | undefined> =>
  change<Campaign>('campaigns', id, fn);

/** The campaign the panel is showing: the running one, else the most recently touched. */
export async function activeCampaign(): Promise<Campaign | undefined> {
  const all = await allCampaigns();
  return all.find(c => c.status === 'running' || c.status === 'stopping') ?? [...all].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/* ---------- applications ---------- */
export const allTasks = (): Promise<ApplicationTask[]> => list<ApplicationTask>('applications');
export const getTask = (id: string): Promise<ApplicationTask | undefined> => one<ApplicationTask>('applications', id);
export const saveTask = (t: ApplicationTask): Promise<void> => save('applications', t);
export const saveTasks = (t: readonly ApplicationTask[]): Promise<void> => putMany('applications', t);
export const changeTask = (
  id: string,
  fn: (t: ApplicationTask | undefined) => ApplicationTask | undefined,
): Promise<ApplicationTask | undefined> => change<ApplicationTask>('applications', id, fn);
export const removeTask = (id: string): Promise<void> => remove('applications', id);

export async function tasksFor(campaignId: string): Promise<ApplicationTask[]> {
  return (await allTasks()).filter(t => t.campaignId === campaignId);
}

/** The task currently open in a tab, so a message from that page finds its application without a tab-keyed store. */
export async function taskForTab(tabId: number): Promise<ApplicationTask | undefined> {
  return (await allTasks()).find(t => t.tabId === tabId);
}

/* ---------- exceptions ---------- */
export const allExceptions = (): Promise<ApplicationException[]> => list<ApplicationException>('exceptions');
export const getException = (id: string): Promise<ApplicationException | undefined> => one<ApplicationException>('exceptions', id);
export const saveExceptions = (e: readonly ApplicationException[]): Promise<void> => putMany('exceptions', e);
export const changeException = (
  id: string,
  fn: (e: ApplicationException | undefined) => ApplicationException | undefined,
): Promise<ApplicationException | undefined> => change<ApplicationException>('exceptions', id, fn);

export async function openExceptionsFor(campaignId: string): Promise<ApplicationException[]> {
  return (await allExceptions()).filter(e => e.campaignId === campaignId && e.status === 'open');
}

/* ---------- facts ---------- */
export const allFacts = (): Promise<CandidateFact[]> => list<CandidateFact>('facts');
export const saveFact = (f: CandidateFact): Promise<void> => save('facts', f);
export const saveFacts = (f: readonly CandidateFact[]): Promise<void> => putMany('facts', f);
export const removeFact = (id: string): Promise<void> => remove('facts', id);

/* ---------- jobs and employers ---------- */
export const allJobs = (): Promise<Job[]> => list<Job>('jobs');
export const getJob = (id: string): Promise<Job | undefined> => one<Job>('jobs', id);
export const saveJobs = (j: readonly Job[]): Promise<void> => putMany('jobs', j);
export const changeJob = (id: string, fn: (j: Job | undefined) => Job | undefined): Promise<Job | undefined> => change<Job>('jobs', id, fn);

export const allCompanies = (): Promise<Company[]> => list<Company>('companies');
export const saveCompanies = (c: readonly Company[]): Promise<void> => putMany('companies', c);

/** One employer, however many jobs point at it. Returns the existing record rather than creating a second one. */
export async function resolveCompany(name: string, domain?: string, now = Date.now()): Promise<Company> {
  const key = canonicalCompany(name);
  const existing = (await allCompanies()).find(c => canonicalCompany(c.canonicalName) === key);
  if (existing) {
    if (domain && !existing.domain) {
      const updated = { ...existing, domain, updatedAt: now };
      await saveCompanies([updated]);
      return updated;
    }
    return existing;
  }
  const made: Company = {
    id: `co:${key || now}`,
    canonicalName: name,
    ...(domain ? { domain } : {}),
    sourceIds: [],
    sizeBand: 'unknown',
    confidence: domain ? 0.9 : 0.6,
    createdAt: now,
    updatedAt: now,
  };
  await saveCompanies([made]);
  return made;
}

/* ---------- candidate profile ---------- */
const PROFILE_ID = 'profile:default';
export const getProfile = async (): Promise<CandidateProfile> => (await one<CandidateProfile>('profiles', PROFILE_ID)) ?? emptyProfile();
export const saveProfile = (p: CandidateProfile): Promise<void> => save('profiles', p);
export const changeProfile = (fn: (p: CandidateProfile) => CandidateProfile): Promise<CandidateProfile | undefined> =>
  change<CandidateProfile>('profiles', PROFILE_ID, old => touch(fn(old ?? emptyProfile())));

/* ---------- contacts and outreach ---------- */
export const allContacts = (): Promise<Contact[]> => list<Contact>('contacts');
export const saveContacts = (c: readonly Contact[]): Promise<void> => putMany('contacts', c);
export const changeContact = (id: string, fn: (c: Contact | undefined) => Contact | undefined): Promise<Contact | undefined> =>
  change<Contact>('contacts', id, fn);

/** A person who asked not to be contacted stays suppressed across every campaign and channel. */
export async function suppressContact(personKey: string, reason: string, now = Date.now()): Promise<number> {
  const matches = (await allContacts()).filter(c => c.personKey === personKey && !c.suppressed);
  await saveContacts(matches.map(c => ({ ...c, suppressed: { at: now, reason }, updatedAt: now })));
  return matches.length;
}

export const allOutreach = (): Promise<OutreachTask[]> => list<OutreachTask>('outreach');
export const saveOutreach = (t: readonly OutreachTask[]): Promise<void> => putMany('outreach', t);
export const changeOutreach = (
  id: string,
  fn: (t: OutreachTask | undefined) => OutreachTask | undefined,
): Promise<OutreachTask | undefined> => change<OutreachTask>('outreach', id, fn);

/* ---------- AI context, mail, notifications, audit ---------- */
export const getAiContext = (id: string): Promise<AIContext | undefined> => one<AIContext>('aiContexts', id);
export const saveAiContext = (c: AIContext): Promise<void> => save('aiContexts', c);
export const allThreads = (): Promise<GmailThread[]> => list<GmailThread>('threads');
export const saveThreads = (t: readonly GmailThread[]): Promise<void> => putMany('threads', t);
export const allNotifications = (): Promise<Notification[]> => list<Notification>('notifications');
export const saveNotification = (n: Notification): Promise<void> => save('notifications', n);
export const recordAudit = (e: AuditEvent): Promise<void> => save('audit', e);
export const allAudit = (): Promise<AuditEvent[]> => list<AuditEvent>('audit');

/* ---------- outcome ledger ---------- */
export type OutcomeType =
  | 'queued'
  | 'filling'
  | 'submitted'
  | 'submission-uncertain'
  | 'assessment'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'
  | 'contact-selected'
  | 'invitation-sent'
  | 'invitation-accepted'
  | 'reply'
  | 'referral-offered'
  | 'referral-submitted'
  | 'bounce';

export interface OutcomeEvent {
  id: string;
  campaignId: string;
  /** The application or contact the event is about. */
  entityId: string;
  entityKind: 'application' | 'contact';
  type: OutcomeType;
  company: string;
  title?: string;
  /** Where the fact came from: the site itself, the person, or a classified email. */
  source: 'site' | 'user' | 'gmail' | 'linkedin' | 'system';
  occurredAt: number;
  observedAt: number;
  /** An inbox-derived event is a reading of a message, not a fact. Low confidence is shown, never applied silently. */
  confidence: 'verified' | 'suggested' | 'needs-confirmation';
  note?: string;
}

export const allEvents = (): Promise<OutcomeEvent[]> => list<OutcomeEvent>('events');
export const saveEvent = (e: OutcomeEvent): Promise<void> => save('events', e);

/** The ledger only ever grows; a correction is a new event, so the history of what was believed stays readable. */
export function recordEvent(input: Omit<OutcomeEvent, 'id' | 'observedAt'> & { observedAt?: number }): Promise<void> {
  const observedAt = input.observedAt ?? Date.now();
  return saveEvent({ ...input, observedAt, id: `evt:${observedAt}:${Math.random().toString(36).slice(2, 8)}` });
}

export async function eventsFor(campaignId: string, limit = 50): Promise<OutcomeEvent[]> {
  return (await allEvents())
    .filter(e => e.campaignId === campaignId)
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, limit);
}
