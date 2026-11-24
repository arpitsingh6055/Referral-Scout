# Referral Scout privacy and data handling — v0.49.0 source candidate

**Updated:** 25 November 2026. This describes the patched source under review. It is not a verified store-release privacy policy; verify every flow and the deployed endpoint before publication.

## Stored locally

Referral Scout stores the owner's LinkedIn profile details and capture time; extracted PDF/DOCX CV text and file metadata; the structured candidate profile and its source/provenance; target roles, campaign preferences and settings; observed job cards and descriptions; application records; invitation notes; contacts, connection/acceptance status, messages and action timestamps. The newer workbench uses extension-owned IndexedDB records, while the older `network-v1` state remains as a compatibility source for the existing referral workflow. Some state is mirrored between the two layers so both screens can use the same profile and search preferences. Routine side-panel status polling omits full profile/CV text.

## Sent to LinkedIn and Google services

LinkedIn actions use the user's existing signed-in LinkedIn session and visible LinkedIn pages. Referral Scout does not request or store a LinkedIn password. When a user asks it to read their own profile, it opens the signed-in user's `/in/me/` profile in an extension work window and reads the visible profile data needed by the feature. Search, invitations and messages are also performed through the user's LinkedIn session and remain subject to LinkedIn's own policies and retention.

Gmail features use the user's signed-in Gmail session when the user chooses to connect or sync. Messages and drafts remain subject to Google's services, account settings and retention. Connecting Gmail is optional and is not needed for job search.

## Sent to AI providers

AI-assisted tasks may send relevant profile details, extracted CV text, job or recipient context, and proposed text to the user's own signed-in ChatGPT website session. If the user configures an OpenAI API key, the relevant task context is instead sent to OpenAI through its API. API usage is billed by OpenAI under the user's account. The API key is stored locally and deliberately excluded from data backups. The extension does not send a CV binary as part of an AI prompt, but text extracted from the CV can be included when relevant to a task. Users should review provider terms, retention controls and the content sent before using these features.

## Optional usage reporting

Usage reporting is **off by default** and is not required to read a LinkedIn profile, save a CV, create a campaign, search jobs or use core features. It runs only after the user explicitly enables **Allow one-time usage counting** in the dashboard. When enabled, the extension sends a small record to `https://referral-scout.vercel.app/api/ping` containing a random per-install identifier (`uid`), the display name (`name`) and the LinkedIn profile handle (`id`). The code attempts to report once per LinkedIn handle. The report does not include CV text or files, job details, contacts, messages or application records.

The user can turn this setting off at any time in **Settings → Privacy and usage reporting**. Turning it off prevents future reports; it cannot retract a record already transmitted to the reporting endpoint. The endpoint operator's server-side retention and access practices must be verified separately before public release.

## Controls and retention

The default mode requests approval before each LinkedIn send; an optional user-selected automatic mode can send while Edge is running. The user can pause work, export local data, delete a saved CV, remove individual contacts or clear outreach data locally. Clearing extension data does not undo invitations, messages, Gmail drafts, or AI prompts already sent through external services, and does not delete provider-side records. The source candidate has no automatic expiry policy for all saved profile, CV and outreach records. Browser uninstall/reinstall behaviour may affect browser-owned storage.

## Release review required

Before public release, verify the production build, all data flows, the usage endpoint's privacy and retention terms, accessibility, consent language, browser-store policy compliance and the published privacy statement. This source document is a development disclosure, not legal advice or a substitute for the required store policy.
