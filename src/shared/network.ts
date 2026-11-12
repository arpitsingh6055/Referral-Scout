import { z } from 'zod';
import { classify, suggestTarget } from './targeting';
import type { ReferralJob } from './referral';
import type { JobSearch, SearchPlan } from './jobsearch';
export const DAY = 86400000;
export const networkKey = 'network-v1'; // Retain old state for lossless migration; mirror entities in v2 stores.
export function profileUrl(value: string): string | null {
  try {
    const u = new URL(value, 'https://www.linkedin.com');
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !['www.linkedin.com', 'linkedin.com'].includes(u.hostname))
      return null;
    const match = /^\/in\/([^/]+)\/?$/.exec(u.pathname);
    return match ? `https://www.linkedin.com/in/${match[1]}/` : null;
  } catch {
    return null;
  }
}
export const networkProfileSchema = z.object({
  name: z.string().min(1).max(150),
  url: z.string().refine(v => profileUrl(v) === v),
  headline: z.string().max(500),
  location: z.string().max(200),
  about: z.string(),
  degree: z.number().int().min(1).max(3).optional(),
  rawText: z.string().optional(),
  sections: z.record(z.string(), z.string()).optional(),
  sourceCapturedAt: z.number().optional(),
  completeness: z.record(z.string(), z.boolean()).optional(),
  /** LinkedIn's own "Current: Recruiter at X" line from search results, or the company shown on the profile. */
  current: z.string().max(300).optional(),
});
export type NetworkProfile = z.infer<typeof networkProfileSchema>;
/** A person or job the user chose to remember from a LinkedIn page, with their own note. */
export const savedItemSchema = z
  .object({
    type: z.enum(['person', 'job']),
    url: z.string().max(300),
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().max(500).default(''),
    company: z.string().max(200).optional(),
    relation: z.enum(['connected', 'pending', 'not-connected', 'unknown']).optional(),
    note: z.string().max(300).default(''),
  })
  .refine(i => (i.type === 'person' ? profileUrl(i.url) === i.url : /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/$/.test(i.url)));
export const jobStatuses = ['saved', 'applied', 'interviewing', 'offer', 'rejected'] as const;
export type JobStatus = (typeof jobStatuses)[number];
export type SavedItem = z.infer<typeof savedItemSchema> & {
  savedAt: number;
  acceptedAt?: number;
  status?: JobStatus;
  statusAt?: number;
  remindAt?: number;
};
/** Requests still unanswered after this long are worth withdrawing: they count against LinkedIn's pending limit. */
export const STALE_REQUEST = 21 * 86400000;
export interface StaleRequest {
  name: string;
  url: string;
  since: number;
}
export function staleRequests(s: Pick<NetworkState, 'contacts' | 'saved'>, now = Date.now()): StaleRequest[] {
  const tracked = s.contacts
    .filter(p => p.state === 'pending' && p.requestedAt > 0 && now - p.requestedAt > STALE_REQUEST)
    .map(p => ({ name: p.name, url: p.url, since: p.requestedAt }));
  const remembered = (s.saved ?? [])
    .filter(
      i =>
        i.type === 'person' &&
        i.relation === 'pending' &&
        !i.acceptedAt &&
        now - i.savedAt > STALE_REQUEST &&
        !tracked.some(t => t.url === i.url),
    )
    .map(i => ({ name: i.title, url: i.url, since: i.savedAt }));
  return [...tracked, ...remembered].sort((a, b) => a.since - b.since);
}
export const dueReminders = (s: Pick<NetworkState, 'saved'>, now = Date.now()): SavedItem[] =>
  (s.saved ?? []).filter(i => i.remindAt !== undefined && i.remindAt <= now);
export const rememberMessage = z.object({
  kind: z.literal('network.remember'),
  action: z.enum(['get', 'save', 'remove']),
  item: savedItemSchema,
});
/** 'found' = listed for a job's referrals but not queued for any contact until the person asks. */
export type ContactState =
  'found' | 'shortlisted' | 'requesting' | 'pending' | 'connected' | 'messaging' | 'messaged' | 'attention' | 'skipped' | 'review';
