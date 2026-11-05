# Contributing

Keep changes small and describe the observed problem, final behavior, and checks.
Do not claim live-site support based only on fixture tests.

## Local checks

Use Node.js 24. Phase 0 has no dependencies or build step.

```sh
node --test spike/parsers.test.cjs
node --check spike/llm.js
node --check spike/gmail.js
node --check spike/linkedin.js
git diff --check
```

Keep parser tests alongside the current probes. Later phases will introduce strict
TypeScript, Vitest, sanitized DOM snapshots, and a locked dependency manifest.
Use synthetic names, example domains, and invented message text in fixtures.
Put unsanitized local captures under ignored captures/ or private/ directories.
Ignore rules do not sanitize files or remove files already tracked by Git.

## Behavioral requirements

- Never read credentials, cookies, or authentication tokens.
- Read rendered UI; do not use undocumented private service APIs.
- Do not bypass challenges, warnings, or sending restrictions.
- Do not retry an uncertain send without reconciling the original attempt.
- Keep external text out of HTML rendering and executable code.
- Preserve explicit user control over live sending.
- Never run logged-in browser tests in GitHub Actions.

## Pull requests

Explain what changed, how it was verified, and any live checks still pending.
Include sanitized reproduction details for selector changes. Never attach full
inbox screenshots, session exports, browser profiles, or real outreach datasets.
Discuss licensing before contributing substantial third-party code; this project
does not currently have a redistribution license.

