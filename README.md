# Referral Scout — usage tracking

This is the **dashboard** branch (`main`). The extension itself lives on the
`job-search-pipeline` branch. One Vercel project (deployed from `main`) does
everything: records each user and serves a live dashboard. Your MongoDB
connection string lives only in a Vercel environment variable — never in this
repo and never in the extension.

- `api/_db.js`  — shared connection; ensures the collection + unique index exist on first use.
- `api/ping.js` — the extension POSTs `{ id: "<linkedin-handle>" }` here; one row per person.
- `api/stats.js`— returns the live count + user list (read-only); the dashboard calls it.
- `index.html`  — the dashboard; fetches `/api/stats` on load, always current.

The database `Referral_Scout`, the collection `user_details`, and the unique index
on `handle` are created automatically the first time the app talks to MongoDB, so
there is no manual table setup in Atlas.

## Setup (about 5 minutes, no server to run)

### 1. MongoDB Atlas
1. Network Access → Add IP → **Allow access from anywhere** (`0.0.0.0/0`). Vercel has no fixed IP.
2. That's it — no collection or index to create by hand; the app does it on first request.
3. Keep your connection string in `atlas-credentials.env` (gitignored — never commit it).
   It looks like `mongodb+srv://USER:PASSWORD@cluster.xxxx.mongodb.net/...`.

### 2. Vercel
1. vercel.com → Add New → Project → import the `Referral-Scout` repo. It deploys the
   default branch (`main`), which is this dashboard — so there is no branch to change.
2. **Framework Preset: Other** (it's a static page + serverless functions, no build step).
3. Environment Variables → add `MONGODB_URI` = your full connection string.
4. Deploy. You get a URL like `https://referral-scout.vercel.app`.
   - Dashboard: open that URL.
   - Write endpoint for the extension: that URL + `/api/ping`.

### 3. Point the extension at it
On the `job-search-pipeline` branch, open `src/background/usage.ts` and set:

```ts
export const USAGE_ENDPOINT = 'https://referral-scout.vercel.app/api/ping';
```

Then rebuild (`pnpm build`). Until the endpoint is set it's a no-op, so nothing is
recorded and nothing breaks.

## How it stays private
The extension only ever sends a LinkedIn handle to `/api/ping`. The database credential
sits in Vercel's env var, which the public extension can't read. The dashboard reads
through `/api/stats`, so the credential never leaves Vercel.
