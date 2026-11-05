# Phase 1 checkpoint

## Build

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

Expected: Phase 0 tests and Vitest tests pass, TypeScript reports no errors, and
the build checks confirm MV3 entry points. There is no live-site test in CI.

## Chrome

1. Open chrome://extensions, enable Developer mode, Load unpacked, select dist/.
2. Click the extension icon; the side panel must say Phase 1 and show Open settings.
3. Save a complete profile with a proof point such as `P1 | Built a dashboard used
   by 20 teams`. Reload Options; values should persist. Use your own real profile
   only in Chrome settings, not in checked-in source files.
4. Try daily cap 26, pattern cap 4, a javascript: resume URL, duplicate P1 entries,
   or an invalid holiday. Save must reject them without overwriting saved values.
5. Confirm Dry run is fixed and no Start campaign/Send button is exposed.
6. Without optional HTTPS permission, confirm the Dry run only notice. Click the
   permission button only if you want to test the browser grant flow. Denial must
   leave settings usable; granting must not switch modes.
7. Reload the four site tabs. Open LinkedIn company results, Gmail with an empty
   compose, and provider chats. Click Check selectors in open tabs. It must report
   missing contexts/controls explicitly and must not click, insert, or send.
8. Inspect the extension service worker in chrome://extensions. In DevTools under
   Application > IndexedDB, cold-contact-pro should contain company, person, email,
   role, draft, send, event, and meta stores. The last health report is in meta.

Health checks only cover the stated page context. Provider send/search/temporary
controls are configuration candidates until Phase 2 tests them. Live login walls
that redirect to an unpermitted host are reported as inaccessible tabs.

## Three likely issues

- No receiver for a health request: reload the site tab after installing/updating.
- Missing Gmail From or company cards: expose the relevant page context and report
  the missing selector; do not relax sender verification to get a PASS.
- Dependency/build failure: use Node.js 24 and pinned pnpm 11.25.0, then reinstall
  with the checked-in lockfile. Include the first error in your report.

## Interpretation decisions

- A 15-minute call is an explicit exception to proof-point-only body numbers.
- The selected proof point must appear verbatim once, making its presence testable.
- Follow-ups will contain no URLs; the original thread already has the resume link.
- Steps that send, infer an address, or approve Autopilot are not available here.
- Phase 0 live results remain pending, as requested progression is not a PASS report.

Report: build PASS/error; Chrome load PASS/error; settings persistence PASS/error;
invalid settings rejection PASS/error; permission behavior; and each site's health
result with any missing selector. Redact personal information. Phase 2 follows this
checkpoint.
