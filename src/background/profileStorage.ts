/**
 * Atomic, read-back-verified persistence pipeline for approving ChatGPT profile drafts.
 *
 * Bridges all storage layers cleanly without leaving partial state:
 * 1. Normalizes `schemaVersion: 3` (`identity.*`) and legacy flat payloads via `normalizeChatGptResponse`.
 * 2. Merges identity, education, employment, projects, skills, and narrative into IndexedDB `profiles`.
 * 3. Syncs identity fields (`full_name`, `email`, `phone`, `city`, `state`, `country`, `linkedin_url`) into
 *    the Answer Bank `facts` store AND legacy `apply-profile` (`PROFILE_KEY`) so autofill and `#answers` update
 *    immediately without a page reload or stale blank fields.
 * 4. Persists a verified profile snapshot in `chrome.storage.local` and reads back both IndexedDB and
 *    `chrome.storage.local` to guarantee durability before returning success.
 */

import { allFacts, changeProfile, getProfile, saveFacts } from '../shared/persistence/campaign-store';
import { factsFromProfileSnapshot } from '../shared/domain/facts';
import { formatLocation, mergeCandidateIdentity, normalizeChatGptResponse } from '../shared/normalizeChatGptProfile';
import type { CandidateProfile, EducationRecord, EmploymentRecord, ProfileReviewStatus, ProjectRecord } from '../shared/domain/profile';
import { read, write } from '../storage/state';
import { currentResetGeneration, isResettingData, shouldAbortStaleWrite } from '../storage/database';
import { emptyApplyProfile } from '../shared/apply';
import { clearProgressTask } from '../shared/progress-store';
import { PROFILE_KEY } from './apply';

export const PROFILE_SNAPSHOT_KEY = 'rs_profile_snapshot_v1';

export interface ProfileSnapshot {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  location: string;
  profileUrl: string;
  educationCount: number;
  employmentCount: number;
  projectsCount: number;
  skillsCount: number;
  reviewStatus: ProfileReviewStatus;
  profileVersion: number;
  updatedAt: number;
}

export interface ApprovalOptions {
  skippedEmploymentIndexes?: readonly number[];
  skippedEducationIndexes?: readonly number[];
  overwriteIdentity?: boolean;
}

export interface ApprovalResult {
  added: number;
  verified: boolean;
  profile: CandidateProfile;
  snapshot: ProfileSnapshot;
}

const makeId = (prefix: string): string => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;

function localStorageArea(): chrome.storage.StorageArea | undefined {
  try {
    return (globalThis as { chrome?: typeof chrome }).chrome?.storage?.local;
  } catch {
    return undefined;
  }
}

export function buildProfileSnapshot(profile: CandidateProfile): ProfileSnapshot {
  return {
    fullName: profile.identity.fullName ?? '',
    email: profile.identity.email ?? '',
    phone: profile.identity.phone ?? '',
    city: profile.identity.city ?? '',
    state: profile.identity.state ?? '',
    country: profile.identity.country ?? '',
    location: formatLocation(profile.identity),
    profileUrl: profile.identity.profileUrl ?? '',
    educationCount: profile.education.length,
    employmentCount: profile.employment.length,
    projectsCount: profile.projects.length,
    skillsCount: profile.skills.length,
    reviewStatus: profile.review?.status ?? 'unreviewed',
    profileVersion: profile.profileVersion,
    updatedAt: profile.updatedAt,
  };
}

/** Syncs the current CandidateProfile snapshot into `chrome.storage.local` cleanly. */
export async function syncProfileSnapshotToLocalStorage(profile: CandidateProfile): Promise<ProfileSnapshot> {
  const snapshot = buildProfileSnapshot(profile);
  if (isResettingData()) return snapshot;
  const area = localStorageArea();
  if (area) {
    await area.set({ [PROFILE_SNAPSHOT_KEY]: snapshot }).catch(() => undefined);
  }
  return snapshot;
}

/** Reads back persisted snapshot from `chrome.storage.local` (null in non-extension test environments). */
export async function readProfileSnapshotFromLocalStorage(): Promise<ProfileSnapshot | null> {
  const area = localStorageArea();
  if (!area) return null;
  const got = await area.get(PROFILE_SNAPSHOT_KEY).catch(() => undefined);
  return (got?.[PROFILE_SNAPSHOT_KEY] as ProfileSnapshot | undefined) ?? null;
}

export async function clearProfileSnapshot(): Promise<void> {
  const area = localStorageArea();
  if (area?.remove) await Promise.resolve(area.remove(PROFILE_SNAPSHOT_KEY)).catch(() => undefined);
}

