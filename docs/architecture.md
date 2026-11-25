# Referral Scout — System Architecture (`v0.58.2`)

This document describes the live implemented architecture of **Referral Scout**, verified directly against `src/`, `manifest.json`, and the `43`-file (`713`-test) Vitest suite.

---

## 1. Design Principles

1. **Tab is a lease, never identity:** Browser `tabId` values vanish on restart and are reassigned to unrelated tabs. Every queued application is anchored by durable `applicationId` in IndexedDB with an expiring `WorkerLease` (`LEASE_MS = 90_000` in [`application-task.ts`](../src/shared/state-machines/application-task.ts)).
2. **Engine isolation:** The **Application Queue Engine** (`runner.ts`, `campaign.ts`) and **LinkedIn Referral Engine** (`network.ts`, `bridge.ts`) operate independently. One paused form needing a PIN code never stalls referral outreach or other applications.
3. **Human-in-the-loop before irreversible actions:**
   - Default `submitPolicy: 'review'` leaves final application submission to the human.
   - Default `outreachMode` holds LinkedIn/Gmail drafts for approval.
   - Uncertain submissions (`attemptedAt` set without `confirmedAt`) transition to `uncertain` (`safeToRetry() === false`) and never auto-retry; only explicit confirmation returns an item (`uncertain -> submitted` or `uncertain -> queued`).
4. **Local-first storage:** Zero Referral Scout backend database. External network interactions target the user's own signed-in sessions (`linkedin.com`, `chatgpt.com`, `mail.google.com`) or runtime-consented destinations (`api.openai.com`, `media.licdn.com`, individual ATS sites via `optional_host_permissions`).

---

## 2. Module Map

| Directory / Module | Responsibilities |
| --- | --- |
| [`manifest.json`](../manifest.json) | MV3 manifest (`permissions`: 9 narrow permissions; `host_permissions`: `linkedin.com`, `chatgpt.com`, `mail.google.com`; strict CSP `script-src 'self'; object-src 'none'; base-uri 'none'`) |
| [`src/background/service-worker.ts`](../src/background/service-worker.ts) | MV3 entry point, message router registration, wake-lock lifecycle (`chrome.power`), notification click handlers |
| [`src/background/runner.ts`](../src/background/runner.ts) | Application queue scheduler, worker poll loop, `recoverQueue()`, `staleNeedsYou()` self-healing, `reconcile()` |
| [`src/background/campaign.ts`](../src/background/campaign.ts) | Campaign CRUD, `enqueueJobs()`, `resolveException()`, `confirmSubmission()`, `pinCompany` |
| [`src/background/workspace.ts`](../src/background/workspace.ts) | Candidate profile/CV/Answer Bank backend handlers, `saveFact` bi-directional sync, `applyStudentDefaults`, `workspaceView()` |
| [`src/background/profileStorage.ts`](../src/background/profileStorage.ts) | Atomic transaction + `chrome.storage.local` read-back verification (`rs_profile_snapshot_v1`) for approved AI drafts |
| [`src/background/network.ts`](../src/background/network.ts) & [`bridge.ts`](../src/background/bridge.ts) | LinkedIn profile capture, job search (`findJobsStep`), referrer discovery, approval queue, IndexedDB bridge |
| [`src/shared/normalizeChatGptProfile.ts`](../src/shared/normalizeChatGptProfile.ts) | Defensive schema V3 (`identity.*`) & flat legacy JSON normalizer + `mergeCandidateIdentity()` |
| [`src/shared/domain/facts.ts`](../src/shared/domain/facts.ts) | 42-key canonical `CATALOGUE`, alias/anti-collision matching, scope rules, `detectCandidateMode()`, `buildStudentSmartDefaults()`, `factsFromProfileSnapshot()`, `essentialReadiness()` |
| [`src/shared/scoring/allocator.ts`](../src/shared/scoring/allocator.ts) | Contact scoring (`scoreContact`), employer breakdowns (`rankCompanies`), depth-based weekly allocator (`allocate`) |
| [`src/shared/progress-store.ts`](../src/shared/progress-store.ts) | Cross-context `chrome.storage.local` (`rs_live_progress_v1`) store + 6-stage `resolveMacroJourney()` state machine |
| [`src/ui/workbench/`](../src/ui/workbench/) | Full-tab 12-screen dashboard (`overview`, `jobs`, `applications`, `needs-you`, `referrals`, `people`, `answers`, `profile`, `setup`, `settings`, `welcome`, `activity`), `GuidedReviewWorkspace`, `FloatingProgressHUD` |
| [`src/ui/sidepanel.ts`](../src/ui/sidepanel.ts) & [`src/content/floating-hud.ts`](../src/content/floating-hud.ts) | Side Panel UI & Closed-Shadow-DOM host-page overlays (`health.js`, `apply.js`) |

