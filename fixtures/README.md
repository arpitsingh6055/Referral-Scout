# Fixture provenance and refresh

These Phase 1 DOM snapshots are synthetic, minimal selector contracts, not captures
from the user's logged-in sites. They validate deterministic extraction and health
logic; they do not establish compatibility with current live pages. Each site has
a fixture read by tests/health.test.ts; source.html is read by tests/email.test.ts.
replies.json is read by tests/json.test.ts.

To refresh after a live failure:

1. Inspect the affected rendered component in Chrome DevTools.
2. Copy only that component's outerHTML into an ignored captures/ file.
3. Remove names, addresses, account and thread IDs, tokens, script contents,
   hidden inputs, tracking values, and private message text.
4. Replace remaining personal data with synthetic names and example.com addresses.
5. Keep structural classes, roles and accessible labels needed by selectors.
6. Save the sanitized component in the matching fixture and record the observed
   date, UI language, page context and changed selectors in the pull request.
7. Run pnpm check and rerun the read-only Options selector check on the live page.

Never copy an entire mailbox or browser profile into this repository. Keep failing
fixtures as regression cases instead of replacing every fixture with happy paths.
