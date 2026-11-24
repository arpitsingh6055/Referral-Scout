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
| `shared/domain/` | Campaign, Job + Company + qualification, CandidateProfile, Contact + OutreachTask, facts, exceptions, system records |
| `shared/state-machines/application-task.ts` | Queue states, transitions, leases, admission, ordering |
| `shared/scoring/allocator.ts` | Global invitation allocation |
| `shared/persistence/campaign-store.ts` | Typed IndexedDB access; `change()` is read-modify-write in one transaction |
| `connectors/job-sources/` | Adapter contract and the five sources |
| `background/runner.ts` | Scheduler, worker, recovery, reconciliation |
| `background/campaign.ts` | Services and the message API; returns one `CampaignView` the whole UI draws from |
| `ui/workbench/` | The six extension-hosted screens |
| `ui/side-panel/campaign-card.ts` | Compact control surface in the panel |

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

Built and tested: durable queue with leases and idempotent transitions; scheduler and worker; recovery and
reconciliation; Needs-you with semantic grouping and scoped reuse; Answer Bank with migration; canonical Job,
Company, CandidateProfile, Contact, OutreachTask with its stop rules, AI context correlation, Gmail
classification thresholds, notifications, audit; global allocator; source adapter contract with LinkedIn wired
and four sources declared with honest health states; six workbench screens and the side-panel card.

Not yet built: live Gmail OAuth and thread sync; discovery adapters for Internshala, Naukri, Instahyre and
Wellfound (contract and normalisation exist, search does not); the Jobs and People workbench screens, which still
point at the side panel; CV parsing into the structured profile; the allocator wired to live contact records.

## Running it

```
pnpm test        # 608 tests
pnpm typecheck
pnpm build       # dist/ — loads unpacked in Edge
npx vite build --mode preview   # preview/ — the workbench with sample data, for design review
```

`preview.ts` and `preview.html` never ship in the extension package; they build to `preview/`, not `dist/`.
