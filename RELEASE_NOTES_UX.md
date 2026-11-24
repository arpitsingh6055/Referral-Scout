# UX revision notes

- Added immediate dashboard progress feedback for async actions.
- LinkedIn profile read/refresh controls now show a busy label and are disabled during import.
- Added accessible live status semantics and reduced-motion handling for progress feedback.
- Routed unhandled async button errors into the dashboard error banner.
- Added shared progress feedback for multi-step async button workflows.
- Replaced misleading non-interactive “Next” onboarding labels with “Not started”.
- Clarified the LinkedIn identity prerequisite before CV association.
- Moved custom OpenAI API-key configuration into an Advanced disclosure; website-session usage remains the default and API keys are not required.

See `PRODUCT_UX_AUDIT.md` for findings, limitations and release QA.

## Deep follow-up revision (0.56.3)

- LinkedIn profile import sends real progress milestones from the service worker to the dashboard, instead of showing only one generic waiting message.
- The dashboard reports success only after a verified profile and capture timestamp come back. Candidate-profile refresh failures are called out separately from a successful local save.
- Async buttons show a busy label/spinner, set `aria-busy`, and block concurrent mutating actions while allowing navigation.
- CV upload from both onboarding and Candidate profile uses the shared progress/lock pattern.
- Campaign updates preserve the core campaign and surface any partial failure in the rules, candidate preferences, or legacy referral preference sync.
- LinkedIn capture freshness is shown, and Settings makes clear that a saved profile is not a live session check.
- The onboarding hero has been compacted to put the first actionable step higher on the screen.

## Verification boundary

All 128 TypeScript source/test/script files passed syntax transpilation with the globally available TypeScript compiler. Full `pnpm build` / typecheck / tests / browser-level integrations were not run because Corepack could not reach the npm registry to fetch the pinned pnpm release and no project dependencies were preinstalled. The archive intentionally contains source, not a stale `dist/`; run the commands in `REBUILD_REQUIRED.md` before loading this version into Edge.
