# Referral Scout 0.57.0 — product and workflow rebuild

## Product decisions

Referral Scout remains a browser extension with local-first storage. The normal workflow uses the user's existing LinkedIn and ChatGPT browser sessions; no API key, external account, hosted backend or subscription is required. The optional OpenAI API configuration remains optional and is not introduced into onboarding.

The product now distinguishes two separate jobs:

1. **Find and assess jobs** — search LinkedIn Jobs using the saved role/location, expand to related titles, read available job descriptions and rank the results against the full LinkedIn profile and saved CV through the signed-in ChatGPT session where available.
2. **Process application tasks** — work only on jobs the user has shortlisted and added to the application queue.

The UI no longer uses a generic “Start” label for both jobs. When no application tasks are queued, the primary campaign action starts job discovery. When tasks exist, the action is explicitly “Start application queue”.

## Changes

### 1. Cross-surface notifications
- Important background status transitions are broadcast to the dashboard and side panel.
- Both surfaces render floating toast notifications.
- The toast receiver acknowledges whether its extension surface is visible.
- If no visible extension surface acknowledges the event, the service worker creates an operating-system notification.
- System notifications are restricted to important milestones: profile import completion, job-search completion/no-results, user action required, and significant errors.
- Clicking a system notification opens the workbench. It never submits an application or sends outreach.
- The side-panel toast is moved to the top so it is not hidden behind the bottom navigation.

### 2. Job discovery starts from the dashboard
- Jobs empty state, Jobs header, Overview and empty Application Queue all have a direct “Find jobs on LinkedIn” action.
- The action invokes the existing `network.findJobs` pipeline and gives immediate feedback.
- Repeated clicks cannot silently reset an active search; the background returns an explicit already-running message.
- Overview and Jobs show the actual search phase, number of results found, title-search progress and description-ranking progress.
- Users can ask the search to finish with current results and review what has been found.
- The application runner is labelled “Start application queue” and is not presented as job discovery.

### 3. Candidate fit uses the whole profile
- The full LinkedIn profile and CV evidence are passed to the existing signed-in ChatGPT ranking workflow even when the user has not manually selected a specialisation.
- Manual specialisation selection is no longer a gate for fit assessment.
- The fit score and rationale from ChatGPT are carried into the canonical job record and shown in the Jobs detail view.
- The deterministic specialisation fallback is distinguished from a ChatGPT assessment.
- If no assessment was actually produced, the UI says “Fit not assessed”; it does not fabricate a zero score.
- Local matching now includes technologies from employment records and skills from projects, not only the manually curated Skills list.
- The warning about having no saved skills is suppressed when LinkedIn or CV source evidence is already available.
- Ranked fit is tied to the profile version used to produce it; stale AI assessments are not presented as current after profile changes.

### 4. User-facing states
- The default Jobs filter is “All”, so a thin or unassessed result set is not hidden behind a Strong-only filter.
- The Jobs screen explains that current automated discovery is through LinkedIn Jobs. It does not claim to search other job boards that have no implemented source adapter.
- Empty states lead to an actual next action.

## Important scope boundary

This release activates and improves the existing LinkedIn Jobs search pipeline. It does **not** add new Naukri, Indeed, Wellfound or other job-board discovery adapters. Claiming multi-board discovery without source-specific adapters, selectors, permission handling and QA would be misleading. ATS/application support remains separate from job-board discovery.

## Validation

- Manifest and package JSON parse successfully.
- 126 TypeScript source/test/script files pass TypeScript transpilation with zero syntax diagnostics.
- Full `tsc --noEmit`, Vitest and Vite production builds could not run because this environment has no installed dependencies and Corepack could not fetch pinned pnpm 11.25.0 from the npm registry (`EAI_AGAIN registry.npmjs.org`).
- No pre-existing `dist` folder is included or represented as a newly built artifact.

## Local release check

Run from the extracted project root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

Then load the generated `dist/` folder using `edge://extensions` → **Load unpacked**.

## End-to-end checks still required in Edge

1. Start a fresh job search from Overview with a verified LinkedIn profile.
2. Confirm the active search state appears in Overview and Jobs while the side panel is closed.
3. Close the dashboard, switch to another browser tab/window, and confirm important completion/attention events appear as system notifications.
4. Open the side panel and confirm floating toasts appear at the top without covering core controls.
5. Click a system notification and confirm the workbench opens.
6. Search with a CV and LinkedIn profile but no manually saved skills; confirm ChatGPT still ranks jobs and its rationale is visible.
7. Disconnect ChatGPT or force a timeout; confirm the product uses its deterministic fallback and shows “Fit not assessed” when no genuine fit assessment exists.
8. Edit profile evidence after a ranking; confirm an old ranked score is not presented as current.
9. Confirm “Start application queue” only starts queued application tasks and never masquerades as job discovery.
10. Confirm no application is submitted and no outreach is sent merely by starting job discovery.
