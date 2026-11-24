/**
 * The candidate workspace: profile, Answer Bank, jobs, contacts, settings and the data controls.
 *
 * Kept apart from `campaign.ts` so the runner's services and the person's own records do not end up in one file.
 * Everything here edits what the person owns; nothing here starts work.
 */

import { z } from 'zod';
import {
  allCompanies,
  allContacts,
  allFacts,
  allJobs,
  changeJob,
  changeProfile,
  getProfile,
  removeFact,
  saveFacts,
  saveJobs,
  suppressContact,
  type OutcomeEvent,
} from '../shared/persistence/campaign-store';
import { CATALOGUE, completeness, makeFact, sections, statusOf, type CandidateFact, type FactSection } from '../shared/domain/facts';
import {
  documentFor,
  emptyProfile,
  unverified,
  yearsOfExperience,
  conflicts,
  type CandidateProfile,
  type DocumentRecord,
  type EducationRecord,
  type EmploymentRecord,
  type ProjectRecord,
  type SkillRecord,
} from '../shared/domain/profile';
import { qualify, rankScore, type CandidateRequirements, type Job } from '../shared/domain/job';
import type { Contact } from '../shared/domain/outreach';
import { gmailConnected } from './gmail';
import { defaultSurface, setDefaultSurface, type Surface } from './surfaces';
import { getNetwork } from './network';
import { cvFile, applyProfile } from './apply';
import { parseCv, summarise, type ParseSummary } from '../shared/domain/cv';
import { all } from '../storage/database';
import { trustedExtension } from '../validators/security';

const id = (prefix: string): string => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;

/* ---------- profile ---------- */
export const profile = (): Promise<CandidateProfile> => getProfile();

/**
 * Turns the profile into the shape the job matcher needs. Experience is derived from the employment records
 * rather than asked for separately, so the two can never disagree.
 */
export async function requirements(p?: CandidateProfile): Promise<CandidateRequirements> {
  const me = p ?? (await getProfile());
  const years = yearsOfExperience(me.employment);
  return {
    authorisedIn: me.eligibility.authorisedIn,
    ...(me.eligibility.needsSponsorship !== undefined ? { needsSponsorship: me.eligibility.needsSponsorship } : {}),
    ...(years !== undefined ? { yearsExperience: years } : {}),
    skills: me.skills.map(s => s.skill),
    preferredLocations: me.preferences.locations,
    preferredWorkModes: me.preferences.workModes as CandidateRequirements['preferredWorkModes'],
    preferredEmploymentTypes: me.preferences.employmentTypes as CandidateRequirements['preferredEmploymentTypes'],
  };
}

/**
 * Re-runs qualification over every stored job. Called after a profile edit, because a job's eligibility can
 * change the moment the person records a new degree or a country they may work in.
 */
export async function requalify(): Promise<number> {
  const [jobs, reqs] = await Promise.all([allJobs(), requirements()]);
  if (!jobs.length) return 0;
  const now = Date.now();
  await saveJobs(jobs.map(j => ({ ...j, qualification: qualify(j, reqs, now), updatedAt: now })));
  return jobs.length;
}

/* ---------- the view the workspace screens draw ---------- */
export interface JobRow {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  source: string;
  applyType: string;
  fit: number;
  tier: string;
  eligibility: string;
  freshness: string;
  /** Requirement by requirement, with what in the profile answers it. */
  evidence: { requirement: string; state: string; matchedWith?: string }[];
  checks: { label: string; state: string; reason: string }[];
  rejectionReasons: string[];
  preferenceNotes: string[];
  judgement: string;
  postedAt?: number;
  rank: number;
}

export interface ContactRow {
  id: string;
  name: string;
  role?: string;
  company?: string;
  relationship: string;
  category: string;
  confidence: number;
  channel: string;
  email?: string;
  emailConfidence: string;
  suppressed?: string;
  profileUrl?: string;
}

