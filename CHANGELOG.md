# Changelog

All versions below were built on 11 November 2026 on the `cleanup/linkedin-only` branch.
What is and is not proven on the live site is recorded in `docs/live-verification.md`.

## 0.15.3
- Remember button was invisible in browsers with an ad blocker. Blockers such as Stands AdBlocker hide any `div` placed directly under `<html>` that has an inline `z-index` (rule `head ~ div[style*="z-index"]`). The button is now its own element in `<body>`, with no inline style, positioned from a stylesheet inside its shadow root.
- If something still hides it, it is moved once and the page console says so.
- The button is built with DOM calls only. LinkedIn enforces Trusted Types, which blocks `innerHTML` and stopped the original version from ever creating the button.

## 0.15.2
- Remember button: now shown on every LinkedIn profile and job page (except your own profile), even when LinkedIn's layout can't be read. Before, it stayed hidden unless the top card was recognised exactly.
- Click it, write a note (for example the role that is open at their company), press Save. The note box is part of the button, not a second step.
- A failed save now says so ("Refresh this LinkedIn tab and try again") instead of doing nothing.
- Typing a note no longer triggers LinkedIn keyboard shortcuts. A top card left over from the previous profile is ignored when LinkedIn changes page without reloading.
- Not yet confirmed on the live site; see `docs/live-verification.md`.

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
