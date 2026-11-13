# Referral Scout — usage tracking (Vercel Blob)

This is the **dashboard** branch (`main`); the extension lives on `job-search-pipeline`.
One Vercel project does everything, using **Vercel Blob** for storage — no database,
no connection string, no IP allowlist.

- `api/ping.js`  — the extension POSTs `{ uid, name, id }`; stored as `users/<id>.json` (one file per person).
- `api/stats.js` — lists those files for the live count and reads each for the table.
- `index.html`   — the dashboard; shows the count, each person's name + LinkedIn link, and first-seen date.

Each person is one blob keyed by their LinkedIn id, so re-pinging never double-counts and
there are no write races. Fields stored: `uid`, `name`, `linkedin_id`, `at` (first-seen ms).

## Setup

### 1. Create a Blob store and connect it
Vercel → your project → **Storage** (or the team **Stores** page) → Create → **Blob** →
connect it to the `referral-scout` project. Vercel injects `BLOB_READ_WRITE_TOKEN`
automatically — nothing to copy.

### 2. Redeploy
Env/token changes only apply to new deployments: Deployments → latest → ⋯ → **Redeploy**.
Then open the dashboard URL — it shows the count (0 at first). If the token is missing it
now says so instead of showing a blank 0.

### 3. Point the extension at it (already set on `job-search-pipeline`)
`src/background/usage.ts` has `USAGE_ENDPOINT = 'https://referral-scout.vercel.app/api/ping'`.
Rebuild (`pnpm build`) and reload the extension.

## Privacy note
Blob files are public-read (unguessable base URL, but not secret). They hold public
LinkedIn display names and handles only — no private data, no credentials.
