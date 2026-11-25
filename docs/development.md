# Development, Testing & Release Guide

## 1. Prerequisites

- **Node.js:** `22.0.0+` (CI runs Node `24`)
- **Package Manager:** `pnpm@11.25.0` (`corepack enable` or `npm i -g pnpm@11.25.0`)
- **Browsers for local testing:** Google Chrome (`120+`) or Microsoft Edge (`120+`)

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
```

---

## 2. NPM Scripts Reference ([`package.json`](../package.json))

| Script | Command | Purpose |
| --- | --- | --- |
| `pnpm format` | `prettier --write src tests scripts` | Auto-format source, test, and release scripts |
| `pnpm format:check` | `prettier --check src tests scripts` | Verify formatting compliance |
| `pnpm typecheck` | `tsc --noEmit` | Strict TypeScript check (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) |
| `pnpm test` | `vitest run` | Execute all `43` unit & integration suites (`713` tests in `jsdom` + `fake-indexeddb`) |
| `pnpm build` | `tsc && vite build (client/content/apply) && check-build.mjs` | Build production MV3 `dist/` and verify CSP, versions, icons, PDF worker, zero `.map` leaks |
| `pnpm check` | Format + Test + Typecheck + Build + Audit | Full local & CI verification gate |
| `pnpm package` | `pnpm build && node scripts/package-extension.mjs` | Create `referral-scout.zip` from verified `dist/` with SHA-256 verification |
| Preview build | `npx vite build --mode preview` | Build standalone Workbench preview (`preview/`) with synthetic fixtures |

---

## 3. Testing & Fixture Discipline

- Unit & UI integration tests live in [`tests/`](../tests/) (`43` files, `713` tests):
  - **Domain & State Machines:** `application-task.test.ts`, `allocator.test.ts`, `facts.test.ts`, `exceptions.test.ts`, `job.test.ts`, `profile.test.ts`, `outreach.test.ts`, `runner.test.ts`.
  - **Storage & Draft Safety:** `storage.test.ts`, `profile-draft-save.test.ts`, `message-validation.test.ts`, `security.test.ts`.
  - **Parsers, Prompts & Content Automation:** `apply.test.ts`, `linkedin-connect.test.ts`, `chatgpt-hydration.test.ts`, `chatgpt-2026-markup.test.ts`, `gmail-parser.test.ts`, `gmail-send-gate.test.ts`, `jobsearch.test.ts`.
  - **Workbench & Side Panel UI:** `workbench-ux.test.ts`, `sidepanel.test.ts`, `reset-sync.test.ts`, `button-progress.test.ts`.
- Never test against personal accounts or commit live inbox/profile fixtures in PRs. Put private local captures inside ignored `captures/` or `private/` folders.

---

## 4. Selector & Host Overlay Maintenance

- Structural hooks for LinkedIn, Gmail, and ChatGPT live centrally in [`src/shared/selectors.config.ts`](../src/shared/selectors.config.ts).
- Host overlays injected onto external web pages (**Remember button** in [`src/content/remember.ts`](../src/content/remember.ts) and **Floating Page HUD** in [`src/content/floating-hud.ts`](../src/content/floating-hud.ts)) must use:
  - Closed Shadow DOM (`attachShadow({ mode: 'closed' })`)
  - Constructable `CSSStyleSheet` (`adoptedStyleSheets`)
  - Custom element tags (never bare `<div style="z-index:...">` so ad blockers and site CSP Trusted Types rules never strip or break them).

---

## 5. Pre-Publish Store Checklist

1. Ensure [`package.json`](../package.json), [`manifest.json`](../manifest.json), [`install/install-mac.sh`](../install/install-mac.sh), [`install/install-windows.ps1`](../install/install-windows.ps1), and [`CHANGELOG.md`](../CHANGELOG.md) share the exact same version.
2. Run `pnpm check` and confirm zero errors or warnings.
3. Run `pnpm package` to build `referral-scout.zip` and verify the printed SHA-256 hash.
4. Load `dist/` unpacked in `chrome://extensions` and `edge://extensions` for smoke verification using the reviewer steps in [`docs/store-submission.md`](store-submission.md).
