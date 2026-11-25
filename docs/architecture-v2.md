# Referral Scout v2 — architecture notes

Written against `Referral_Scout_Complete_Extension_Software_Specification.docx` (version 2.0, 24 November 2026).
This records the decisions behind the campaign layer and the reasoning that is not obvious from the code.

## Shape of the change

The existing per-tab fill engine works. It reads a form, maps fields, asks ChatGPT only where it has to, and
submits. What it could not do was choose the next job itself, keep going when one application needed the person,
or survive the browser closing mid-form.

So the campaign layer sits **above** the engine rather than replacing it. `src/background/runner.ts` calls
`startApplyOnTab()` — the same entry point the side panel's Fill button uses — and watches the session the engine
already writes. Every ATS quirk that engine has learned stays learned. Three exports were added to
`background/apply.ts` (`startApplyOnTab`, `loadApplySession`, `applyRunning`); nothing in it changed behaviour.

## The three rules the runner is built on

**1. The tab is a lease, never the identity.** Tab ids are reused after a restart, so a remembered one points at
an unrelated page. The durable identity is `applicationId` in IndexedDB; `tabId` lives inside a lease with an
expiry. On startup `recoverQueue()` hands back everything an earlier service-worker generation was holding.

**2. An exception parks one application and nothing else.** `nextEligible()` skips `needs-you` items rather than
waiting on them. This is the single decision that turns a one-at-a-time tool into something that runs unattended.

**3. A submit that was pressed and not confirmed is never retried.** `safeToRetry()` returns false the moment
`submission.attemptedAt` is set without `confirmedAt`. Retry paths, the Needs-you inbox and the queue screen all
consult it. A duplicate application is worse than a missing one, and it cannot be undone.

## Where things live

| Path | What |
| --- | --- |
| `shared/domain/` | Campaign, Job + Company + qualification, CandidateProfile, Contact + OutreachTask, facts (`detectCandidateMode`, `buildStudentSmartDefaults`, `factsFromProfileSnapshot`, `essentialReadiness`), exceptions, system records |
| `shared/progress-store.ts` | Cross-context `chrome.storage.local` progress store + 6-stage `resolveMacroJourney()` HUD navigator |
| `shared/state-machines/application-task.ts` | Queue states (`queued` through `submitted`/`uncertain`), transitions, leases, `staleNeedsYou()`, admission, ordering |
| `shared/scoring/allocator.ts` | Global weekly outreach allocator + transparent `rankCompanies()` breakdowns + pinned company priority |
| `shared/persistence/campaign-store.ts` | Typed IndexedDB access; `change()` is read-modify-write in one transaction |
| `connectors/job-sources/` | Adapter contract and 6 source declarations (`linkedin` & `user-url` active; external boards cleanly health-reported) |
| `background/runner.ts` | Scheduler, worker, startup/lease/orphan recovery, `staleNeedsYou` self-healing, reconciliation |
| `background/profileStorage.ts` & `normalizeChatGptProfile.ts` | Atomic ChatGPT V3 profile normalization, read-back verification, full CV->Answer Bank hydration & snapshot sync |
| `background/campaign.ts` & `workspace.ts` | Campaign/workspace message API returning `CampaignView` & `WorkspaceView` including `pinCompany`, `applyStudentDefaults`, and bi-directional fact sync |
| `ui/workbench/` | Dashboard screens (`overview`, `jobs`, `applications`, `needs-you`, `referrals`, `people`, `answers`, `profile`, `setup`, `settings`, `welcome`, `activity`), `GuidedReviewWorkspace`, and `FloatingProgressHUD` |
| `ui/side-panel/` & `content/floating-hud.ts` | Compact Side Panel control surface & Closed-Shadow-DOM host page HUD |

## Decisions worth knowing