export interface FactRow {
  key: string;
  label: string;
  section: FactSection;
  value: string;
  status: string;
  source?: string;
  scope: string;
  provenance?: string;
  selfDeclared: boolean;
  type: string;
}

export interface WorkspaceView {
  profile: CandidateProfile;
  conflicts: ReturnType<typeof conflicts>;
  yearsExperience?: number | undefined;
  cvName?: string | undefined;
  defaultCv?: DocumentRecord | undefined;
  facts: FactRow[];
  factSections: ReturnType<typeof sections>;
  completeness: ReturnType<typeof completeness>;
  jobs: JobRow[];
  contacts: ContactRow[];
  connections: {
    linkedin: boolean;
    ai: boolean;
    gmail: boolean;
    cv: boolean;
  };
  surface: Surface;
  /** Whether there is CV text to read records out of, and whether that has been done. */
  cv: { hasText: boolean; imported: boolean };
  storage: { jobs: number; applications: number; contacts: number; events: number; facts: number };
}

export async function workspaceView(): Promise<WorkspaceView> {
  // Bring across whatever the side panel's search and referral engine have found since last time, so these
  // screens are never empty while the person can plainly see results in the panel.
  const { syncFromNetwork } = await import('./bridge');
  await syncFromNetwork().catch(() => undefined);
  const [me, facts, jobs, contacts, network, cv, gmail, surface] = await Promise.all([
    getProfile(),
    allFacts(),
    allJobs(),
    allContacts(),
    getNetwork().catch(() => null),
    cvFile().catch(() => undefined),
    gmailConnected().catch(() => false),
    defaultSurface(),
  ]);
  const byKey = new Map(facts.map(f => [f.canonicalKey, f]));
  const now = Date.now();

  const [applications, events] = await Promise.all([all('applications'), all('events')]);

  return {
    profile: me,
    conflicts: conflicts(me),
    ...(yearsOfExperience(me.employment) !== undefined ? { yearsExperience: yearsOfExperience(me.employment) } : {}),
    ...(cv?.name ? { cvName: cv.name } : {}),
    ...(documentFor(me) ? { defaultCv: documentFor(me)! } : {}),
    facts: CATALOGUE.map(def => {
      const fact = byKey.get(def.key);
      return {
        key: def.key,
        label: def.label,
        section: def.section,
        value: fact?.value ?? '',
        status: statusOf(fact, now),
        ...(fact?.source ? { source: fact.source } : {}),
        scope: def.scope,
        ...(fact?.provenance ? { provenance: fact.provenance } : {}),
        selfDeclared: !!def.selfDeclared,
        type: def.type,
      };
    }),
    factSections: sections(facts, now),
    completeness: completeness(facts, now),
    jobs: jobs
      .map(j => ({
        id: j.id,
        company: j.companyName,
        title: j.title,
        location: j.location,
        url: j.canonicalUrl,
        source: j.sourceName,
        applyType: j.applyType,
        fit: j.qualification?.fit ?? 0,
        tier: j.qualification?.tier ?? 'weak',
        eligibility: j.qualification?.eligibility ?? 'unknown',
        freshness: j.qualification?.freshness ?? 'unknown',
        evidence: (j.qualification?.fitEvidence ?? []).map(e => ({
          requirement: e.requirement,
          state: e.state,
          ...(e.matchedWith ? { matchedWith: e.matchedWith } : {}),
        })),
        checks: (j.qualification?.checks ?? []).map(c => ({ label: c.label, state: c.state, reason: c.reason })),
        rejectionReasons: j.qualification?.rejectionReasons ?? [],
        preferenceNotes: j.qualification?.preferenceNotes ?? [],
        judgement: j.userJudgement ?? 'none',
        ...(j.postedAt ? { postedAt: j.postedAt } : {}),
        rank: rankScore(j, now),
      }))
      .sort((a, b) => b.rank - a.rank),
    contacts: contacts.map(c => ({
      id: c.id,
      name: c.name,
      ...(c.currentRole ? { role: c.currentRole } : {}),
      ...(c.companyName ? { company: c.companyName } : {}),
      relationship: c.relationship,
      category: c.category,
      confidence: c.confidence,
      channel: c.email ? 'email' : c.profileUrl ? 'linkedin' : 'none',
      ...(c.email ? { email: c.email } : {}),
      emailConfidence: c.emailConfidence,
      ...(c.suppressed ? { suppressed: c.suppressed.reason } : {}),
      ...(c.profileUrl ? { profileUrl: c.profileUrl } : {}),
    })),
    connections: {
      linkedin: !!network?.profile,
      ai: !!network?.api || !!network?.aiDefaultV3,
      gmail,
      cv: !!cv,
    },
    surface,
    cv: {
      hasText: !!network?.cv?.text?.trim(),
      imported: me.education.some(e => e.provenance.source === 'cv') || me.employment.some(e => e.provenance.source === 'cv'),
    },
    storage: {
      jobs: jobs.length,
      applications: applications.length,
      contacts: contacts.length,
      events: events.length,
      facts: facts.length,
    },
  };
}

