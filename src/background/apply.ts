/**
 * "Fill this application": reads the job application open in the person's tab, asks ChatGPT (thinking) what goes in
 * each field from their own LinkedIn profile, CV and saved answers, types it in, and walks a multi-step application
 * one step at a time when the person asks. It never presses Submit: the last step is always the person's.
 *
 * The CV file and profile photo are kept only on this device, under their own keys, and leave it only when they are
 * put into an upload field of an application the person chose to fill.
 */
import { z } from 'zod';
import {
  canFill,
  emptyApplyProfile,
  fillPrompt,
  pageKindFromUrl,
  planFromReply,
  questionKey,
  rememberedFor,
  rewritePrompt,
  isWritten,
  fitTo,
  matchOption,
  applyError,
  sameApplication,
  needsWork,
  localPlan,
  wantsThinking,
  type ApplyProfile,
  type FillPlan,
  type FormField,
  type PageKind,
  type PageSnapshot,
} from '../shared/apply';
import { seekerEvidence } from '../shared/seeker';
import { extractJson } from '../parsers/json';
import { read, write } from '../storage/state';
import { all, remove } from '../storage/database';
import { trustedExtension } from '../validators/security';
import { AI_HEALTH_KEY, askChatGpt, type AiHealth } from './network-ai';
import { getNetwork, queueReferral } from './network';
import { referralJobInput } from '../shared/referral';
import type { ApplyApi, FillResult } from '../content/apply';

export const SESSION_KEY = 'apply-session';
export const PROFILE_KEY = 'apply-profile';
export const CV_FILE_KEY = 'cv-file';
export const PHOTO_KEY = 'apply-photo';
export const HISTORY_KEY = 'apply-history';
export const PHOTO_ORIGIN = 'https://media.licdn.com/*';
const MAX_FILE = 8 * 1024 * 1024;

export interface StoredFile {
  name: string;
  type: string;
  /** Base64 of the file's bytes. */
  data: string;
  size: number;
  savedAt: number;
}
export type ApplyStage =
  'reading' | 'opening' | 'thinking' | 'filling' | 'review' | 'moving' | 'permission' | 'error' | 'done' | 'submitted';
export interface ApplySession {
  tabId: number;
  url: string;
  stage: ApplyStage;
  message: string;
  aiStage?: string | undefined;
  startedAt: number;
  updatedAt: number;
  step: string;
  stepCount: number;
  summary: string;
  filled: { id: string; label: string; value: string; confidence: 'high' | 'medium' | 'low'; why: string; ok: boolean; note?: string }[];
  files: { id: string; label: string; file: 'cv' | 'photo'; ok: boolean; note?: string }[];
  ask: { id: string; frame: number; label: string; question: string; options?: string[]; kind?: string | undefined }[];
  leftForYou: { id: string; label: string; reason: string }[];
  hasNext: boolean;
  hasSubmit: boolean;
  captcha: boolean;
  needOrigins?: string[];
  /** LinkedIn's "Mark this job as a top choice" on this step, and how many the person has left this month. */
  topChoice?: { checked: boolean; remaining?: number } | undefined;
  /** The job being applied for, for the referral step after sending: LinkedIn's job page, or the company's own page. */
  job?: { title: string; company: string; location: string; url: string; companyUrl?: string } | undefined;
  /** When the current stage began, so the panel can show how long ChatGPT has been working. */
  stageSince?: number;
  /** Set once the site confirms the application was sent. */
  sent?: { at: number; referral: 'queued' | 'off' | 'needs-company' | 'failed'; message: string; resumed?: boolean } | undefined;
  /** Kept in the background only: the fields of the current step, to fill answers the person gives. */
  form?: FormField[];
  /** The job description read from the page, kept for rewriting one answer on request. */
  jobText?: string;
}
export const fileFromBase64Size = (data: string): number => Math.floor((data.length * 3) / 4);

/* ---------- small storage helpers ---------- */
export const applyProfile = async (): Promise<ApplyProfile> => ({
  ...emptyApplyProfile(),
  ...((await read<ApplyProfile>(PROFILE_KEY)) ?? {}),
});
export const cvFile = async (): Promise<StoredFile | undefined> => await read<StoredFile>(CV_FILE_KEY);
export const photoFile = async (): Promise<StoredFile | undefined> => await read<StoredFile>(PHOTO_KEY);
export async function saveCvFile(file: { name: string; type: string; data: string }): Promise<void> {
  const size = fileFromBase64Size(file.data);
  if (size > MAX_FILE) throw new Error('That CV is larger than 8 MB. Save a smaller PDF and upload it again.');
  await write(CV_FILE_KEY, { ...file, size, savedAt: Date.now() } satisfies StoredFile);
}
export async function clearApplyData(): Promise<void> {
  for (const key of [SESSION_KEY, PROFILE_KEY, CV_FILE_KEY, PHOTO_KEY, HISTORY_KEY]) await remove('meta', key);
  for (const item of await all('meta')) if (item.id.startsWith(`${SESSION_KEY}:`)) await remove('meta', item.id);
}
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
/** Downloads the person's own LinkedIn profile photo (from the address read at onboarding) and keeps it locally. */
export async function captureProfilePhoto(): Promise<StoredFile> {
  const s = await getNetwork();
  const url = s.profile?.photo;
  if (!url) throw new Error('No LinkedIn photo was found on your profile. Refresh your profile in Settings, or upload a photo.');
  if (!(await chrome.permissions.contains({ origins: [PHOTO_ORIGIN] })))
    throw new Error('Allow Referral Scout to download your LinkedIn photo first.');
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`LinkedIn did not return your photo (error ${res.status}). Refresh your profile and try again.`);
  const type = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  if (!type.startsWith('image/')) throw new Error('LinkedIn did not return an image.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const file: StoredFile = {
    name: `${(s.profile?.name || 'photo').replace(/[^\w-]+/g, '-').toLowerCase()}.${type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'}`,
    type,
    data: toBase64(bytes),
    size: bytes.length,
    savedAt: Date.now(),
  };
  await write(PHOTO_KEY, file);
  return file;
}

