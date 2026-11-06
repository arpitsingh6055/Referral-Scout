# Cold Contact — LinkedIn Outreach

A Chrome / Edge extension for building professional connections directly on LinkedIn.

## The experience

1. Open your LinkedIn home or profile page while signed in.
2. Open the extension and choose **Read my LinkedIn profile**.
3. Check the suggested target and the introduction, then choose **Start outreach**.

The extension saves relevant recruiters, founders and team leaders, sends connection
requests gradually, and checks pending invitations every 24 hours. After a tracked
invitation is confirmed as a first-degree connection, it sends one introduction.
The conversation is yours from that point onward.

Keep your LinkedIn profile up to date. There is no CV form, email lookup, Gmail
configuration, ChatGPT prompt, Gemini account, API key or paid AI call in this build.

## What changed in 0.4

The primary workflow is now LinkedIn-only. The three extension entry pages open the
same dashboard. The installed background worker and content script no longer load
or run the old AI/Gmail campaign. Old campaign alarms are cleared on initialization.
Previous email-campaign source and tests remain in the repository as legacy code;
they are not part of the installed workflow. Existing legacy records are preserved.

## Current behavior and limits

- Reads name, headline, location and the rendered About section from your own profile.
  Account navigation identifies the signed-in user; viewing someone else's profile
  never makes that person the account owner.
- Suggests a target from the headline. You can edit the target, search location and
  introduction before starting. This is a simple suggestion, not AI interpretation.
- Searches LinkedIn people results using the target, location and alternating
  recruiter/founder/team-lead searches. Saves matching visible profiles, with a
  reason and their profile link. It does not verify vacancies or employment claims.
- Sends invitations without a note, up to five attempts per rolling 24 hours.
- Checks each pending invitation after 24 hours. Sends at most five introductions
  per rolling 24 hours, and only after a tracked invitation becomes first-degree.
- Does not adopt existing first-degree connections or already-pending invitations.
  Existing conversations and unsent message drafts are left for the user.
- Uses a normal LinkedIn work tab without bringing up multiple automation windows.
  Chrome must be open and the computer awake. Checks missed during sleep/closure
  resume after the browser returns; this is not a cloud scheduler.
- Pause stops future work. A click already completed cannot be recalled. Persisted
  action intent, account/recipient checks and uncertain-action recovery prevent
  blind retries after interruption. Uncertain contacts stay in Needs attention.
- Stops for unrecognized pages, signed-out sessions and account challenges.
  The current selectors expect English LinkedIn pages.
- The shortlist is bounded to 500 saved profiles and 50 pending invitations.
  Search is bounded, cycles through five result pages per category and backs off
  after empty results. Search quality is heuristic and needs real-session review.

**Status: implemented preview, not live-verified.** Automated tests exercise the
workflow with synthetic data. No real invitation or LinkedIn message was sent while
building this version. LinkedIn selectors and account-specific dialogs still need
verification in a signed-in session. Do not interpret a successful build as proof
of reliable live automation.

## Build and load

Use the pinned Node/pnpm versions in `package.json`:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm package
```

Load the generated `dist` directory in your browser's extension developer settings,
or reload the existing unpacked extension after rebuilding. Refresh LinkedIn tabs
after updating so they receive the new content script. The distributable ZIP is
`cold-contact-pro.zip`.

## Data and permissions

New profile, shortlist, message and progress records stay in local IndexedDB.
Rendered profiles are read through the user's signed-in LinkedIn pages. Invitations
and messages go to LinkedIn through its normal interface. No AI service or
extension-owned server receives the new workflow's data.

**Clear saved outreach** removes the new workflow's local profile and contacts.
It does not withdraw invitations, delete LinkedIn messages or erase legacy email
campaign records. LinkedIn remains responsible for its service-side copies.

The build requests access only to LinkedIn, plus extension storage, tab control,
script injection, side panel, alarms and power permission (to release an old
version's keep-awake request). It does not inspect passwords, cookies or tokens.
LinkedIn can change its interface or restrict automated activity; the extension
does not bypass those restrictions.

## Code map

- `src/ui/sidepanel.ts`, `network.css`: the shared dashboard.
- `src/shared/network.ts`: profiles, contact states, validation and matching rules.
- `src/parsers/network.ts`: own-profile identification and rendered profile data.
- `src/content/network.ts`: LinkedIn reads, invitations and introductions.
- `src/background/network*.ts`: scheduling, account/action authorization and storage.
- `tests/network.test.ts`: identity, acceptance, 24-hour timing, caps, pause races,
  authorization and interrupted-action recovery.

See [implementation status](docs/implementation-status.md) for verification notes.
