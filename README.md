# Referral Scout — usage dashboard

Isolated branch: only the dashboard and its plumbing live here, nothing from the extension.

```
index.html            the page (shows the count + the list of handles)
data.json             the data, rebuilt hourly from MongoDB Atlas
build.mjs             reads Atlas -> writes data.json   (run by the Action)
api/ping.js           the write endpoint (Vercel) that records a user in Atlas
package.json          the mongodb driver, used by both of the above
.github/workflows/usage.yml   the hourly Action (see the note in step 4)
```

## How it fits together

```
extension  --POST { id }-->  Vercel /api/ping  --insert-->  MongoDB Atlas
                                                               |
GitHub Action (hourly)  --read--------------------------------+
        |
        +--> rebuilds data.json --> publishes index.html to GitHub Pages
```

Why a Vercel function and not "extension straight to Mongo": MongoDB removed its Data API / HTTPS endpoints
(end-of-life 30 Sep 2025), and a connection string must never ship inside a public extension (anyone could read or
wipe the database). So one small server-side piece has to hold the credential. Vercel is the least-friction free host
that runs the real Mongo driver.

---

## Step 1 — MongoDB: collection + index (2 min)

In Atlas, create database **Referral_Scout**, collection **user_details**.
**Leave Time-Series OFF** (a plain collection). Then add a unique index so each person is stored once:

- Collection -> Indexes -> Create Index: field `handle`, Options: `{ "unique": true }`.

Also: **Network Access -> Add IP Address -> Allow access from anywhere (0.0.0.0/0)**. GitHub Action and Vercel
runners have no fixed IPs; your username/password still gate access.

## Step 2 — The write endpoint on Vercel (5 min)

1. vercel.com -> sign in with GitHub -> **Add New -> Project** -> import `cold-contact-pro`.
2. Set **Production Branch** to `usage-dashboard` (Project Settings -> Git), so Vercel deploys this branch.
3. **Settings -> Environment Variables**: add `MONGODB_URI` = the value from your `atlas-credentials.env`.
4. Deploy. Your endpoint is `https://<project>.vercel.app/api/ping`.
   Open it in a browser — it should say the endpoint is running.

## Step 3 — Point the extension at it (on the main branch, 2 min)

1. `src/background/usage.ts`:
   `export const USAGE_ENDPOINT = 'https://<project>.vercel.app/api/ping';`
2. `manifest.json` -> add to `host_permissions`: `"https://<project>.vercel.app/*"`
3. Rebuild (`corepack pnpm build`) and reload the extension.

## Step 4 — The hourly dashboard (GitHub Actions + Pages, 3 min)

1. Repo -> **Settings -> Secrets and variables -> Actions -> New repository secret**:
   `MONGODB_URI` = the same connection string.
2. Repo -> **Settings -> Pages -> Source: GitHub Actions**.
3. **Copy `.github/workflows/usage.yml` onto the main branch.** Scheduled workflows only run from the default
   branch, so the hourly trigger fires only when this file is on main. It checks out the usage-dashboard branch for
   the build, so all the logic stays here.
4. Actions tab -> **Usage dashboard (hourly)** -> **Run workflow** once to publish immediately. After that it runs
   every hour. The dashboard is at `https://arpitsingh6055.github.io/cold-contact-pro/`.

## Test

In the extension, accept the consent screen and read your profile. `api/ping` writes your handle to Atlas; at the
next hourly run (or a manual "Run workflow") the dashboard shows the count and your handle.

Reset: delete the documents in user_details.

## Simpler alternative (optional)

Vercel alone can do everything: host index.html, run api/ping, and rebuild hourly with a Vercel Cron — no GitHub
Pages or Action. Use that if you'd rather keep it on one platform. The GitHub-Actions route above is what you asked
for.