---

## 3. Application State Machine (`application-task.ts`)

```text
queued ──▶ opening ──▶ filling ──▶ ready ──▶ submitted ──▶ closed
  ▲           │           │          │           ▲
  │           ▼           ▼          ▼           │
  └────── needs-you ◀─────┴────── uncertain ─────┘
              │                      ▲
              └── (staleNeedsYou self-heal if all blockedBy exceptions resolved)
```

- **Lease recovery:** `orphaned()` returns active (`opening | filling | ready`) tasks whose `lease.expiresAt` elapsed, returning safe items to `queued` or attempted ones to `uncertain`.
- **Orphaned blocker healing:** `staleNeedsYou()` returns safe-to-retry `needs-you` tasks whose `blockedBy` exception IDs are absent from open campaign exceptions.
- **Explicit submission confirmation:** `uncertain -> submitted` (`"It went through"`) or `uncertain -> queued` (`"It did not"`, clearing `submission` & resolving open `submission-uncertain` exceptions).

---

## 4. Ranking, Company Pin Boost & Budget Allocation (`allocator.ts`)

1. **Contact Score (`scoreContact()`):**
   `round(100 * (0.25 * relationship + 0.30 * roleRelevance + 0.20 * hiringRelevance + 0.15 * opportunity + 0.10 * confidence))`
   where `opportunity = clamp(0.7 * (opportunityFit / 100) + 0.3 * opportunityFreshness)`.
   Tiers: `>=85 P1`, `>=65 P2`, `<65 P3`.
2. **Company Ranking (`rankCompanies()`):**
   Groups contacts by `canonicalCompany()` and scores:
   `min(100, round(0.65 * bestContactScore + 0.25 * bestOpportunityFit + min(10, (contactCount - 1) * 5) + (pinned ? 15 : 0)))`
   emitting transparent `reasons[]`.
3. **Allocation (`allocate()`):**
   Iterates company-by-company breadth-first (`depth = 1..maxPerCompany`). Pinned companies sort first at equal depth, claim budget slots ahead of unpinned employers, and bypass the `diminishingHours` cooldown timer.

---

## 5. Storage Schema & Bi-Directional Sync

- **IndexedDB Stores (`src/shared/persistence/campaign-store.ts`):**
  `campaigns`, `jobs`, `companies`, `profiles`, `applications`, `exceptions`, `facts`, `contacts`, `outreach`, `threads`, `aiContexts`, `events`, `notifications`, `audit`.
  Every read-modify-write runs inside a single IndexedDB transaction via `change()`.
- **`chrome.storage.local` Cross-Context Keys:**
  - `rs_live_progress_v1`: Monotonic cross-context task progress shared between service worker, Workbench, and Side Panel.
  - `rs_profile_snapshot_v1`: Verified summary read back after approving AI profile drafts (`profileStorage.ts`).
- **Bi-Directional Answer Sync:**
  - `saveNormalizedProfileApproval()` calls `factsFromProfileSnapshot()` to populate identity, education, current employment, and preferences into `facts`.
  - `saveFact` and `applyStudentDefaults` in `workspace.ts` mirror updates back into `CandidateProfile`, `rs_profile_snapshot_v1`, and legacy `apply-profile.details` (`PROFILE_KEY`).