/* ---------- editing the profile ---------- */
const identitySchema = z.object({
  fullName: z.string().max(120).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
  address: z.string().max(300).optional(),
  postalCode: z.string().max(20).optional(),
  profileUrl: z.string().max(300).optional(),
  portfolioLinks: z.array(z.string().max(300)).max(10).optional(),
});

const educationSchema = z.object({
  id: z.string().max(60).optional(),
  level: z.string().max(60),
  institution: z.string().max(200),
  board: z.string().max(120).optional(),
  qualification: z.string().max(120).optional(),
  field: z.string().max(120).optional(),
  startDate: z.string().max(20).optional(),
  endDate: z.string().max(20).optional(),
  grade: z.string().max(40).optional(),
  gradeScale: z.string().max(40).optional(),
});

const employmentSchema = z.object({
  id: z.string().max(60).optional(),
  employer: z.string().max(200),
  title: z.string().max(200),
  location: z.string().max(120).optional(),
  startDate: z.string().max(20).optional(),
  endDate: z.string().max(20).optional(),
  current: z.boolean().optional(),
  responsibilities: z.array(z.string().max(400)).max(20).optional(),
  achievements: z.array(z.string().max(400)).max(20).optional(),
  technologies: z.array(z.string().max(60)).max(40).optional(),
});

const projectSchema = z.object({
  id: z.string().max(60).optional(),
  name: z.string().max(200),
  summary: z.string().max(1000).optional(),
  role: z.string().max(120).optional(),
  skills: z.array(z.string().max(60)).max(40).optional(),
  outcomes: z.array(z.string().max(400)).max(20).optional(),
  links: z.array(z.string().max(300)).max(10).optional(),
});

/**
 * Reads the saved CV into the profile. Existing records are left alone: a parse is a suggestion and must never
 * overwrite something the person already confirmed. Anything new arrives unverified, for them to check.
 */
