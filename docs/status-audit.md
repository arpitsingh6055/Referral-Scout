# Referral Scout v2 — what works, what doesn't

Written 25 November 2026 by tracing call paths, not by reading intentions. Anything below marked **Wired** was
followed from the screen through the background to storage and back. **UI only** means the screen is real but
nothing behind it runs yet. **Absent** means it isn't built.

## Bugs found in this audit and fixed

| Bug | Why it mattered | Fix |
| --- | --- | --- |
| The workbench rebuilt its whole DOM every 5 seconds | Typing was destroyed mid-keystroke; fields cleared themselves | Renders are skipped when nothing changed, never run while a field has focus, and the caret, focus and unsaved text are restored across the ones that do run |
| `/workbench.html` was missing from the trusted-sender list | Every message was rejected in silence, so the page reported "Referral Scout is not running" | Added, with a test asserting every shipped page is on the list |
| Nothing ever wrote a `Job` record | Jobs screen, queue and runner read a store discovery never filled — the entire chain was dead | `bridge.ts` imports the side panel's search results as canonical jobs and qualifies them |
| The allocator was always passed an empty array | Referrals screen could never show anyone | Fed from the contacts the referral engine has already found |
| Changing the URL hash did nothing | Browser Back and Forward were broken | Two-way routing with `popstate` and `hashchange` |
| `role="tab"` with no `tablist` parent | Screen readers did not see the filters as tabs | Containers given `role="tablist"` and a label |
| The side panel card returned early with no campaign | It held the only route to the workbench, so the new UI was unreachable | Always shows a way in |

## Screen by screen

| Screen | State | Detail |
| --- | --- | --- |
| Welcome | **Wired** | Creates a real campaign; CV import and connection status are live |
| Overview | **Wired** | Counts, stage progress, queue preview, inbox preview and the outcome ledger all read real records |
| Jobs | **Wired** | Imported from the side panel's LinkedIn search, qualified against the profile, shortlist and queue both work |
| Applications | **Wired** | Real queue. Start/pause/drain, retry, skip, open, confirm all reach the runner |
| Needs you | **Wired** | Real exceptions; answering saves to the Answer Bank and resumes the affected applications |
| Answer Bank | **Wired** | Full read and write against the typed fact store |
| Profile | **Wired** | Every section reads and writes; editing re-qualifies the shortlist |
| People | **Wired** | Imported contacts; suppression persists across campaigns |
| Referrals | **Partly wired** | Ranking and budget are real and computed from real contacts. Reserving a contact does not yet send anything |
| Activity | **Wired** | Reads the append-only event ledger |
| Campaign | **Wired** | Creates and edits rules |
| Settings | **Wired** | Connections, surface choice, export. Delete still points at the side panel |

## Engines

| Capability | State | Detail |
| --- | --- | --- |
| Application queue runner | **Wired** | Claims, leases, opens a tab, drives the existing fill engine, parks exceptions, recovers after restart |
| Exception isolation | **Wired** | One blocked application never stops another; tested |
| Answer Bank reuse and scoping | **Wired** | Canonical keys, aliases, country scope, staleness; tested |
| Uncertain submission handling | **Wired** | Never auto-retried; tested |
| Job qualification | **Wired** | Eligibility separated from fit, with evidence; tested |
| Gmail DOM control | **Wired, not reachable from the UI** | Read, classify, draft, send and the send gate all work and are tested. No screen calls draft or send yet |
| Global referral allocator | **Wired, read-only** | Ranks and allocates correctly. Nothing consumes the allocation to send |
| Source adapters | **Contract only** | LinkedIn discovery comes through the side panel. Internshala, Naukri, Instahyre and Wellfound report `not-implemented` rather than pretending |
| CV parsing | **Wired** | Local, no model call; everything lands unverified with its source line |
| Notifications | **Absent** | The rules exist in `domain/system.ts`; nothing raises a browser notification |
| Outcome sync from Gmail | **Wired, manual** | Runs from Settings. Not on a schedule |

## Known gaps, in the order I would close them

1. **Outreach has no send path from the UI.** The allocator reserves contacts; nothing drafts or sends. The
   channel code and its safety gates are built and tested — this is a screen, not an engine.
2. **Contacts are not tied to a specific vacancy**, so the allocator scores opportunity fit against the campaign
   rather than the job. The screen says so rather than implying precision it does not have.
3. **No notifications.** A person who leaves it running learns about an uncertain submission only by looking.
4. **Discovery for the four other sources.** Contract and normalisation exist; `search()` does not.
5. **Delete everything** is still only in the side panel.
6. **Version mismatch**: `manifest.json` says 0.56.2, `package.json` says 0.49.0. Both specs call this a release
   gate failure. Deliberately not changed — picking the version is the owner's call.

## What I would not trust yet

Gmail's markup is the brittle part of the DOM approach. Every selector lives in `selectors.config.ts` and a
missing one throws a named error rather than returning an empty result, so a break looks like a break — but it
will break eventually, and there is no live-verification log for it yet.

The allocator's weights are a starting hypothesis. They are not calibrated against any outcome data and the UI
says so.