/* ---------- the page ---------- */
const originOf = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
};
const LINKEDIN = /^https:\/\/(www\.)?linkedin\.com$/;
async function allowed(origin: string): Promise<boolean> {
  if (LINKEDIN.test(origin)) return true;
  return chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false);
}
type Frame = { frameId: number; result: ReturnType<ApplyApi['scan']> };
async function inject(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['apply.js'] });
}
/** Presses "Continue applying" on LinkedIn's safety reminder, in whichever frame shows it. */
async function passInterstitials(tabId: number): Promise<boolean> {
  await inject(tabId).catch(() => undefined);
  const passed = await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.passInterstitial() ?? false,
    })
    .catch(() => []);
  if (!passed.some(p => p.result === true)) return false;
  await new Promise(r => setTimeout(r, 900));
  return true;
}
async function scanAll(tabId: number, linkedin = false): Promise<Frame[]> {
  await inject(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (li: boolean) => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.scan({ linkedin: li }) ?? null,
    args: [linkedin],
  });
  return results.filter(r => r.result).map(r => ({ frameId: r.frameId, result: r.result as Frame['result'] }));
}
async function inFrame<T>(
  tabId: number,
  frameId: number,
  func: (...args: never[]) => T,
  args: unknown[] = [],
): Promise<Awaited<T> | undefined> {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: func as never,
    args: args as never,
  });
  return r?.result as Awaited<T> | undefined;
}
async function everyFrame(tabId: number, func: () => unknown): Promise<unknown[]> {
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func }).catch(() => []);
  return results.map(r => r.result);
}
/** The application as one snapshot: every frame's fields (tagged with their frame) and the best job text. */
function merge(
  frames: Frame[],
  tabUrl: string,
  title: string,
): PageSnapshot & {
  frames: string[];
  topChoice?: { checked: boolean; remaining?: number } | undefined;
  jobMatch?: 'low' | 'medium' | 'high' | undefined;
} {
  const withForm = frames.filter(f => f.result.form.length);
  const main = frames.find(f => f.frameId === 0)?.result;
  const job = [main?.job, ...frames.map(f => f.result.job)].filter(Boolean).sort((a, b) => b!.length - a!.length)[0] ?? '';
  // A step can have no fields (LinkedIn's review page has only its Submit button): then the open Easy Apply window counts.
  const active = withForm.length ? withForm : frames.filter(f => f.result.easyApplyOpen);
  const primary = [...active].sort((a, b) => b.result.form.length - a.result.form.length)[0]?.result;
  return {
    url: tabUrl,
    title,
    job,
    html: withForm
      .map(f => f.result.html)
      .join('\n')
      .slice(0, 16000),
    form: withForm.flatMap(f => f.result.form.map(x => ({ ...x, frame: f.frameId }))),
    step: primary?.step ?? main?.step ?? '',
    hasNext: active.some(f => f.result.hasNext),
    hasSubmit: active.some(f => f.result.hasSubmit),
    captcha: frames.some(f => f.result.captcha),
    topChoice: frames.find(f => f.result.topChoice)?.result.topChoice,
    jobMatch: frames.find(f => f.result.jobMatch)?.result.jobMatch,
    frames: main?.frames ?? [],
  };
}

/* ---------- the session ---------- */
/** One fill per tab: each tab's application has its own record and its own run. */
const sessionKey = (tabId: number) => `${SESSION_KEY}:${tabId}`;
const loadSession = async (tabId: number | undefined): Promise<ApplySession | undefined> =>
  tabId === undefined ? undefined : await read<ApplySession>(sessionKey(tabId));
const runs = new Map<number, AbortController>();
const isRunning = (tabId: number): boolean => runs.has(tabId);
async function update(tabId: number, fn: (s: ApplySession) => ApplySession | void): Promise<ApplySession | undefined> {
  const s = await loadSession(tabId);
  if (!s) return undefined;
  const before = s.stage;
  const next = fn(s) ?? s;
  next.updatedAt = Date.now();
  if (next.stage !== before || !next.stageSince) next.stageSince = next.updatedAt; // for the panel's elapsed time
  await write(sessionKey(tabId), next);
  return next;
}
export type SessionView = Omit<ApplySession, 'form' | 'jobText'> & {
  /** Fields of the step on screen that can still be changed from the panel, and which of them are written answers. */
  editable: string[];
  written: string[];
};
export function sessionView(s: ApplySession | undefined): SessionView | null {
  if (!s) return null;
  const { form, jobText, ...rest } = s;
  void jobText;
  const view: SessionView = {
    ...rest,
    editable: (form ?? []).filter(f => !f.sensitive && f.kind !== 'file').map(f => f.id),
    written: (form ?? []).filter(f => isWritten(f)).map(f => f.id),
  };
  // A worker restart stops a run silently; say so instead of showing a spinner forever.
  if (!isRunning(s.tabId) && ['reading', 'opening', 'thinking', 'filling', 'moving'].includes(s.stage) && Date.now() - s.updatedAt > 60000)
    return { ...view, stage: 'error', message: 'This fill was interrupted. Press Fill again.' };
  return view;
}
const aiWords: Record<string, string> = {
  queued: 'Opening ChatGPT',
  current_document_ready: 'ChatGPT is ready',
  thinking_verified: 'Thinking mode is on',
  thinking_unverified: 'Thinking mode could not be confirmed; continuing',
  thinking_skipped: 'Thinking mode is not available on this account; using the standard model',
  composer_stable: 'Pasting the application into ChatGPT',
  prompt_inserted: 'Checking the question was pasted completely',
  insertion_verified: 'Sending',
  send_clicked: 'Waiting for ChatGPT to accept it',
  user_turn_verified: 'ChatGPT is reading the job and the form',
  assistant_streaming: 'ChatGPT is writing the answers',
  completion_verified: 'Reading the answers',
  response_extracted: 'Checking every answer against the form',
};
const background = async (): Promise<{ text: string; location: string; name: string; url: string; roles: string[] }> => {
  const s = await getNetwork();
  if (!s.profile) throw new Error('Set up Referral Scout with your LinkedIn profile first.');
  const evidence = seekerEvidence(
    {
      headline: s.profile.headline,
      location: s.profile.location,
      about: s.profile.about,
      sections: s.profile.sections,
      rawText: s.profile.rawText,
    },
    7000,
  );
  const cv = (s.cv?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 14000);
  return {
    text: `${evidence}${cv ? `\nCV (full text): ${cv}` : ''}`,
    location: s.profile.location,
    name: s.profile.name,
    url: s.profile.url,
    roles: s.settings?.roles ?? [],
  };
};