export interface NetworkContact extends NetworkProfile {
  state: ContactState;
  reason: string;
  addedAt: number;
  requestedAt: number;
  checkedAt: number;
  messagedAt: number;
  message: string;
  nextCheckAt?: number;
  acceptedAt?: number;
  invitationNote?: string;
  invitationLimit?: number;
  companyName?: string;
  companyUrl?: string;
  approvalKind?: 'connect' | 'message';
  approved?: boolean;
  attemptedAt?: number;
  /** Already a 1st-degree connection when found: no invitation is needed, only a message. */
  direct?: boolean;
  /** What came of it, marked by the person: they wrote back, agreed to refer, or said no. */
  /** LinkedIn's own id for this person in messaging, learned the first time their conversation is opened. */
  messagingId?: string;
  /** The conversation with them, kept quietly for drafting replies. Never shown in the side panel. */
  thread?: { mine: boolean; text: string }[];
  outcome?: 'replied' | 'referred' | 'declined';
  outcomeAt?: number;
  /** The job (its LinkedIn address) this person was found for, when the aim is a referral. */
  referralJob?: string;
  /** Queued by the person's own "Ask for referrals" click: that click is the approval, so no second one is asked for. */
  auto?: boolean;
  lastError?: string;
  score?: number;
  category?: string;
  failures?: number;
  retryAfter?: number;
}
/** The note before v0.11.1. It asked a recruiter about "your work", which is the wrong thing to say to someone who hires. */
export const legacyNoteTemplate =
  'Hi {firstName}, I’m {myFirstName}, exploring {target} opportunities. Would love to connect and learn about your work at {company}.';
