# Cold Contact Pro — v0.15.1

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

1. Sign in to LinkedIn, open the side panel and choose **Read my LinkedIn profile**.
2. Check **Who to contact** and **Your messages**. Both come from templates you can edit.
3. Choose **Start outreach**.

What happens next:

- **Find.** LinkedIn people search, filtered by connection degree, for recruiters, team leaders and founders matching your target roles. At most three people per company.
- **Invite.** 2nd and 3rd+ degree people get a connection request with your note (LinkedIn allows 200 characters, and free accounts only a few notes a month; after that requests go without a note).
- **Message.** 1st-degree matches, and anyone who accepts, get one message. Your connections list is read every 2 hours to see who accepted.
- **You stay in control.** By default every send waits for **Approve** (or **Approve all**). Drafts can be edited, rewritten by ChatGPT, or reset to your template. Automatic sending is a setting.
- **Saved.** A **Remember** button on LinkedIn profiles and job pages saves people and jobs with a note, a reminder and, for jobs, application progress.

Pages open in a separate window that is never brought to the front. Limits: 15 invitations a day, 80 a week, 100 pending, about 30 seconds between sends, active 8:00 to 22:00. Outreach pauses only for account-level problems (signed out, security check, LinkedIn's weekly limit) or three failed sends in a row.

**ChatGPT is optional** and needs no API key: stay signed in at chatgpt.com. It only adapts your own template. If it is signed out or fails you are told, and the template is used.

See [`CHANGELOG.md`](CHANGELOG.md) for what changed and [`docs/live-verification.md`](docs/live-verification.md) for what has been proven on the live site.

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