/** Atomically saves a normalized ChatGPT profile draft and verifies persistence with a read-back check. */
export async function saveNormalizedProfileApproval(rawDraft: unknown, options: ApprovalOptions = {}): Promise<ApprovalResult> {
  const draft = normalizeChatGptResponse(rawDraft);
  const skipEmp = new Set(options.skippedEmploymentIndexes ?? []);
  const skipEdu = new Set(options.skippedEducationIndexes ?? []);
  const now = Date.now();
  const provenance = { source: 'model' as const, confidence: 0.6, capturedAt: now };

  const selectedEdu = draft.education.filter((_, idx) => !skipEdu.has(idx));
  const selectedEmp = draft.employment.filter((_, idx) => !skipEmp.has(idx));

  await changeProfile(p => {
    const haveEducation = new Set(p.education.map(e => `${e.institution}|${e.qualification ?? e.level}`.toLowerCase()));
    const haveEmployment = new Set(p.employment.map(e => `${e.employer}|${e.title}|${e.startDate ?? ''}`.toLowerCase()));
    const haveProjects = new Set(p.projects.map(e => e.name.toLowerCase()));
    const haveSkills = new Set(p.skills.map(e => e.skill.toLowerCase()));

    const education: EducationRecord[] = selectedEdu.flatMap(e => {
      const level = e.level || e.qualification;
      if (!e.institution || !level) return [];
      const key = `${e.institution}|${e.qualification || level}`.toLowerCase();
      if (haveEducation.has(key)) return [];
      return [
        {
          id: makeId('edu'),
          level,
          institution: e.institution,
          ...(e.qualification ? { qualification: e.qualification } : {}),
          ...(e.field ? { field: e.field } : {}),
          ...(e.startDate ? { startDate: e.startDate } : {}),
          ...(e.endDate ? { endDate: e.endDate } : {}),
          ...(e.grade ? { grade: e.grade } : {}),
          ...(e.gradeScale ? { gradeScale: e.gradeScale } : {}),
          provenance,
        },
      ];
    });

    const employment: EmploymentRecord[] = selectedEmp
      .filter(e => e.employer && e.title && !haveEmployment.has(`${e.employer}|${e.title}|${e.startDate}`.toLowerCase()))
      .map(e => ({
        id: makeId('job'),
        employer: e.employer,
        title: e.title,
        ...(e.location ? { location: e.location } : {}),
        ...(e.startDate ? { startDate: e.startDate } : {}),
        ...(e.endDate ? { endDate: e.endDate } : {}),
        current: e.current,
        responsibilities: e.responsibilities,
        achievements: e.achievements,
        technologies: e.technologies,
        provenance,
      }));

    const projects: ProjectRecord[] = draft.projects
      .filter(e => e.name && !haveProjects.has(e.name.toLowerCase()))
      .map(e => ({
        id: makeId('project'),
        name: e.name,
        ...(e.summary ? { summary: e.summary } : {}),
        ...(e.role ? { role: e.role } : {}),
        skills: e.skills,
        outcomes: e.outcomes,
        links: e.links,
        provenance,
      }));

    const skills = draft.skills
      .filter(skill => !haveSkills.has(skill.toLowerCase()))
      .map(skill => ({ id: makeId('skill'), skill, evidenceRefs: [], provenance }));

    return {
      ...p,
      identity: mergeCandidateIdentity(p.identity, draft.identity, { overwriteNonEmpty: !!options.overwriteIdentity }),
      education: [...p.education, ...education],
      employment: [...p.employment, ...employment],
      projects: [...p.projects, ...projects],
      skills: [...p.skills, ...skills],
      narrative: {
        ...p.narrative,
        ...(p.narrative.strengths?.trim() ? {} : draft.narrative.strengths ? { strengths: draft.narrative.strengths } : {}),
        ...(p.narrative.careerGoal?.trim() ? {} : draft.narrative.careerGoal ? { careerGoal: draft.narrative.careerGoal } : {}),
      },
      review: {
        status: 'pending_review',
        draftSavedAt: now,
        mergeNotes: draft.mergeNotes,
        pendingPrompts: draft.structuredMissing,
      },
    };
  });

  // 2. Read back the committed profile to guarantee atomic durability before downstream syncs.
  const persistedProfile = await getProfile();
  if (draft.identity.fullName && !persistedProfile.identity.fullName) {
    throw new Error('Name could not be verified after saving to profile storage. Please try again.');
  }
  if (draft.identity.email && !persistedProfile.identity.email) {
    throw new Error('Email could not be verified after saving to profile storage. Please try again.');
  }

  // 3. Hydrate all already-known profile fields (identity, education, experience, preferences) into Answer Bank facts.
  const existingFacts = await allFacts().catch(() => []);
  const factsToSave = factsFromProfileSnapshot(persistedProfile, existingFacts, { now });
  if (factsToSave.length) {
    await saveFacts(factsToSave);
  }

  // 4. Mirror key contact details to legacy apply-profile store without overwriting existing user entries.
  const legacy = { ...emptyApplyProfile(), ...((await read<ReturnType<typeof emptyApplyProfile>>(PROFILE_KEY)) ?? {}) };
  await write(PROFILE_KEY, {
    ...legacy,
    details: {
      ...legacy.details,
      ...(legacy.details.email || !persistedProfile.identity.email ? {} : { email: persistedProfile.identity.email }),
      ...(legacy.details.phone || !persistedProfile.identity.phone ? {} : { phone: persistedProfile.identity.phone }),
      ...(legacy.details.city || !persistedProfile.identity.city ? {} : { city: persistedProfile.identity.city }),
      ...(legacy.details.state || !persistedProfile.identity.state ? {} : { state: persistedProfile.identity.state }),
    },
  }).catch(() => undefined);

  // 5. Write snapshot to chrome.storage.local and read back to confirm cross-context durability.
  const writtenSnapshot = await syncProfileSnapshotToLocalStorage(persistedProfile);
  const verifiedLocal = await readProfileSnapshotFromLocalStorage();
  const verified =
    verifiedLocal === null
      ? Boolean(!draft.identity.fullName || persistedProfile.identity.fullName)
      : verifiedLocal.profileVersion >= persistedProfile.profileVersion &&
        (!draft.identity.fullName || Boolean(verifiedLocal.fullName)) &&
        (!draft.identity.email || Boolean(verifiedLocal.email));

  if (!verified) {
    throw new Error('Saved profile snapshot could not be verified in extension storage. Please retry.');
  }

  await clearProgressTask('cv_ai_review');

  return {
    added: selectedEdu.length + selectedEmp.length + draft.projects.length + draft.skills.length,
    verified,
    profile: persistedProfile,
    snapshot: writtenSnapshot,
  };
}

