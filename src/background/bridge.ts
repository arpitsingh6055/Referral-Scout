/**
 * The bridge between what already works and the new campaign layer.
 *
 * The side panel's LinkedIn search has been finding and ranking jobs for a long time, and the referral engine has
 * been finding people. Both keep their results inside `NetworkState`. The new screens read canonical `Job` and
 * `Contact` records instead — and nothing was writing those, so the Jobs screen, the queue and the allocator all
 * sat permanently empty no matter how much the person had actually found.
 *
 * This file copies across, in one direction only: `NetworkState` stays the source of truth for the engines that
 * own it, and nothing here writes back into it. That keeps the old flow working untouched while the new screens
 * get real data, and it means removing this file would break the new UI and nothing else.
 */

import { getNetwork } from './network';
import { enqueueJobs } from './campaign';
import {
  activeCampaign,
  allContacts,
  allJobs,
  getProfile,
  resolveCompany,
  saveCampaign,
  saveContacts,
  saveJobs,
} from '../shared/persistence/campaign-store';
import { newCampaign, type Campaign } from '../shared/domain/campaign';
import { canonicalJobUrl, dedupeKey, normalizeTitle, qualify, type Availability, type Job } from '../shared/domain/job';
import { personKeyOf, type Contact, type ContactCategory, type Relationship } from '../shared/domain/outreach';
import { requirementsFrom } from '../shared/domain/profile';
import type { FoundJob } from '../shared/jobsearch';
import type { NetworkContact } from '../shared/network';
import { parseEmploymentType, parseSeniority, parseWorkMode, hashText } from '../connectors/job-sources';

/* ---------- jobs ---------- */
function toJob(found: FoundJob, now: number, profileVersion: number): Job {
  const url = found.url;
  return {
    id: `job:linkedin:${found.id || hashText(url)}`,
    sourceId: found.id || hashText(url),
    sourceName: 'LinkedIn Jobs',
    canonicalUrl: url,
    alternateUrls: [],
    duplicateGroupId: dedupeKey({ company: found.company, title: found.title, location: found.location, canonicalUrl: url }),
    companyName: found.company,
    title: found.title,
    normalizedTitle: normalizeTitle(found.title),
    seniority: parseSeniority(found.title),
    employmentType: parseEmploymentType(found.title),
    location: found.location,
    workMode: parseWorkMode(`${found.location} ${found.insight}`),
    observedAt: now,
    // A search result does not prove a vacancy is open; only reading the page could, and we have not.
    availability: (found.closed ? 'closed' : 'unknown') as Availability,
    ...(found.why ? { description: found.why, descriptionHash: hashText(found.why) } : {}),
    // The ranking step writes one reason per job rather than a requirement list, so that is what there is to
    // match against. It is thin evidence and the Jobs screen says so rather than inventing bullet points.
    requirements: found.matched?.length ? [...found.matched] : [],
    ...(typeof found.fit === 'number' && found.fitSource === 'chatgpt' ? { aiFit: Math.max(0, Math.min(100, Math.round(found.fit))) } : {}),
    ...(typeof found.fit === 'number' && found.fitSource === 'specialization'
      ? { profileFit: Math.max(0, Math.min(100, Math.round(found.fit))) }
      : {}),
    ...(found.fitSource ? { fitSource: found.fitSource, fitProfileVersion: profileVersion } : {}),
    ...(found.why ? { aiWhy: found.why } : {}),
    responsibilities: [],
    applyType: 'unknown',
    applyUrl: url,
    effort: 'unknown',
    userJudgement: found.picked ? 'shortlisted' : 'none',
    createdAt: now,
    updatedAt: now,
  };
}

export interface BridgeReport {
  jobsAdded: number;
  jobsUpdated: number;
  contactsAdded: number;
}

export async function ensureDefaultCampaignFromNetwork(now = Date.now()): Promise<Campaign | null> {
  const existing = await activeCampaign().catch(() => undefined);
  if (existing) return existing;
  const network = await getNetwork().catch(() => null);
  if (!network) return null;
  const hasActivity = !!(network.profile || network.referralJobs?.length || network.jobSearch?.found?.length || network.targetSet);
  if (!hasActivity) return null;
  const roles = network.settings?.roles?.length ? network.settings.roles : [network.target || 'Target role'];
  const created = newCampaign({
    name: `${roles[0] ?? 'Job Search'}`,
    targetRoles: roles,
    location: network.location || 'India',
    employmentType: network.settings?.employmentType ?? 'any',
    now,
  });
  await saveCampaign(created);
  return created;
}

