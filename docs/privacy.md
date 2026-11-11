# Referral Scout privacy and data handling — v0.8.0 source candidate

**Updated:** 6 November 2026. This describes the patched source under review and is **not** a verified store-release privacy policy.

### Stored locally

Referral Scout can store the owner's verified LinkedIn profile URL, visible profile sections and capture times; extracted PDF/DOCX/TXT CV text and file metadata; the ChatGPT-generated career dossier; target roles, company preferences and settings; observed LinkedIn job cards/descriptions, company and recipient evidence; invitation notes; connection/acceptance status; thank-you messages; and timestamps/action ledgers. The data is saved to extension-owned IndexedDB. The former `network-v1` state remains as a compatibility source while v2 normalized owner-keyed records are mirrored. Legacy raw CV-file/base64 fields are stripped on state update. Full text is not included in routine side-panel status polling.

### Sent to LinkedIn and ChatGPT

The extension uses ordinary visible LinkedIn controls for account verification, search, invitations and messages. These actions use the existing user's LinkedIn session and are subject to the service's storage and policies. When you choose **Process with ChatGPT**, or Start requires an unprocessed dossier, the complete available LinkedIn profile text and **extracted CV text** appear in a visible ChatGPT prompt. For each recipient, validated dossier excerpts, public recipient/company/job observations and proposed text appear in ChatGPT prompts. No CV binary is attached or uploaded by the extension, although entered prompt text is transmitted to ChatGPT by that website. ChatGPT may retain conversations under your own account settings; clearing extension data does not delete ChatGPT web conversations.

There is no extension-owned analytics backend, cookie reading or stored authentication tokens. It does not send profile or CV bytes to an external AI API. Source text and LLM results are untrusted and should be reviewed before automatic sending.

### Controls and retention

The default mode requests approval before each LinkedIn send; an optional user-selected automatic mode can send while Edge is running. You can pause, export local data, delete extracted CV text, remove individual contacts or **clear all outreach** locally. The clear-all action removes network caches and owner/contact/job/action/AI-task records, but it does not undo invitations, messages or ChatGPT prompts already sent through websites, or necessarily remove all unrelated legacy campaign records. Extracted CV text and outreach history have no automatic expiration policy in this source candidate. Reinstalling/uninstalling an extension may alter browser-owned storage retention.

Do not ship publicly until the published privacy statement, accessibility, consent and platform policy review match a verified production build.