export interface Detect {
  tabId: number | null;
  url: string;
  origin: string;
  kind: PageKind;
  canFill: boolean;
  permission: boolean;
  onboarded: boolean;
  cv: { name: string; size: number } | null;
  photo: { name: string; size: number; type: string; data: string } | null;
  linkedinPhoto: boolean;
  photoPermission: boolean;
  session: SessionView | null;
  /** The latest applications sent from the panel, newest first. */
  history: { title: string; company: string; url: string; at: number }[];
  /** Applications sent since midnight, for the gentle daily limit on assisted applying. */
  today: number;
  /** The last ChatGPT task's outcome, when it pointed at a problem with ChatGPT's page. */
  aiHealth: AiHealth | null;
  profile: ApplyProfile;
}
/** Opens the next Easy Apply job in a LinkedIn results list and starts filling it. */
async function nextJob(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https:\/\/www\.linkedin\.com\/jobs\//.test(tab.url ?? ''))
    throw new Error('Open your LinkedIn job search results to move on to the next job.');
  await inject(tabId);
  const before = new URL(tab.url!).searchParams.get('currentJobId') ?? '';
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.openNextJob() ?? '',
  });
  const id = typeof r?.result === 'string' ? r.result : '';
  if (!id)
    throw new Error('No other Easy Apply job on this page that you have not applied to. Scroll the list or open the next page of results.');
  // LinkedIn swaps the job in place: wait until the address names the new job, then give its details a moment to load.
  for (let i = 0; i < 20; i++) {
    await new Promise(res => setTimeout(res, 400));
    const now = await chrome.tabs.get(tabId).catch(() => undefined);
    const cur = now?.url ? (new URL(now.url).searchParams.get('currentJobId') ?? '') : '';
    if (cur && cur !== before) break;
  }
  await new Promise(res => setTimeout(res, 1200));
  await remove('meta', sessionKey(tabId));
  await start(tabId);
}
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const formCheck = new Map<string, boolean>();
/** A page outside known job sites counts as an application when it has a form of several fields or a CV upload. */
async function looksLikeApplication(tabId: number | undefined, url: string, origin: string): Promise<boolean> {
  if (tabId === undefined || !origin || !(await allowed(origin))) return false; // nothing is read without permission
  const key = url.split('#')[0]!;
  const known = formCheck.get(key);
  if (known !== undefined) return known;
  const [r] = await chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        const shown = (e: Element) => (e as HTMLElement).getClientRects().length > 0;
        const fields = [
          ...document.querySelectorAll('form input:not([type="hidden"]):not([type="search"]), form select, form textarea'),
        ].filter(shown);
        const upload = !!document.querySelector('input[type="file"]');
        return fields.length >= 4 || (upload && fields.length >= 2);
      },
    })
    .catch(() => []);
  const yes = r?.result === true;
  formCheck.set(key, yes);
  if (formCheck.size > 200) formCheck.delete(formCheck.keys().next().value!);
  return yes;
}
async function detect(tabId?: number, withPhoto = false): Promise<Detect> {
  const tab =
    tabId !== undefined
      ? await chrome.tabs.get(tabId).catch(() => undefined)
      : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const url = tab?.url ?? '';
  const kind = pageKindFromUrl(url);
  const origin = originOf(url);
  const [s, cv, photo, stored, profile, history, health, since] = await Promise.all([
    getNetwork(),
    cvFile(),
    photoFile(),
    loadSession(tab?.id),
    applyProfile(),
    read<Detect['history']>(HISTORY_KEY).then(h => h ?? []),
    read<AiHealth>(AI_HEALTH_KEY).catch(() => undefined),
    startOfToday(),
  ]);
  let session = stored;
  // The last step was reached: see whether the site has confirmed the application (polled while the panel is open).
  if (session && !session.sent && session.hasSubmit && !session.hasNext && !isRunning(session.tabId)) {
    if (await checkSubmitted(session.tabId).catch(() => false)) session = await loadSession(session.tabId);
  }
  // The tab moved to another job (LinkedIn changes the job in the same tab): the old fill no longer applies.
  if (session && url && !sameApplication(session.url, url)) {
    runs.get(session.tabId)?.abort();
    await remove('meta', sessionKey(session.tabId));
    session = undefined;
  }
  return {
    tabId: tab?.id ?? null,
    url,
    origin,
    kind,
    // Any other website: offer the fill only where the page really holds an application form, never on every site.
    canFill: kind === 'other' ? await looksLikeApplication(tab?.id, url, origin) : canFill(kind),
    permission: canFill(kind) ? await allowed(origin) : false,
    onboarded: !!s.profile,
    cv: cv ? { name: cv.name, size: cv.size } : null,
    // A small preview for the panel; the photo is the person's own.
    photo: photo
      ? { name: photo.name, size: photo.size, type: photo.type, data: withPhoto && photo.size < 400000 ? photo.data : '' }
      : null,
    linkedinPhoto: !!s.profile?.photo,
    photoPermission: await chrome.permissions.contains({ origins: [PHOTO_ORIGIN] }).catch(() => false),
    session: session ? sessionView(session) : null,
    history: history.slice(0, 15),
    today: history.filter(h => h.at >= since).length,
    aiHealth: health && !health.ok ? health : null,
    profile,
  };
}

/** The address a referral should point to: LinkedIn's own job page when it is a LinkedIn job, else the page applied on. */
function jobUrlFor(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)linkedin\.com$/.test(u.hostname)) {
      const id = /^\/jobs\/view\/(\d+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('currentJobId');
      if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
/** Reads the job's title and company from the page once per application (ChatGPT's reading fills any gap later). */
async function captureJob(tabId: number, url: string): Promise<void> {
  const s = await loadSession(tabId);
  if (!s || (s.job?.company && s.job.title)) return;
  const metas = await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.jobMeta() ?? null,
    })
    .catch(() => []);
  const found = metas.map(m => m.result).filter((m): m is NonNullable<typeof m> => !!m);
  const meta = found.find(m => m.company && m.title) ?? found.find(m => m.company) ?? found[0];
  if (!meta) return;
  await update(tabId, x => ({
    ...x,
    job: {
      title: x.job?.title || meta.title,
      company: x.job?.company || meta.company,
      location: x.job?.location || meta.location,
      url: x.job?.url || jobUrlFor(url),
      ...(meta.companyUrl ? { companyUrl: meta.companyUrl } : x.job?.companyUrl ? { companyUrl: x.job.companyUrl } : {}),
    },
  }));
}

/**
 * Checks, once the last step was reached, whether the site confirmed the application (LinkedIn's "Application sent",
 * a thank-you page). Then the application is recorded and, unless the person turned it off, the referral search for
 * that company starts: the same pipeline as "Ask for referrals", with every invitation waiting for approval by default.
 */