export async function importCv(): Promise<ParseSummary & { added: number }> {
  const network = await getNetwork().catch(() => null);
  const text = network?.cv?.text?.trim();
  if (!text) throw new Error('No CV text is saved yet. Upload your CV in the side panel first.');
  const parsed = parseCv(text);
  let added = 0;
  await changeProfile(p => {
    const haveEdu = new Set(p.education.map(e => `${e.qualification ?? e.level}|${e.institution}`.toLowerCase()));
    const haveJob = new Set(p.employment.map(e => `${e.title}|${e.employer}`.toLowerCase()));
    const haveProj = new Set(p.projects.map(e => e.name.toLowerCase()));
    const haveSkill = new Set(p.skills.map(s => s.skill.toLowerCase()));

    const education = parsed.education.filter(e => !haveEdu.has(`${e.qualification ?? e.level}|${e.institution}`.toLowerCase()));
    const employment = parsed.employment.filter(e => !haveJob.has(`${e.title}|${e.employer}`.toLowerCase()));
    const projects = parsed.projects.filter(e => !haveProj.has(e.name.toLowerCase()));
    const skills = parsed.skills.filter(s => !haveSkill.has(s.skill.toLowerCase()));
    added = education.length + employment.length + projects.length + skills.length;

    return {
      ...p,
      education: [...p.education, ...education],
      employment: [...p.employment, ...employment],
      projects: [...p.projects, ...projects],
      skills: [...p.skills, ...skills],
      identity: {
        ...p.identity,
        ...(p.identity.email ? {} : parsed.identity.email ? { email: parsed.identity.email } : {}),
        ...(p.identity.phone ? {} : parsed.identity.phone ? { phone: parsed.identity.phone } : {}),
        portfolioLinks: p.identity.portfolioLinks.length ? p.identity.portfolioLinks : parsed.identity.links,
      },
    };
  });
  await requalify();
  return { ...summarise(parsed), added };
}

export const workspaceRequest = z.discriminatedUnion('action', [
  z.object({ kind: z.literal('workspace'), action: z.literal('view') }),
  z.object({ kind: z.literal('workspace'), action: z.literal('identity'), identity: identitySchema }),
  z.object({
    kind: z.literal('workspace'),
    action: z.literal('preferences'),
    targetRoleFamilies: z.array(z.string().max(80)).max(10).optional(),
    locations: z.array(z.string().max(80)).max(10).optional(),
    workModes: z.array(z.string().max(20)).max(4).optional(),
    employmentTypes: z.array(z.string().max(30)).max(6).optional(),
    expectedCompensation: z.string().max(80).optional(),
    willingToRelocate: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('workspace'),
    action: z.literal('eligibility'),
    authorisedIn: z.array(z.string().max(60)).max(10).optional(),
    needsSponsorship: z.boolean().optional(),
    languages: z.array(z.string().max(40)).max(12).optional(),
  }),
  z.object({ kind: z.literal('workspace'), action: z.literal('education'), record: educationSchema }),
  z.object({ kind: z.literal('workspace'), action: z.literal('employment'), record: employmentSchema }),
  z.object({ kind: z.literal('workspace'), action: z.literal('project'), record: projectSchema }),
  z.object({ kind: z.literal('workspace'), action: z.literal('skills'), skills: z.array(z.string().max(60)).max(120) }),
  z.object({
    kind: z.literal('workspace'),
    action: z.literal('removeRecord'),
    list: z.enum(['education', 'employment', 'projects', 'skills']),
    id: z.string().max(60),
  }),
  z.object({ kind: z.literal('workspace'), action: z.literal('saveFact'), key: z.string().max(60), value: z.string().max(4000) }),
  z.object({ kind: z.literal('workspace'), action: z.literal('clearFact'), key: z.string().max(60) }),
  z.object({
    kind: z.literal('workspace'),
    action: z.literal('judgeJob'),
    id: z.string().max(120),
    judgement: z.enum(['shortlisted', 'rejected', 'none']),
    reason: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal('workspace'), action: z.literal('requalify') }),
  z.object({ kind: z.literal('workspace'), action: z.literal('enqueueShortlisted') }),
  z.object({
    kind: z.literal('workspace'),
    action: z.literal('suppressContact'),
    id: z.string().max(80),
    reason: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal('workspace'), action: z.literal('surface'), surface: z.enum(['tab', 'panel']) }),
  z.object({ kind: z.literal('workspace'), action: z.literal('importCv') }),
  z.object({ kind: z.literal('workspace'), action: z.literal('export') }),
]);

export type WorkspaceRequest = z.infer<typeof workspaceRequest>;

const withId = <T extends { id?: string | undefined }>(record: T, prefix: string): T & { id: string } => ({
  ...record,
  id: record.id ?? id(prefix),
});

