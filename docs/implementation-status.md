# Implementation checkpoint

The installed build includes settings, diagnostics and guided CV onboarding. Work on
later phases was interrupted before the campaign scheduler, dashboard, and live
drivers were integrated. Do not describe this revision as ready for unattended
outreach, and do not enable the dormant sending modules without their safety tests.

## Ready in the build

- Existing Phase 1 settings, storage, validation, and read-only diagnostics.
- One-time profile JSON import with validation and Chrome sync persistence.
- Configurable writing style, with migration for older saved profiles.
- Generic CV upload, public-link download and pasted text flows, explicit ChatGPT
  consent, validated extraction, restart recovery, cancellation and editable review.

Optional private profiles can be stored in ignored private/profile.json, outside
source control. Select that file in Options > Import your saved profile to copy it
into Chrome storage. Resume links are saved as supplied; verify public sharing
before using one for outreach. No personal profile is embedded in the extension
bundle or public fixtures. Each user reviews their own extracted facts and supplies
availability and role preferences.

## Source implemented but not integrated or live-validated

Bridge queue/repair/fallback, provider DOM driver, page command protocol, lease,
Kolkata calendar, discovery/vetting/email/roles/drafting/sending/monitoring modules,
and parser helpers. The CV-specific ChatGPT driver is now integrated, but campaign
drivers remain disabled. Provider selection prefers ChatGPT for draft/follow-up jobs
and Gemini for vetting/contact/role searches. These modules are not yet bundled into
the installed extension's automation runtime.

## Required before enabling campaign execution

- Connect and test the scheduler, service-worker RPC, heartbeats, pause cancellation,
  lease recovery, durable status transitions, and six-hour/start/resume health gates.
- Finish dashboard controls, ten-live-draft approval, manual results, retention,
  full CSV/debug export, notifications, and confirmed send reconciliation.
- Complete pattern inference and verification policy, LinkedIn action pacing and
  search filtering, monitoring pagination and per-recipient follow-up checks.
- Correctly ignore quoted text when detecting opt-outs and use the latest message's
  sender/body pair when inspecting Gmail threads.
- Test restart and pause races, source and domain validation, follow-up identity,
  cooldowns, caps, mocked end-to-end flow, and all live selectors.
- Ensure no stale pipeline write can replace a paused/stopped campaign state, and
  that uncertain sends are reconciled before any duplicate is possible.

No live campaign, provider prompt, CV upload, or Gmail send was executed during development.
