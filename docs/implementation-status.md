# Implementation checkpoint

The installed build includes settings, diagnostics, guided CV onboarding, campaign
controls, and a guarded campaign runtime. The mock path exercises discovery through
ten dry-run drafts without opening websites. Do not describe this revision as ready
for unattended outreach: live provider, LinkedIn, and Gmail behavior still needs
verification in real user sessions.

## Ready in the build

- Existing Phase 1 settings, storage, validation, and read-only diagnostics.
- One-time profile JSON import with validation and Chrome sync persistence.
- Configurable writing style, with migration for older saved profiles.
- Generic CV upload, public-link download and pasted text flows, explicit ChatGPT
  consent, validated extraction, restart recovery, cancellation and editable review.
- Start, pause, resume, stop, approval, mock campaign execution, retention, export,
  manual recovery, and Delete All Data controls.

Optional private profiles can be stored in ignored private/profile.json, outside
source control. Select that file in Options > Import your saved profile to copy it
into Chrome storage. Resume links are saved as supplied; verify public sharing
before using one for outreach. No personal profile is embedded in the extension
bundle or public fixtures. Each user reviews their own extracted facts and supplies
availability and role preferences.

## Source implemented but not fully live-validated

Bridge queue/repair/fallback, provider DOM driver, page command protocol, lease,
Kolkata calendar, discovery/vetting/email/roles/drafting/sending/monitoring modules,
and parser helpers are wired into the scheduler and dashboard. The CV-specific
ChatGPT driver is integrated, and provider selection prefers ChatGPT for
draft/follow-up jobs and Gemini for vetting/contact/role searches. Live selectors
and account-specific behavior remain unverified.

## Required before enabling campaign execution

- Verify the scheduler, service-worker RPC, heartbeats, pause cancellation, lease
  recovery, durable status transitions, and six-hour/start/resume health gates in
  a live Chrome session.
- Verify dashboard controls, ten-live-draft approval, manual results, retention,
  CSV/debug export, notifications, and confirmed send reconciliation in that session.
- Complete pattern inference and verification policy, LinkedIn action pacing and
  search filtering, monitoring pagination and per-recipient follow-up checks.
- Correctly ignore quoted text when detecting opt-outs and use the latest message's
  sender/body pair when inspecting Gmail threads.
- Test restart and pause races, source and domain validation, follow-up identity,
  cooldowns, caps, mocked end-to-end flow, and all live selectors.
- Ensure no stale pipeline write can replace a paused/stopped campaign state, and
  that uncertain sends are reconciled before any duplicate is possible.

No live campaign, provider prompt, CV upload, or Gmail send was executed during development.
