import { expect, it } from 'vitest';
import { friendlyError } from '../src/shared/errors';
import { detectSpecializations } from '../src/shared/specializations';

it('turns a schema-mismatch dump into a plain sentence', () => {
  const zod =
    '[ { "expected": "string", "code": "invalid_type", "path": [], "message": "Invalid input: expected string, received undefined" } ]';
  expect(friendlyError(zod)).toMatch(/unexpected format/);
  expect(friendlyError(`ChatGPT could not draft a reply: ${zod}`)).toMatch(/unexpected format/);
});

it('explains a severed extension context and a moved page element', () => {
  expect(friendlyError('Extension context invalidated.')).toMatch(/Refresh the LinkedIn tab/);
  expect(friendlyError("Cannot read properties of undefined (reading 'onMessage')")).toMatch(/Refresh the page/);
});

it('passes a message written for people through unchanged', () => {
  const human = 'The message window for this person did not open, so the message was NOT sent.';
  expect(friendlyError(human)).toBe(human);
  expect(friendlyError('')).toMatch(/Try again/);
});

it('reads qualifications from a profile or CV to pre-tick the checklist', () => {
  expect(detectSpecializations('PGDM 2026-28 at IMT Ghaziabad | Product Management')).toEqual(['mba']);
  // a CS/IT engineering degree is not also listed as "other branches"
  expect(detectSpecializations('B.Tech in Computer Science, 2023')).toEqual(['btech-cs']);
  expect(detectSpecializations('B.Tech Mechanical; MBA (Finance)')).toEqual(['mba', 'btech-other']);
  expect(detectSpecializations('')).toEqual([]);
  // an ambiguous abbreviation alone is not enough on a CV
  expect(detectSpecializations('Education: CA, USA campus')).toEqual([]);
});