/** Promotes draft AI records with user sign-off (`verifiedAt`) and marks the Candidate Profile as approved. */
export async function finalizeProfileReview(): Promise<CandidateProfile> {
  const capturedGen = currentResetGeneration();
  const current = await getProfile();
  if (!current.identity.fullName?.trim()) throw new Error('Add your Full Name in Identity before approving.');
  if (!current.identity.email?.trim()) throw new Error('Add your Email in Identity before approving.');
  if (shouldAbortStaleWrite(capturedGen)) return current;

  const now = Date.now();
  const verifyProv = <T extends { provenance: { verifiedAt?: number; confidence: number } }>(items: readonly T[]): T[] =>
    items.map(item => ({
      ...item,
      provenance: {
        ...item.provenance,
        verifiedAt: item.provenance.verifiedAt ?? now,
        confidence: Math.max(item.provenance.confidence, 0.9),
      },
    }));

  const updated =
    (await changeProfile(p => ({
      ...p,
      education: verifyProv(p.education),
      employment: verifyProv(p.employment),
      projects: verifyProv(p.projects),
      skills: verifyProv(p.skills),
      review: {
        status: 'approved',
        ...(p.review?.draftSavedAt ? { draftSavedAt: p.review.draftSavedAt } : {}),
        finalizedAt: now,
        mergeNotes: p.review?.mergeNotes ?? [],
        pendingPrompts: [],
      },
    }))) ?? (await getProfile());
  await syncProfileSnapshotToLocalStorage(updated);
  await clearProgressTask('cv_ai_review');
  return updated;
}

/** Re-opens an approved profile for non-destructive inline review without losing any saved records. */
export async function reopenProfileReview(): Promise<CandidateProfile> {
  const updated =
    (await changeProfile(p => ({
      ...p,
      review: {
        status: 'reopened',
        draftSavedAt: Date.now(),
        ...(p.review?.finalizedAt ? { finalizedAt: p.review.finalizedAt } : {}),
        mergeNotes: p.review?.mergeNotes ?? [],
        pendingPrompts: p.review?.pendingPrompts ?? [],
      },
    }))) ?? (await getProfile());
  await syncProfileSnapshotToLocalStorage(updated);
  return updated;
}

/** Persistently dismisses or resolves a single structured gap prompt inside the active review draft. */
export async function dismissReviewPrompt(promptId: string): Promise<CandidateProfile> {
  const updated =
    (await changeProfile(p => {
      const existing = p.review ?? { status: 'draft' as const, mergeNotes: [], pendingPrompts: [] };
      return {
        ...p,
        review: {
          ...existing,
          pendingPrompts: existing.pendingPrompts.filter(item => item.id !== promptId),
        },
      };
    })) ?? (await getProfile());
  await syncProfileSnapshotToLocalStorage(updated);
  return updated;
}