async function upsert<K extends 'education' | 'employment' | 'projects'>(list: K, record: { id?: string | undefined }): Promise<void> {
  await changeProfile(p => {
    const made = withId(record, list);
    const existing = (p[list] as { id: string }[]).findIndex(r => r.id === made.id);
    const next = [...(p[list] as unknown[])] as Record<string, unknown>[];
    // An edit keeps whatever the record already held, so clearing one field cannot wipe the rest.
    if (existing >= 0) next[existing] = { ...next[existing], ...made };
    else next.push({ ...made, provenance: unverified('user') });
    return { ...p, [list]: next } as CandidateProfile;
  });
}

export async function exportData(): Promise<string> {
  const [me, facts, jobs, contacts, applications, events] = await Promise.all([
    getProfile(),
    allFacts(),
    allJobs(),
    allContacts(),
    all('applications'),
    all('events'),
  ]);
  return JSON.stringify(
    {
      // The schema version travels with the export, so a future build can read a backup taken today.
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      profile: me,
      facts,
      jobs,
      contacts,
      applications,
      events,
      companies: await allCompanies(),
    },
    null,
    2,
  );
}

async function handle(req: WorkspaceRequest): Promise<WorkspaceView | { json: string }> {
  switch (req.action) {
    case 'view':
      break;
    case 'identity':
      await changeProfile(p => {
        // Only the fields the form actually sent are written; an absent key must not blank a saved value.
        const given = Object.fromEntries(Object.entries(req.identity).filter(([, v]) => v !== undefined));
        return { ...p, identity: { ...p.identity, ...given, portfolioLinks: req.identity.portfolioLinks ?? p.identity.portfolioLinks } };
      });
      break;
    case 'preferences':
      await changeProfile(p => ({
        ...p,
        preferences: {
          ...p.preferences,
          ...(req.targetRoleFamilies ? { targetRoleFamilies: req.targetRoleFamilies } : {}),
          ...(req.locations ? { locations: req.locations } : {}),
          ...(req.workModes ? { workModes: req.workModes } : {}),
          ...(req.employmentTypes ? { employmentTypes: req.employmentTypes } : {}),
          ...(req.expectedCompensation !== undefined ? { expectedCompensation: req.expectedCompensation } : {}),
          ...(req.willingToRelocate !== undefined ? { willingToRelocate: req.willingToRelocate } : {}),
        },
      }));
      // Preferences change which jobs qualify, so the shortlist is recomputed rather than left stale.
      await requalify();
      break;
    case 'eligibility':
      await changeProfile(p => ({
        ...p,
        eligibility: {
          ...p.eligibility,
          ...(req.authorisedIn ? { authorisedIn: req.authorisedIn } : {}),
          ...(req.needsSponsorship !== undefined ? { needsSponsorship: req.needsSponsorship } : {}),
          ...(req.languages ? { languages: req.languages } : {}),
        },
      }));
      await requalify();
      break;
    case 'education':
      await upsert('education', req.record);
      break;
    case 'employment':
      await upsert('employment', req.record);
      await requalify();
      break;
    case 'project':
      await upsert('projects', req.record);
      break;
    case 'skills':
      await changeProfile(p => {
        const existing = new Map(p.skills.map(s => [s.skill.toLowerCase(), s]));
        const skills: SkillRecord[] = req.skills
          .map(s => s.trim())
          .filter(Boolean)
          .map(skill => existing.get(skill.toLowerCase()) ?? { id: id('skill'), skill, evidenceRefs: [], provenance: unverified('user') });
        return { ...p, skills };
      });
      await requalify();
      break;
    case 'removeRecord':
      await changeProfile(p => ({ ...p, [req.list]: (p[req.list] as { id: string }[]).filter(r => r.id !== req.id) }) as CandidateProfile);
      break;
    case 'saveFact': {
      const fact = makeFact({ canonicalKey: req.key, value: req.value, source: 'user' });
      await saveFacts([fact]);
      break;
    }
    case 'clearFact':
      await removeFact(`fact:${req.key}:global`);
      break;
    case 'judgeJob':
      await changeJob(req.id, j =>
        j ? { ...j, userJudgement: req.judgement, ...(req.reason ? { userReason: req.reason } : {}), updatedAt: Date.now() } : j,
      );
      break;
    case 'requalify':
      await requalify();
      break;
    case 'enqueueShortlisted': {
      const { enqueueShortlisted } = await import('./bridge');
      const report = await enqueueShortlisted();
      if (!report.added && report.skipped.length) throw new Error(`Nothing was added. ${report.skipped[0]}`);
      if (!report.added) throw new Error('Shortlist a job first — pick “Why?” on one and press Shortlist.');
      break;
    }
    case 'suppressContact': {
      const contact = (await allContacts()).find(c => c.id === req.id);
      if (contact) await suppressContact(contact.personKey, req.reason ?? 'You asked not to contact them.');
      break;
    }
    case 'surface':
      await setDefaultSurface(req.surface);
      break;
    case 'importCv':
      await importCv();
      break;
    case 'export':
      return { json: await exportData() };
  }
  return workspaceView();
}

