# Referral Scout — UX redesign notes

**Source version:** 0.49.0  
**Updated:** 25 November 2026

## Product decision

The extension now uses a two-surface model with one clear responsibility for each surface:

- **Side panel — quick entry and in-context control.** A fresh install opens here. Until the user has a LinkedIn profile and campaign target, the panel is a short launcher that explains the three setup steps and opens the dashboard. Once configured, it remains the compact workspace for referral activity, saved people, progress and outreach-specific controls.
- **Dashboard — setup, decisions and record management.** The full dashboard owns LinkedIn profile reading, candidate profile records, CV upload and review, AI/Gmail connections, usage-reporting choice, campaign targeting, application rules and data export. The side panel links to these places rather than exposing second versions of the same forms.

This is intended to preserve the convenience of opening Referral Scout beside LinkedIn without asking a first-time user to learn two overlapping navigation systems.

## First-run journey

1. Install the extension and click its toolbar icon. The side panel opens by default.
2. Choose **Open setup dashboard**. The dashboard presents a three-step setup: read the signed-in LinkedIn profile, optionally add a CV, and set the job-search goal.
3. Sign in on LinkedIn itself, return to the dashboard and choose **Read my LinkedIn profile**. Referral Scout does not ask for a LinkedIn password.
4. Add a PDF/DOCX CV if desired. The current data model associates the CV with the verified LinkedIn identity, so the upload action becomes available after profile reading. CV import is optional; new details are reviewable suggestions.
5. Set target role(s), location and employment type, then create the campaign. The dashboard saves the campaign and synchronises the corresponding target preferences to the legacy referral workflow.
6. Connect ChatGPT/Gmail only when needed. The API key is optional and is configured in dashboard Settings.
7. Use the dashboard for job/application decisions and the side panel for quick referral work. The user can change the toolbar's default surface in Settings.

## Changes implemented

- New installs default to the side panel; users can still choose the dashboard as the toolbar default.
- Replaced the mandatory consent gate with a non-blocking first-run launcher.
- Reduced first-run dashboard navigation to Get started, Candidate profile, Campaign and Settings. Full navigation appears when a campaign exists.
- Added LinkedIn profile read/refresh and open-login actions to Candidate profile and Settings.
- Centralised CV upload, CV replacement/deletion and CV-to-profile import in Candidate profile / onboarding.
- Centralised OpenAI API-key save/test/remove, ChatGPT test/open and Gmail connect/recheck/sync in Settings.
- Kept usage counting off by default, made it optional, and added a direct on/off control in both onboarding and Settings.
- Removed the duplicate role/location editor from side-panel outreach settings. Side-panel targeting now links to Campaign.
- Made Campaign edits update the existing campaign as well as create a new one; previously, changing the role/location form for an existing campaign only updated the auxiliary profile preferences.
- Synchronised campaign role/location/work type to the existing referral workflow while preserving its invitation template and limits.
- Added status feedback and clearer explanations for the LinkedIn identity prerequisite on CV upload.
- Updated README and the source privacy disclosure to describe the new flow and distinguish local storage from provider/AI data flows.

## Privacy and security notes

- Usage counting is an explicit opt-in and does not gate profile reading or core features. When enabled, the current implementation sends an install ID, display name and LinkedIn profile handle to the configured reporting endpoint; it does not include CV, jobs, contacts or messages.
- Candidate profile and CV records remain browser-local in the extension's stores. Relevant text may be sent to the user's signed-in ChatGPT session or OpenAI API when the user invokes an AI-assisted feature.
- LinkedIn and Gmail sign-in happen on their own sites; Referral Scout does not collect provider passwords.
- These are source-level observations, not a certification. Verify the deployed reporting endpoint, browser-store disclosures and all provider flows before publishing.

## Build and verification

The source archive intentionally omits the previous `dist/` output because it predates these source changes. Build a fresh extension bundle locally:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

Then load the generated `dist/` folder using Edge's **Load unpacked** control at `edge://extensions`.

In this environment, the dependency install could not complete because the npm registry was unreachable (`EAI_AGAIN registry.npmjs.org`). The updated TypeScript source and tests were syntax-transpiled successfully (125 `.ts` files, zero syntax diagnostics), but a full TypeScript check, Vitest run, browser interaction test and production build could not be completed here. Treat this ZIP as an updated **source package**, not a verified prebuilt extension.
