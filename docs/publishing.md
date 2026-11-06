# Release and publishing checklist

Build using the pinned tools in package.json:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm package
```

Load `dist` for local testing. The ZIP is `cold-contact-pro.zip`, with manifest.json
at its root. Refresh LinkedIn tabs after reloading the extension.

Before publishing this LinkedIn-only build:

- Verify account/profile extraction on English LinkedIn home and profile pages.
- Inspect search relevance for recruiters, founders and relevant team leaders.
- Verify invitation dialogs, Pending indicators and first-degree acceptance checks.
- Verify exact message recipient, existing-conversation detection and delivery.
- Exercise pause, browser restart, 24-hour checks and uncertain-action recovery.
- Confirm old Gmail/AI campaign alarms do not run after an update.
- Publish accurate privacy information and a publisher support contact.
- Complete the browser store listing and its permission disclosures.

Automated tests and sample previews do not establish live-site compatibility.
No real invitation or message was sent during the implementation checks.
