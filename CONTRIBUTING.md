# Contributing

Thank you for helping improve **Referral Scout**.

## Development Setup

Use **Node.js 22+** (Node 24 recommended) and **pnpm 11.25.0**:

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm check
```

See [docs/development.md](docs/development.md) for the full test matrix, selector maintenance notes, and preview build workflow.

## Code & Security Standards

- **Strict TypeScript:** Respect `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` in `tsconfig.json`.
- **Safety Boundaries (Non-Negotiable):**
  - Preserve `trustedExtension()` sender checks (`src/validators/security.ts`).
  - Keep human-in-the-loop review gates (`submitPolicy: 'review'`, explicit outreach approvals, uncertain submission reconciliation).
  - Never read cookies, passwords, or private tokens, and never bypass CAPTCHAs or site restrictions.
  - Build DOM nodes via `document.createElement` / `textContent` helpers (`src/ui/workbench/dom.ts`), never unsanitized HTML string concatenation.
  - Keep `host_permissions` narrow; any new external integrations belong in `optional_host_permissions`.
- **Clean Repository Rules:**
  - Do not commit `dist/`, `*.zip`, `.docx` binaries, `captures/`, `private/`, or real PII/inbox screenshots.
  - When modifying `package.json` dependencies, commit `pnpm-lock.yaml` in the same change.
  - Every new parser, state-machine transition, validator, or UI workflow requires corresponding tests in `tests/`.

## Submitting Changes

Open a pull request using `.github/pull_request_template.md`, summarizing the problem solved, tests added, and `pnpm check` output.
