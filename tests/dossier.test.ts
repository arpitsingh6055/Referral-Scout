import { expect, it } from 'vitest';
import { validatedDossier } from '../src/shared/dossier';

const fact = (detail: string, source = 'both') => ({ detail, source });
const base = { schemaVersion: 2, name: 'Arpit Singh', headline: 'PGDM', summary: 's', targetRoleStrengths: [fact('x', 'cv')], experience: [fact('Oracle')], education: [], projects: [], skills: [], certifications: [], achievements: [], otherFacts: [] };

it('accepts missingInformation and conflicts as {detail} objects, exactly as ChatGPT returned them', () => {
  const reply = JSON.stringify({ ...base, missingInformation: [{ detail: 'No CGPA supplied.' }], conflicts: [fact('Start date differs: CV Aug 2023, LinkedIn Sep 2023.')] });
  expect(JSON.parse(validatedDossier(reply)).conflicts[0].detail).toContain('Start date');
});

it('still accepts plain-string notes and rendered-markdown noise around the JSON', () => {
  const reply = 'ChatGPT said:\n\n' + JSON.stringify({ ...base, missingInformation: ['No CGPA'], conflicts: [] }, null, 2);
  expect(JSON.parse(validatedDossier(reply)).missingInformation).toEqual(['No CGPA']);
});

it('rejects prose and empty notes', () => {
  expect(() => validatedDossier('Here is your dossier!')).toThrow(/required career-profile JSON/);
  expect(() => validatedDossier(JSON.stringify({ ...base, missingInformation: [''], conflicts: [] }))).toThrow();
});