/** {ask} is the closing line, chosen by who the person is: a recruiter, a team leader or a founder. */
export const defaultNoteTemplate = 'Hi {firstName}, I’m {myFirstName}, exploring {target} opportunities. {ask}';
export function askFor(category: string | undefined, company: string | undefined): string {
  const at = company ? ` at ${company}` : '';
  if (category === 'leader') return `Would love to connect and learn about your team’s work${at}.`;
  if (category === 'founder') return `Would love to connect and learn about what you’re building${at}.`;
  // Recruiters and anyone unclassified: ask about openings, never about "their work".
  return company
    ? `Would love to connect in case there are relevant openings at ${company}.`
    : 'Would love to connect in case you’re hiring for relevant roles.';
}
export const outreachSettingsSchema = z.object({
  roles: z.array(z.string().trim().min(2).max(140)).min(1).max(30),
  outreachMode: z.enum(['automatic', 'review']),
  noteMode: z.enum(['require', 'preferred', 'none']),
  followupMode: z.enum(['automatic', 'review']),
  paceMinutes: z.number().min(0.08).max(1440), // minutes between sends; fractions allowed (0.5 = 30 seconds)
  dailyInvites: z.number().int().positive().nullable(),
  dailyMessages: z.number().int().positive().nullable(),
  maxPending: z.number().int().positive().nullable(),
  companyAllowlist: z.array(z.string()).default([]),
  companyExclusions: z.array(z.string()).default([]),
  workMode: z.enum(['any', 'remote', 'hybrid', 'onsite']).default('any'),
  employmentType: z.enum(['any', 'internship', 'full-time']).default('any'),
  aiMode: z.enum(['template', 'chatgpt']).default('template'),
  noteTemplate: z.string().trim().min(10).max(1200).default(defaultNoteTemplate),
  weeklyInvites: z.number().int().positive().nullable().default(80),
  activeHours: z
    .object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) })
    .nullable()
    .default(null),
});
export type OutreachSettings = z.infer<typeof outreachSettingsSchema>;
export const defaultSettings: OutreachSettings = {
  roles: ['Product Management internship'],
  outreachMode: 'review',
  noteMode: 'preferred',
  followupMode: 'review',
  paceMinutes: 0.5,
  dailyInvites: 30,
  dailyMessages: 20,
  maxPending: 100,
  companyAllowlist: [],
  companyExclusions: [],
  workMode: 'any',
  employmentType: 'any',
  aiMode: 'template',
  noteTemplate: defaultNoteTemplate,
  weeklyInvites: 80,
  activeHours: null,
};
export interface NetworkState {
  profile: NetworkProfile | null;
  target: string;
  location: string;
  template: string;
  cv: {
    name: string;
    type: string;
    text: string;
    textVersion?: number;
    pages?: number;
    warnings?: string[];
    savedAt?: number;
    characterCount?: number;
  } | null;
  dossier?: string;
  dossierSavedAt?: number;
  profileCapturedAt?: number;
  active: boolean;
  /** Everything is stopped (by the person or by an account-level problem) until something is started or resumed. */ paused?: boolean;
  /** What was running when everything was paused, so Resume restores exactly that. */ resumeTo?: {
    active: boolean;
    scope?: 'all' | 'referrals';
  };
  revision: number;
  status: string;
  contacts: NetworkContact[];
  ownerVerifiedAt?: number;
  nextSweepAt?: number;
  jobSearch?: JobSearch;
  plan?: SearchPlan;
  /** 'referrals' = only people from Referrals jobs are contacted; general searching and outreach stay off. */
  scope?: 'all' | 'referrals';
  referralJobs?: ReferralJob[];
  saved?: SavedItem[];
  aiDefaultV3?: boolean;
  noteV2?: boolean;
  paceV2?: boolean;
  hoursV2?: boolean;
  limitsV2?: boolean;
  /** The person pressed "Check now": look at acceptances and replies on the next step, whatever else is going on. */
  checkRequested?: boolean;
  /** When replies were last looked for in LinkedIn messaging. */
  repliesCheckedAt?: number;
  /** The person has said what they are looking for; until then setup asks instead of assuming. */ targetSet?: boolean;
  /** Shown to the side panel only: whether an API key is saved, its model and its last four characters. Never the key. */ api?: {
    model: string;
    ending: string;
  };
  settings?: OutreachSettings;
  log?: { at: number; text: string; kind: 'ok' | 'info' | 'warn' }[];
  searchCursor: number;
  failureStreak?: number;
  nextDiscoveryAt: number;
  nextActionAt: number;
  actions: { at: number; kind: 'connect' | 'message' | 'check'; url: string; confirmed?: boolean; idempotencyKey?: string }[];
  intent: {
    id: string;
    tabId: number;
    url: string;
    kind: 'connect' | 'message';
    at: number;
    body: string;
    revision: number;
    claimed: boolean;
  } | null;
}
export const defaultTemplate =
  'Hi {firstName}, thanks for connecting! I’m exploring {target} opportunities and would love to hear about your team. Would you be open to a brief chat?';