/**
 * Brings the side panel's search results AND referral jobs across as canonical jobs and qualifies them against the profile.
 *
 * A job already here keeps its own record: the person may have shortlisted, applied or rejected it, and a re-import must
 * not quietly undo that. Only the ranking and the qualification are refreshed.
 */
export async function importJobs(now = Date.now()): Promise<{ added: number; updated: number }> {
  const network = await getNetwork().catch(() => null);
  const searchFound = network?.jobSearch?.found ?? [];
  const referralJobs = network?.referralJobs ?? [];
  const seenUrls = new Set(searchFound.map(j => canonicalJobUrl(j.url) ?? j.url));
  const extraFromReferrals: (FoundJob & { applied?: number })[] = referralJobs
    .filter(r => !seenUrls.has(canonicalJobUrl(r.url) ?? r.url))
    .map(r => ({
      id: hashText(r.url),
      url: r.url,
      title: r.title,
      company: r.company,
      location: r.location,
      insight: '',
      term: r.title,
      score: 75,
      picked: true,
      ...(r.fitNote ? { why: r.fitNote } : {}),
      ...(r.applied ? { applied: r.applied } : {}),
    }));
  const appliedByUrl = new Map(referralJobs.filter(r => !!r.applied).map(r => [canonicalJobUrl(r.url) ?? r.url, r.applied!]));
  const found: (FoundJob & { applied?: number })[] = [...searchFound, ...extraFromReferrals];
  if (!found.length) return { added: 0, updated: 0 };

  const [existing, profile] = await Promise.all([allJobs(), getProfile()]);
  // The matcher's shape is the profile's own derived requirements; the cast narrows the open string unions.
  const reqs = requirementsFrom(profile) as unknown as Parameters<typeof qualify>[1];
  const byUrl = new Map(existing.map(j => [canonicalJobUrl(j.canonicalUrl) ?? j.canonicalUrl, j]));
  const write: Job[] = [];
  let added = 0;
  let updated = 0;

  for (const raw of found) {
    if (!raw.url || !raw.company) continue;
    const key = canonicalJobUrl(raw.url) ?? raw.url;
    const previous = byUrl.get(key);
    const fresh = toJob(raw, now, profile.profileVersion);
    const isApplied = !!(raw.applied || appliedByUrl.get(key));
    const job: Job = previous
      ? {
          ...previous,
          // Applied wins; otherwise the person's own call wins over whatever the search thinks this time.
          userJudgement: isApplied
            ? 'applied'
            : previous.userJudgement && previous.userJudgement !== 'none'
              ? previous.userJudgement
              : (fresh.userJudgement ?? 'none'),
          ...(fresh.description ? { description: fresh.description, descriptionHash: fresh.descriptionHash } : {}),
          requirements: fresh.requirements.length ? fresh.requirements : previous.requirements,
          observedAt: now,
          updatedAt: now,
        }
      : { ...fresh, ...(isApplied ? { userJudgement: 'applied' as const } : {}) };
    job.qualification = qualify(job, reqs, now);
    // The AI ranking has read the full CV, LinkedIn background and job description. Preserve that assessment;
    // the local keyword matcher is only a fallback when the ChatGPT session is unavailable.
    const rankedFit = fresh.aiFit ?? fresh.profileFit;
    if (typeof rankedFit === 'number' && job.qualification) {
      const q = job.qualification;
      q.fit = rankedFit;
      q.fitEvidence = (fresh.requirements ?? []).map(requirement => ({
        requirement,
        state: 'met' as const,
        matchedWith: fresh.fitSource === 'chatgpt' ? 'ChatGPT profile assessment' : 'Profile evidence',
      }));
      q.tier =
        q.eligibility === 'ineligible'
          ? 'blocked'
          : q.fit >= 70 && q.preferenceFit >= 60 && q.freshness !== 'stale'
            ? 'strong'
            : q.fit >= 45
              ? 'possible'
              : 'weak';
    }
    write.push(job);
    if (previous) updated++;
    else added++;
    byUrl.set(key, job);
    await resolveCompany(raw.company).catch(() => undefined);
  }
  await saveJobs(write);
  return { added, updated };
}

