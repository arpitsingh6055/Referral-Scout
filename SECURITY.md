# Security

This project is in a feasibility stage. There is no production release or security
support commitment yet. Only the current code on the default branch is maintained.

## Reporting a vulnerability

Use the repository's Security > Report a vulnerability option if it is enabled.
If that option is unavailable, open a public issue requesting a private reporting
channel without including exploit details, personal data, or secrets. Do not post
credentials, cookies, session tokens, real recipient lists, or mailbox contents.

Include the affected file, reproduction steps using synthetic data, expected
behavior, actual behavior, and whether a message might already have been sent.

## Maintainer publication checklist

- Enable GitHub private vulnerability reporting before inviting public reports.
- Enable available secret-scanning and push-protection features.
- Require the Extension checks workflow before merging changes to the default branch.
- Review dependency and Actions updates before merging them.
- Review staged files for private data; ignore rules are not a security scanner.
- Keep CI read-only and independent of logged-in personal accounts.