export async function checkSubmitted(tabId: number): Promise<boolean> {
  const s = await loadSession(tabId);
  if (!s || s.tabId !== tabId || s.sent || !s.hasSubmit || s.hasNext) return false;
  await inject(tabId).catch(() => undefined);
  const said = await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.submitted() ?? false,
    })
    .catch(() => []);
  if (!said.some(r => r.result === true)) return false;
  runs.get(tabId)?.abort();
  const now = Date.now();
  const job = s.job;
  const history = (await read<{ title: string; company: string; url: string; at: number }[]>(HISTORY_KEY)) ?? [];
  if (job) await write(HISTORY_KEY, [{ title: job.title, company: job.company, url: job.url, at: now }, ...history].slice(0, 200));
  const profile = await applyProfile();
  let sent: NonNullable<ApplySession['sent']>;
  if ((profile.afterApply ?? 'referrals') === 'nothing') sent = { at: now, referral: 'off', message: '' };
  else sent = await startReferral(job, now);
  await update(tabId, x => ({
    ...x,
    stage: 'submitted',
    aiStage: undefined,
    ask: [],
    sent,
    message: job?.company ? `Application sent to ${job.company}.` : 'Application sent.',
  }));
  return true;
}
async function startReferral(job: ApplySession['job'], appliedAt: number): Promise<NonNullable<ApplySession['sent']>> {
  if (!job?.company || !job.title || job.title.length < 2) return { at: appliedAt, referral: 'needs-company', message: '' };
  const input = referralJobInput.safeParse({
    url: job.url,
    title: job.title,
    company: job.company,
    location: job.location ?? '',
    ...(job.companyUrl ? { companyUrl: job.companyUrl } : {}),
  });
  if (!input.success) return { at: appliedAt, referral: 'needs-company', message: '' };
  try {
    const linkedin = /^https:\/\/www\.linkedin\.com\/jobs\/view\//.test(job.url);
    const r = await queueReferral({ ...input.data, applied: appliedAt, ...(linkedin ? {} : { infoTried: true }) }, 'referral');
    return r.ok
      ? {
          at: appliedAt,
          referral: 'queued',
          message: `Finding people at ${job.company} who can refer you.`,
          ...(r.resumed ? { resumed: true } : {}),
        }
      : { at: appliedAt, referral: 'failed', message: r.message };
  } catch (e) {
    return { at: appliedAt, referral: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}
/** Puts one answer into the page (an edit from the panel or a rewrite) and updates the panel's list. */
async function editAnswer(tabId: number, id: string, value: string, why: string): Promise<void> {
  const s = await loadSession(tabId);
  const f = s?.form?.find(x => x.id === id);
  if (!s || !f) throw new Error('That field is no longer on the page.');
  if (f.sensitive) throw new Error('That field is left for you to answer on the page.');
  let v = value.trim();
  if (!v) throw new Error('Type an answer first.');
  if (f.options?.length && (f.kind === 'select' || f.kind === 'radio')) {
    const hit = matchOption(v, f.options);
    if (!hit) throw new Error(`Choose one of: ${f.options.slice(0, 8).join(', ')}.`);
    v = hit;
  }
  if (f.maxLength && v.length > f.maxLength) v = fitTo(v, f.maxLength);
  const r = await inFrame(
    tabId,
    f.frame,
    (i: unknown) => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.fill(i as never, []) ?? Promise.resolve([]),
    [[{ id: f.id, kind: f.kind, value: v }]],
  ).catch(() => undefined);
  const ok = !!(r as FillResult[] | undefined)?.[0]?.ok;
  if (!ok) throw new Error('The page did not take the new answer. Change it on the page.');
  await update(tabId, x => ({
    ...x,
    stage: x.stage === 'thinking' ? 'review' : x.stage,
    message: `Updated \u201c${f.label.slice(0, 60)}\u201d.`,
    filled: [...x.filled.filter(y => y.id !== f.id), { id: f.id, label: f.label, value: v, confidence: 'high', why, ok: true }],
  }));
}
/** Fills the step on screen. advance: true when nothing is left for the person and the site has a Next button. */
async function fillStep(tabId: number, signal: AbortSignal, attempt: number): Promise<{ advance: boolean } | void> {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? '';
  const kind = pageKindFromUrl(url);
  if (!canFill(kind)) throw new Error('Open a single job or its application form first; a list of jobs cannot be filled.');
  if (!(await allowed(originOf(url))))
    return void (await update(tabId, s => ({
      ...s,
      stage: 'permission',
      needOrigins: [originOf(url)],
      message: 'Allow Referral Scout on this site first.',
    })));
  await update(tabId, s => ({ ...s, stage: 'reading', message: 'Reading the application form…', url }));
  const linkedin = kind === 'linkedin-job';
  // LinkedIn may put a "Job search safety reminder" in front of the form: pass it, the person need not see it.
  if (linkedin) await passInterstitials(tabId);
  let frames = await scanAll(tabId, linkedin);
  let page = merge(frames, url, tab.title ?? '');
  if (!page.form.length && (page.hasNext || page.hasSubmit)) {
    // A step with nothing to fill: move on, or stop at the final review for the person to submit.
    await update(tabId, s => ({
      ...s,
      step: page.step,
      hasNext: page.hasNext,
      hasSubmit: page.hasSubmit,
      captcha: page.captcha,
      topChoice: page.topChoice,
      form: [],
      ask: [],
      stage: page.hasNext ? 'moving' : 'review',
      message: page.hasNext
        ? `Step ${s.stepCount}: nothing to fill. Moving on…`
        : 'All steps are filled. This is the final review: check the application and press Submit on the page yourself.',
    }));
    return { advance: page.hasNext && !page.captcha };
  }
  if (!page.form.length && kind === 'linkedin-job') {
    // LinkedIn may show the job inside its in-app frame: find which frame has the button, then press it in that one only.
    const looks = await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.openEasyApply(false) ?? 'none',
      })
      .catch(() => []);
    const already = looks.some(r => r.result === 'open');
    const target = looks.find(r => r.result === 'opened');
    if (!target && looks.some(r => r.result === 'applied')) {
      // Nothing to fill: the person already applied here. Offer the referral step instead of an error.
      await captureJob(tabId, url);
      const s0 = await loadSession(tabId);
      await update(tabId, x => ({
        ...x,
        stage: 'submitted',
        message: 'You already applied to this job.',
        sent: { at: Date.now(), referral: s0?.job?.company ? 'off' : 'needs-company', message: '' },
      }));
      return;
    }
    let opened: 'opened' | 'external' | 'none' = already
      ? 'opened'
      : looks.some(r => r.result === 'external') && !target
        ? 'external'
        : 'none';
    if (!already && target) {
      await inFrame(tabId, target.frameId, () =>
        (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.openEasyApply(true),
      );
      opened = 'opened';
    }
    if (opened === 'none')
      throw new Error('The Easy Apply button was not found on this job. Open the job so its details show, then press Fill again.');
    if (opened === 'external')
      throw new Error(
        'This job is applied for on the company’s own site. Press Apply on LinkedIn, then press "Fill this application" on the page that opens.',
      );
    if (opened === 'opened') {
      await update(tabId, s => ({ ...s, stage: 'opening', message: 'Opening Easy Apply…' }));
      for (let i = 0; i < 12 && !page.form.length; i++) {
        await new Promise(r => setTimeout(r, 700));
        signal.throwIfAborted();
        await passInterstitials(tabId);
        frames = await scanAll(tabId, linkedin);
        page = merge(frames, url, tab.title ?? '');
      }
    }
  }
  if (!page.form.length) {
    // The form may live in a frame from another site (a careers page embedding Greenhouse, say).
    const missing: string[] = [];
    for (const src of page.frames) {
      const o = originOf(src);
      if (o && !missing.includes(o) && !(await allowed(o))) missing.push(o);
    }
    if (missing.length)
      return void (await update(tabId, s => ({
        ...s,
        stage: 'permission',
        needOrigins: missing,
        message: `The form on this page comes from ${missing.map(m => new URL(m).host).join(', ')}. Allow it to fill the form.`,
      })));
    throw new Error(
      kind === 'linkedin-job'
        ? 'No application form is open. Press Easy Apply (or Apply) on the job first.'
        : 'No form fields were found on this page. Open the application form itself (often behind an "Apply" button), then try again.',
    );
  }
  await captureJob(tabId, url);
  const [bg, profile, photo, cv] = await Promise.all([background(), applyProfile(), photoFile(), cvFile()]);
  // "Mark this job as a top choice": ticked on every application while LinkedIn offers it, unless the person chose
  // to decide themselves. Ticking reveals a required message, which is written below with the rest of the step.
  let topTicked = false;
  // Not on a job LinkedIn itself rates a low match: the few top choices a month are kept for jobs that fit.
  if (
    linkedin &&
    page.topChoice &&
    !page.topChoice.checked &&
    page.topChoice.remaining !== 0 &&
    page.jobMatch !== 'low' &&
    (profile.topChoice ?? 'auto') === 'auto'
  ) {
    const ticks = await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.markTopChoice() ?? 'none',
      })
      .catch(() => []);
    if (ticks.some(t => t.result === 'checked')) {
      topTicked = true;
      await new Promise(r => setTimeout(r, 1200));
      frames = await scanAll(tabId, linkedin);
      page = merge(frames, url, tab.title ?? '');
    }
  }
  if (!cv) throw new Error('Upload your CV (PDF or Word) in Settings first: applications need the file.');
  await update(tabId, s => ({
    ...s,
    step: page.step,
    hasNext: page.hasNext,
    hasSubmit: page.hasSubmit,
    captcha: page.captcha,
    topChoice: page.topChoice,
    form: page.form,
    ...(page.job ? { jobText: page.job.slice(0, 7000) } : {}),
  }));
  // Fast path. LinkedIn already fills most Easy Apply steps from the person's account, and many questions were
  // answered before: only what is still empty, and cannot be answered from saved answers and details, goes to ChatGPT.
  const todo = needsWork(page.form, linkedin);
  // Saved answers cost nothing, so they also go into empty optional fields (current location, links...).
  const local = localPlan(needsWork(page.form, false), profile, { linkedinUrl: bg.url, photo: !!photo, location: bg.location });
  const covered = new Set([...local.fill.map(f => f.id), ...local.files.map(f => f.id)]);
  const rest = todo.filter(f => !covered.has(f.id));
  let plan: FillPlan = {
    fill: local.fill,
    files: local.files,
    ask: [],
    leftForYou: page.form
      .filter(f => f.sensitive && !(f.sensitive === 'eeo' && profile.eeo === 'decline'))
      .map(f => ({ id: f.id, label: f.label, reason: 'Left for you to answer.' })),
    summary: '',
  };
  if (rest.length) {
    const thinking = wantsThinking(rest);
    const prompt =
      fillPrompt({ page, background: bg.text, roles: bg.roles, profile, name: bg.name, linkedinUrl: bg.url, photo: !!photo }) +
      (attempt > 1 ? `\n(Attempt ${attempt}: answer afresh.)` : '');
    await update(tabId, s => ({
      ...s,
      stage: 'thinking',
      message: thinking
        ? 'ChatGPT is writing your answers…'
        : `ChatGPT is answering ${rest.length} question${rest.length === 1 ? '' : 's'}…`,
    }));
    const reply = await askChatGpt(prompt, signal, 'FILL_APPLICATION', bg.url, '', {
      startMs: 90000,
      totalMs: (thinking ? 8 : 3) * 60000,
      thinking,
      onStage: stage => void update(tabId, s => ({ ...s, aiStage: stage, message: `${aiWords[stage] ?? 'Working'}…` })),
    });
    signal.throwIfAborted();
    let ai: FillPlan;
    try {
      ai = planFromReply(extractJson(reply), page.form, profile, !!photo);
    } catch {
      throw new Error('ChatGPT’s answer could not be read. Press Fill again.');
    }
    if (ai.job?.company)
      await update(tabId, x => ({
        ...x,
        // The page's own structured data wins; ChatGPT's reading fills what the page did not say.
        job: {
          title: x.job?.title || ai.job!.title,
          company: x.job?.company || ai.job!.company,
          location: x.job?.location ?? '',
          url: x.job?.url || jobUrlFor(url),
          ...(x.job?.companyUrl ? { companyUrl: x.job.companyUrl } : {}),
        },
      }));
    // Saved answers win over ChatGPT's; ChatGPT fills the rest.
    // On LinkedIn ChatGPT may only answer what was empty, never change what LinkedIn or the person already set
    // (such as "Mark this job as a top choice", which uses a monthly allowance, or "Follow the company").
    const allowed = (id: string) => !covered.has(id) && (!linkedin || rest.some(f => f.id === id));
    plan = {
      fill: [...local.fill, ...ai.fill.filter(f => allowed(f.id))],
      files: [...local.files, ...ai.files.filter(f => allowed(f.id))],
      ask: ai.ask.filter(a => allowed(a.id)),
      leftForYou: ai.leftForYou,
      summary: ai.summary,
    };
    // Questions the person already answered on an earlier application are filled, not asked again.
    const remembered = new Map(rememberedFor(page.form, profile).map(r => [r.id, r.value]));
    for (const q of [...plan.ask]) {
      const value = remembered.get(q.id);
      const f = page.form.find(x => x.id === q.id);
      if (value && f) {
        plan.ask = plan.ask.filter(a => a !== q);
        plan.fill.push({ id: f.id, frame: f.frame, kind: f.kind, label: f.label, value, confidence: 'high', why: 'Your earlier answer' });
      }
    }
  }
  signal.throwIfAborted();
  if (plan.fill.length || plan.files.length) await update(tabId, s => ({ ...s, stage: 'filling', message: 'Filling the form…' }));
  const results = plan.fill.length || plan.files.length ? await applyPlan(tabId, plan, page.form, cv, photo) : [];
  const byId = new Map(results.map(r => [r.id, r]));
  await mark(tabId, page.form, plan, byId);
  const failedRequired = results.filter(r => !r.ok && page.form.find(f => f.id === r.id)?.required).length;
  const failed = results.filter(r => !r.ok).length;
  const stillEmptyRequired = rest.filter(f => f.required && !plan.fill.some(x => x.id === f.id) && !plan.files.some(x => x.id === f.id));
  const advance = !!page.hasNext && !page.captcha && !plan.ask.length && !failedRequired && !stillEmptyRequired.length;
  await update(tabId, s => ({
    ...s,
    stage: advance ? 'moving' : 'review',
    aiStage: undefined,
    summary: plan.summary || s.summary,
    message: advance
      ? `Step ${s.stepCount} done${plan.fill.length + plan.files.length ? '' : ' (already filled)'}. Moving on…`
      : reviewMessage(plan, failed, page),
    filled: [
      ...s.filled.filter(x => !plan.fill.some(f => f.id === x.id) && !(topTicked && x.id === 'top-choice')),
      ...(topTicked
        ? [
            {
              id: 'top-choice',
              label: 'Mark this job as a top choice',
              value: 'Yes',
              confidence: 'high' as const,
              why: 'Your setting',
              ok: true,
            },
          ]
        : []),
      ...plan.fill.map(f => ({
        id: f.id,
        label: f.label,
        value: Array.isArray(f.value) ? f.value.join(', ') : f.value,
        confidence: f.confidence,
        why: f.why,
        ok: byId.get(f.id)?.ok ?? false,
        ...(byId.get(f.id)?.note ? { note: byId.get(f.id)!.note } : {}),
      })),
    ],
    files: [
      ...s.files.filter(x => !plan.files.some(f => f.id === x.id)),
      ...plan.files.map(f => ({
        id: f.id,
        label: f.label,
        file: f.file,
        ok: byId.get(f.id)?.ok ?? false,
        ...(byId.get(f.id)?.note ? { note: byId.get(f.id)!.note } : {}),
      })),
    ],
    ask: plan.ask.map(a => ({ ...a, kind: page.form.find(f => f.id === a.id)?.kind })),
    leftForYou: [...s.leftForYou.filter(x => !plan.leftForYou.some(l => l.id === x.id)), ...plan.leftForYou],
  }));
  return { advance };
}
function reviewMessage(plan: FillPlan, failed: number, page: PageSnapshot): string {
  const n = plan.fill.length + plan.files.length;
  const parts = [
    n
      ? `Filled ${n} field${n === 1 ? '' : 's'}.`
      : page.hasSubmit && !page.hasNext
        ? 'All steps are filled.'
        : 'Nothing needed filling here.',
  ];
  if (plan.ask.length) parts.push(`${plan.ask.length} need${plan.ask.length === 1 ? 's' : ''} your answer below.`);
  if (failed) parts.push(`${failed} could not be typed; fill ${failed === 1 ? 'it' : 'them'} on the page.`);
  if (page.captcha) parts.push('There is a security check on the page for you to complete.');
  parts.push(
    page.hasNext
      ? 'Answer what is left, then press Next step and the rest is filled for you.'
      : page.hasSubmit
        ? 'This is the last step: review the application and press Submit on the page yourself.'
        : 'Check the page before you submit it yourself.',
  );
  return parts.join(' ');
}
async function applyPlan(
  tabId: number,
  plan: FillPlan,
  form: FormField[],
  cv: StoredFile,
  photo: StoredFile | undefined,
): Promise<FillResult[]> {
  const frames = new Set(form.map(f => f.frame));
  const out: FillResult[] = [];
  for (const frame of frames) {
    const items = plan.fill.filter(f => f.frame === frame).map(f => ({ id: f.id, kind: f.kind, value: f.value }));
    const files = plan.files
      .filter(f => f.frame === frame)
      .map(f => {
        const src = f.file === 'cv' ? cv : photo!;
        return { id: f.id, name: src.name, type: src.type, data: src.data };
      });
    if (!items.length && !files.length) continue;
    const results = await inFrame(
      tabId,
      frame,
      (i: unknown, f: unknown) =>
        (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.fill(i as never, f as never) ?? Promise.resolve([]),
      [items, files],
    ).catch(() => undefined);
    out.push(
      ...((results as FillResult[] | undefined) ?? items.map(i => ({ id: i.id, ok: false, note: 'The page changed while filling.' }))),
    );
  }
  return out;
}
async function mark(tabId: number, form: FormField[], plan: FillPlan, results: Map<string, FillResult>): Promise<void> {
  const tones = new Map<string, 'done' | 'check' | 'you'>();
  for (const f of plan.fill)
    tones.set(f.id, !results.get(f.id)?.ok ? 'you' : f.confidence === 'low' || results.get(f.id)?.note ? 'check' : 'done');
  for (const f of plan.files) tones.set(f.id, results.get(f.id)?.ok ? 'done' : 'you');
  for (const a of plan.ask) tones.set(a.id, 'you');
  for (const l of plan.leftForYou) tones.set(l.id, 'you');
  for (const frame of new Set(form.map(f => f.frame))) {
    const ids = [...tones].filter(([id]) => form.find(f => f.id === id)?.frame === frame).map(([id, tone]) => ({ id, tone }));
    if (ids.length)
      await inFrame(
        tabId,
        frame,
        (x: unknown) => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.mark(x as never),
        [ids],
      ).catch(() => undefined);
  }
}
async function run(tabId: number, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
  runs.get(tabId)?.abort();
  const controller = new AbortController();
  runs.set(tabId, controller);
  const keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
  try {
    await task(controller.signal);
  } catch (e) {
    if (!controller.signal.aborted)
      await update(tabId, s => ({
        ...s,
        stage: 'error',
        aiStage: undefined,
        message: applyError(e instanceof Error ? e.message : String(e)),
      }));
  } finally {
    clearInterval(keepAlive);
    if (runs.get(tabId) === controller) runs.delete(tabId);
  }
}
const signature = (p: { form: FormField[]; step: string }): string => `${p.step}|${p.form.map(f => f.label).join('|')}`;
async function start(tabId: number, attempt = 1): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const old = await loadSession(tabId);
  const same = old && old.tabId === tabId;
  await write(sessionKey(tabId), {
    tabId,
    url: tab.url ?? '',
    stage: 'reading',
    message: 'Reading the application form…',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    step: '',
    stepCount: same ? old.stepCount : 1,
    summary: same ? old.summary : '',
    filled: [],
    files: [],
    ask: [],
    leftForYou: [],
    hasNext: false,
    hasSubmit: false,
    captcha: false,
  } satisfies ApplySession);
  void run(tabId, signal => autoRun(tabId, signal, attempt));
}
/** Presses the site's Next / Continue / Review and waits for the next step. False when the site stayed put. */
async function pressNext(tabId: number, signal: AbortSignal): Promise<boolean> {
  const s = await loadSession(tabId);
  if (!s) return false;
  const frame = s.form?.[0]?.frame ?? 0;
  const before = signature({ form: s.form ?? [], step: s.step });
  await update(tabId, x => ({ ...x, stage: 'moving' }));
  const clicked = await inFrame(tabId, frame, () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.next());
  if (!clicked?.clicked) throw new Error(clicked?.error ?? 'The page changed; press Fill again.');
  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, i < 4 ? 400 : 750));
    signal.throwIfAborted();
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'loading') continue;
    const frames = await scanAll(tabId, pageKindFromUrl(tab.url ?? '') === 'linkedin-job').catch(() => [] as Frame[]);
    const page = merge(frames, tab.url ?? '', tab.title ?? '');
    // A step can have no fields at all (LinkedIn's review page has only Submit), so a changed step counts too.
    if (signature(page) !== before && (page.form.length || page.hasSubmit || page.hasNext)) {
      await update(tabId, x => ({ ...x, stepCount: x.stepCount + 1 }));
      return true;
    }
    if (!page.form.length && !page.hasNext && !page.hasSubmit && i > 5) {
      await update(tabId, x => ({
        ...x,
        stage: 'done',
        message: 'The form moved on and nothing is left to fill on this page. Check the page.',
      }));
      return false;
    }
  }
  await update(tabId, x => ({
    ...x,
    stage: 'review',
    message: 'The site stayed on this step. It usually marks what is missing in red: fix it on the page, then press Next step.',
  }));
  return false;
}
/** Fills each step and moves on by itself; stops for the person's answers, a site error, or the final Submit. */
async function autoRun(tabId: number, signal: AbortSignal, attempt: number, moveFirst = false): Promise<void> {
  if (moveFirst && !(await pressNext(tabId, signal))) return;
  for (let i = 0; i < 25; i++) {
    const r = await fillStep(tabId, signal, i === 0 ? attempt : 1);
    if (!r?.advance) return;
    if (!(await pressNext(tabId, signal))) return;
  }
  await update(tabId, x => ({
    ...x,
    stage: 'review',
    message: 'This application has many steps. Check the page, then press Next step to keep going.',
  }));
}
async function nextStep(tabId: number): Promise<void> {
  const s = await loadSession(tabId);
  if (!s) throw new Error('Nothing is being filled.');
  await update(tabId, x => ({ ...x, stage: 'moving', message: 'Moving to the next step…' }));
  void run(tabId, signal => autoRun(s.tabId, signal, 1, true));
}
async function answer(tabId: number, answers: { id: string; value: string; remember: boolean }[], skip: string[] = []): Promise<void> {
  const s = await loadSession(tabId);
  if (!s?.form) throw new Error('Nothing is being filled.');
  const items = answers
    .map(a => ({ a, f: s.form!.find(f => f.id === a.id) }))
    .filter((x): x is { a: (typeof answers)[number]; f: FormField } => !!x.f && !!x.a.value.trim() && !x.f.sensitive);
  // Questions the person chose to answer on the page themselves.
  const skipped = (s.ask ?? []).filter(q => skip.includes(q.id));
  if (!items.length && !skipped.length) throw new Error('Type an answer first.');
  const remember = items.filter(x => x.a.remember);
  if (remember.length) {
    const profile = await applyProfile();
    for (const { a, f } of remember) profile.answers[questionKey(f.label)] = a.value.trim().slice(0, 2000);
    await write(PROFILE_KEY, profile);
  }
  const results: FillResult[] = [];
  for (const frame of new Set(items.map(x => x.f.frame))) {
    const list = items.filter(x => x.f.frame === frame).map(x => ({ id: x.f.id, kind: x.f.kind, value: x.a.value.trim() }));
    const r = await inFrame(
      s.tabId,
      frame,
      (i: unknown) => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.fill(i as never, []) ?? Promise.resolve([]),
      [list],
    ).catch(() => undefined);
    results.push(...((r as FillResult[] | undefined) ?? []));
    const ok = ((r as FillResult[] | undefined) ?? []).filter(x => x.ok).map(x => ({ id: x.id, tone: 'done' as const }));
    if (ok.length)
      await inFrame(
        s.tabId,
        frame,
        (x: unknown) => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.mark(x as never),
        [ok],
      ).catch(() => undefined);
  }
  const done = new Set(results.filter(r => r.ok).map(r => r.id));
  const skippedRequired = skipped.filter(q => s.form!.find(f => f.id === q.id)?.required);
  await update(tabId, x => ({
    ...x,
    ask: x.ask.filter(q => !done.has(q.id) && !skip.includes(q.id)),
    leftForYou: [
      ...x.leftForYou.filter(l => !skip.includes(l.id)),
      ...skipped.map(q => ({ id: q.id, label: q.label, reason: 'You chose to answer this on the page.' })),
    ],
    filled: [
      ...x.filled,
      ...items
        .filter(i => done.has(i.f.id))
        .map(i => ({ id: i.f.id, label: i.f.label, value: i.a.value.trim(), confidence: 'high' as const, why: 'Your answer', ok: true })),
    ],
    message: skippedRequired.length
      ? `Answer \u201c${skippedRequired[0]!.label.slice(0, 80)}\u201d on the page (it is required), then press Next step.`
      : done.size === items.length
        ? items.length
          ? `Added your answer${items.length === 1 ? '' : 's'}.`
          : 'Left for you on the page.'
        : 'Some answers could not be typed; fill them on the page.',
  }));
  // Everything this step needed is answered: carry on through the remaining steps by itself.
  const after = await loadSession(tabId);
  if (after && !after.ask.length && after.hasNext && done.size === items.length && !skippedRequired.length && !after.captcha)
    void run(tabId, signal => autoRun(after.tabId, signal, 1, true));
}

