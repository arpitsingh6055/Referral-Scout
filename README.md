# Cold Contact Pro

A local Chrome Manifest V3 extension project for source-backed internship outreach.

**Phase 1 is implemented:** profile and campaign settings, optional source permission,
read-only selector diagnostics, IndexedDB records, prompts, strict validators, and
tests. Campaign execution, provider automation, and sending are not available in
this build. Phase 0 live-browser results remain unreported.

## Build and install

Use Node.js 24 with npm available. Commands work in Linux, macOS, and Windows:

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

For subsequent builds, run `pnpm build`. The production extension is in `dist/`.
Open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select
`dist/`. Pin the extension and click its icon to open the side panel, then Open
settings. Reload existing LinkedIn/Gmail/Gemini/ChatGPT tabs after installation so
the read-only content script is present. No local development server is needed.

See [the Phase 1 checkpoint](docs/phase-1.md) and [Phase 0 probes](spike/README.md).

## Checks

```sh
pnpm test          # Vitest validators, fixtures, settings and IndexedDB
pnpm test:spike    # Standalone Phase 0 parser tests
pnpm typecheck    # Strict TypeScript
pnpm build        # Type-check, Vite bundles and MV3 output checks
pnpm check        # All of the above
```

Dependencies are pinned in package.json and pnpm-lock.yaml. GitHub Actions runs
the same complete check with read-only repository permissions. CI never signs in,
submits prompts, reads an inbox, or sends emails. DOM fixtures are synthetic;
passing tests do not prove current live-site compatibility.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Provider, Gmail, and LinkedIn probes | Code ready; live results unreported |
| 1 | Manifest, settings, storage, selectors, prompts, validators | Implemented; Chrome checkpoint pending |
| 2 | LLM bridge, both provider drivers, mock mode, diagnostics | Planned |
| 3 | Durable orchestration, scheduler, controls, dashboard | Planned |
| 4 | Discovery, company vetting, contact selection | Planned |
| 5 | Email evidence, source confirmation, MX, roles | Planned |
| 6 | Personalized drafts and validation | Planned |
| 7 | Sending, monitoring, follow-ups, retention, export | Planned |

## Data and permissions

Profile and campaign settings are stored in chrome.storage.sync, so Chrome may
sync them with your browser account. Operational records and the last diagnostic
report use local IndexedDB. Content scripts cannot read synced settings. Settings
may be saved incomplete, but readiness checks identify missing required fields.

The Phase 1 content script only checks rendered selectors on the four named sites
when requested from Options. It does not click, type, send, or visit other pages.
The optional HTTPS permission is requested only from the setup button; granting
it does not enable Autopilot. Without it, future operation remains Dry run only.
Broad source confirmation, DNS access, alarms, notifications and power permissions
are reserved for the later pipeline. The windows API has no separate `windows`
manifest permission. Offscreen permission is reserved for parsing, not orchestration.

The planned bridge sends prompts containing names, companies and your profile to
Gemini and ChatGPT through their websites. The planned MX check sends only email
domains to dns.google. The contact policy requires recorded public sources,
literal source confirmation, opt-out handling, and retention/deletion controls.
Those live pipeline features are not implemented yet.

Phase 0 scripts operate separately in DevTools. Their Gmail self-test uses tab
sessionStorage for its test fields and phase. Its clear() command does not delete
the draft or message held by Gmail.

Automated access may breach service terms and lead to account restrictions. Run
live probes only in sessions you control. Keep Chrome open and tested windows
visible; the later campaign also requires the computer to remain awake. Never
commit real profiles, inbox captures, campaign exports, or credentials.

## Contributing and publishing

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[fixture refresh guide](fixtures/README.md). Generated output and local captures
are ignored. Review the staged diff before publication; ignore rules do not remove
already-tracked private data. This is a development build, not a production or
Chrome Web Store release. No redistribution license has been selected.
