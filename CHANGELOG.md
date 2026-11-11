# Changelog

All versions below were built on 11 November 2026 on the `cleanup/linkedin-only` branch.
What is and is not proven on the live site is recorded in `docs/live-verification.md`.

## 0.15.1
- Settings no longer fail to save silently; the rejected field is named.
- Gap between sends can be set from 5 seconds upward.

## 0.15.0
- Acceptance check every 2 hours from My Network > Connections (one page load for all pending invitations).
- Search uses LinkedIn's degree filter; 1st-degree matches get a direct message, 2nd and 3rd+ get an invitation.
- Connect under the More menu; "Invitation sent to NAME" counts as proof of sending.

## 0.14.0
- Follows LinkedIn's real two-step invitation dialog; sends without a note when the monthly free notes run out.
- One failed send no longer pauses outreach: certain failures retry, slow confirmations are re-checked, never sent twice.

## 0.13.0
- Approve queues instantly; Cancel sending; Approve all. ChatGPT runs in its own window.

## 0.12.x
- Saved tab: job progress, reminders, requests unanswered for 3+ weeks, notes.
- Drafts are editable, with Rewrite with ChatGPT and Use my template.
- CV "processing" step removed; ChatGPT reads the saved CV text directly. Stuck unsent prompts are cleared.

## 0.11.x
- Remember button on LinkedIn profile and job pages.
- Closing line of the first note depends on who is contacted (recruiter, team leader, founder).

## 0.10.x
- Fixed everyone being skipped as "already connected" (hidden "1st" label on profiles).
- Pages open in a separate, unfocused window. Steps follow each other in seconds, each one announced.
- Templates are the default; ChatGPT may only lightly adapt them. Default gap between sends is 30 seconds.

## 0.9.0
- Every LinkedIn reader rebuilt against the live site: by role, label and text instead of class names.
- Removed 43 unreachable source files from the retired Gmail tool, Jobs mode and 14 of 16 storage tables.
