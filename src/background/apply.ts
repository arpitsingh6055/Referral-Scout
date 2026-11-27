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
  aiUnavailable,
  aiUnavailableNote,
  questionKey,
  rememberedFor,
  rememberable,
  entryPlan,
  type ListItem,
  rewritePrompt,
  isWritten,
  fitTo,
  matchOption,
  applyError,
  sameApplication,
  outboundUrl,
  needsWork,
  localPlan,
  wantsThinking,
  navPrompt,
  detailKeyFor,
  consentTick,
  DAILY_SOFT_CAP,
  type ApplyProfile,
  type FillPlan,
  type FormField,
  type PageAction,
  type PageKind,
  type PageSnapshot,
  refusalSentence,
} from '../shared/apply';
import { seekerEvidence } from '../shared/seeker';
import { askLine } from '../shared/ai-budget';
import { extractJson } from '../parsers/json';
import { read, write } from '../storage/state';
import { all, remove } from '../storage/database';
import { trustedExtension } from '../validators/security';
import { AI_HEALTH_KEY, askChatGpt, type AiHealth } from './network-ai';
import { openManagedTab } from './network-browser';
import { getNetwork, queueReferral, updateNetwork } from './network';
import { referralJobInput } from '../shared/referral';
import { clearProgressTask, publishProgressTask } from '../shared/progress-store';
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
  closed?: boolean;
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
  /** On a company's site reached from LinkedIn: the LinkedIn tab the application started in. */
  from?: number;
  /** On LinkedIn: the tab where the company's own application is being filled. */
  handoff?: { tabId: number; host: string; url?: string | undefined } | undefined;
  /** Last non-error progress percentage so an error never displays a false 100%. */
  lastPercent?: number;
  /** The site asked to sign in or create an account: filling carries on once the form shows. */
  waitSignIn?: boolean;
  /** Lists already extended on a step ("step|button"), so entries are added once and never again in a loop. */
  added?: string[];
  /** The entries ChatGPT listed for the lists on this step, typed into the entries once they are added. */
  listItems?: { section: string; label: string; items: ListItem[] }[];
  /** The button ChatGPT chose to move this step on, when the site's own Next button is not one the rules know. */
  nextControl?: { id: string; frame: number; label: string } | undefined;
  /** Pages moved through before a form appeared (job page, "Apply", "Apply manually"), capped so it never wanders. */
  hops?: number;
  /** Hands-free mode pressed the final Submit on this application (never twice). */
  autoSent?: boolean;
  /** Entries already opened for ChatGPT ("page|card label"), so each closed card is opened once and never in a loop. */
  opened?: string[];
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
async function clearSessions(): Promise<void> {
  for (const item of await all('meta')) if (item.id.startsWith(`${SESSION_KEY}:`)) await remove('meta', item.id);
}
export function abortAllApply(): void {
  for (const runController of runs.values()) runController.abort();
  runs.clear();
}
export async function clearApplyData(): Promise<void> {
  abortAllApply();
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
    actions: frames.flatMap(f => (f.result.actions ?? []).map(a => ({ ...a, frame: f.frameId }))),
    controls: frames.flatMap(f => (f.result.controls ?? []).map(c => ({ ...c, frame: f.frameId }))).slice(0, 50),
  };
}

/* ---------- the session ---------- */
/** One fill per tab: each tab's application has its own record and its own run. */
const sessionKey = (tabId: number) => `${SESSION_KEY}:${tabId}`;
export const loadApplySession = (tabId: number): Promise<ApplySession | undefined> => loadSession(tabId);
const loadSession = async (tabId: number | undefined): Promise<ApplySession | undefined> =>
  tabId === undefined ? undefined : await read<ApplySession>(sessionKey(tabId));
const runs = new Map<number, AbortController>();
const isRunning = (tabId: number): boolean => runs.has(tabId);
/**
 * Every change to a tab's record goes through one queue per tab, so two changes never overlap: a late ChatGPT progress
 * note can no longer write back an older record over the filled answers (each change reads the record the previous
 * one wrote).
 */
const queues = new Map<number, Promise<unknown>>();
function serial<T>(tabId: number, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(tabId) ?? Promise.resolve()).then(task, task);
  const tail = next.catch(() => undefined);
  queues.set(tabId, tail);
  void tail.then(() => {
    if (queues.get(tabId) === tail) queues.delete(tabId);
  });
  return next;
}
async function syncApplyProgress(tabId: number, s: ApplySession): Promise<void> {
  const stagePct: Record<ApplyStage, number> = {
    reading: 18,
    opening: 28,
    thinking: 56,
    filling: 78,
    moving: 88,
    permission: 40,
    review: 100,
    done: 100,
    submitted: 100,
    error: 25,
  };
  const isLoginWait = !!s.waitSignIn;
  const status =
    s.stage === 'error'
      ? ('error' as const)
      : isLoginWait || (s.stage === 'review' && (s.ask.length > 0 || s.leftForYou.length > 0 || s.captcha))
        ? ('waiting' as const)
        : s.stage === 'submitted' || s.stage === 'done' || s.stage === 'review'
          ? ('done' as const)
          : s.stage === 'permission'
            ? ('waiting' as const)
            : ('running' as const);
  // A stalled fill has made no progress, so it reports the last figure it reached rather than creeping on. The two
  // numbers people saw side by side ("Step 1 · 25% complete" from the site's own bar, "28%" from this one) measure
  // different things; the site's counter now wins the step line, and this figure stays on the HUD alone.
  const percent = isLoginWait ? 35 : s.stage === 'error' ? Math.min(85, Math.max(15, s.lastPercent ?? 25)) : (stagePct[s.stage] ?? 50);
  const label =
    s.stage === 'error'
      ? // The panel already carries the full sentence. Repeating it in the HUD put the same words on screen twice at
        // once, so the HUD names the job and leaves the explanation to the one place that can show it in full.
        s.job
        ? `Autofill needs you \u00b7 ${s.job.title}`
        : 'Autofill needs you'
      : isLoginWait
        ? 'Sign in on this ATS page, then click Resume Fill'
        : status === 'waiting'
          ? s.ask.length
            ? `${s.ask.length} form answer${s.ask.length === 1 ? '' : 's'} needed`
            : s.captcha
              ? 'Complete verification check on page'
              : 'Site access permission needed'
          : status === 'done'
            ? s.stage === 'submitted'
              ? 'Application submitted'
              : 'Ready to submit — review & click Submit application'
            : s.stage === 'moving'
              ? s.message || `Step ${s.stepCount} filled — advancing…`
              : s.message || 'Filling application form…';

  const payload = {
    kind: 'rs.applyHud' as const,
    status,
    percent,
    label,
    detail: s.job ? `${s.job.company} · ${s.job.title}` : s.step || undefined,
    askCount: s.ask.length + s.leftForYou.length,
  };
  void publishProgressTask({
    id: 'apply_autofill',
    status,
    percent: payload.percent,
    label,
    ...(payload.detail ? { detail: payload.detail } : {}),
    ctaLabel: isLoginWait ? 'Sign In & Resume' : status === 'waiting' ? 'Inspect Tab →' : status === 'error' ? 'Retry fill' : 'View form',
    targetRoute: 'overview',
    backgroundTab: status !== 'done' && status !== 'error',
    needsIntervention: status === 'waiting',
    tabUrl: s.url,
    tabId,
    startedAt: s.startedAt,
    ...(s.stage === 'error' ? { error: s.message } : {}),
  });
  try {
    void chrome.tabs?.sendMessage?.(tabId, payload)?.catch?.(() => undefined);
  } catch {
    // No receiver or non-tab test environment.
  }
}

async function update(tabId: number, fn: (s: ApplySession) => ApplySession | void): Promise<ApplySession | undefined> {
  return serial(tabId, async () => {
    const s = await loadSession(tabId);
    if (!s) return undefined;
    const before = s.stage;
    const next = fn(s) ?? s;
    next.updatedAt = Date.now();
    if (next.stage !== 'error') {
      const pctMap: Record<ApplyStage, number> = {
        reading: 18,
        opening: 28,
        thinking: 56,
        filling: 78,
        moving: 88,
        permission: 40,
        review: 95,
        done: 95,
        submitted: 100,
        error: 25,
      };
      next.lastPercent = next.waitSignIn ? 35 : (pctMap[next.stage] ?? next.lastPercent ?? 25);
    }
    if (next.stage !== before || !next.stageSince) next.stageSince = next.updatedAt; // for the panel's elapsed time
    await write(sessionKey(tabId), next);
    void syncApplyProgress(tabId, next);
    return next;
  });
}
/** Replaces a tab's record, in the same queue as every change to it. */
const saveSession = (tabId: number, s: ApplySession): Promise<void> =>
  serial(tabId, async () => {
    await write(sessionKey(tabId), s);
    await syncApplyProgress(tabId, s);
  });