/* ---------- messages from the side panel ---------- */
const file = z.object({ name: z.string().min(1).max(200), type: z.string().max(120), data: z.string().min(4).max(12_000_000) });
const detailsSchema = z
  .object({
    phone: z.string().max(40),
    email: z.string().max(200),
    city: z.string().max(120),
    currentCtc: z.string().max(80),
    expectedCtc: z.string().max(80),
    noticePeriod: z.string().max(80),
    startDate: z.string().max(80),
    workAuthorization: z.string().max(300),
    relocate: z.string().max(120),
    links: z.string().max(600),
  })
  .partial();
export const applyRequest = z.discriminatedUnion('action', [
  z.object({
    kind: z.literal('apply'),
    action: z.literal('detect'),
    tabId: z.number().int().optional(),
    withPhoto: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('apply'), action: z.literal('start'), tabId: z.number().int(), again: z.boolean().optional() }),
  z.object({ kind: z.literal('apply'), action: z.literal('next') }),
  z.object({ kind: z.literal('apply'), action: z.literal('nextJob') }),
  z.object({ kind: z.literal('apply'), action: z.literal('testAi') }),
  z.object({ kind: z.literal('apply'), action: z.literal('topChoice') }),
  z.object({ kind: z.literal('apply'), action: z.literal('edit'), id: z.string().max(60), value: z.string().max(4000) }),
  z.object({ kind: z.literal('apply'), action: z.literal('rewrite'), id: z.string().max(60), style: z.enum(['rewrite', 'shorter']) }),
  z.object({
    kind: z.literal('apply'),
    action: z.literal('referral'),
    company: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().min(2).max(200).optional(),
    /** From the applications list: a past application, not the one in this tab. */
    url: z.string().url().max(500).optional(),
  }),
  z.object({ kind: z.literal('apply'), action: z.literal('undo') }),
  z.object({ kind: z.literal('apply'), action: z.literal('stop') }),
  z.object({
    kind: z.literal('apply'),
    action: z.literal('answer'),
    answers: z.array(z.object({ id: z.string().max(60), value: z.string().max(4000), remember: z.boolean() })).max(60),
    /** Questions to leave for the person to answer on the page. */
    skip: z.array(z.string().max(60)).max(60).optional(),
  }),
  z.object({
    kind: z.literal('apply'),
    action: z.literal('saveProfile'),
    details: detailsSchema,
    eeo: z.enum(['leave', 'decline']),
    topChoice: z.enum(['auto', 'ask']).optional(),
    afterApply: z.enum(['referrals', 'nothing']).optional(),
    forget: z.array(z.string().max(200)).max(200).optional(),
  }),
  z.object({ kind: z.literal('apply'), action: z.literal('capturePhoto') }),
  z.object({ kind: z.literal('apply'), action: z.literal('savePhoto'), file }),
  z.object({ kind: z.literal('apply'), action: z.literal('deletePhoto') }),
]);
export type ApplyRequest = z.infer<typeof applyRequest>;
export function registerApplyMessages(): void {
  // After the last step, a page load in that tab (a thank-you page) or LinkedIn's "Application sent" is caught even
  // when the side panel is closed.
  chrome.tabs.onRemoved?.addListener(tabId => {
    runs.get(tabId)?.abort();
    void remove('meta', sessionKey(tabId)).catch(() => undefined);
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete' && !info.url) return;
    void loadSession(tabId).then(s => {
      if (s && !s.sent && s.hasSubmit && !s.hasNext && !isRunning(tabId))
        setTimeout(() => void checkSubmitted(tabId).catch(() => undefined), 1500);
    });
  });
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (!input || typeof input !== 'object' || (input as { kind?: unknown }).kind !== 'apply') return false;
    if (!trustedExtension(sender, chrome.runtime.id)) return false;
    const parsed = applyRequest.safeParse(input);
    if (!parsed.success) {
      respond({ ok: false, error: 'That request was not understood. Reload the side panel.' });
      return false;
    }
    const req = parsed.data;
    const raw = (input as { tabId?: unknown }).tabId;
    void (async () => {
      // Every request names the tab it is about (the side panel sends the active tab), since each tab has its own fill.
      const tabId =
        typeof raw === 'number' && Number.isInteger(raw)
          ? raw
          : ((await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id ?? -1);
      if (req.action === 'start') {
        const s = await getNetwork();
        if (!s.profile) throw new Error('Set up Referral Scout with your LinkedIn profile first.');
        if (!(await cvFile())) throw new Error('Upload your CV in Settings first: applications need the file itself.');
        const old = await loadSession(tabId);
        await start(req.tabId, req.again && old?.tabId === req.tabId ? 2 + Math.floor(Math.random() * 1000) : 1);
      }
      if (req.action === 'next') await nextStep(tabId);
      if (req.action === 'nextJob') {
        if (isRunning(tabId)) throw new Error('This tab is still being filled.');
        // Awaited (about ten seconds at most) so a missing job shows as a message; the fill itself runs on its own.
        await nextJob(tabId);
      }
      if (req.action === 'testAi') {
        // A tiny real task, so the check covers sign-in, the composer, sending and reading the answer.
        const reply = await askChatGpt(
          'Reply with exactly the word READY and nothing else.',
          AbortSignal.timeout(120000),
          'LEGACY',
          'apply-test',
        );
        if (!/ready/i.test(reply)) throw new Error('ChatGPT answered, but not as expected. Open chatgpt.com and check it works.');
      }
      if (req.action === 'referral') {
        // The person asked (or confirmed the company): start the referral search for this application.
        if (req.url) {
          const past = ((await read<Detect['history']>(HISTORY_KEY)) ?? []).find(h => h.url === req.url);
          if (!past) throw new Error('That application is no longer in your list.');
          const sent = await startReferral({ title: past.title, company: past.company, location: '', url: past.url }, past.at);
          if (sent.referral !== 'queued') throw new Error(sent.message || 'The company or role of that application is missing.');
          return detect(tabId);
        }
        const s = await loadSession(tabId);
        if (!s) throw new Error('Nothing was applied for in this tab.');
        const job = {
          title: req.title ?? s.job?.title ?? '',
          company: req.company ?? s.job?.company ?? '',
          location: s.job?.location ?? '',
          url: s.job?.url ?? jobUrlFor(s.url),
          ...(s.job?.companyUrl && !req.company ? { companyUrl: s.job.companyUrl } : {}),
        };
        const sent = await startReferral(job, s.sent?.at ?? Date.now());
        if (sent.referral !== 'queued') throw new Error(sent.message || 'Type the company and the role first.');
        await update(tabId, x => ({ ...x, job, sent }));
      }
      if (req.action === 'edit') await editAnswer(tabId, req.id, req.value, 'Your edit');
      if (req.action === 'rewrite') {
        const s = await loadSession(tabId);
        const f = s?.form?.find(x => x.id === req.id);
        if (!s || !f) throw new Error('That field is no longer on the page.');
        if (s.stage !== 'review' && s.stage !== 'done') throw new Error('Wait for the current step to finish first.');
        const current = s.filled.find(x => x.id === req.id)?.value ?? '';
        await update(tabId, x => ({
          ...x,
          stage: 'thinking',
          message: req.style === 'shorter' ? 'Shortening your answer…' : 'ChatGPT is writing a new answer…',
        }));
        void run(tabId, async signal => {
          const bg = await background();
          const reply = await askChatGpt(
            rewritePrompt({ field: f, current, job: s.jobText ?? '', background: bg.text, name: bg.name, style: req.style }) +
              `\n(Request ${Date.now()})`,
            signal,
            'FILL_APPLICATION',
            bg.url,
            '',
            { startMs: 90000, totalMs: 4 * 60000, thinking: req.style === 'rewrite' },
          );
          const text = z
            .object({ text: z.string().min(1).max(8000) })
            .parse(extractJson(reply))
            .text.trim();
          await editAnswer(
            tabId,
            f.id,
            f.maxLength ? fitTo(text, f.maxLength) : text,
            req.style === 'shorter' ? 'Shortened by ChatGPT' : 'Rewritten by ChatGPT',
          );
        });
      }
      if (req.action === 'topChoice') {
        // The person asked for it: tick the box, then ChatGPT (thinking) writes the message it reveals.
        const s = await loadSession(tabId);
        if (!s) throw new Error('Nothing is being filled.');
        await inject(s.tabId);
        const ticks = await chrome.scripting
          .executeScript({
            target: { tabId: s.tabId, allFrames: true },
            func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.markTopChoice() ?? 'none',
          })
          .catch(() => []);
        if (!ticks.some(t => t.result === 'checked' || t.result === 'already'))
          throw new Error('The "Mark this job as a top choice" box is not on this page.');
        await update(tabId, x => ({ ...x, stage: 'reading', message: 'Marked as top choice. Writing your message…' }));
        await new Promise(r => setTimeout(r, 1200));
        void run(tabId, signal => autoRun(s.tabId, signal, 1));
      }
      if (req.action === 'answer') await answer(tabId, req.answers, req.skip ?? []);
      if (req.action === 'undo') {
        const s = await loadSession(tabId);
        if (s) {
          runs.get(tabId)?.abort();
          await everyFrame(s.tabId, () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.undo());
          await update(tabId, x => ({
            ...x,
            stage: 'done',
            filled: [],
            files: [],
            ask: [],
            message: 'Put back what was on the page before.',
          }));
        }
      }
      if (req.action === 'stop') {
        const s = await loadSession(tabId);
        runs.get(tabId)?.abort();
        if (s) await everyFrame(s.tabId, () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.clear());
        await remove('meta', sessionKey(tabId));
      }
      if (req.action === 'saveProfile') {
        const profile = await applyProfile();
        profile.details = Object.fromEntries(
          Object.entries(req.details)
            .map(([k, v]) => [k, (v ?? '').trim()])
            .filter(([, v]) => v),
        );
        profile.eeo = req.eeo;
        if (req.topChoice) profile.topChoice = req.topChoice;
        if (req.afterApply) profile.afterApply = req.afterApply;
        for (const k of req.forget ?? []) delete profile.answers[k];
        await write(PROFILE_KEY, profile);
      }
      if (req.action === 'capturePhoto') await captureProfilePhoto();
      if (req.action === 'savePhoto') {
        if (!req.file.type.startsWith('image/')) throw new Error('Choose an image (JPG or PNG).');
        const size = fileFromBase64Size(req.file.data);
        if (size > 4 * 1024 * 1024) throw new Error('That photo is larger than 4 MB.');
        await write(PHOTO_KEY, { ...req.file, size, savedAt: Date.now() } satisfies StoredFile);
      }
      if (req.action === 'deletePhoto') await remove('meta', PHOTO_KEY);
      return detect(
        req.action === 'detect' || req.action === 'start' ? (req.tabId ?? (typeof raw === 'number' ? raw : undefined)) : tabId,
        req.action === 'detect' ? !!req.withPhoto : req.action.endsWith('Photo'),
      );
    })()
      .then(data => respond({ ok: true, data }))
      .catch(e => respond({ ok: false, error: applyError(e instanceof Error ? e.message : String(e)) }));
    return true;
  });
}
