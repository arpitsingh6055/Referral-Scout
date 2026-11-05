# Cold Contact Pro

A Chrome extension project for a source-backed internship outreach workflow.

**Status: Phase 0 feasibility probes only.** The extension, campaign engine, and
Autopilot are not implemented yet. Live website behavior has not been verified.
Do not install this repository as an unpacked extension yet: there is no manifest.

## Try the current code

Requirements: Node.js 24 and Chrome with your own logged-in website sessions.
No dependency installation, API keys, or server are needed for Phase 0.

```sh
node --test spike/parsers.test.cjs
node --check spike/llm.js
node --check spike/gmail.js
node --check spike/linkedin.js
```

Follow [the Phase 0 instructions](spike/README.md) to run the browser probes.
The Gmail probe saves a self-addressed draft; sending requires a separate command.
The LinkedIn probe only reads cards on the currently open company-search page.
Automated tests cover synthetic parser inputs, not live DOM compatibility.

## Planned delivery

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Provider, Gmail, and LinkedIn feasibility probes | Code ready; live checkpoint pending |
| 1 | MV3 manifest, settings, storage, selectors, validation | Planned |
| 2 | Provider bridge, mock mode, diagnostics | Planned |
| 3 | Durable orchestration, scheduler, controls, dashboard | Planned |
| 4 | Discovery, company vetting, contact selection | Planned |
| 5 | Email evidence, source confirmation, MX, roles | Planned |
| 6 | Personalized drafts and validation | Planned |
| 7 | Sending, monitoring, follow-ups, retention, export | Planned |

Each phase has a local checkpoint before the next phase begins. Future builds will
start in Dry run and require explicit approval before Autopilot. The implementation
will not bypass challenges, login screens, warnings, or account restrictions.

## Data and privacy

Current probes read rendered page content. The provider probe submits only a tiny
JSON test prompt. The Gmail probe keeps its test address, subject, body, and phase
in that tab's sessionStorage; its clear() command removes those local test fields,
not the draft or message held by Gmail. Probe output may appear in DevTools.

In the planned extension, prompts containing names, companies, and your profile
will go to Gemini and ChatGPT through their websites. Email domains will go to
dns.google for MX lookups. The design requires recorded sources for web-sourced
contact data, opt-out handling, retention controls, and deletion/export tools.
Those campaign features are not available in Phase 0.

Automated access may breach service terms and lead to account restrictions. Run
live probes only in sessions you control. Keep Chrome open and the tested window
visible. The planned campaign runtime also requires the computer to remain awake.
Do not commit real profiles, inbox captures, campaign exports, or credentials.

## Development and publication

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
GitHub Actions runs syntax checks and parser tests on pushes and pull requests.
It does not sign into websites, submit prompts, or send emails.

Before publishing, inspect the staged diff for personal information and verify the
checks pass. This repository is an early feasibility project, not a production
release or Chrome Web Store package. A redistribution license has not been chosen;
no open-source license is granted by this repository at this stage.

