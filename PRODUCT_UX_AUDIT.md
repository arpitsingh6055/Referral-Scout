# Referral Scout — Product, UX, UI and workflow audit

> **Deep follow-up revision (0.56.3):** this revision addresses gaps found after the first progress-feedback pass. It adds live milestone messages from the LinkedIn background workflow, verifies profile capture before success, adds a shared async-action lock and busy-state affordance, brings CV upload under the same feedback pattern, reports partial campaign synchronisation accurately, and displays profile freshness. The full live Edge QA matrix remains mandatory.

**Scope reviewed:** the supplied MV3 extension source archive (manifest 0.56.2), workbench/dashboard screens, side-panel experience, background LinkedIn workflow, workspace/campaign messaging, storage boundaries, and the supplied first-run screenshot.

**Important verification boundary:** this is a source-level audit plus static checks. It is not a claim that every LinkedIn/ChatGPT/Gmail/browser interaction was exercised in a live Edge profile. LinkedIn DOM changes, browser permissions, extension reload behaviour, and real-world account states still require the release checklist below.

## Executive verdict

Referral Scout has a valuable product premise: automate the repetitive parts of job search and referral discovery while keeping the candidate in control of consequential decisions. Its strongest design principles are already visible in the code: local-first records, use of the user's existing LinkedIn/ChatGPT/Gmail sessions, explicit review for uncertain application outcomes, provenance on profile facts, and no silent retry after an uncertain submission.

The biggest product weakness is not a lack of features. It is the gap between what the system is doing and what the person can understand at the moment it is doing it. The LinkedIn profile import is the clearest example: the background opens/uses a tab in a separate work window and restores focus to the user's prior window. That is intentional, but before this update the dashboard did not immediately tell the person that work had started, what was happening, or whether the click had registered. A long-running operation could therefore look like a dead button.

The product also has two substantial surfaces: the workbench/dashboard and the older, feature-rich side panel. They contain overlapping setup and referral concepts. This is a cohesion risk and should be treated as a strategic follow-up, not hidden by a visual polish pass.

## Changes implemented in this revision

1. **Immediate action acknowledgement and real milestones.** Dashboard actions render a visible progress banner before awaiting the background response. LinkedIn import now sends milestone updates from the background: opening the own-profile work tab, checking signed-in identity, reading profile details, and saving locally. The dashboard updates the existing live banner without rebuilding the page.
2. **Dynamic LinkedIn controls.** The read/refresh buttons change to “Reading profile…” / “Reading…” and become disabled while the import is running, preventing repeat clicks and making the active state obvious.
3. **Accessible status feedback.** The progress banner uses `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`. The progress icon respects reduced-motion preferences.
4. **Consistent async-action feedback.** Generic asynchronous button callbacks and non-button CV uploads emit start/end events. The clicked control stays in the DOM while progress is shown; background polling does not replace the clicked control during a generic action.
5. **No silent rejected click promises.** Unhandled async button failures are converted into the dashboard's visible error banner.
6. **Misleading setup status corrected.** The onboarding step badge previously said “Next” despite not being a clickable control. It now says “Not started”.
7. **CV dependency clarified.** The setup step says the CV is added after LinkedIn identity is read, matching the owner-scoping safeguard. CV upload from both Get started and Candidate profile now shows progress and blocks duplicate actions.
8. **API key de-emphasised.** The custom OpenAI API-key configuration remains collapsed under an explicit Advanced disclosure and says it is not required. The default ChatGPT website-session route remains the normal-user path.
9. **Profile freshness shown.** Candidate Profile and Settings show when the LinkedIn profile was last captured, and Settings explicitly distinguishes a saved profile record from a live sign-in check.
10. **Partial campaign saves surfaced.** The campaign target remains saved if a secondary rules/profile/referral-preferences sync fails. The user receives a follow-up checklist instead of an inaccurate all-or-nothing error.

## Detailed findings

### P0 — feedback and trust

| Finding | User impact | Status |
|---|---|---|
| LinkedIn profile import had no immediate progress state in the dashboard. | User cannot tell whether the click registered, whether a new tab opened, or whether the action failed. | **Fixed in this revision.** |
| Async click callbacks could reject without a consistent visible error surface. | Failure may be console-only or inconsistent across screens. | **Fixed in this revision.** |
| LinkedIn read/refresh controls did not express a distinct in-progress label. | Repeat clicks and uncertainty during a long operation. | **Fixed in this revision.** |

### P1 — product coherence and onboarding

