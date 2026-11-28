import { z } from 'zod';
import { extractJson } from '../parsers/json';
const fact = z.object({ detail: z.string().trim().min(1), source: z.enum(['linkedin', 'cv', 'both']) }).passthrough();
// The prompt describes "category arrays" as {detail,source} objects, and ChatGPT applies that to
// missingInformation and conflicts too. Accept either a plain string or a {detail} object there.
const note = z.union([z.string().trim().min(1), z.object({ detail: z.string().trim().min(1) }).passthrough()]);
const categories = {
  experience: z.array(fact),
  education: z.array(fact),
  projects: z.array(fact),
  skills: z.array(fact),
  certifications: z.array(fact),
  achievements: z.array(fact),
  otherFacts: z.array(fact),
  missingInformation: z.array(note),
  conflicts: z.array(note),
};
const v2 = z
  .object({
    schemaVersion: z.literal(2),
    name: z.string(),
    headline: z.string(),
    summary: z.string(),
    targetRoleStrengths: z.array(z.union([z.string(), fact])),
    ...categories,
  })
  .passthrough();
const v1 = z.object({ schemaVersion: z.literal(1), name: z.string(), summary: z.string(), ...categories }).passthrough();
export const dossierSchema = z.union([v2, v1]); // Read historical saved dossiers; new prompts produce v2.
export function validatedDossier(reply: string): string {
  try {
    return JSON.stringify(dossierSchema.parse(extractJson(reply)), null, 2);
  } catch {
    throw new Error(
      'ChatGPT did not return the required career-profile JSON. Nothing was saved as processed. Review the response and try again.',
    );
  }
}

/**
 * Whether the structured AI review still describes the CV and profile it was built from.
 *
 * Both paths that replace the evidence — saving a CV and re-reading the LinkedIn profile — clear the dossier
 * today, so this is not the only thing standing between an application and stale evidence. It is the thing that
 * cannot be forgotten: a future import, edit or migration that writes a new CV without remembering to clear the
 * dossier is caught here rather than silently filling forms from last month's résumé. Timestamps are compared
 * rather than trusted flags, because a flag has to be maintained and a timestamp does not.
 */
export function dossierStale(s: {
  dossier?: string;
  dossierSavedAt?: number;
  cv?: { savedAt?: number } | null;
  profileCapturedAt?: number;
}): boolean {
  if (!s.dossier?.trim()) return false; // nothing to be stale
  const built = s.dossierSavedAt ?? 0;
  if (!built) return true; // a dossier with no build time cannot be shown to be current
  const newest = Math.max(s.cv?.savedAt ?? 0, s.profileCapturedAt ?? 0);
  return newest > built;
}

/** Whether there is a usable, current structured review to prefer over the raw CV and profile text. */
export const dossierUsable = (s: Parameters<typeof dossierStale>[0]): boolean => !!s.dossier?.trim() && !dossierStale(s);
