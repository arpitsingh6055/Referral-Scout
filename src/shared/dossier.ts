import { z } from 'zod';
import { extractJson } from '../parsers/json';
const fact = z.object({detail:z.string(),source:z.enum(['linkedin','cv','both'])}).strict();
export const dossierSchema = z.object({
  schemaVersion:z.literal(1), name:z.string(), summary:z.string(),
  experience:z.array(fact),education:z.array(fact),projects:z.array(fact),
  skills:z.array(fact),certifications:z.array(fact),achievements:z.array(fact),
  otherFacts:z.array(fact),missingInformation:z.array(z.string()),conflicts:z.array(z.string())
}).strict();
export function validatedDossier(reply:string):string {
  try { return JSON.stringify(dossierSchema.parse(extractJson(reply)),null,2); }
  catch { throw new Error('ChatGPT did not return the required career-profile JSON. Nothing was saved as processed. Review the response and try again.'); }
}
