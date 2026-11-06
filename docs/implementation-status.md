# Implementation status — LinkedIn workflow (0.4)

The primary experience has been rebuilt around LinkedIn profiles, saved people,
connection requests and introductions after acceptance. The old email campaign is
not registered by the current service worker and its old alarms are cleared.

Implemented:
- Shared onboarding/dashboard for the side panel, options and old onboarding URL.
- Own-profile identification from account navigation or the feed identity card.
- Profile extraction, suggested target, editable introduction and search location.
- Saved recruiters, founders and relevant team leaders from rendered people search.
- Durable invitation/message intents, per-action authorization and account checks.
- Per-contact 24-hour pending checks, first-degree acceptance checks, one introduction.
- Rolling daily limits, Pause/Resume, Skip and Clear saved outreach.
- Recovery that does not retry uncertain requests/messages.
- Local state persistence without AI calls, Gmail or email discovery.

Still requires real-session validation:
- Account menu and profile selectors across LinkedIn layouts.
- People-search quality, location matching and search pagination.
- Connect buttons, invitation dialogs and the post-invitation Pending indicator.
- First-degree markers, exact recipient links in message headers, history loading,
  message delivery indicators, and existing-conversation detection.
- Browser sleep/restart and pause during a real page action.

The build targets English LinkedIn UI. Unknown layouts produce a visible error or
Needs attention, not fallback guesses. Tests use synthetic profiles and mocked
browser responses. No real invitation or message was sent during development.

Other phase-1/email documentation describes the legacy 0.3 implementation and is
not an installation guide for the current LinkedIn-only build.
