import { z } from 'zod';
import { extractJson } from '../parsers/json';
const fact = z.object({detail:z.string().trim().min(1),source:z.enum(['linkedin','cv','both'])}).passthrough();
// The prompt describes "category arrays" as {detail,source} objects, and ChatGPT applies that to
// missingInformation and conflicts too. Accept either a plain string or a {detail} object there.
const note = z.union([z.string().trim().min(1),z.object({detail:z.string().trim().min(1)}).passthrough()]);
const categories = { experience:z.array(fact),education:z.array(fact),projects:z.array(fact),skills:z.array(fact),certifications:z.array(fact),achievements:z.array(fact),otherFacts:z.array(fact),missingInformation:z.array(note),conflicts:z.array(note) };
const v2=z.object({schemaVersion:z.literal(2),name:z.string(),headline:z.string(),summary:z.string(),targetRoleStrengths:z.array(z.union([z.string(),fact])),...categories}).passthrough();
const v1=z.object({schemaVersion:z.literal(1),name:z.string(),summary:z.string(),...categories}).passthrough();
export const dossierSchema=z.union([v2,v1]); // Read historical saved dossiers; new prompts produce v2.
export function validatedDossier(reply:string):string {
  try { return JSON.stringify(dossierSchema.parse(extractJson(reply)),null,2); }
  catch { throw new Error('ChatGPT did not return the required career-profile JSON. Nothing was saved as processed. Review the response and try again.'); }
}