/* ---------- contacts ---------- */
const CATEGORY: Record<string, ContactCategory> = {
  recruiter: 'recruiter',
  leader: 'hiring-manager',
  founder: 'founder',
  senior: 'peer',
  peer: 'peer',
  employee: 'peer',
};

function relationshipOf(person: NetworkContact): Relationship {
  if (person.direct || person.state === 'connected' || person.state === 'messaging' || person.state === 'messaged')
    return 'existing-connection';
  if (/alum|college|university|school/i.test(person.reason ?? '')) return 'alumni';
  return 'second-degree';
}

function toContact(person: NetworkContact, now: number): Contact {
  const personKey = personKeyOf({
    ...(person.url ? { profileUrl: person.url } : {}),
    name: person.name,
    ...(person.companyName ? { companyName: person.companyName } : {}),
  });
  return {
    id: `contact:${personKey}`,
    personKey,
    name: person.name,
    ...(person.headline ? { currentRole: person.headline } : {}),
    ...(person.companyName ? { companyName: person.companyName } : {}),
    ...(person.url ? { profileUrl: person.url } : {}),
    relationship: relationshipOf(person),
    category: CATEGORY[person.category ?? ''] ?? 'unknown',
    evidence: person.reason ? [{ claim: person.reason, source: 'LinkedIn', observedAt: now, confidence: 0.8 }] : [],
    // The ranking score is out of 100 where the engine set one; otherwise identity is simply unconfirmed.
    confidence: person.score !== undefined ? Math.max(0.3, Math.min(1, person.score / 100)) : 0.5,
    emailConfidence: 'unknown',
    ...(person.outcome === 'declined' ? { suppressed: { at: person.outcomeAt ?? now, reason: 'They declined.' } } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export async function importContacts(now = Date.now()): Promise<number> {
  const network = await getNetwork().catch(() => null);
  const people = network?.contacts ?? [];
  if (!people.length) return 0;
  const existing = new Map((await allContacts()).map(c => [c.personKey, c]));
  const write: Contact[] = [];
  for (const person of people) {
    const fresh = toContact(person, now);
    const previous = existing.get(fresh.personKey);
    // A suppression is permanent and is never cleared by a re-import.
    write.push(previous?.suppressed ? { ...fresh, suppressed: previous.suppressed } : fresh);
  }
  await saveContacts(write);
  return write.filter(c => !existing.has(c.personKey)).length;
}

/**
 * Runs both. Called when a workbench screen is opened and on the runner's tick, so the new screens reflect
 * whatever the side panel has found without the person having to press anything.
 */
export async function syncFromNetwork(now = Date.now()): Promise<BridgeReport> {
  const campaign = await ensureDefaultCampaignFromNetwork(now).catch(() => null);
  const [jobs, contactsAdded] = await Promise.all([
    importJobs(now).catch(() => ({ added: 0, updated: 0 })),
    importContacts(now).catch(() => 0),
  ]);
  if (campaign?.application.autoAdmit && (jobs.added > 0 || jobs.updated > 0)) {
    await enqueueShortlisted().catch(() => undefined);
  }
  return { jobsAdded: jobs.added, jobsUpdated: jobs.updated, contactsAdded };
}

/**
 * Puts every job the person shortlisted into the application queue, skipping anything already there.
 * This is what turns "I picked these" into work the runner will actually do.
 */
export async function enqueueShortlisted(): Promise<{ added: number; skipped: string[] }> {
  const campaign = (await activeCampaign()) ?? undefined;
  if (!campaign) throw new Error('Create a campaign first.');
  const jobs = await allJobs();
  const shortlisted = jobs.filter(j => j.userJudgement === 'shortlisted' && j.qualification?.tier !== 'blocked');
  if (!shortlisted.length) return { added: 0, skipped: [] };
  const report = await enqueueJobs(
    campaign.id,
    shortlisted.map(j => ({
      jobId: j.id,
      url: j.canonicalUrl,
      company: j.companyName,
      title: j.title,
      location: j.location,
      fit: j.qualification?.fit ?? 0,
      route: j.applyType === 'easy-apply' ? ('easy-apply' as const) : j.applyType === 'ats' ? ('external' as const) : ('unknown' as const),
      source: j.sourceName,
      ...(j.postedAt ? { postedAt: j.postedAt } : {}),
      ...(j.atsHost ? { ats: j.atsHost } : {}),
    })),
  );
  return { added: report.added, skipped: report.skipped.map(s => `${s.company} — ${s.reason}`) };
}