**Eligibility is not a low fit score.** `qualify()` runs `checkEligibility()` first and a single ineligible check
makes the tier `blocked` whatever the fit says. Silence is `unknown`, never `eligible` — a posting that says
nothing about sponsorship has not said the person qualifies, and rounding that up puts a false declaration on a
real application. The experience check only fires when the posting states a number of years; otherwise a student
with no employment records would see every job marked unknown and the signal would be worthless.

**Answer reuse matches canonical facts, not similar text.** `shared/domain/facts.ts` is a catalogue with explicit
alias patterns and explicit `not` patterns. "PIN code", "postal code" and "ZIP code" merge. Current CTC and
expected CTC are one word apart and never do. Work authorisation is country-scoped; an answer given for India is
asked again for a US role. A label matching nothing stays an unknown question and is asked — guessing is the
expensive error. Self-declarations (gender, disability, veteran, ethnicity) are never taken from a CV.

**Grouping happens on the canonical key plus scope**, so two questions merge into one inbox item only when they
are provably the same question in the same context. Before a saved answer reaches several applications the person
sees exactly which ones, and can untick any of them.

**Concurrency ships at one.** Two page tabs are not two AI sessions: with one shared ChatGPT conversation the
model calls serialise anyway, so a second worker buys contention rather than speed until that is measured. The
setting exists and the lease model supports two; the default stays one until a pilot says otherwise.

**Progress bars only ever show verified steps.** `progressOf()` returns `percent: null` when the site gives no
step count, and the UI draws a named state instead. A bar that advances on elapsed time teaches the person that
the screen is guessing, which costs more than the bar is worth.

**Green means confirmed.** Not in progress, not probably. It is the one colour the person needs to be able to
trust at a glance, so nothing else is allowed to wear it.

**Database upgrades only add stores.** Version 3 adds the full entity set; nothing existing is rewritten or
dropped, so an upgrade cannot lose saved people, answers or history, and rolling back leaves data readable. The
old `ApplyProfile` is migrated into the Answer Bank and also left exactly where it was, so the per-tab engine
keeps working if this layer is reverted.

**Everything stays local.** No product backend. External calls go to the person's own accounts for the task they
chose, per specification 17.4.

## What is built, and what is not

Built and tested (**43 test files, 713 passing tests**):
- Durable queue with leases (`90s` TTL), idempotent transitions, startup recovery (`recoverQueue`), `staleNeedsYou()` self-healing, and submission reconciliation (`reconcile`, explicit `uncertain -> queued` only upon user `"It did not"` confirmation);
- Semantic `Needs you` exception inbox + 3-Tier Student-Friendly Answer Bank with `detectCandidateMode()`, `buildStudentSmartDefaults()`, 1-click pill presets, `Auto-learned` ATS Q&A view, and bi-directional profile/legacy detail sync;
- Guided CV & AI Review workspace (`GuidedReviewWorkspace`) with conflict Before/After diffs, 1-click fast-path confirmation, collapsible optional details, cross-tab Live Bridge recovery, and atomic `profileStorage.ts` read-back verification;
- 6-Stage Macro Floating HUD (`resolveMacroJourney()`) synchronized across Workbench, Side Panel, and Closed-Shadow-DOM host overlays;
- Global referrer budget allocator with transparent `rankCompanies()` score breakdowns and persisted `Pin company` priority across Jobs, Referrals, and People screens;
- Session-based Gmail draft/reply helpers, strict sender validation (`trustedExtension`), and all 12 Workbench screens cleanly wired.

Remaining planned adapter expansion: live multi-board search scrapers for Internshala, Naukri, Instahyre, and Wellfound beyond URL ingestion (declared honestly via health states in `connectors/job-sources/`).

## Running it

```bash
pnpm check       # prettier + 713 tests + tsc --noEmit + vite builds + scripts/check-build.mjs
pnpm package     # packages verified dist/ into referral-scout.zip
pnpm build       # dist/ — loads unpacked in Chrome or Edge
npx vite build --mode preview   # preview/ — workbench sample review build
```

`preview.ts` and `preview.html` never ship in the extension package; they build to `preview/`, not `dist/`.