export function suggestedTarget(headline: string, experienceText = ''): string {
  return suggestTarget(headline, experienceText);
}
export function emptyNetwork(): NetworkState {
  return {
    profile: null,
    target: 'Product Management internship',
    location: 'India',
    template: defaultTemplate,
    cv: null,
    active: false,
    revision: 0,
    status: '',
    contacts: [],
    settings: { ...defaultSettings, roles: [...defaultSettings.roles] },
    searchCursor: 0,
    nextDiscoveryAt: 0,
    nextActionAt: 0,
    actions: [],
    intent: null,
  };
}
/** Several versions can be written, separated by a line containing only ---. Each person gets one, so messages are not identical. */
export function pickVariant(text: string, seed: string): string {
  const variants = text
    .split(/\n\s*-{3,}\s*\n/)
    .map(v => v.trim())
    .filter(Boolean);
  if (variants.length < 2) return text;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return variants[h % variants.length]!;
}
export function introduction(
  s: Pick<NetworkState, 'template' | 'target'>,
  person: Pick<NetworkProfile, 'name'> & { companyName?: string; category?: string },
  me?: string,
): string {
  return pickVariant(s.template, person.name)
    .replace(/\{ask\}/g, askFor(person.category, person.companyName))
    .replace(/\{firstName\}/g, person.name.split(/\s+/)[0] || person.name)
    .replace(/\{target\}/g, s.target)
    .replace(/\{myFirstName\}/g, me?.split(/\s+/)[0] ?? '')
    .replace(/\s+at\s+\{company\}/g, person.companyName ? ` at ${person.companyName}` : '')
    .replace(/\{company\}/g, person.companyName ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
/** First message to someone who is ALREADY a connection: no "thanks for connecting", and an ask that fits who they are. */
export function directMessage(
  s: Pick<NetworkState, 'target'>,
  person: Pick<NetworkProfile, 'name'> & { companyName?: string; category?: string },
  me?: string,
): string {
  const first = person.name.split(/\s+/)[0] || person.name,
    at = person.companyName ? ` at ${person.companyName}` : '';
  const ask =
    person.category === 'leader'
      ? `Would you be open to a short chat about your team${at}?`
      : person.category === 'founder'
        ? `Would you be open to a short chat about what you’re building${at}?`
        : `Are there any relevant openings${at} I could apply for, or someone I should speak to?`;
  return `Hi ${first}, hope you’re doing well. I’m ${me?.split(/\s+/)[0] ?? ''}, currently exploring ${s.target} opportunities. ${ask}`
    .replace(/I’m , /, 'I’m ')
    .replace(/\s{2,}/g, ' ');
}
/** How often the connections list is read to see who accepted. One page load covers every pending invitation. */
export const ACCEPTANCE_SWEEP = 2 * 3600000;
/** Connection notes are limited to 200 characters. Shorten at a sentence or word boundary, never mid-word. */
export function fitNote(text: string, limit = 200): string {
  let note = text.replace(/\s+/g, ' ').trim();
  while (note.length > limit) {
    const cut = note.slice(0, note.lastIndexOf('. ', note.length - 2) + 1);
    if (cut.length >= 40) {
      note = cut;
      continue;
    }
    note = note.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
    break;
  }
  return note;
}
export function renderNote(
  settings: Pick<OutreachSettings, 'noteTemplate'>,
  target: string,
  person: Pick<NetworkProfile, 'name'> & { companyName?: string; category?: string },
  me: string,
): string {
  return fitNote(introduction({ template: settings.noteTemplate, target }, person, me));
}
export function relevance(headline: string, target: string): string | null {
  return classify({ headline }, { roles: [target] })?.reason ?? null;
}
/** Local-time quiet hours. Acting at 3 a.m. is both unnatural and a common automation signal. */
export function withinActiveHours(settings: Pick<OutreachSettings, 'activeHours'>, now = Date.now()): boolean {
  const hours = settings.activeHours;
  if (!hours) return true;
  const h = new Date(now).getHours();
  return hours.from < hours.to ? h >= hours.from && h < hours.to : h >= hours.from || h < hours.to;
}
export const MAX_REVIEW_QUEUE = 5;
export const SHORTLIST_BACKLOG = 15;
export function nextContact(s: NetworkState, now = Date.now()): NetworkContact | undefined {
  const settings = s.settings ?? defaultSettings;
  const within = (kind: 'connect' | 'message', span = DAY) =>
    s.actions.filter(a => a.kind === kind && a.confirmed !== false && now - a.at < span).length;
  const permit = (kind: 'connect' | 'message') => {
    const cap = kind === 'connect' ? settings.dailyInvites : settings.dailyMessages;
    if (cap !== null && within(kind) >= cap) return false;
    return kind === 'message' || settings.weeklyInvites === null || within('connect', 7 * DAY) < settings.weeklyInvites;
  };
  const ready = (p: NetworkContact) => (p.retryAfter ?? 0) <= now;
  const due = s.contacts.find(
    p => ready(p) && p.state === 'pending' && p.requestedAt > 0 && now >= (p.nextCheckAt ?? (p.checkedAt || p.requestedAt) + DAY),
  );
  if (due) return due;
  // Messages the person approved go next, ahead of new drafts and searches.
  const approved = s.contacts.find(
    p => ready(p) && p.state === 'review' && p.approved && permit(p.approvalKind === 'message' ? 'message' : 'connect'),
  );
  if (approved) return approved;
  // Never draft more than a handful of messages the user has not looked at yet.
  if (s.contacts.filter(p => p.state === 'review' && !p.approved).length >= MAX_REVIEW_QUEUE) return undefined;
  if (permit('message')) {
    const accepted = s.contacts.find(p => ready(p) && p.state === 'connected' && !p.messagedAt);
    if (accepted) return accepted;
  }
  const pending = s.contacts.filter(p => p.state === 'pending').length;
  if (!permit('connect') || (settings.maxPending !== null && pending >= settings.maxPending)) return undefined;
  // Best candidates first: recruiters and 2nd-degree connections outrank everything else.
  return s.contacts
    .filter(p => ready(p) && p.state === 'shortlisted')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.addedAt - b.addedAt)[0];
}
export const networkRequest = z.discriminatedUnion('action', [
  z.object({ kind: z.literal('network'), action: z.literal('analyze') }),
  z.object({ kind: z.literal('network'), action: z.literal('importDossier'), text: z.string().trim().min(20).max(200000) }),
  z.object({ kind: z.literal('network'), action: z.literal('recoverAi') }),
  z.object({ kind: z.literal('network'), action: z.literal('resetAi') }),
  z.object({ kind: z.literal('network'), action: z.literal('status') }),
  z.object({ kind: z.literal('network'), action: z.literal('ownerData') }),
  z.object({ kind: z.literal('network'), action: z.literal('export') }),
  z.object({ kind: z.literal('network'), action: z.literal('diagnostics') }),
  z.object({ kind: z.literal('network'), action: z.literal('selfTest') }),
  z.object({ kind: z.literal('network'), action: z.literal('import') }),
  z.object({ kind: z.literal('network'), action: z.literal('start') }),
  z.object({ kind: z.literal('network'), action: z.literal('pause') }),
  z.object({ kind: z.literal('network'), action: z.literal('clear'), confirm: z.literal(true) }),
  z.object({ kind: z.literal('network'), action: z.literal('deleteCv') }),
  z.object({ kind: z.literal('network'), action: z.literal('approve'), url: z.string() }),
  z.object({ kind: z.literal('network'), action: z.literal('unapprove'), url: z.string() }),
  z.object({
    kind: z.literal('network'),
    action: z.literal('save'),
    target: z.string().trim().min(2).max(160),
    location: z.string().trim().max(160),
    template: z.string().trim().min(10).max(1500),
    settings: outreachSettingsSchema.optional(),
  }),
  z.object({
    kind: z.literal('network'),
    action: z.literal('saveCv'),
    name: z.string().trim().min(1).max(200),
    type: z.string().max(120),
    text: z.string().min(1),
    pages: z.number().int().optional(),
  }),
  z.object({ kind: z.literal('network'), action: z.literal('prepare'), url: z.string() }),
  z.object({ kind: z.literal('network'), action: z.literal('skip'), url: z.string() }),
  z.object({
    kind: z.literal('network'),
    action: z.literal('outcome'),
    url: z.string(),
    outcome: z.enum(['replied', 'referred', 'declined']).nullable(),
  }),
  z.object({ kind: z.literal('network'), action: z.literal('jobApplied'), url: z.string(), applied: z.boolean() }),
  z.object({
    kind: z.literal('network'),
    action: z.literal('saveApi'),
    key: z.string().trim().min(20).max(400),
    model: z.string().trim().min(2).max(80),
  }),
  z.object({ kind: z.literal('network'), action: z.literal('clearApi') }),
  z.object({ kind: z.literal('network'), action: z.literal('stopSending') }),
  z.object({ kind: z.literal('network'), action: z.literal('skipAttention') }),
  z.object({ kind: z.literal('network'), action: z.literal('skipCompany'), url: z.string() }),
  z.object({ kind: z.literal('network'), action: z.literal('stopCompany'), url: z.string() }),
  z.object({ kind: z.literal('network'), action: z.literal('finishScans') }),
  z.object({ kind: z.literal('network'), action: z.literal('finishJobSearch') }),
  z.object({ kind: z.literal('network'), action: z.literal('checkNow') }),
  z.object({ kind: z.literal('network'), action: z.literal('testApi') }),
  z.object({ kind: z.literal('network'), action: z.literal('forget'), url: z.string() }),
  z.object({ kind: z.literal('network'), action: z.literal('askReferral'), url: z.string() }),
  z.object({ kind: z.literal('network'), action: z.literal('findJobs') }),
  z.object({ kind: z.literal('network'), action: z.literal('resume') }),
  z.object({ kind: z.literal('network'), action: z.literal('cancelJobSearch') }),
  z.object({
    kind: z.literal('network'),
    action: z.literal('pickJobs'),
    ids: z.array(z.string().regex(/^\d+$/)).min(1).max(20),
    perCompany: z.number().int().min(1).max(5),
  }),
  z.object({ kind: z.literal('network'), action: z.literal('referralDecision'), url: z.string(), widen: z.boolean() }),
  z.object({ kind: z.literal('network'), action: z.literal('removeReferralJob'), url: z.string() }),
  z.object({
    kind: z.literal('network'),
    action: z.literal('updateSaved'),
    url: z.string(),
    status: z.enum(jobStatuses).optional(),
    remindDays: z.number().min(0).max(365).nullable().optional(),
    note: z.string().max(300).optional(),
  }),
  z.object({ kind: z.literal('network'), action: z.literal('editDraft'), url: z.string(), text: z.string().trim().min(1).max(2000) }),
  z.object({ kind: z.literal('network'), action: z.literal('templateDraft'), url: z.string() }),
  z.object({ kind: z.literal('network'), action: z.literal('removeContact'), url: z.string() }),
]);
export type NetworkRequest = z.infer<typeof networkRequest>;
export const networkPageCommand = z.object({
  kind: z.literal('network.page'),
  requestId: z.uuid(),
  deadline: z.number(),
  action: z.enum([
    'identity',
    'profile',
    'search',
    'connections',
    'companyId',
    'inbox',
    'sentInvitations',
    'companies',
    'jobs',
    'jobInfo',
    'relationship',
    'connect',
    'message',
    'selftest',
  ]),
  url: z.string().default(''),
  intentId: z.string().default(''),
  body: z.string().default(''),
  noteMode: z.enum(['require', 'preferred', 'none']).default('preferred'),
});
export type NetworkPageCommand = z.infer<typeof networkPageCommand>;
export const networkReplySchema = z.object({
  requestId: z.uuid(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().max(2000).optional(),
});

/** What is left unfinished, in plain words: shown while paused and announced on Resume. */
export function unfinished(s: NetworkState, sending = s.resumeTo?.active ?? s.active): string[] {
  const out: string[] = [],
    jobs = s.referralJobs ?? [],
    open = jobs.filter(j => j.finishedAt === undefined && !j.waiting).length,
    asks = jobs.filter(j => j.waiting).length;
  if (s.jobSearch?.status === 'finding')
    out.push(
      s.plan
        ? `the job search (${Math.min(s.jobSearch.cursor, s.plan.terms.length)} of ${s.plan.terms.length} titles done)`
        : 'the job search',
    );
  if (open) out.push(`people searches at ${open} ${open === 1 ? 'company' : 'companies'}`);
  const scope = s.resumeTo?.scope ?? s.scope,
    queue = s.contacts.filter(
      p =>
        (scope !== 'referrals' || p.referralJob) &&
        (['shortlisted', 'requesting', 'messaging'].includes(p.state) ||
          (p.state === 'review' && p.approved) ||
          (p.state === 'connected' && p.auto)),
    ).length;
  if (sending && queue) out.push(`${queue} ${queue === 1 ? 'message or invitation' : 'messages and invitations'} to send`);
  if (asks) out.push(`${asks} ${asks === 1 ? 'company waits' : 'companies wait'} for your answer`);
  return out;
}

/** The range that rarely draws LinkedIn's attention. Above it the person is warned, never blocked. */
export const SAFE = { daily: 30, weekly: 100, paceSeconds: 20, companies: 10 };
/** Plain-words reasons why these limits are riskier than recommended; empty when they are within the safe range. */
export function riskNotes(daily: number | null, weekly: number | null, paceSeconds: number): string[] {
  const out: string[] = [];
  if (daily === null) out.push('no daily limit on invitations');
  else if (daily > SAFE.daily) out.push(`${daily} invitations a day (recommended: ${SAFE.daily} or fewer)`);
  if (weekly === null) out.push('no weekly limit');
  else if (weekly > SAFE.weekly) out.push(`${weekly} invitations a week (LinkedIn itself allows about ${SAFE.weekly})`);
  if (paceSeconds < SAFE.paceSeconds) out.push(`only ${paceSeconds} seconds between sends (recommended: ${SAFE.paceSeconds} or more)`);
  return out;
}

/** A name as it can be compared between a profile and the messaging list: no brackets, no suffix after a comma, no case. */
export const plainName = (name: string): string =>
  name
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]!
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
/**
 * Who has written back, read from the conversation list in LinkedIn messaging: a conversation with someone who was
 * asked, whose latest message is theirs. Two people with the same name are left for the person to mark.
 */
export function repliesFrom(rows: { name: string; mine: boolean }[], contacts: NetworkContact[]): string[] {
  const asked = contacts.filter(p => !p.outcome && (p.messagedAt > 0 || p.requestedAt > 0)),
    out: string[] = [];
  for (const row of rows) {
    if (row.mine) continue;
    const same = asked.filter(p => plainName(p.name) === plainName(row.name));
    if (same.length === 1) out.push(same[0]!.url);
  }
  return out;
}

export const threadMessage = z.object({
  kind: z.literal('network.thread'),
  action: z.enum(['sync', 'draft']),
  id: z.string().max(120),
  /** The person's own profile address, when the conversation shows it (chat windows opened from a profile do). */
  url: z.string().max(300).optional(),
  name: z.string().min(1).max(200),
  messages: z.array(z.object({ mine: z.boolean(), text: z.string().max(800) })).max(20),
});
/** The person a conversation belongs to: by LinkedIn's messaging id once known, otherwise by a name only one of them has. */
export function contactForThread(contacts: NetworkContact[], id: string, name: string, url?: string): NetworkContact | undefined {
  // 1. The profile address (its last part is the person's permanent LinkedIn name) is exact. 2. So is LinkedIn's
  // messaging id, learned from the connections page. 3. Otherwise a name that only one contacted person has.
  const exact = (url ? contacts.find(p => p.url === url) : undefined) ?? (id ? contacts.find(p => p.messagingId === id) : undefined);
  if (exact) return exact;
  const same = contacts.filter(
    p => !p.messagingId && plainName(p.name) === plainName(name) && (p.requestedAt > 0 || p.messagedAt > 0 || !!p.acceptedAt || !!p.direct),
  );
  return same.length === 1 ? same[0] : undefined;
}

/** The last part of a profile address: the person's permanent LinkedIn name, unique to them. */
export const slugOf = (url: string): string => /\/in\/([^/?#]+)/.exec(url)?.[1] ?? '';
/** One line on what has happened with a person, for showing next to their conversation. */
export function historyLine(p: NetworkContact): string {
  const day = (t: number): string => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const parts: string[] = [];
  if (p.requestedAt > 0) parts.push(`invited ${day(p.requestedAt)}`);
  if (p.acceptedAt) parts.push(`accepted ${day(p.acceptedAt)}`);
  if (p.messagedAt > 0) parts.push(`messaged ${day(p.messagedAt)}`);
  if (p.outcome) parts.push(p.outcome === 'referred' ? 'agreed to refer you' : p.outcome === 'declined' ? 'cannot help' : 'replied');
  return parts.length ? parts.join(' · ') : 'on your list, not contacted yet';
}