const dropSession = (tabId: number): Promise<void> =>
  serial(tabId, async () => {
    await remove('meta', sessionKey(tabId));
    await clearProgressTask('apply_autofill');
  });
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
/**
 * What ChatGPT is told about the applicant. Every step of an application used to ship 7,000 characters of LinkedIn
 * evidence and 14,000 of raw CV, unchanged, so a four-page form sent the same ~21,000 characters four times. The
 * dossier is that same evidence already read and structured once, so where one exists it is sent instead: the same
 * facts at roughly a fifth of the size, and a prompt small enough to answer quickly.
 */
const background = async (): Promise<{ text: string; location: string; name: string; url: string; roles: string[] }> => {
  const s = await getNetwork();
  if (!s.profile) throw new Error('Set up Referral Scout with your LinkedIn profile first.');
  const structured = (s.dossier ?? '').trim();
  const evidence = structured
    ? structured.slice(0, 9000)
    : seekerEvidence(
        {
          headline: s.profile.headline,
          location: s.profile.location,
          about: s.profile.about,
          sections: s.profile.sections,
          rawText: s.profile.rawText,
        },
        7000,
      );
  // Without a dossier the raw CV is the only evidence there is, so it still goes. With one it is already in there.
  const cv = structured ? '' : (s.cv?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 14000);
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
  /** A LinkedIn job applied for on the company's site: where its Apply link leads. */
  external: { url: string; host: string; origin: string; permission: boolean } | null;
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
  await dropSession(tabId);
  await start(tabId);
}
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const externalCheck = new Map<string, { dest: string; at: number }>();
/** Where a LinkedIn job's "Apply on company website" leads, read from the link itself (LinkedIn is always readable). */
async function externalFor(tabId: number | undefined, url: string): Promise<Detect['external']> {
  if (tabId === undefined || pageKindFromUrl(url) !== 'linkedin-job') return null;
  const key = url.split('#')[0]!;
  const seen = externalCheck.get(key);
  let dest = seen?.dest ?? '';
  // A found link is kept; "none" is checked again after a while, since the job's details may still have been loading.
  if (!seen || (!seen.dest && Date.now() - seen.at > 15000)) {
    const links = await inFrames(
      tabId,
      () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.externalApply(false) ?? '',
    );
    dest = outboundUrl(links.find(l => l.result)?.result ?? '');
    externalCheck.set(key, { dest, at: Date.now() });
    if (externalCheck.size > 200) externalCheck.delete(externalCheck.keys().next().value!);
  }
  if (!dest) return null;
  const u = new URL(dest);
  return { url: dest, host: u.host.replace(/^www\./, ''), origin: u.origin, permission: await allowed(u.origin) };
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
  // Waiting for a sign-in: checked on every panel refresh too, since a single-page site may not reload after it.
  if (session?.waitSignIn && !isRunning(session.tabId)) await resumeAfterSignIn(session.tabId).catch(() => undefined);
  // A company site's application may move between addresses (the job page, a separate form site, a sign-in page) while
  // it is filled or waits for a sign-in: kept then. On LinkedIn a different job always ends the old fill.
  const keep = session && !/linkedin\.com/.test(url) && (isRunning(session.tabId) || session.waitSignIn || session.from !== undefined);
  if (session && url && !keep && !sameApplication(session.url, url)) {
    runs.get(session.tabId)?.abort();
    await dropSession(session.tabId);
    session = undefined;
  }
  return {
    tabId: tab?.id ?? null,
    url,
    origin,
    kind,
    // Any other website: the panel only offers a quiet "fill this page" button. The page itself is never read to decide
    // that (even with every site allowed): it is read only once the person presses the button.
    canFill: canFill(kind),
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
    external: session && session.stage !== 'error' ? null : await externalFor(tab?.id, url),
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

async function resumeAfterSignIn(tabId: number): Promise<void> {
  const still = await inFrames(tabId, () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.signIn() ?? false);
  if (still.some(r => r.result) || isRunning(tabId)) return;
  await update(tabId, x => ({ ...x, waitSignIn: false, stage: 'reading', message: 'Signed in. Reading the application form…' }));
  void run(tabId, signal => autoRun(tabId, signal, 1));
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
  await markSent(tabId);
  return true;
}
/**
 * Records a sent application: the history, then (unless the person turned it off) the referral search. Used when the
 * site confirms it, and when the person says so with "I've sent it" (some confirmations use words no rule knows).
 */
async function markSent(tabId: number): Promise<void> {
  const s = await loadSession(tabId);
  if (!s || s.sent) return;
  runs.get(tabId)?.abort();
  const now = Date.now();
  const job = s.job;
  const history = (await read<{ title: string; company: string; url: string; at: number }[]>(HISTORY_KEY)) ?? [];
  if (job) {
    await write(HISTORY_KEY, [{ title: job.title, company: job.company, url: job.url, at: now }, ...history].slice(0, 5000));
    await updateNetwork(net => {
      const target = (net.referralJobs ?? []).find(j => j.url === job.url);
      if (target && !target.applied) target.applied = now;
      if (net.applyQueue?.length) net.applyQueue = net.applyQueue.filter(u => u !== job.url);
      return net;
    }).catch(() => undefined);
  }
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
  // Started on LinkedIn: that tab's card shows the same result, so the referral step is offered wherever the person looks.
  if (s.from !== undefined && (await loadSession(s.from))?.handoff?.tabId === tabId)
    await update(s.from, x => ({
      ...x,
      stage: 'submitted',
      sent,
      ...(job ? { job } : {}),
      message: job?.company ? `Application sent to ${job.company} on its own site.` : 'Application sent on the company’s site.',
    }));
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
/** Runs one content-script call in every frame and returns the results that came back. */
async function inFrames<T>(tabId: number, func: () => T): Promise<{ frameId: number; result: Awaited<T> }[]> {
  await inject(tabId).catch(() => undefined);
  const r = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func }).catch(() => []);
  return r.map(x => ({ frameId: x.frameId, result: x.result as Awaited<T> }));
}
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
/**
 * On a company's own site: clears the cookie banner, opens the application form from the job's page (pressing
 * "Apply", then "Apply manually" where a site asks how to apply), and stops at a sign-in or account page, which only
 * the person may complete. Only at the first step of a fill, so a button on a later step is never mistaken for it.
 */
async function openCompanyApplication(tabId: number, signal: AbortSignal): Promise<'form' | 'signin' | 'none' | 'moved'> {
  const s0 = await loadSession(tabId);
  const firstStep = !!s0 && s0.stepCount <= 1 && !s0.filled.length && !s0.files.length;
  for (let i = 0; i < 4; i++) {
    if (
      (
        await inFrames(tabId, () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.dismissCookies() ?? false)
      ).some(r => r.result)
    )
      await pause(600, signal);
    if (
      (await inFrames(tabId, () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.signIn() ?? false)).some(
        r => r.result,
      )
    ) {
      const host = (() => {
        try {
          return new URL(s0?.url ?? '').host;
        } catch {
          return 'this site';
        }
      })();
      await update(tabId, x => ({
        ...x,
        stage: 'review',
        waitSignIn: true,
        message: `${host} asks you to sign in or create an account before applying. Do that in this tab (Referral Scout never types passwords); filling carries on by itself once the application form shows.`,
      }));
      return 'signin';
    }
    if (!firstStep) return 'form';
    const looks = await inFrames(
      tabId,
      () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.openApplication(false) ?? 'none',
    );
    if (looks.some(r => r.result === 'form')) return 'form';
    const target = looks.find(r => r.result === 'opened');
    if (!target) return 'none';
    await update(tabId, x => ({ ...x, stage: 'opening', message: 'Opening the application form…' }));
    // Some sites open the form in yet another tab: follow it there, with the job carried along.
    let spawned: number | undefined;
    const onCreated = (t: chrome.tabs.Tab) => {
      if (t.openerTabId === tabId && t.id !== undefined && spawned === undefined) spawned = t.id;
    };
    chrome.tabs.onCreated.addListener(onCreated);
    try {
      await inFrame(tabId, target.frameId, () =>
        (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.openApplication(true),
      );
      for (let w = 0; w < 6 && spawned === undefined; w++) await pause(500, signal);
    } finally {
      chrome.tabs.onCreated.removeListener(onCreated);
    }
    if (spawned !== undefined) {
      await followTo(tabId, spawned, signal);
      return 'moved';
    }
    // The form opens on the same page, on a new page, or via an SPA mount (Workday / Greenhouse / Lever):
    // wait for tab navigation to settle, then wait up to 8000ms via MutationObserver for form controls or a login wall.
    for (let w = 0; w < 20; w++) {
      const t = await chrome.tabs.get(tabId).catch(() => undefined);
      if (!t || t.status === 'complete') break;
      await pause(400, signal);
    }
    const waited = await inFrames(
      tabId,
      () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.waitForForm?.(8000) ?? Promise.resolve('timeout'),
    ).catch(() => []);
    if (waited.some(r => r.result === 'login')) {
      const host = (() => {
        try {
          return new URL(s0?.url ?? '').host;
        } catch {
          return 'this site';
        }
      })();
      await update(tabId, x => ({
        ...x,
        stage: 'review',
        waitSignIn: true,
        message: `Sign in on ${host}, then click Resume Fill (Referral Scout never types passwords).`,
      }));
      return 'signin';
    }
    if (waited.some(r => r.result === 'form')) return 'form';
  }
  return 'form';
}
/**
 * Moves a fill to a tab the application opened (the form in a new tab): waits for it to load, gives it this fill's job
 * and description, shows the hand-over on this tab, and fills there. Nothing is read there without permission.
 */
async function followTo(fromTab: number, target: number, signal: AbortSignal): Promise<void> {
  let page = '';
  for (let i = 0; i < 40; i++) {
    const t = await chrome.tabs.get(target).catch(() => undefined);
    if (!t) return;
    page = t.url || t.pendingUrl || '';
    if (page && !/^(about|chrome):/.test(page) && t.status === 'complete') break;
    await pause(500, signal);
  }
  if (!page || /^(about|chrome):/.test(page)) return;
  const host = new URL(page).host;
  const old = await loadSession(fromTab);
  await saveSession(target, {
    tabId: target,
    url: page,
    stage: 'reading',
    message: `Opening the application on ${host}…`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    stageSince: Date.now(),
    step: '',
    stepCount: 1,
    summary: old?.summary ?? '',
    filled: [],
    files: [],
    ask: [],
    leftForYou: [],
    hasNext: false,
    hasSubmit: false,
    captcha: false,
    // Whoever started this fill (a LinkedIn tab, or this tab itself) is where the result is shown too.
    from: old?.from ?? fromTab,
    ...(old?.job ? { job: old.job } : {}),
    ...(old?.jobText ? { jobText: old.jobText } : {}),
  });
  await update(fromTab, x => ({
    ...x,
    stage: 'done',
    handoff: { tabId: target, host },
    message: `The application opened in a new tab on ${host}. Referral Scout is filling it there.`,
  }));
  if (old?.from !== undefined && old.from !== fromTab) await update(old.from, x => ({ ...x, handoff: { tabId: target, host } })); // the LinkedIn card points at the new tab
  if (!(await allowed(originOf(page)))) {
    await update(target, x => ({
      ...x,
      stage: 'permission',
      needOrigins: [originOf(page)],
      message: `To fill this application, allow Referral Scout on ${host}. It reads the form only while it fills it.`,
    }));
    return;
  }
  void run(target, sig => autoRun(target, sig, 1));
}
/**
 * A LinkedIn job applied for on the company's site. Presses LinkedIn's own Apply (so LinkedIn records it), follows the
 * tab it opens to the company's site, and carries on filling there, with the LinkedIn job kept for the referral step.
 * Without permission for that site the new tab asks for it with one button; nothing is read there before.
 */
async function handOff(tabId: number, url: string, jobText: string, signal: AbortSignal): Promise<void> {
  await captureJob(tabId, url);
  if (jobText) await update(tabId, x => ({ ...x, jobText: jobText.slice(0, 7000) }));
  const links = await inFrames(
    tabId,
    () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.externalApply(false) ?? '',
  );
  const link = links.find(l => l.result);
  if (!link)
    throw new Error('LinkedIn’s Apply button for the company site was not found. Open the job so its details show, then press Fill again.');
  const dest = outboundUrl(link.result);
  await update(tabId, x => ({ ...x, stage: 'opening', message: 'Opening the company’s application page…' }));
  // LinkedIn opens the site in a new tab: watch for a tab opened from this one.
  let opened: number | undefined;
  const onCreated = (t: chrome.tabs.Tab) => {
    if (t.openerTabId === tabId && t.id !== undefined && opened === undefined) opened = t.id;
  };
  chrome.tabs.onCreated.addListener(onCreated);
  try {
    await inFrame(tabId, link.frameId, () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.externalApply(true));
    // Chrome may block a tab opened by a script's click as a pop-up: then the destination is opened directly below.
    for (let i = 0; i < 8 && opened === undefined; i++) await pause(500, signal);
  } finally {
    chrome.tabs.onCreated.removeListener(onCreated);
  }
  // No new tab (a pop-up blocker, or the site opened in this same tab): open the destination ourselves.
  let target = opened;
  if (target === undefined) {
    const now = await chrome.tabs.get(tabId).catch(() => undefined);
    if (now?.url && !/linkedin\.com/.test(now.url)) target = tabId;
    else if (dest) {
      const handle = await openManagedTab({
        url: dest,
        mode: now?.active ? 'foreground' : 'background',
        purpose: 'ats_check',
        openerTabId: tabId,
        ...(now?.windowId !== undefined ? { windowId: now.windowId } : {}),
      });
      target = handle.tabId;
    }
  }
  if (target === undefined)
    throw new Error('The company’s application page did not open. Press Apply on LinkedIn, then press Fill on that page.');
  // Wait for LinkedIn's redirect to reach the company's site; a "you are leaving LinkedIn" page is passed by opening the destination.
  let page = '';
  for (let i = 0; i < 40; i++) {
    const t = await chrome.tabs.get(target).catch(() => undefined);
    if (!t) throw new Error('The company’s application tab was closed.');
    page = t.url || t.pendingUrl || '';
    if (page && !/^https?:\/\/([^/]+\.)?linkedin\.com\//.test(page) && !/^(about|chrome):/.test(page) && t.status === 'complete') break;
    if (i === 10 && /linkedin\.com\/(safety\/go|redir)/.test(page) && dest) await chrome.tabs.update(target, { url: dest });
    await pause(500, signal);
  }
  if (!page || /linkedin\.com/.test(page))
    throw new Error('The company’s application page did not finish opening. Press Fill on that page when it loads.');
  const host = new URL(page).host;
  const linkedinSession = await loadSession(tabId);
  await saveSession(target, {
    tabId: target,
    url: page,
    stage: 'reading',
    message: `Opening the application on ${host}…`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    stageSince: Date.now(),
    step: '',
    stepCount: 1,
    summary: linkedinSession?.job?.title
      ? `${linkedinSession.job.title}${linkedinSession.job.company ? ` · ${linkedinSession.job.company}` : ''}`
      : '',
    filled: [],
    files: [],
    ask: [],
    leftForYou: [],
    hasNext: false,
    hasSubmit: false,
    captcha: false,
    from: tabId,
    ...(linkedinSession?.job ? { job: linkedinSession.job } : {}),
    ...(linkedinSession?.jobText ? { jobText: linkedinSession.jobText } : {}),
  } satisfies ApplySession);
  if (target !== tabId)
    await update(tabId, x => ({
      ...x,
      stage: 'done',
      handoff: { tabId: target, host, url: page },
      message: `This job is applied for on ${host}. Referral Scout opened it in a new tab and is filling the application there.`,
    }));
  if (!(await allowed(originOf(page)))) {
    await update(target, x => ({
      ...x,
      stage: 'permission',
      needOrigins: [originOf(page)],
      message: `To fill this application, allow Referral Scout on ${host}. It reads the form only while it fills it.`,
    }));
    return;
  }
  // The new tab gets its own run; this one (the LinkedIn tab) is finished.
  void run(target, sig => autoRun(target, sig, 1));
}
async function fillStep(
  tabId: number,
  signal: AbortSignal,
  attempt: number,
): Promise<{ advance: boolean; again?: boolean; moved?: boolean; opened?: boolean } | void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab) throw new Error('The application tab was closed or reloaded. Click Retry fill to reopen it.');
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
  if (!linkedin) {
    const opened = await openCompanyApplication(tabId, signal);
    if (opened === 'signin' || opened === 'moved') return;
  }
  let frames = await scanAll(tabId, linkedin);
  let page = merge(frames, url, tab.title ?? '');
  const lists = !linkedin && !!page.actions?.length;
  if (!page.form.length && !lists && (page.hasNext || page.hasSubmit)) {
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
    // Hands-free: a final review page with nothing left to answer is submitted for the person.
    const { activeCampaign } = await import('../shared/persistence/campaign-store');
    const camp = await activeCampaign().catch(() => undefined);
    const autopilotAllowed =
      camp !== undefined
        ? camp.application.mode === 'autopilot' && !!camp.application.autopilotOptInAt && !!camp.application.preflightApprovedAt
        : ((await applyProfile()).autoSubmit ?? 'never') === 'auto';
    if (!page.hasNext && !page.captcha && autopilotAllowed) {
      const left = (await loadSession(tabId))?.ask.length ?? 0;
      if (!left) await submitForPerson(tabId, undefined, signal);
    }
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
    if (!target && looks.some(r => r.result === 'closed')) {
      await captureJob(tabId, url);
      if (linkedin) {
        const resumeState = await chrome.scripting
          .executeScript({
            target: { tabId, allFrames: true },
            func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.ensureResumeSelected?.() ?? 'none',
          })
          .catch(() => []);
        if (resumeState.some(r => r.result === 'selected')) {
          frames = await scanAll(tabId, linkedin);
          page = merge(frames, url, tab.title ?? '');
        }
      }
      await update(tabId, x => ({
        ...x,
        stage: 'error',
        closed: true,
        message: 'This job is no longer accepting applications.',
      }));
      return;
    }
    if (!target && looks.some(r => r.result === 'applied')) {
      // Nothing to fill: the person already applied here. Offer the referral step instead of an error.
      await captureJob(tabId, url);
      if (linkedin) {
        const resumeState = await chrome.scripting
          .executeScript({
            target: { tabId, allFrames: true },
            func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.ensureResumeSelected?.() ?? 'none',
          })
          .catch(() => []);
        if (resumeState.some(r => r.result === 'selected')) {
          frames = await scanAll(tabId, linkedin);
          page = merge(frames, url, tab.title ?? '');
        }
      }
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
    if (opened === 'external') return void (await handOff(tabId, url, page.job, signal));
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
  if (!page.form.length && !lists) {
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
    // No form the rules recognise: ChatGPT reads the page and picks the one button that moves the application on.
    if (!linkedin && page.controls?.length) return await navigate(tabId, page, signal);
    throw new Error(
      kind === 'linkedin-job'
        ? 'No application form is open. Press Easy Apply (or Apply) on the job first.'
        : 'No form fields were found on this page. Open the application form itself (often behind an "Apply" button), then try again.',
    );
  }
  await captureJob(tabId, url);
  if (linkedin) {
    const resumeState = await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.ensureResumeSelected?.() ?? 'none',
      })
      .catch(() => []);
    if (resumeState.some(r => r.result === 'selected')) {
      frames = await scanAll(tabId, linkedin);
      page = merge(frames, url, tab.title ?? '');
    }
  }
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
  // List entries just added: their details came with ChatGPT's first answer, so they are typed in without asking again.
  const listed = (await loadSession(tabId))?.listItems ?? [];
  if (listed.length) {
    const taken = new Set(local.fill.map(f => f.id));
    local.fill.push(...entryPlan(page.form, listed).filter(f => !taken.has(f.id)));
  }
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
  // Lists not yet extended on this step: ChatGPT is asked even when no field is empty, to say how many entries the
  // applicant's background needs (an empty "Experience" list with only "Add a role" has no fields at all).
  const before = await loadSession(tabId);
  const stepKey = (a: { label: string; section: string }) => `${before?.stepCount ?? 1}|${a.section}|${a.label}`;
  const doneAdds = new Set(before?.added ?? []);
  const openLists: PageAction[] = lists ? page.actions!.filter(a => !doneAdds.has(stepKey(a))) : [];
  if (rest.length || openLists.length) {
    const thinking = wantsThinking(rest);
    const prompt =
      fillPrompt({ page, background: bg.text, roles: bg.roles, profile, name: bg.name, linkedinUrl: bg.url, photo: !!photo }) +
      // A new request after "Fill again" must not be mistaken for the earlier one (the request id is a hash of the text).
      (attempt > 1 ? `\n(New request ${attempt}: work it out from scratch.)` : '');
    await update(tabId, s => ({
      ...s,
      stage: 'thinking',
      // Say which mode is being used and roughly what it costs in time, so a two-minute wait is expected
      // rather than mistaken for a hang.
      message: thinking
        ? `${askLine(true)} · writing your answers`
        : `${askLine(false)} · ${rest.length} question${rest.length === 1 ? '' : 's'}`,
    }));
    let aiDown: 'limit' | 'signed-out' | 'unreachable' | null = null;
    const reply = await askChatGpt(prompt, signal, 'FILL_APPLICATION', bg.url, '', {
      startMs: 90000,
      totalMs: (thinking ? 8 : 3) * 60000,
      thinking,
      onStage: stage => void update(tabId, s => ({ ...s, aiStage: stage, message: `${aiWords[stage] ?? 'Working'}…` })),
    }).catch((e: unknown) => {
      if (signal.aborted) throw e;
      aiDown = aiUnavailable(e instanceof Error ? e.message : String(e));
      // A fault about this form, rather than about ChatGPT being reachable, is still an error worth stopping for.
      if (!aiDown) throw e;
      return '';
    });
    signal.throwIfAborted();
    let ai: FillPlan | null = null;
    if (!reply) {
      // ChatGPT is unavailable, not wrong. Everything the saved answers and details cover is already in `plan`;
      // the questions that needed ChatGPT are handed to the person rather than losing the whole application.
      plan.ask = rest
        .filter(f => !f.sensitive && f.kind !== 'file')
        .map(f => ({
          id: f.id,
          frame: f.frame,
          label: f.label,
          question: f.label,
          ...(f.options?.length ? { options: f.options } : {}),
          kind: f.kind,
        }));
      await update(tabId, x => ({ ...x, message: aiUnavailableNote(aiDown || 'unreachable', plan.ask.length) }));
    } else {
      try {
        ai = planFromReply(extractJson(reply), page.form, profile, !!photo, openLists, page.controls ?? []);
      } catch {
        throw new Error('ChatGPT’s answer could not be read. Press Fill again.');
      }
    }
    if (ai?.job?.company)
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
    if (ai)
      plan = {
        fill: [...local.fill, ...ai.fill.filter(f => allowed(f.id))],
        files: [...local.files, ...ai.files.filter(f => allowed(f.id))],
        ask: ai.ask.filter(a => allowed(a.id)),
        leftForYou: ai.leftForYou,
        summary: ai.summary,
        ...(ai.add ? { add: ai.add } : {}),
        ...(ai.items ? { items: ai.items } : {}),
        ...(ai.next ? { next: ai.next } : {}),
        ...(ai.open ? { open: ai.open } : {}),
        ...(ai.phase ? { phase: ai.phase } : {}),
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
  // A login form read as fields: the person signs in, filling carries on afterwards.
  if (plan.phase === 'signin' && !linkedin && page.form.some(f => f.sensitive === 'password')) return void (await waitForSignIn(tabId));
  // Consent/terms checkboxes stay with the person unless they explicitly opted into `allowConsentAutoTick`.
  const { activeCampaign } = await import('../shared/persistence/campaign-store');
  const camp = await activeCampaign().catch(() => undefined);
  const handsFree =
    camp !== undefined
      ? camp.application.mode === 'autopilot' && !!camp.application.autopilotOptInAt && !!camp.application.preflightApprovedAt
      : (profile.autoSubmit ?? 'never') === 'auto';
  const allowConsentTick = !!camp?.application.allowConsentAutoTick;
  if (handsFree && allowConsentTick)
    for (const f of page.form)
      if (f.required && consentTick(f) && f.value !== 'true' && !plan.fill.some(x => x.id === f.id)) {
        plan.fill.push({
          id: f.id,
          frame: f.frame,
          kind: f.kind,
          label: f.label,
          value: 'true',
          confidence: 'high',
          why: 'Consent auto-tick (explicitly opted in)',
        });
        plan.leftForYou = plan.leftForYou.filter(l => l.id !== f.id);
      }
  if (plan.fill.length || plan.files.length) await update(tabId, s => ({ ...s, stage: 'filling', message: 'Filling the form…' }));
  const results = plan.fill.length || plan.files.length ? await applyPlan(tabId, plan, page.form, cv, photo) : [];
  // The CV is required for every application. With no ordinary upload field on this step (a site that adds it when
  // "Attach" is pressed, or a drag-and-drop area), it is attached that way.
  if (!linkedin && !page.form.some(f => f.kind === 'file') && !(await loadSession(tabId))?.files.some(f => f.file === 'cv' && f.ok)) {
    const tries = await inFrames(tabId, () => undefined).catch(() => []);
    for (const { frameId } of tries) {
      const r = await inFrame(
        tabId,
        frameId,
        (f: unknown) =>
          (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.attachFallback(f as never) ??
          Promise.resolve({ ok: false, how: 'none' as const }),
        [{ name: cv.name, type: cv.type, data: cv.data }],
      ).catch(() => undefined);
      if (!r || r.how === 'none') continue;
      plan.files.push({ id: 'cv-attach', frame: frameId, label: 'CV', file: 'cv' });
      results.push({ id: 'cv-attach', ok: r.ok, ...(r.note ? { note: r.note } : {}) });
      break;
    }
  }
  const byId = new Map(results.map(r => [r.id, r]));
  await mark(tabId, page.form, plan, byId);
  // Lists that need more entries (two jobs in the CV, no "Role" yet): press their "Add" button that many times, then
  // fill the new entries in the next pass. Each list is extended once per step, so this can never loop.
  if (plan.add?.length) {
    const keys: string[] = [];
    let pressed = 0;
    for (const a of plan.add) {
      const offered = page.actions?.find(x => x.id === a.id);
      if (!offered) continue;
      keys.push(stepKey(offered));
      for (let n = 0; n < a.times; n++) {
        const ok = await inFrame(
          tabId,
          a.frame,
          (id: unknown) => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.press(id as string) ?? false,
          [a.id],
        ).catch(() => false);
        if (!ok) break;
        pressed++;
        await new Promise(r => setTimeout(r, 600 + Math.floor(Math.random() * 500)));
      }
    }
    await update(tabId, x => ({
      ...x,
      added: [...(x.added ?? []), ...keys],
      ...(plan.items ? { listItems: plan.items } : {}),
      ...(pressed
        ? {
            stage: 'reading' as const,
            message: `Added ${pressed} ${pressed === 1 ? 'entry' : 'entries'} (${plan.add!.map(a => a.label.toLowerCase()).join(', ')}). Filling ${pressed === 1 ? 'it' : 'them'} from your background…`,
          }
        : {}),
    }));
    if (pressed) return { advance: false, again: true };
  } else if (openLists.length) {
    // ChatGPT saw these lists and judged them complete: they are not asked about again on this step.
    await update(tabId, x => ({ ...x, added: [...(x.added ?? []), ...openLists.map(stepKey)] }));
  }
  // Closed entries ChatGPT wants opened (an imported education card marked "Fields to fix"): open the first one not
  // opened yet, then read the step again so its fields are filled. One at a time, as opening one may close another.
  if (!linkedin && plan.open?.length && !plan.ask.length) {
    const path = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    })();
    const done = new Set((await loadSession(tabId))?.opened ?? []);
    const card = plan.open.find(o => !done.has(`${path}|${o.label}`));
    if (card) {
      const r = await inFrame(
        tabId,
        card.frame,
        (id: unknown) => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.click(id as string),
        [card.id],
      ).catch(() => undefined);
      await update(tabId, x => ({
        ...x,
        opened: [...(x.opened ?? []), `${path}|${card.label}`].slice(-60),
        ...(r?.clicked ? { stage: 'reading' as const, message: `Opened \u201c${card.label.slice(0, 60)}\u201d to complete it…` } : {}),
      }));
      if (r?.clicked) {
        await pause(1200, signal);
        return { advance: false, again: true, opened: true };
      }
    }
  }
  // Nothing on this page was ours to fill and the rules see no Next or Submit (a job page with a search bar, a page whose
  // apply button has an unusual label): ChatGPT decides what to press, instead of stopping with "nothing to fill".
  const didNothing = !plan.fill.length && !plan.files.length && !plan.ask.length && !plan.add?.length;
  if (!linkedin && didNothing && !page.hasNext && !page.hasSubmit && page.controls?.length) {
    if (plan.next && !plan.next.final) return await pressChoice(tabId, plan.next, (await loadSession(tabId))?.hops ?? 0, signal);
    return await navigate(tabId, page, signal);
  }
  // Answers can reveal more questions ("Do you need sponsorship? Yes" brings "Which visa?"). Read the step again: any
  // new empty question is filled in another pass before moving on, instead of pressing Next into the site's error.
  let revealed = 0;
  if (plan.fill.length) {
    await new Promise(r => setTimeout(r, 700));
    const again = merge(await scanAll(tabId, linkedin).catch(() => [] as Frame[]), url, tab.title ?? '');
    const known = new Set(page.form.map(f => f.id));
    revealed = needsWork(again.form, linkedin).filter(f => !known.has(f.id) && (f.required || !linkedin)).length;
  }
  const failedRequired = results.filter(r => !r.ok && page.form.find(f => f.id === r.id)?.required).length;
  const failed = results.filter(r => !r.ok).length;
  const stillEmptyRequired = rest.filter(f => f.required && !plan.fill.some(x => x.id === f.id) && !plan.files.some(x => x.id === f.id));
  const blocked = !!plan.ask.length || !!failedRequired || !!stillEmptyRequired.length || page.captcha;
  if (revealed && !blocked) {
    await update(tabId, s => ({
      ...s,
      stage: 'reading',
      message: `Your answers opened ${revealed} more question${revealed === 1 ? '' : 's'}. Filling ${revealed === 1 ? 'it' : 'them'}…`,
    }));
    return { advance: false, again: true };
  }
  // ChatGPT's choice when it named one (it sees an open entry's own Save, which the page's Next would abandon), or
  // else the site's Next button the rules found.
  const viaAi = !!plan.next && !plan.next.final;
  const advance = (!!page.hasNext || viaAi) && !blocked;
  // What is still the person's: a required field left for them that hands-free cannot do (a signature, a declaration).
  const personal = page.form.filter(
    f => f.required && f.sensitive && !plan.fill.some(x => x.id === f.id) && !(f.kind === 'checkbox' && f.value === 'true'),
  );
  const finalStep = !advance && !page.hasNext && (page.hasSubmit || !!plan.next?.final);
  const autoSubmit = handsFree && finalStep && !blocked && !personal.length && !revealed;
  await update(tabId, s => ({
    ...s,
    nextControl: viaAi && plan.next ? { id: plan.next.id, frame: plan.next.frame, label: plan.next.label } : undefined,
    stage: advance ? 'moving' : 'review',
    aiStage: undefined,
    summary: plan.summary || s.summary,
    message: advance
      ? `Step ${s.stepCount} done${plan.fill.length + plan.files.length ? '' : ' (already filled)'}. Moving on…`
      : reviewMessage(plan, failed, page, openLists),
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
  if (handsFree && finalStep && !autoSubmit)
    await update(tabId, s => ({
      ...s,
      message: `${s.message} Hands-free stopped here: ${
        personal.length
          ? `“${personal[0]!.label.slice(0, 80)}” is yours to answer`
          : page.captcha
            ? 'there is a security check'
            : 'something above needs you'
      }.`,
    }));
  if (autoSubmit) await submitForPerson(tabId, plan.next?.final ? plan.next : undefined, signal);
  return { advance };
}
/** The site asks for an account or a login: always the person's, the extension never types a password. */
async function waitForSignIn(tabId: number): Promise<void> {
  const s0 = await loadSession(tabId);
  let host = 'This site';
  try {
    host = new URL(s0?.url ?? '').host;
  } catch {
    /* keep the plain words */
  }
  await update(tabId, x => ({
    ...x,
    stage: 'review',
    waitSignIn: true,
    message: `${host} asks you to sign in or create an account before applying. Do that in this tab (Referral Scout never types passwords); filling carries on by itself once the application form shows.`,
  }));
  await inFrames(tabId, () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.watchLoginCompletion?.()).catch(
    () => undefined,
  );
}
/** Watches a tab for a new tab it opens while one action runs, so a form opened elsewhere is followed. */
async function watchNewTab<T>(tabId: number, signal: AbortSignal, act: () => Promise<T>): Promise<{ result: T; spawned?: number }> {
  let spawned: number | undefined;
  const onCreated = (t: chrome.tabs.Tab) => {
    if (t.openerTabId === tabId && t.id !== undefined && spawned === undefined) spawned = t.id;
  };
  chrome.tabs.onCreated.addListener(onCreated);
  try {
    const result = await act();
    for (let w = 0; w < 6 && spawned === undefined; w++) await pause(500, signal);
    return { result, ...(spawned !== undefined ? { spawned } : {}) };
  } finally {
    chrome.tabs.onCreated.removeListener(onCreated);
  }
}
async function settle(tabId: number, signal: AbortSignal): Promise<void> {
  await pause(1500, signal);
  for (let w = 0; w < 20; w++) {
    const t = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!t || t.status === 'complete') break;
    await pause(500, signal);
  }
  await pause(800, signal);
}
const MAX_HOPS = 5;
/**
 * A page with no form the rules know (a job page whose button says "I'm interested", a "how do you want to apply"
 * chooser, a pop-up over the form): ChatGPT reads the page without thinking mode and names the one button that moves
 * the application on. Sign-in pages go to the person; a confirmation page records the application.
 */
async function navigate(tabId: number, page: PageSnapshot, signal: AbortSignal): Promise<{ advance: boolean; moved?: boolean } | void> {
  const s0 = await loadSession(tabId);
  const hops = s0?.hops ?? 0;
  if (hops >= MAX_HOPS)
    throw new Error(
      'Several pages were opened and no application form appeared. Open the form on the page yourself, then press Fill again.',
    );
  await update(tabId, x => ({ ...x, stage: 'thinking', message: 'ChatGPT is reading the page to find the way to the application…' }));
  const bg = await background();
  const goal = s0?.job?.title
    ? `Reach and complete the application for "${s0.job.title}"${s0.job.company ? ` at ${s0.job.company}` : ''}.`
    : 'Reach and complete the application form for the job on this page.';
  const reply = await askChatGpt(
    navPrompt(page, goal) + (hops ? `\n(Page ${hops + 1} of this application.)` : ''),
    signal,
    'FILL_APPLICATION',
    bg.url,
    '',
    {
      startMs: 60000,
      totalMs: 2 * 60000,
      thinking: false,
      onStage: stage => void update(tabId, s => ({ ...s, aiStage: stage })),
    },
  );
  signal.throwIfAborted();
  let plan: FillPlan;
  try {
    plan = planFromReply(extractJson(reply), [], await applyProfile(), false, [], page.controls ?? []);
  } catch {
    throw new Error('ChatGPT’s answer could not be read. Press Fill again.');
  }
  if (plan.phase === 'signin') return void (await waitForSignIn(tabId));
  if (plan.phase === 'done') {
    // Only after this fill pressed Submit itself or filled anything; a stray thank-you page is not an application.
    if (s0?.autoSent || s0?.filled.length) return void (await markSent(tabId));
    throw new Error('This page says an application was already sent. Open another job to apply.');
  }
  if (!plan.next || plan.phase === 'other')
    throw new Error(
      plan.summary
        ? `${plan.summary.replace(/\.?$/, '.')} No way to apply was found here. Open the application form, then press Fill again.`
        : 'No application form or Apply button was found on this page. Open the form, then press Fill again.',
    );
  return await pressChoice(tabId, plan.next, hops, signal);
}
/** Presses the button ChatGPT chose, follows a new tab it opens, and waits for the page it leads to. */
async function pressChoice(
  tabId: number,
  choice: NonNullable<FillPlan['next']>,
  hops: number,
  signal: AbortSignal,
): Promise<{ advance: boolean; moved?: boolean } | void> {
  if (hops >= MAX_HOPS)
    throw new Error(
      'Several pages were opened and no application form appeared. Open the form on the page yourself, then press Fill again.',
    );
  await update(tabId, x => ({ ...x, hops: hops + 1, stage: 'opening', aiStage: undefined, message: `Pressing “${choice.label}”…` }));
  const { result, spawned } = await watchNewTab(tabId, signal, () =>
    inFrame(
      tabId,
      choice.frame,
      (id: unknown) => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.click(id as string) ?? { error: 'gone' },
      [choice.id],
    ).catch(() => undefined),
  );
  if (!result?.clicked) throw new Error(result?.error ?? 'The page changed; press Fill again.');
  if (spawned !== undefined) return void (await followTo(tabId, spawned, signal));
  await settle(tabId, signal);
  return { advance: false, moved: true };
}
async function startOfTodayCount(): Promise<number> {
  const [history, since] = await Promise.all([read<Detect['history']>(HISTORY_KEY).then(h => h ?? []), startOfToday()]);
  return history.filter(h => h.at >= since).length;
}
/**
 * Hands-free mode: presses the final Submit once every check passed, then confirms the site took it (its own
 * confirmation, or ChatGPT reading the page). Never twice for one application, and never past the daily limit.
 */
async function submitForPerson(tabId: number, chosen: FillPlan['next'], signal: AbortSignal): Promise<void> {
  const s0 = await loadSession(tabId);
  if (!s0 || s0.autoSent || s0.sent) return;
  const { activeCampaign } = await import('../shared/persistence/campaign-store');
  const camp = await activeCampaign().catch(() => undefined);
  const effectiveCap = Math.min(camp?.application.dailyTarget || DAILY_SOFT_CAP, DAILY_SOFT_CAP);
  if ((await startOfTodayCount()) >= effectiveCap)
    return void (await update(tabId, x => ({
      ...x,
      message: `All steps are filled. You have sent ${effectiveCap} applications today, so Autopilot stops here: review it and press Submit yourself.`,
    })));
  await update(tabId, x => ({
    ...x,
    autoSent: true,
    hasSubmit: true,
    hasNext: false,
    stage: 'moving',
    message: 'Hands-free: submitting the application…',
  }));
  const frame = chosen?.frame ?? s0.form?.[0]?.frame ?? 0;
  const r = await inFrame(
    tabId,
    frame,
    (id: unknown) => {
      const api = (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply;
      return (id ? api?.click(id as string, true) : api?.submitFinal()) ?? { error: 'gone' };
    },
    [chosen?.id ?? ''],
  ).catch(() => undefined);
  if (!r?.clicked)
    return void (await update(tabId, x => ({
      ...x,
      stage: 'review',
      message: `${r?.error ?? 'The Submit button could not be pressed.'} Review the application and submit it yourself.`,
    })));
  // Confirmation: the site's own words first, then ChatGPT reading the page that followed.
  const began = Date.now();
  while (Date.now() - began < 20000) {
    await pause(1500, signal);
    if (await checkSubmitted(tabId)) return;
    if (Date.now() - began > 6000 && (await siteRefused(tabId)))
      return void (await update(tabId, x => ({
        ...x,
        stage: 'review',
        autoSent: false,
        message: 'The site did not accept the application: it marks what is missing in red. Fix it on the page, then submit.',
      })));
  }
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const page = merge(await scanAll(tabId, false).catch(() => [] as Frame[]), tab?.url ?? '', tab?.title ?? '');
  const bg = await background();
  const reply = await askChatGpt(navPrompt(page, 'Say whether the application was sent.'), signal, 'FILL_APPLICATION', bg.url, '', {
    startMs: 60000,
    totalMs: 2 * 60000,
    thinking: false,
  }).catch(() => '');
  let phase: FillPlan['phase'];
  try {
    phase = planFromReply(extractJson(reply), [], await applyProfile(), false).phase;
  } catch {
    phase = undefined;
  }
  if (phase === 'done') return void (await markSent(tabId));
  await update(tabId, x => ({
    ...x,
    stage: 'review',
    message: 'Submit was pressed, but the page shows no clear confirmation. Check the page: if it was sent, press “I’ve sent it”.',
  }));
}
function reviewMessage(plan: FillPlan, failed: number, page: PageSnapshot, lists: PageAction[] = []): string {
  const n = plan.fill.length + plan.files.length;
  const parts = [
    n
      ? `Filled ${n} field${n === 1 ? '' : 's'}.`
      : lists.length
        ? // A list was offered and nothing was added: say which, never "nothing needed filling".
          `ChatGPT found nothing in your background for ${lists.map(l => `\u201c${l.label}\u201d`).join(', ')}. Add entries on the page if you want them, or press Fill again.`
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
export const applyRunning = (tabId: number): boolean => isRunning(tabId);
const signature = (p: { form: FormField[]; step: string }): string => `${p.step}|${p.form.map(f => f.label).join('|')}`;
/**
 * Starts the per-tab fill engine on one tab. The campaign runner calls this instead of the side panel's Fill button;
 * everything below is unchanged, so the queue drives exactly the engine that is already known to work.
 */
export interface ResolvedApplicationTab {
  tab: chrome.tabs.Tab;
  tabId: number;
  recovered: boolean;
}

/**
 * Self-healing tab lookup for external ATS & LinkedIn application flows.
 * 1) Validates `tabId` via `chrome.tabs.get` inside try/catch.
 * 2) Falls back to querying open tabs by normalized application URL or ATS hostname.
 * 3) If still missing and `url` is http(s), opens a new foreground tab, waits for load + content script readiness.
 */
export async function resolveOrOpenApplicationTab(opts: {
  tabId?: number | undefined;
  url?: string | undefined;
  activate?: boolean | undefined;
  waitReady?: boolean | undefined;
}): Promise<ResolvedApplicationTab> {
  const activate = opts.activate ?? true;
  const isHttp = (u: string | undefined): u is string => !!u && /^https?:\/\//i.test(u);

  const waitTabLoad = async (id: number): Promise<chrome.tabs.Tab | undefined> => {
    for (let i = 0; i < 20; i++) {
      const t = await chrome.tabs.get(id).catch(() => undefined);
      if (!t) return undefined;
      if (t.status === 'complete') return t;
      await new Promise(r => setTimeout(r, 400));
    }
    return await chrome.tabs.get(id).catch(() => undefined);
  };

  if (opts.tabId !== undefined && opts.tabId >= 0) {
    const existing = await chrome.tabs.get(opts.tabId).catch(() => undefined);
    if (existing?.id !== undefined) {
      if (activate) await chrome.tabs.update(existing.id, { active: true }).catch(() => undefined);
      const settled = opts.waitReady ? ((await waitTabLoad(existing.id)) ?? existing) : existing;
      return { tab: settled, tabId: existing.id, recovered: false };
    }
  }

  if (isHttp(opts.url)) {
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    const targetHost = (() => {
      try {
        return new URL(opts.url).host;
      } catch {
        return '';
      }
    })();
    const matched =
      allTabs.find(t => t.id !== undefined && t.url && sameApplication(t.url, opts.url!)) ??
      allTabs.find(t => {
        if (t.id === undefined || !t.url || !targetHost) return false;
        try {
          return new URL(t.url).host === targetHost;
        } catch {
          return false;
        }
      });
    if (matched?.id !== undefined) {
      if (activate) await chrome.tabs.update(matched.id, { active: true }).catch(() => undefined);
      const settled = opts.waitReady ? ((await waitTabLoad(matched.id)) ?? matched) : matched;
      return { tab: settled, tabId: matched.id, recovered: true };
    }

    const created = await chrome.tabs.create({ url: opts.url, active: activate });
    if (created.id === undefined) throw new Error('The application tab could not be opened.');
    const settled = (await waitTabLoad(created.id)) ?? created;
    if (opts.waitReady) await inject(created.id).catch(() => undefined);
    return { tab: settled, tabId: created.id, recovered: true };
  }

  throw new Error('The application tab was closed or reloaded. Open the job page and press Retry fill.');
}

export const startApplyOnTab = async (tabId: number): Promise<void> => {
  await start(tabId);
};
async function start(tabId: number, attempt = 1, fallbackUrl?: string): Promise<number> {
  const old = await loadSession(tabId);
  const resolved = await resolveOrOpenApplicationTab({
    tabId,
    url: fallbackUrl ?? old?.url ?? old?.job?.url,
    activate: false,
    waitReady: true,
  });
  const activeTabId = resolved.tabId;
  const tab = resolved.tab;
  const prev = activeTabId === tabId ? old : ((await loadSession(activeTabId)) ?? old);
  const same = !!prev;
  await saveSession(activeTabId, {
    tabId: activeTabId,
    url: tab.url ?? fallbackUrl ?? prev?.url ?? '',
    stage: 'reading',
    message: resolved.recovered ? 'Tab recovered — reading the application form…' : 'Reading the application form…',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    step: '',
    stepCount: same ? prev.stepCount : 1,
    summary: same ? prev.summary : '',
    filled: [],
    files: [],
    ask: [],
    leftForYou: [],
    hasNext: false,
    hasSubmit: false,
    captcha: false,
    // A fill handed over from LinkedIn keeps the LinkedIn job (for the referral step) and its description.
    ...(same && prev.from !== undefined
      ? { from: prev.from, ...(prev.job ? { job: prev.job } : {}), ...(prev.jobText ? { jobText: prev.jobText } : {}) }
      : {}),
  } satisfies ApplySession);
  void run(activeTabId, signal => autoRun(activeTabId, signal, attempt));
  return activeTabId;
}
/** Presses the site's Next / Continue / Review and waits for the next step. False when the site stayed put. */
/** True when the page shows the site's own validation errors (fields marked invalid, an alert with text). */
/**
 * What the site is complaining about on this step, in its own words, read from every frame. The page script knows
 * where each site puts its messages; the panel only ever shows the words the person can see on the page.
 */
async function siteProblems(tabId: number): Promise<{ label: string; message: string }[]> {
  const r = await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.fieldErrors?.() ?? [],
    })
    .catch(() => []);
  const out: { label: string; message: string }[] = [];
  for (const frame of r)
    for (const e of Array.isArray(frame.result) ? frame.result : []) if (!out.some(o => o.message === e.message)) out.push(e);
  return out.slice(0, 4);
}
async function siteRefused(tabId: number): Promise<boolean> {
  return (await siteProblems(tabId)).length > 0;
}
async function pressNext(tabId: number, signal: AbortSignal): Promise<boolean> {
  const s = await loadSession(tabId);
  if (!s) return false;
  const frame = s.form?.[0]?.frame ?? 0;
  const before = signature({ form: s.form ?? [], step: s.step });
  await update(tabId, x => ({ ...x, stage: 'moving' }));
  // The site's Next button, or the one ChatGPT chose for this step when the rules found none.
  const via = s.nextControl;
  const clicked = via
    ? await inFrame(
        tabId,
        via.frame,
        (id: unknown) => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.click(id as string),
        [via.id],
      )
    : await inFrame(tabId, frame, () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.next());
  if (!clicked?.clicked) throw new Error(clicked?.error ?? 'The page changed; press Fill again.');
  const settled = await inFrame(
    tabId,
    via?.frame ?? frame,
    () => (globalThis as { __referralScoutApply?: ApplyApi }).__referralScoutApply?.waitAfterNext?.(2500) ?? Promise.resolve('timeout'),
  ).catch(() => 'timeout' as const);
  if (settled === 'error') {
    const said = refusalSentence(await siteProblems(tabId));
    await update(tabId, x => ({
      ...x,
      stage: 'review',
      message: said || 'The site highlighted a required field on this step. Fix it on the page, then press Next step.',
    }));
    return false;
  }
  // Slow sites (Workday, company job sites) can take 20 seconds or more to show the next step: wait up to 25 seconds
  // for the step to change, and stop early only when the site has plainly refused (an error shown on the fields).
  const began = Date.now();
  let emptyReads = 0;
  for (let i = 0; Date.now() - began < 25000; i++) {
    await new Promise(r => setTimeout(r, i < 4 ? 400 : 800));
    signal.throwIfAborted();
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab) throw new Error('The application tab was closed or reloaded. Click Retry fill to reopen it.');
    if (tab.status === 'loading') continue;
    const frames = await scanAll(tabId, pageKindFromUrl(tab.url ?? '') === 'linkedin-job').catch(() => [] as Frame[]);
    const page = merge(frames, tab.url ?? '', tab.title ?? '');
    // A step can have no fields at all (LinkedIn's review page has only Submit), so a changed step counts too.
    if (signature(page) !== before && (page.form.length || page.hasSubmit || page.hasNext)) {
      // A new step: the entries listed for the last step's lists belong to that step only.
      await update(tabId, x => {
        const { listItems, nextControl, ...rest } = x;
        void listItems;
        void nextControl;
        return { ...rest, stepCount: x.stepCount + 1 };
      });
      return true;
    }
    emptyReads = !page.form.length && !page.hasNext && !page.hasSubmit ? emptyReads + 1 : 0;
    if (emptyReads >= 3 && Date.now() - began > 8000) {
      await update(tabId, x => ({
        ...x,
        stage: 'done',
        message: 'The form moved on and nothing is left to fill on this page. Check the page.',
      }));
      return false;
    }
    if (Date.now() - began > 5000 && (await siteRefused(tabId))) break;
  }
  const said = refusalSentence(await siteProblems(tabId));
  await update(tabId, x => ({
    ...x,
    stage: 'review',
    message: said || 'The site stayed on this step. It usually marks what is missing in red: fix it on the page, then press Next step.',
  }));
  return false;
}
/** Fills each step and moves on by itself; stops for the person's answers, a site error, or the final Submit. */
async function autoRun(tabId: number, signal: AbortSignal, attempt: number, moveFirst = false): Promise<void> {
  if (moveFirst && !(await pressNext(tabId, signal))) return;
  for (let i = 0, passes = 0, opens = 0; i < 25; i++) {
    const r = await fillStep(tabId, signal, i === 0 ? attempt : 1);
    // ChatGPT pressed a button on a page with no form (Apply, Apply manually): read the page it led to.
    if (r && 'moved' in r && r.moved) continue;
    // An entry was opened for ChatGPT to complete: up to ten entries per application, then on with the step.
    if (r?.opened && opens < 10) {
      opens++;
      i--;
      continue;
    }
    // New questions appeared on the same step: fill them (at most twice per step) before moving on.
    if (r?.again && passes < 3) {
      passes++;
      i--;
      continue;
    }
    if (r?.again) {
      await update(tabId, x => ({
        ...x,
        stage: 'review',
        message: 'New questions kept appearing as answers were filled. Check this step on the page, then press Next step.',
      }));
      return;
    }
    passes = 0;
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
  // Only short facts are kept for later applications; an answer tied to this job or company is used here only.
  const remember = items.filter(x => x.a.remember && rememberable(x.f, x.a.value, s.job));
  if (remember.length) {
    const profile = await applyProfile();
    for (const { a, f } of remember) {
      profile.answers[questionKey(f.label)] = a.value.trim().slice(0, 2000);
      // An address, PIN code or notice period typed here becomes a saved detail (Settings), used on every site.
      const key = detailKeyFor(f.label);
      if (key && !profile.details[key]?.trim()) profile.details[key] = a.value.trim().slice(0, 300);
    }
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
    address: z.string().max(300),
    state: z.string().max(120),
    pincode: z.string().max(20),
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
  z.object({
    kind: z.literal('apply'),
    action: z.literal('start'),
    tabId: z.number().int().optional(),
    url: z.string().max(1000).optional(),
    again: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('apply'),
    action: z.literal('focusHandoff'),
    tabId: z.number().int().optional(),
    url: z.string().max(1000).optional(),
  }),
  z.object({ kind: z.literal('apply'), action: z.literal('next') }),
  z.object({ kind: z.literal('apply'), action: z.literal('nextJob') }),
  z.object({ kind: z.literal('apply'), action: z.literal('testAi') }),
  z.object({ kind: z.literal('apply'), action: z.literal('sent') }),
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
  z.object({ kind: z.literal('apply'), action: z.literal('resumeAfterLogin') }),
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
    autoSubmit: z.enum(['never', 'auto']).optional(),
    forget: z.array(z.string().max(200)).max(200).optional(),
  }),
  z.object({ kind: z.literal('apply'), action: z.literal('capturePhoto') }),
  z.object({ kind: z.literal('apply'), action: z.literal('savePhoto'), file }),
  z.object({ kind: z.literal('apply'), action: z.literal('deletePhoto') }),
  z.object({
    kind: z.literal('apply'),
    action: z.literal('startForJob'),
    url: z.string().url().max(500),
    title: z.string().trim().min(1).max(200).optional(),
    company: z.string().trim().min(1).max(200).optional(),
    location: z.string().max(200).optional(),
  }),
]);
export type ApplyRequest = z.infer<typeof applyRequest>;
export function registerApplyMessages(): void {
  // After the last step, a page load in that tab (a thank-you page) or LinkedIn's "Application sent" is caught even
  // when the side panel is closed.
  chrome.tabs.onRemoved?.addListener(tabId => {
    runs.get(tabId)?.abort();
    void (async () => {
      const s = await loadSession(tabId);
      await dropSession(tabId);
      // The company's tab of a LinkedIn application was closed: the LinkedIn card stops saying it is filled there.
      if (s?.from !== undefined && (await loadSession(s.from))?.handoff?.tabId === tabId && !s.sent)
        await update(s.from, x => ({
          ...x,
          stage: 'review',
          handoff: undefined,
          message: 'The company’s application tab was closed before the application was sent. Press Fill again to reopen it.',
        }));
    })().catch(() => undefined);
  });
  // Tab ids start again after the browser restarts, so a record left from an earlier run could attach itself to an
  // unrelated tab: every application record is cleared at startup (history and saved answers stay).
  chrome.runtime.onStartup?.addListener(() => void clearSessions().catch(() => undefined));
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete' && !info.url) return;
    void loadSession(tabId).then(s => {
      if (s && !s.sent && s.hasSubmit && !s.hasNext && !isRunning(tabId))
        setTimeout(() => void checkSubmitted(tabId).catch(() => undefined), 1500);
      // Signed in: once a page finishes loading without a password field, the fill picks up where it stopped.
      if (s?.waitSignIn && (info.status === 'complete' || info.url) && !isRunning(tabId))
        setTimeout(() => void resumeAfterSignIn(tabId).catch(() => undefined), 1500);
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
        if (!(await cvFile()))
          throw new Error('Upload your CV in Candidate profile in the dashboard first; applications need the file itself.');
        const requestedTabId = req.tabId ?? tabId;
        const old = await loadSession(requestedTabId);
        const activeTabId = await start(
          requestedTabId,
          req.again && old?.tabId === requestedTabId ? 2 + Math.floor(Math.random() * 1000) : 1,
          req.url,
        );
        return detect(activeTabId);
      }
      if (req.action === 'focusHandoff') {
        const old = await loadSession(tabId);
        const targetUrl = req.url ?? old?.handoff?.url;
        const resolved = await resolveOrOpenApplicationTab({
          tabId: req.tabId ?? old?.handoff?.tabId,
          url: targetUrl,
          activate: true,
        });
        if (old?.handoff && resolved.tabId !== old.handoff.tabId) {
          await update(tabId, x => ({
            ...x,
            handoff: {
              tabId: resolved.tabId,
              host:
                x.handoff?.host ??
                (() => {
                  try {
                    return new URL(resolved.tab.url || targetUrl || '').host;
                  } catch {
                    return '';
                  }
                })(),
              ...(resolved.tab.url || targetUrl ? { url: resolved.tab.url || targetUrl } : {}),
            },
          }));
        }
        return detect(tabId);
      }
      if (req.action === 'startForJob') {
        const s = await getNetwork();
        if (!s.profile) throw new Error('Set up Referral Scout with your LinkedIn profile first.');
        if (!(await cvFile()))
          throw new Error('Upload your CV in Candidate profile in the dashboard first; applications need the file itself.');
        const tabs = await chrome.tabs.query({}).catch(() => []);
        const existing = tabs.find(t => t.id !== undefined && t.url && sameApplication(t.url, req.url));
        let targetTabId = existing?.id;
        if (targetTabId !== undefined) {
          await chrome.tabs.update(targetTabId, { active: true }).catch(() => undefined);
        } else {
          const created = await chrome.tabs.create({ url: req.url, active: true });
          targetTabId = created.id;
          if (targetTabId !== undefined) {
            await new Promise<void>(resolve => {
              const timeout = setTimeout(resolve, 4000);
              const onUpd = (id: number, info: chrome.tabs.OnUpdatedInfo): void => {
                if (id === targetTabId && info.status === 'complete') {
                  clearTimeout(timeout);
                  chrome.tabs.onUpdated.removeListener(onUpd);
                  resolve();
                }
              };
              chrome.tabs.onUpdated.addListener(onUpd);
            });
          }
        }
        if (targetTabId === undefined) throw new Error('Could not open the job tab.');
        await start(targetTabId, 1);
        if (req.title || req.company) {
          await update(targetTabId, x => ({
            ...x,
            job: {
              title: x.job?.title || req.title || '',
              company: x.job?.company || req.company || '',
              location: x.job?.location || req.location || '',
              url: req.url,
            },
          }));
        }
        return detect(targetTabId);
      }
      if (req.action === 'resumeAfterLogin') {
        const target = sender.tab?.id ?? tabId;
        if (target >= 0) await resumeAfterSignIn(target).catch(() => undefined);
      }
      if (req.action === 'next') await nextStep(tabId);
      if (req.action === 'nextJob') {
        if (isRunning(tabId)) throw new Error('This tab is still being filled.');
        // Awaited (about ten seconds at most) so a missing job shows as a message; the fill itself runs on its own.
        await nextJob(tabId);
      }
      if (req.action === 'sent') {
        const s = await loadSession(tabId);
        if (!s) throw new Error('Nothing is being filled in this tab.');
        if (!s.hasSubmit) throw new Error('Fill the application up to its last step first.');
        await captureJob(tabId, s.url);
        await markSent(tabId);
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
        await dropSession(tabId);
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
        if (req.autoSubmit) profile.autoSubmit = req.autoSubmit;
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
        req.action === 'detect' ? (req.tabId ?? (typeof raw === 'number' ? raw : undefined)) : tabId,
        req.action === 'detect' ? !!req.withPhoto : req.action.endsWith('Photo'),
      );
    })()
      .then(data => respond({ ok: true, data }))
      .catch(e => respond({ ok: false, error: applyError(e instanceof Error ? e.message : String(e)) }));
    return true;
  });
}
