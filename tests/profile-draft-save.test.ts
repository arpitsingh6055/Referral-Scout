import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearDatabase, closeDatabase } from '../src/storage/database';
import { allFacts, getProfile } from '../src/shared/persistence/campaign-store';
import { normalizeChatGptResponse, mergeCandidateIdentity } from '../src/shared/normalizeChatGptProfile';
import { PROFILE_SNAPSHOT_KEY, readProfileSnapshotFromLocalStorage, saveNormalizedProfileApproval } from '../src/background/profileStorage';
import { field, input, restoreForm, snapshotForm } from '../src/ui/workbench/dom';

beforeEach(async () => {
  await clearDatabase();
  document.body.innerHTML = '';
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearDatabase();
  closeDatabase();
  document.body.innerHTML = '';
});

it('normalizeChatGptResponse extracts nested schemaVersion 3 identity.* as well as legacy flat schemas', () => {
  const v3 = normalizeChatGptResponse({
    schemaVersion: 3,
    identity: {
      fullName: 'ARPIT SINGH',
      email: 'pgp26arpitsingh@imt.ac.in',
      phone: '+91 8968771062',
      city: 'Ghaziabad',
      state: 'UP',
      country: 'India',
      profileUrl: 'https://linkedin.com',
    },
    education: [
      { level: 'Masters', institution: 'IMT Ghaziabad', qualification: 'PGDM', field: 'Marketing', grade: '8.4', gradeScale: '10' },
    ],
    employment: [
      {
        employer: 'TBX',
        title: 'Product Intern',
        responsibilities: ['Built flows'],
        achievements: ['+12% activation'],
        technologies: ['SQL'],
      },
    ],
    projects: [{ name: 'Extension', summary: 'Built automation' }],
    skills: ['SQL', { name: 'Product Strategy' }],
    narrative: { strengths: 'Analytics', careerGoal: 'Product Manager' },
    conflicts: [],
    missingInformation: ['Current CTC'],
  });
  expect(v3.identity.fullName).toBe('ARPIT SINGH');
  expect(v3.identity.email).toBe('pgp26arpitsingh@imt.ac.in');
  expect(v3.identity.phone).toBe('+91 8968771062');
  expect(v3.identity.formattedLocation).toBe('Ghaziabad, UP, India');
  expect(v3.identity.profileUrl).toBe('https://linkedin.com');
  expect(v3.skills).toEqual(['SQL', 'Product Strategy']);
  expect(v3.missingInformation).toEqual(['Current CTC']);

  const legacyFlat = normalizeChatGptResponse({
    fullName: 'Arpit Singh',
    email: 'flat@example.com',
    phone: '9999999999',
    linkedinUrl: 'https://www.linkedin.com/in/arpit/',
    location: 'Bengaluru, Karnataka, India',
    experience: [{ company: 'Acme', role: 'APM', startDate: '2024-01' }],
    skills: ['SQL', { detail: 'Figma' }],
    summary: 'Built products',
  });
  expect(legacyFlat.identity.fullName).toBe('Arpit Singh');
  expect(legacyFlat.identity.email).toBe('flat@example.com');
  expect(legacyFlat.identity.profileUrl).toBe('https://www.linkedin.com/in/arpit/');
  expect(legacyFlat.identity.city).toBe('Bengaluru');
  expect(legacyFlat.employment[0]?.employer).toBe('Acme');
  expect(legacyFlat.skills).toEqual(['SQL', 'Figma']);

  const merged = mergeCandidateIdentity({ fullName: 'Existing Name', portfolioLinks: [] }, { fullName: '', email: 'new@example.com' });
  expect(merged.fullName).toBe('Existing Name');
  expect(merged.email).toBe('new@example.com');
});

it('saveNormalizedProfileApproval persists identity into IndexedDB profile, Answer Bank facts, and chrome.storage.local with read-back check', async () => {
  const localBacking: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: localBacking[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(localBacking, patch)),
        remove: vi.fn(async (key: string) => {
          delete localBacking[key];
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });

  const result = await saveNormalizedProfileApproval({
    schemaVersion: 3,
    identity: {
      fullName: 'ARPIT SINGH',
      email: 'pgp26arpitsingh@imt.ac.in',
      phone: '+91 8968771062',
      city: 'Ghaziabad',
      state: 'UP',
      country: 'India',
      profileUrl: 'https://linkedin.com',
    },
    education: [{ level: 'Masters', institution: 'IMT Ghaziabad', qualification: 'PGDM', startDate: '2026-06', endDate: '2028-04' }],
    employment: [
      {
        employer: 'TBX',
        title: 'Product Intern',
        startDate: '2025-05',
        endDate: '2025-08',
        current: false,
        responsibilities: [],
        achievements: [],
        technologies: ['SQL'],
      },
    ],
    projects: [],
    skills: ['SQL', 'Product Management'],
    narrative: { strengths: 'SQL & Strategy', careerGoal: 'PM' },
    conflicts: [],
    missingInformation: ['Expected CTC'],
  });

  expect(result.verified).toBe(true);
  const profile = await getProfile();
  expect(profile.identity.fullName).toBe('ARPIT SINGH');
  expect(profile.identity.email).toBe('pgp26arpitsingh@imt.ac.in');
  expect(profile.identity.phone).toBe('+91 8968771062');
  expect(profile.identity.profileUrl).toBe('https://linkedin.com');
  expect(profile.employment).toHaveLength(1);

  const facts = await allFacts();
  expect(facts.find(f => f.canonicalKey === 'full_name')?.value).toBe('ARPIT SINGH');
  expect(facts.find(f => f.canonicalKey === 'email')?.value).toBe('pgp26arpitsingh@imt.ac.in');
  expect(facts.find(f => f.canonicalKey === 'phone')?.value).toBe('+91 8968771062');

  const localSnap = await readProfileSnapshotFromLocalStorage();
  expect(localSnap).toBeTruthy();
  expect(localBacking[PROFILE_SNAPSHOT_KEY]).toBeTruthy();
  expect(localSnap!.fullName).toBe('ARPIT SINGH');
  expect(localSnap!.email).toBe('pgp26arpitsingh@imt.ac.in');
});

it('restoreForm never overwrites freshly saved backend profile values with an empty pre-approval DOM snapshot', () => {
  const beforeName = input('');
  const beforeEmail = input('');
  document.body.replaceChildren(field('Full name', beforeName), field('Email', beforeEmail));
  // User edits Email manually, leaves Full name untouched before clicking Approve.
  beforeEmail.value = 'unsaved-typing@example.com';
  const snap = snapshotForm(document.body);

  // Re-render after backend approves AI draft and populates both defaults.
  const afterName = input('ARPIT SINGH');
  const afterEmail = input('pgp26arpitsingh@imt.ac.in');
  document.body.replaceChildren(field('Full name', afterName), field('Email', afterEmail));
  restoreForm(document.body, snap);

  // Both backend-populated defaults survive; blank pre-approval snapshot does NOT wipe ARPIT SINGH.
  expect(afterName.value).toBe('ARPIT SINGH');
  expect(afterEmail.value).toBe('pgp26arpitsingh@imt.ac.in');

  // Conversely, when backend default did NOT change, unsaved user typing IS preserved across unrelated redraws.
  const redrawEmail = input('');
  document.body.replaceChildren(field('Email', redrawEmail));
  restoreForm(document.body, snap);
  expect(redrawEmail.value).toBe('unsaved-typing@example.com');
});
