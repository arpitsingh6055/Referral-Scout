import { describe, expect, it } from 'vitest';
import {
  conflicts,
  currentEmployment,
  documentFor,
  emptyProfile,
  isVerified,
  latestEducation,
  touch,
  unverified,
  yearsOfExperience,
  type EducationRecord,
  type EmploymentRecord,
} from '../src/shared/domain/profile';

const NOW = Date.parse('2026-01-01T00:00:00Z');

const employment = (over: Partial<EmploymentRecord> & Pick<EmploymentRecord, 'id'>): EmploymentRecord => ({
  employer: 'Acme',
  title: 'Analyst',
  responsibilities: [],
  achievements: [],
  technologies: [],
  provenance: unverified('cv', NOW),
  ...over,
});

const education = (over: Partial<EducationRecord> & Pick<EducationRecord, 'id'>): EducationRecord => ({
  level: 'bachelors',
  institution: 'Some College',
  provenance: unverified('cv', NOW),
  ...over,
});

describe('provenance', () => {
  it('treats what the person typed as verified and what a model wrote as not', () => {
    expect(isVerified(unverified('user', NOW))).toBe(true);
    expect(isVerified(unverified('model', NOW))).toBe(false);
    expect(isVerified(unverified('cv', NOW))).toBe(false);
  });
});

describe('experience', () => {
  it('adds up employment rather than asking the person again', () => {
    const years = yearsOfExperience([employment({ id: '1', startDate: '2022-01-01', endDate: '2024-01-01' })], NOW);
    expect(years).toBeCloseTo(2, 1);
  });

  it('does not double-count two jobs held at the same time', () => {
    const years = yearsOfExperience(
      [
        employment({ id: '1', startDate: '2022-01-01', endDate: '2024-01-01' }),
        employment({ id: '2', startDate: '2023-01-01', endDate: '2024-01-01' }),
      ],
      NOW,
    );
    expect(years).toBeCloseTo(2, 1);
  });

  it('counts a current job up to today', () => {
    const years = yearsOfExperience([employment({ id: '1', startDate: '2025-01-01', current: true })], NOW);
    expect(years).toBeCloseTo(1, 1);
  });

  it('says nothing rather than zero when there are no records', () => {
    expect(yearsOfExperience([], NOW)).toBeUndefined();
  });
});

describe('records', () => {
  it('picks the most recent qualification', () => {
    const list = [education({ id: 'a', endDate: '2020-06' }), education({ id: 'b', endDate: '2024-06' })];
    expect(latestEducation(list)!.id).toBe('b');
  });

  it('prefers the job marked current over the latest end date', () => {
    const list = [employment({ id: 'old', endDate: '2025-01-01' }), employment({ id: 'now', current: true, startDate: '2024-01-01' })];
    expect(currentEmployment(list)!.id).toBe('now');
  });
});

describe('documents', () => {
  const profile = {
    ...emptyProfile(NOW),
    documents: [
      {
        id: 'master',
        kind: 'cv' as const,
        name: 'cv.pdf',
        mimeType: 'application/pdf',
        size: 1,
        roleFamilies: [],
        version: 1,
        savedAt: NOW,
        isDefault: true,
      },
      {
        id: 'pm',
        kind: 'cv-variant' as const,
        name: 'pm.pdf',
        mimeType: 'application/pdf',
        size: 1,
        roleFamilies: ['Product'],
        version: 1,
        savedAt: NOW,
      },
    ],
  };

  it('attaches the variant written for that role family', () => {
    expect(documentFor(profile, 'Product')!.id).toBe('pm');
  });

  it('falls back to the master CV when no variant fits', () => {
    expect(documentFor(profile, 'Finance')!.id).toBe('master');
    expect(documentFor(profile)!.id).toBe('master');
  });

  it('returns nothing rather than guessing when no CV is saved', () => {
    expect(documentFor(emptyProfile(NOW))).toBeUndefined();
  });
});

describe('versioning', () => {
  it('bumps the version on every edit, so an application can name what it filled from', () => {
    const p = emptyProfile(NOW);
    expect(touch(p, NOW + 1).profileVersion).toBe(p.profileVersion + 1);
  });
});

describe('conflicts', () => {
  it('surfaces two different graduation years instead of picking one', () => {
    const p = {
      ...emptyProfile(NOW),
      education: [
        education({ id: 'a', qualification: 'B.Tech', endDate: '2023-06', institution: 'College A' }),
        education({ id: 'b', qualification: 'B.Tech', endDate: '2024-06', institution: 'College B' }),
        education({ id: 'c', qualification: 'B.Tech', endDate: '2024-06', institution: 'College C' }),
      ],
    };
    const found = conflicts(p);
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe('graduationYear');
    expect(found[0]!.values.length).toBeGreaterThan(1);
  });

  it('does not invent a conflict from a single degree', () => {
    const p = { ...emptyProfile(NOW), education: [education({ id: 'a', qualification: 'B.Tech', endDate: '2024-06' })] };
    expect(conflicts(p)).toHaveLength(0);
  });
});