| Finding | User impact | Recommendation |
|---|---|---|
| Side panel and workbench remain two substantial experiences. | Two navigation models and overlapping settings create a split mental model. | Make the side panel a focused “quick status + next action” surface; route all complex setup, profile editing, job review and application work to the dashboard. Migrate legacy referral workflows only after parity tests. |
| The first-run dashboard introduces LinkedIn, CV, campaign, ChatGPT, Gmail and privacy in one long page. | Users may perceive a setup wall even though some connections are optional. | Keep the first three essentials visually dominant: verify LinkedIn, confirm profile, set search goal. Put CV and optional services in clearly secondary sections; retain skip paths. |
| The CV ownership rule is enforced by the product but was not obvious from the stepper copy. | Users could interpret the disabled upload as a broken control. | **Copy clarified in this revision.** Consider a disabled upload control with an inline explanation and a “Why?” disclosure in a later pass. |
| “Next” appeared on non-interactive step cards. | A visual affordance promised navigation that did not exist. | **Fixed in this revision.** |
| Optional API-key settings were visible beside normal connection settings. | Contradicts the low-setup product promise and can make users think a key is mandatory. | **Collapsed under Advanced in this revision.** Keep website-session usage as the default. |

### P1 — operational clarity

| Workflow | Source-level observation | Required product behaviour |
|---|---|---|
| LinkedIn sign-in | Sign-in happens on LinkedIn itself; Referral Scout should never request the password. | State “Sign in on LinkedIn”, then return to the dashboard. Never show an app-specific sign-in form. |
| Read own profile | Background opens `linkedin.com/in/me/`, validates the redirected identity, reads the profile, and stores it. It uses the extension's work window, which does not take focus away from the user's normal window. | **Now shows immediate progress and final success/error.** Live test must verify signed-out, checkpoint, slow-load, account-switch and success cases. |
| CV upload | CV is owner-scoped to the verified LinkedIn identity; imported details are suggestions/reviewable records. | Explain the dependency before the user chooses a file. Keep original file local and make replacement/deletion discoverable. |
| Campaign creation | Creation spans campaign, workspace preferences and legacy referral preferences. | **Now preserves the core campaign and explicitly lists any secondary sync that needs attention.** Full live test still required. |
| ChatGPT | Website-session route is the normal path; API key is an optional alternative. | Keep the website route prominent and test session-expired, unavailable, and response-timeout states. |
| Gmail | Optional; used for drafts/reply context, not required for job discovery. | Keep it optional, explain permissions at the moment they are needed, and confirm whether a draft was created rather than implying an email was sent. |
| Application queue | The product distinguishes confirmed submissions from uncertain outcomes and routes exceptions to “Needs you”. | Preserve this. Never auto-retry a submission with uncertain outcome. Test every exception state with real application forms. |

### P2 — UI system and touch/feel

- The visual foundation is coherent: navy rail, violet primary action, restrained status colours, rounded cards and a consistent spacing scale.
- The onboarding hero is shorter in 0.56.3: reduced padding, title scale, text spacing and step-card padding bring actionable setup cards higher in the first viewport. Verify at 100%, 125% and narrow widths.
- The dashboard's dark theme is legible in the supplied screenshot, but status banners, muted text and small helper copy should be checked at 100% and 125% scaling. Verify WCAG contrast for every text/status combination in both themes.
- Every primary action should have four explicit states: idle, hover/focus, busy, and success/error. The shared button helper now provides a busy label, spinner, `aria-busy`, duplicate-action lock and global feedback event. Review custom controls and file inputs in live QA for parity.
- Keep visible focus rings, keyboard navigation, reduced-motion behaviour and descriptive accessible names as release requirements.
- Avoid using green for “in progress”; green should remain a confirmed-success signal.

### P2 — architecture, privacy and resilience

- The manifest is MV3 and the application stores user data in browser-local extension storage/IndexedDB. Keep the local-first model; do not introduce a hosted account or backend as a shortcut for onboarding.
- LinkedIn, ChatGPT and Gmail use existing browser sessions. The extension does not need a Referral Scout password flow.
- The manifest declares broad optional host permissions for arbitrary HTTP/HTTPS sites. This may be needed for user-selected application sites, but it is a high-trust permission. Request only the host needed for the selected workflow, explain why at the moment of use, and avoid requesting broad access at install time.
- The API-key path is optional, but it has financial implications because API usage is billed separately by the provider. Keep the warning explicit and the setting advanced.
- Ensure exports never contain secrets, and make it easy to inspect/delete local data. Verify behaviour when IndexedDB is unavailable, storage quota is exceeded, the service worker restarts, and the user removes/reinstalls the extension.
- The dashboard polls the background on a five-second interval and defers state replacement while a user is editing. This is a sensible resilience choice; test that long-running actions and open forms are not overwritten by polling.

## What I would prioritise next

### Release-blocking manual QA

