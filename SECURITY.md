# Security Policy

## Architecture & Threat Model

Referral Scout operates under a strict **local-first, least-privilege Manifest V3** security model:

- **Strict CSP:** `script-src 'self'; object-src 'none'; base-uri 'none'` — zero `eval()`, zero `new Function()`, and zero remotely loaded code in extension bundles.
- **Sender Verification:** Every privileged `chrome.runtime.onMessage` listener verifies extension sender identity via `trustedExtension(sender, chrome.runtime.id)` (`src/validators/security.ts`).
- **Narrow Install Permissions:** Install-time `host_permissions` are limited strictly to `linkedin.com`, `chatgpt.com`, and `mail.google.com`. External ATS/employer websites and optional APIs (`api.openai.com`, `media.licdn.com`) live under `optional_host_permissions` and require explicit runtime user consent.
- **Zero Credential Harvesting:** The extension never reads browser cookies, passwords, or private session tokens, and never auto-bypasses CAPTCHAs, login walls, or rate limits.
- **XSS / Untrusted DOM Isolation:** Workbench views build DOM trees with safe `document.createElement` / `textContent` helpers (`src/ui/workbench/dom.ts`), and host-page overlays use closed Shadow DOM + `CSSStyleSheet` isolation (`src/content/floating-hud.ts`, `src/content/remember.ts`).
- **No Unreviewed External Sends by Default:** Applications pause before final submission (`submitPolicy: 'review'`) and LinkedIn/email drafts require explicit user approval (`gmail-send-gate`, `outreachMode`) unless explicitly opted in.

---

## Supported Version

Security fixes target the latest minor release on the main release line (`v0.58.2`). Always verify builds with:

```bash
pnpm check
pnpm package
```

---

## Reporting a Vulnerability

Use the repository's **Security → Report a vulnerability** advisory flow on GitHub if enabled. If unavailable, open an issue requesting a private reporting channel **without** posting exploit payloads, personal data, session tokens, email lists, or private inbox screenshots.

Include:
- Affected file path(s) and extension version
- Minimal reproduction steps using synthetic test fixtures
- Expected vs. actual security boundary behavior

---

## Maintainer Pre-Publish Security Checklist

1. Confirm `pnpm check` passes (`prettier --check`, `vitest run`, `tsc --noEmit`, Vite MV3 builds, and `scripts/check-build.mjs`).
2. Confirm `scripts/check-build.mjs` reports zero `.map` source maps, matching `package.json`/`manifest.json` versions, and zero forbidden dynamic execution patterns.
3. Verify `referral-scout.zip` contains no untracked `captures/`, `private/`, or credential files before uploading to Chrome Web Store or Microsoft Edge Add-ons.
