/**
 * The qualification checklist, shared by onboarding and Settings. Until the seeker confirms a choice it is pre-filled
 * from their CV and LinkedIn headline/About, so most people get the description ranking without ticking anything.
 * Onboarding shows a one-line summary above the options; Settings shows the list with a longer explanation.
 */
import { SPECIALIZATIONS, detectSpecializations } from '../shared/specializations';
import { type NetworkState } from '../shared/network';
import { node, flags } from './core';

export interface QualificationPicker {
  wrap: HTMLElement;
  values: () => string[];
  /** Whether the saved choice should count as confirmed: the seeker changed it, or it holds something. */
  confirmed: () => boolean;
}

/**
 * What the seeker's own profile says they hold. The background reads it from the full LinkedIn profile (Education,
 * Certifications) and the CV, which the panel never receives; headline/About is only a fallback.
 */
export function suggestedQualifications(s: NetworkState): string[] {
  return s.suggestedSpecializations ?? detectSpecializations(`${s.profile?.headline ?? ''}\n${s.profile?.about ?? ''}`);
}

export function qualificationPicker(s: NetworkState, compact: boolean): QualificationPicker {
  const settings = s.settings;
  const suggested = suggestedQualifications(s);
  const chosen = !!settings?.specializationsChosen;
  const initial = new Set(
    chosen ? (settings?.specializations ?? []) : settings?.specializations?.length ? settings.specializations : suggested,
  );
  const fromProfile = !chosen && !settings?.specializations?.length && suggested.length > 0;

  const boxes = new Map<string, HTMLInputElement>();
  const list = node('div');
  for (const spec of SPECIALIZATIONS) {
    const row = node('label');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0;cursor:pointer';
    const cb = node('input');
    cb.type = 'checkbox';
    cb.checked = initial.has(spec.id);
    boxes.set(spec.id, cb);
    row.append(cb, node('span', spec.label));
    list.append(row);
  }
  const values = (): string[] => [...boxes].filter(([, cb]) => cb.checked).map(([id]) => id);
  let touched = false;
  for (const cb of boxes.values())
    cb.addEventListener('change', () => {
      touched = true;
    });
  // An empty list nobody touched stays unconfirmed, so a CV uploaded later can still pre-fill it.
  const confirmed = (): boolean => chosen || touched || values().length > 0;
  const help =
    'Each job’s full description is read and ranked against these. Matching jobs move to the top of your list with the reason shown; nothing is excluded.';

  const wrap = node('div', '', 'field');
  if (compact) {
    // A one-line summary that follows the ticks, above the options.
    const summary = node('p', '', 'field-help');
    const describe = (): void => {
      const picked = SPECIALIZATIONS.filter(x => boxes.get(x.id)?.checked).map(x => x.short);
      summary.textContent = picked.length
        ? `${fromProfile ? 'From your profile, we’ll' : 'We’ll'} prioritise jobs that ask for: ${picked.join(', ')}.`
        : 'Optional: tick your qualification to see jobs that ask for it first.';
    };
    for (const cb of boxes.values())
      cb.addEventListener('change', () => {
        flags.dirty = true;
        describe();
      });
    describe();
    // The options are shown directly: a fold here only added a click before the one choice that matters.
    wrap.append(node('label', 'Your qualification', 'field-label'), summary, list, node('p', help, 'field-help'));
  } else {
    for (const cb of boxes.values())
      cb.addEventListener('change', () => {
        flags.dirty = true;
      });
    wrap.append(
      node('label', 'Prioritise jobs that ask for your qualification', 'field-label'),
      node('p', fromProfile ? `${help} Pre-filled from your profile; change it if it is wrong.` : help, 'field-help'),
      list,
    );
  }
  return { wrap, values, confirmed };
}