1. Fresh Edge profile: install → open side panel → open dashboard → LinkedIn signed out → sign in → read profile.
2. Repeat LinkedIn read while already connected; confirm refresh label, progress banner, disabled state, final timestamp/profile values and success message.
3. Test LinkedIn checkpoint/challenge, session expiry, slow network, offline mode, and an existing outreach action holding the LinkedIn lease. Every case must end in a plain-language explanation and a clear next action.
4. Upload valid PDF and DOCX, malformed files, oversized files and a second CV. Confirm owner checks, reviewable facts, replacement and deletion.
5. Create, edit, pause, resume and delete a campaign. Confirm dashboard campaign, workspace preferences and side-panel referral targeting stay aligned.
6. Run job discovery; test empty results, duplicate jobs, stale postings, rate limits, permission denial and partial source failure.
7. Run application fill on at least three ATS families. Verify field mapping, answer provenance, required-field detection, review gates, uncertain submission handling and no duplicate submission.
8. Test ChatGPT/Gmail connected, disconnected, expired, permission denied and provider unavailable states. Confirm drafts are not described as sent emails.
9. Test keyboard-only navigation, screen reader announcements, 200% zoom, narrow side panel, dark/light/system themes and reduced motion.
10. Reload/update/uninstall/reinstall the extension. Confirm queue recovery, local data retention expectations and no unintended automation resume.

### Product roadmap

- **P0:** Complete live QA of LinkedIn import and all long-running operations using the same progress/success/error pattern.
- **P1:** Consolidate side panel into quick status + one next action; dashboard remains the full workspace.
- **P1:** Introduce a unified activity timeline that tells the user what happened, when, where, and what they need to do next.
- **P1:** Add a clear connection health panel: LinkedIn session, ChatGPT session, Gmail access, and last successful check, without asking for credentials.
- **P2:** Add a first-run checklist that can be resumed and dismissed, with optional tasks clearly separated from required tasks.
- **P2:** Add event-level diagnostics/export that excludes secrets and sensitive payloads by default, so support does not require guessing.

## Verification performed for this revision

- Inspected the MV3 manifest, workbench shell, onboarding/profile/settings screens, side-panel renderer, LinkedIn background message handler, work-tab lifecycle, workspace state and relevant styles.
- Verified the profile import implementation uses the signed-in LinkedIn identity route, enforces account ownership, saves profile capture time, and returns an updated status state.
- Verified the dashboard's network message wrapper returns the updated state in `data`, and the shell refreshes campaign/workspace views after the operation.
- Added actual LinkedIn import progress messages from the background workflow and a success gate that requires a non-null profile plus `profileCapturedAt`.
- Added a shared async-action lock with navigation exceptions, animated busy state (respecting reduced motion), CV-upload feedback and busy-state tests.
- Added explicit partial-success handling for campaign, rules, workspace preferences and legacy referral preference synchronisation.
- Exposed `linkedinProfileCapturedAt` through the workspace view so the UI can show profile freshness without implying a live session check.
- Transpiled 128 TypeScript source/test/script files with the globally available TypeScript compiler: no syntax diagnostics. The project typecheck, Vitest suite, Vite build and browser QA were not run because the pinned pnpm binary and project dependencies could not be downloaded in this environment.
- Verified ZIP archive integrity after packaging.
- Ran global TypeScript compiler availability check. Full typecheck/build could not run because the environment lacks installed project dependencies (`@types/chrome`, `@types/node`) and Corepack could not download the pinned pnpm version from the npm registry. Do not treat this package as a verified production build until `pnpm build` and the manual QA matrix pass locally.

---

## 0.57.0 follow-up audit — 25 November 2026

The user's latest screenshot revealed three high-impact defects:

1. **No global feedback surface.** The side panel and dashboard had separate notification experiences, and a background status change could be missed when the current surface was closed. Important status transitions now broadcast a floating toast to both surfaces. The active visible surface acknowledges the toast; when no visible surface acknowledges it, the service worker emits an OS notification. Notification clicks reopen the workbench. Only significant milestones/errors use this OS fallback.
2. **“Start” conflated job discovery with application execution.** The campaign control started the application runner, which has no useful work when the application queue is empty. Dashboard Jobs, Overview and the empty Application Queue now launch the existing LinkedIn job-discovery pipeline. The application runner is explicitly named “Start application queue”. Overview reflects active search and review states. The side-panel campaign card opens Jobs rather than starting an empty runner when no applications are queued.
3. **Fit 0 caused by a manual-specialisation gate and a weak dashboard bridge.** The older LinkedIn search only ran full-description ChatGPT ranking when specialisations had been selected. It now ranks every non-empty batch against the full LinkedIn/CV evidence, even with no manually selected specialisation. ChatGPT scores and rationale are retained in canonical jobs; the local specialisation fallback is distinguished; missing assessment is labelled “Fit not assessed”. Employment technologies and project skills are also included in local profile matching.

The current source discovery adapter remains LinkedIn Jobs. The application/ATS layer is not evidence of multi-board job discovery; no unsupported Naukri/Indeed/Wellfound coverage is claimed.
