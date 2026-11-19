import { describe, expect, it } from 'vitest';
import { profileSections, seekerEvidence, suggestSpecializationsFromProfile } from '../src/shared/seeker';

// The shape the profile reader stores: name/headline/location, then one block per section.
const rawText = [
  'Arpit Singh\nPGDM 2026-28, IMT Ghaziabad | ex-Inside Sales\nGhaziabad, Uttar Pradesh',
  'ABOUT\nCommerce graduate who spent two years in B2B inside sales before the PGDM.',
  'EXPERIENCE\nInside Sales Executive, Acme SaaS, 2023-2025. Closed 40 mid-market accounts. Mentored MBA interns.',
  'EDUCATION\nIMT Ghaziabad, PGDM, 2026-2028. Delhi University, B.Com (Hons), 2020-2023.',
  'SKILLS\nSalesforce, Excel, negotiation',
  'VOLUNTEERING\nTaught maths at a weekend school.',
].join('\n\n');

describe('the seeker background given to ChatGPT', () => {
  it('recovers every section from the stored profile text', () => {
    const sections = profileSections({ rawText });
    expect(Object.keys(sections)).toEqual(['about', 'experience', 'education', 'skills', 'volunteering']);
    expect(sections['experience']).toMatch(/Inside Sales Executive/);
  });

  it('includes experience, education, skills, other sections and the CV, but not the name', () => {
    const text = seekerEvidence({ headline: 'PGDM | ex-Inside Sales', rawText, cvText: 'CV: Excel modelling project at IMT.' });
    for (const part of [
      'HEADLINE: PGDM',
      'EXPERIENCE: Inside Sales Executive',
      'EDUCATION: IMT Ghaziabad, PGDM',
      'SKILLS: Salesforce',
      'VOLUNTEERING: Taught',
      'CV: CV: Excel modelling',
    ])
      expect(text).toContain(part);
    expect(text).not.toContain('Arpit Singh');
  });

  it('keeps each section within its budget so a long experience section cannot push education out', () => {
    const long = [
      'Name\nHeadline\nPlace',
      `EXPERIENCE\n${'Led growth projects. '.repeat(600)}`,
      'EDUCATION\nB.Tech Computer Science, 2021',
    ].join('\n\n');
    const text = seekerEvidence({ rawText: long });
    expect(text).toContain('EDUCATION: B.Tech Computer Science');
    expect(text.length).toBeLessThanOrEqual(9000);
  });

  it('returns nothing when there is nothing to go on, so the prompt says so instead of guessing', () => {
    expect(seekerEvidence({})).toBe('');
  });

  it('suggests qualifications from education and certifications, not from what was said in experience', () => {
    // "Mentored MBA interns" in Experience must not make this person an MBA; PGDM and B.Com in Education do count.
    expect(suggestSpecializationsFromProfile({ headline: 'Sales executive', rawText: rawText.replace('PGDM, ', '') })).toEqual([
      'commerce',
    ]);
    expect(suggestSpecializationsFromProfile({ rawText })).toEqual(['mba', 'commerce']);
  });
});
