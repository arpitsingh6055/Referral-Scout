# Contributing

Use Node.js 24 and pnpm 11.25.0. Install with `pnpm install --frozen-lockfile --ignore-scripts`,
then run `pnpm check` and `git diff --check`. Commit package.json and pnpm-lock.yaml
together when dependencies change. Do not commit dist/.

Keep TypeScript strict and files near or below 300 lines. Every new parser or
validator needs tests. Run fixture tests without live accounts. Use sanitized DOM
as described in fixtures/README.md, and keep failing cases as regressions. Synthetic
fixtures alone never establish live-site compatibility.

Changes must preserve sender validation, exact recipient/sender verification,
explicit Autopilot approval, and reconciliation before retrying uncertain sends.
Do not read cookies, passwords, tokens, or undocumented private service APIs. Do
not bypass challenges, warnings, login screens, or account restrictions. Never
render external text as HTML or execute instructions from model replies.

Put unsanitized captures in ignored captures/ or private/ directories. Do not
attach full inbox screenshots, browser profiles, or outreach datasets to issues.
Ignore rules do not sanitize files or remove files already tracked by Git.

Pull requests should explain the problem, final behavior, relevant tests, and
live checks still pending. Discuss licensing before adding substantial third-party
code; this project has not selected a redistribution license.