export function registerWorkspaceMessages(): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (!input || typeof input !== 'object' || (input as { kind?: unknown }).kind !== 'workspace') return false;
    if (!trustedExtension(sender, chrome.runtime.id)) return false;
    const parsed = workspaceRequest.safeParse(input);
    if (!parsed.success) {
      respond({ ok: false, error: 'That request was not understood.' });
      return false;
    }
    void handle(parsed.data)
      .then(data => respond({ ok: true, view: data }))
      .catch((e: unknown) => respond({ ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' }));
    return true;
  });
}

/* ---------- seeding the profile from what already exists ---------- */
/**
 * Fills an empty profile from the LinkedIn record and the saved application details the person already gave, so
 * the first visit to the profile screen is not a blank form.
 */
export async function seedProfile(): Promise<CandidateProfile> {
  const existing = await getProfile();
  if (existing.identity.fullName || existing.education.length || existing.employment.length) return existing;
  const [network, legacy] = await Promise.all([getNetwork().catch(() => null), applyProfile().catch(() => undefined)]);
  const d = legacy?.details ?? {};
  const country = network?.location?.split(',').pop()?.trim();
  return (
    (await changeProfile(p => ({
      ...emptyProfile(p.createdAt),
      ...p,
      identity: {
        ...p.identity,
        ...(network?.profile?.name ? { fullName: network.profile.name } : {}),
        ...(network?.profile?.url ? { profileUrl: network.profile.url } : {}),
        ...(d.email ? { email: d.email } : {}),
        ...(d.phone ? { phone: d.phone } : {}),
        ...(d.city ? { city: d.city } : {}),
        ...(d.state ? { state: d.state } : {}),
        ...(d.address ? { address: d.address } : {}),
        ...(d.pincode ? { postalCode: d.pincode } : {}),
        ...(country ? { country } : {}),
        portfolioLinks: d.links ? [d.links] : p.identity.portfolioLinks,
      },
      preferences: {
        ...p.preferences,
        locations: network?.location ? [network.location] : p.preferences.locations,
        targetRoleFamilies: network?.settings?.roles ?? p.preferences.targetRoleFamilies,
        ...(d.expectedCtc ? { expectedCompensation: d.expectedCtc } : {}),
        ...(d.relocate ? { willingToRelocate: /yes|open|willing/i.test(d.relocate) } : {}),
      },
      eligibility: { ...p.eligibility, authorisedIn: country ? [country] : p.eligibility.authorisedIn },
    }))) ?? existing
  );
}

export const factCatalogue = (): typeof CATALOGUE => CATALOGUE;
export type { CandidateFact, EducationRecord, EmploymentRecord, ProjectRecord, Job, Contact, OutcomeEvent };
