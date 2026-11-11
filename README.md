# Cold Contact Pro — v0.9.0

Chromium/Edge Manifest V3 extension for **visible** LinkedIn people discovery, ChatGPT-written personalized invitation notes, 24-hour acceptance checking, and contextual follow-up messages. It is intended for use with a signed-in LinkedIn tab and a signed-in ChatGPT tab, not an AI API. The extension controls the ordinary rendered web interfaces; it does not promise reliable operation when those interfaces change.

> **Status:** Reading LinkedIn (who is signed in, your profile, people search, a person's connection state, the message window) was checked against the live site on 11 November 2026 and works. Sending an invitation and sending a message have **not** been run live yet. See [`docs/live-verification.md`](docs/live-verification.md) for the exact list. **LinkedIn restricts automated activity; use is at your own risk.** The defaults (15 invitations a day, 80 a week, quiet hours, review before every send) are deliberately conservative.

## Build and install

Use **Node.js 22 or later** with pnpm (or npm). From the repository root:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm package
```

`build` compiles the background, UI and content runtime and verifies the Manifest V3 files. `package` also builds a distributable archive. Do **not** mistake the source ZIP for the compiled archive. If any check fails, resolve it before loading the extension. On Edge, visit `edge://extensions`, turn on **Developer mode**, select **Load unpacked**, and choose the **generated `dist/` directory**. Reload the extension after rebuilding and refresh already open LinkedIn and ChatGPT tabs so new scripts run in those pages.

## The experience

1. Sign in to LinkedIn, open the side panel, and choose **Read my LinkedIn profile**. The extension opens your own profile for you.
2. Check **Who to contact** (target roles and place) and **Your introduction** (the invitation note and the one message sent after someone accepts). Both come from templates you can edit; no ChatGPT is needed.
3. Choose **Start outreach**.

The extension searches LinkedIn for 2nd and 3rd degree recruiters and talent partners, team leaders in your field, and founders. It skips students, open-to-work profiles, former roles, assistants, and anyone you are already connected to. Candidates are ranked (recruiters first, then leaders, then founders, 2nd degree before 3rd) and at most three people per company are kept. Invitations go out slowly with randomised gaps, only in your active hours, within daily and weekly limits. Pending invitations are checked every 24 hours. When a tracked invitation is confirmed as a first-degree connection, one introduction is sent. After that the conversation is yours.

In **Review before every send** mode (the default) every note is drafted and waits for your approval; at most five drafts queue up at a time. Status messages and notifications always say what happened and what to do next.

**Optional ChatGPT personalisation.** Under *Optional: personalise with ChatGPT*, add a CV and process a dossier, then choose *Personalise with ChatGPT* in Advanced settings. If ChatGPT fails for any reason the extension falls back to your templates instead of stopping.

**Search and filtering.** Search combinations are every target role crossed with recruiters, campus recruiters (for internships), leaders and founders, paged up to five pages deep, then stopped. The employer comes from LinkedIn's own "Current: role at company" line when it is shown. Rules live in `src/shared/targeting.ts` and are covered by tests. LinkedIn pages are read by role, label and text, never by class name (`src/parsers/network.ts`).

**Safety behaviour.** A problem with one profile (no Connect button, existing conversation, email required) skips that person and continues. LinkedIn's weekly limit pauses outreach and puts the person back in the queue. Anything uncertain after a click pauses everything and is never retried automatically.

**Pause/Resume:** Pausing persists across restarts. Saved data can be exported; you can delete extracted CV text, remove individual contacts or clear all outreach. Deleting extension records does **not** retract sent LinkedIn requests or erase chats on ChatGPT's servers.

## Troubleshooting

- **ChatGPT tab opens but no prompt:** Confirm you're signed in and no existing unsent draft, authentication page, challenge or usage cap is visible. Open **Automation diagnostics** in the side panel. Check the current document/composer and the job's last recorded stage. Refresh the ChatGPT tab and use the same action again only after checking the visible conversation; never resend an uncertain job blindly.
- **LinkedIn account or action blocked:** Verify the signed-in owner matches the imported profile. Check the exact recipient profile. LinkedIn may modify its selectors, require email confirmation or impose account-level restrictions. The extension does not bypass restrictions.
- **No results or slow discovery:** Check your target roles and location, then open a LinkedIn people search and press **Check this LinkedIn page** in the side panel.
- **No 24-hour check while Edge closed:** MV3 alarms cannot run when Edge is completely closed. After restarting, overdue records are eligible on the next worker tick.
- **A send is uncertain:** Inspect LinkedIn and the per-contact activity record. An uncertain invitation or follow-up must not be auto-retried.

## Privacy and limitations

LinkedIn profile and CV-derived text are stored locally in the extension database; the extracted text (not original binary file) is inserted in a **visible** ChatGPT web prompt when processing is selected. The rendered recipient and company data is likewise supplied to ChatGPT for individual outreach text. These are intentional external transmissions via the user's signed-in sessions. No OpenAI API key, private LinkedIn endpoint, credential extraction, or extension-owned telemetry server is used. Read [`docs/privacy.md`](docs/privacy.md) for details. Live-browser validation is mandatory before reliance on automatic sending.

## Look and feel

The side panel has a status card that always says what the extension is doing (running, waiting for active hours, paused, needs you), three tabs (Setup, People, Activity), a notification for every action, an activity log, and light and dark themes. Screenshots are in `docs/screenshots`. To preview every screen with sample data and no LinkedIn access: `npm run build`, then `node scripts/preview-network.mjs` and open `http://127.0.0.1:4173/?screen=active` (also `welcome`, `ready`, `review`, `attention`, `quiet`).
