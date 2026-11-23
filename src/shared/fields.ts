/**
 * Field and button rules shared by the page script and the background. Kept apart from the rest of the application
 * logic (and its validation library) so the script injected into job sites stays small.
 */
import type { FieldKind, Sensitive } from './apply';
const EEO =
  /\b(gender|pronoun|race|racial|ethnic|ethnicity|hispanic|latin[oax]|veteran|disabilit|disabled|sexual orientation|transgender|lgbt|religion|caste|tribe)\b/i;
const LEGAL =
  /\b(i (hereby )?(certify|declare|confirm|acknowledge|agree|consent|attest|understand)|terms (and|&) conditions|terms of (use|service)|privacy (policy|notice|statement)|consent to|attest|true(, accurate)? and (correct|complete)|background (check|verification) (authori|consent)|non-?disclosure)\b/i;
const SIGNATURE = /\b(signature|sign here|e-?sign|type your (full |legal )?name to sign)\b/i;
const CAPTCHA = /captcha|recaptcha|hcaptcha|turnstile|i'?m not a robot/i;
/**
 * Fields the extension must not answer on its own: passwords and CAPTCHAs (never), diversity and identity questions
 * (unless the person chose "Prefer not to say"), and legal declarations and signatures (they are the person's own act).
 */
export function sensitivity(f: {
  kind: FieldKind;
  label: string;
  help?: string;
  inputType?: string;
  name?: string;
}): Sensitive | undefined {
  const text = `${f.label} ${f.help ?? ''} ${f.name ?? ''}`;
  if (f.inputType === 'password') return 'password';
  if (CAPTCHA.test(text)) return 'captcha';
  if (SIGNATURE.test(text)) return 'signature';
  if ((f.kind === 'checkbox' || f.kind === 'checkboxes' || f.kind === 'radio') && LEGAL.test(text)) return 'legal';
  if (EEO.test(text)) return 'eeo';
  return undefined;
}
/** Buttons that end an application. The extension never presses these. */
export const SUBMIT_LABEL =
  /\b(submit|send (my )?application|apply( now)?|finish( application)?|complete application|confirm and submit)\b/i;
/** Buttons that only move to the next step of a multi-page application. */
export const NEXT_LABEL =
  /^(next|continue|save (and|&) continue|save (and|&) next|proceed|review( (application|your application))?|next step)\b/i;
export function buttonRole(label: string): 'next' | 'submit' | null {
  const t = label.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return null;
  if (NEXT_LABEL.test(t) && !/submit/i.test(t)) return 'next';
  if (SUBMIT_LABEL.test(t)) return 'submit';
  return null;
}
