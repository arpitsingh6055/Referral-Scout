# Referral Scout — usage tracking

One Vercel project does everything: it records each user and serves a live dashboard.
Your MongoDB connection string lives only in a Vercel environment variable, never in
this repo and never in the extension.

- `api/_db.js`  — shared connection; ensures the collection + unique index exist on first use.
- `api/ping.js` — the extension POSTs `{ id: "<linkedin-handle>" }` here; one row per person.
- `api/stats.js`— returns the live count + user list (read-only); the dashboard calls it.
- `index.html`  — the dashboard; fetches `/api/stats` on load, always current.

The database `Referral_Scout`, the collection `user_details`, and the unique index on
`handle` are all created automatically the first time the app talks to MongoDB
(`createIndex` is idempotent and creates the collection if missing). So there is no
manual table setup in Atlas.

## Setup (about 5 minutes, no server to run)

### 1. MongoDB Atlas
1. Network Access → Add IP → **Allow access from anywhere** (`0.0.0.0/0`). Vercel has no fixed IP.
2. That's it — no collection or index to create by hand; the app does it on first request.
3. You already have the connection string in `atlas-credentials.env` (keep that file gitignored —
   never commit it). It looks like `mongodb+srv://USER:PASSWORD@cluster.xxxx.mongodb.net/...`.

### 2. Vercel
1. Push this `usage-dashboard` branch to GitHub (see bottom).
2. vercel.com → Add New → Project → import the `cold-contact-pro` repo.
3. **Production Branch: `usage-dashboard`** (Settings → Git, if it didn't pick it up).
4. Settings → Environment Variables → add `MONGODB_URI` = your full connection string. Save.
5. Deploy. You get a URL like `https://referral-scout-usage.vercel.app`.
   - Dashboard: open that URL.
   - Write endpoint for the extension: that URL + `/api/ping`.

### 3. Point the extension at it
In the `job-search-pipeline` (main) branch, open `src/background/usage.ts` and set:

```ts
export const USAGE_ENDPOINT = 'https://referral-scout-usage.vercel.app/api/ping';
```

Then rebuild (`pnpm build`). Until the endpoint is set it's a no-op, so nothing is recorded
and nothing breaks.

## How it stays private
The extension only ever sends a LinkedIn handle to `/api/ping`. The database credential
sits in Vercel's env var, which the public extension can't read. The dashboard reads
through `/api/stats`, so the credential never leaves Vercel.

## Push this branch
```
git push --force origin usage-dashboard
```
(Force because it's an isolated/orphan branch with its own history.)
