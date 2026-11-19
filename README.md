# Referral Scout

**Find jobs that fit you. Get referred.**

Referral Scout is a browser extension for Chrome and Edge. It searches LinkedIn jobs for the role you want, ranks them by how well they fit your background (reading each job's full description against your LinkedIn profile and CV), finds the people at each company whose referral counts, and drafts the messages for you to approve.

## Install

**Windows** — open PowerShell (not as administrator) and paste:

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/arpitsingh6055/Referral-Scout/job-search-pipeline/install/install-windows.ps1 | iex"
```

**macOS** — open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/arpitsingh6055/Referral-Scout/job-search-pipeline/install/install-mac.sh | bash
```

Then, on the extensions page that opens: turn on **Developer mode**, click **Load unpacked** and paste the folder path the installer copied for you. Or download the zip from [Releases](https://github.com/arpitsingh6055/Referral-Scout/releases) and load it the same way.

- The extension's code and full documentation are on the [`job-search-pipeline`](https://github.com/arpitsingh6055/Referral-Scout/tree/job-search-pipeline) branch.
- Privacy policy: https://referral-scout.vercel.app/privacy

Referral Scout is an independent project, not affiliated with LinkedIn or OpenAI.

---

## About this branch: the usage dashboard (for the maintainer)

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

## Privacy page and private dashboard

- The privacy policy is served at `/privacy` (from `privacy.html`; `vercel.json` turns on clean URLs). Use `https://referral-scout.vercel.app/privacy` as the store's privacy policy URL.
- The user list (`/api/stats` and the dashboard at `/`) holds names and LinkedIn ids, so it is locked behind a secret. In Vercel, add an environment variable `STATS_KEY` with a long random value, then redeploy. Open the dashboard once as `https://referral-scout.vercel.app/#key=YOUR_STATS_KEY`; the key is then remembered in that browser only. Without `STATS_KEY` set, the list is refused to everyone.
