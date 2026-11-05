# Phase 0 — feasibility checkpoint

These are standalone JavaScript probes, not the finished extension. No framework,
API credentials, private endpoints, cookie reads, or external libraries are used.
They operate on rendered pages in your existing logged-in sessions. English UI is
the initial probe assumption; missing/localized controls fail visibly.

## Run the local parser checks

From the project folder, with Node.js installed:

```powershell
node --test spike/parsers.test.cjs
node --check spike/llm.js
node --check spike/gmail.js
node --check spike/linkedin.js
```

The fixtures here are synthetic parser inputs, not captured live DOM. Full DOM
snapshots, Vitest, mock pipeline tests, and extension builds arrive in later phases.

## Install each probe as a Chrome DevTools Snippet

Open the relevant website, press F12, choose Sources > Snippets (possibly under
the overflow menu), create a snippet, and paste the corresponding complete file.
Run it with Ctrl+Enter. Then use the Console commands below. Review the scripts
before running them. Do not disable Chrome's paste protection to run unknown code.
Official instructions: https://developer.chrome.com/docs/devtools/javascript/snippets

Keep the tested tab selected and its window visible. A background/hidden tab makes
the waiting probes fail. The scripts do not attempt to bypass login or challenges.

## A. Gemini and ChatGPT

1. Open a fresh empty chat on https://gemini.google.com/app. Use its temporary-chat
   control manually if available; otherwise note that this test uses normal history.
2. Run llm.js as a snippet, then run:

```javascript
await recruiterLLMProbe.run()
```

3. Repeat in a fresh chat at https://chatgpt.com/?temporary-chat=true.
4. Record each LLM PROBE result: provider, ok, stage/error, and timing.

Expected: ok=true and reply={ok:true}, after the stop control disappears and the
last assistant text remains unchanged for three seconds. Cancel polling with
recruiterLLMProbe.stop(); this does not recall an already submitted prompt.
This smoke test does not yet test Search activation, sources, repair, or fallback.

## B. Gmail draft and optional self-send

Close other compose boxes in the tested Gmail tab first. Run gmail.js, then:

```javascript
recruiterGmailProbe.prepare("YOUR_ACTUAL_GMAIL_ADDRESS", 0)
```

This navigates the same tab to a compose URL addressed only to that address.
Use your actual account index instead of 0 if necessary. After navigation, run
gmail.js again, because page navigation clears the installed functions. Expose
the From field using Gmail's sender/recipient details controls if available.

```javascript
await recruiterGmailProbe.saveDraft()
```

Expected: ok=true, phase=draft_saved. This checks the recipient, actual visible
From field, subject, body, and saved indicator. It leaves compose open. If Gmail
hides From or uses an unrecognized saved indicator, report that failure; do not
weaken verification or assume the account menu proves the compose sender.

Only if you want to send this one test email to yourself, run:

```javascript
await recruiterGmailProbe.sendSelf()
await recruiterGmailProbe.locate()
```

Expected: sent_confirmed, followed by located with threadId and threadUrl. The
second command can also reconcile an uncertain send; it never sends anything.
If sending times out, inspect Sent and run locate(), never sendSelf() again.
The probe stores only its test fields and phase in this tab's sessionStorage.
Do not close the tab before reconciling a possible send. You can inspect status()
and call clear() after reconciliation. Clear does not delete Gmail drafts/messages.

## C. LinkedIn company cards

Open a company search manually, for example:
https://www.linkedin.com/search/results/companies/?keywords=AI

Wait for cards to appear and run linkedin.js. Inspect LINKEDIN PROBE and the table.
Expected: at least one correctly named company and company URL. Check whether the
industry, location, tagline, and employee band match the page. Missing fields stay
null rather than being invented. Scroll manually and rerun to test lazy-loaded cards.
No pages, profiles, or buttons are opened by this probe.

## Report back before Phase 1

- Gemini: PASS or stage/error.
- ChatGPT: PASS or stage/error.
- Gmail draft: PASS or exact error; was From visible?
- Gmail self-send/thread: PASS, error, or NOT RUN.
- LinkedIn: card count, incorrect/missing fields, or error.
- UI language and whether temporary-chat controls were available.

Do not include your full inbox, email address, account identifiers, or message
contents in the report. Error strings and redacted results are sufficient.

Most likely failure points: changed provider selectors (report stage and visible
control labels); Gmail's hidden From/saved controls (report visibility; no send);
LinkedIn's changed card layout (report missing fields and a sanitized card sample).
The main build will adapt selectors and verification to this checkpoint.
