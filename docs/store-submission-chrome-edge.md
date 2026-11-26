# Referral Scout — Chrome Web Store & Microsoft Edge Partner Center Submission Packet (v0.58.2)

**Release Artifacts:** Built & verified via `pnpm check && pnpm package` (`44` Vitest test suites / `738` tests passing, strict `tsc --noEmit`, `scripts/check-build.mjs` MV3 pre-flight validator, and `referral-scout.zip` / `release/referral-scout-v0.58.2-chrome-edge.zip`).

---

## 1. Store Listing Metadata (Ready to Paste)

- **Extension Name:** `Referral Scout — Jobs, Referrals & Autofill` *(45 / 75 chars)*
- **Short Name (`manifest.json`):** `Ref Scout` *(9 / 12 chars — passes Edge & Chrome limit)*
- **Short Summary / Tagline (113 / 132 chars):**
  `Find jobs matching your CV, rank referrers, draft outreach, and autofill applications—always under your review.`
- **Category:** `Productivity`
- **Primary Language:** `English`
- **Homepage / Support URL:** `https://github.com/arpitsingh6055/Referral-Scout`
- **Privacy Policy URL:** `https://referral-scout.vercel.app/privacy` *(canonical source in [`docs/privacy.md`](privacy.md))*

### Single-Purpose Description (Chrome Web Store Policy Statement)

> Referral Scout has a single purpose: helping job seekers organize job searches, identify employee referrers, and manage job applications from a unified local-first browser workspace—with explicit human confirmation before external actions.

### Full Store Description (Chrome Web Store & Edge Add-ons)

> **Manage every job, application, referrer, and reply in one coordinated workspace—without losing context or giving up control.**
>
> Referral Scout is a local-first Chrome & Edge assistant built for students, graduates, and professionals running active multi-company job searches:
>
> **Core Capabilities:**
> - **Opportunity-Centred Workspace:** Inspect each vacancy's Eligibility, CV Fit evidence, Pre-Flight Application Readiness, Application Queue status, Recommended Referrers, Cross-Channel Conversations, Chronological Timeline, and Outcomes in one unified view.
> - **Today's Priorities Command Centre:** A single ranked action feed highlighting replies needing a response, uncertain submissions to confirm, missing application facts, and outreach drafts awaiting approval.
> - **Guided CV & LinkedIn Profile Reconciliation:** Parse PDF/DOCX resumes locally, compare against your LinkedIn background, review Before/After diffs, and save structured profile data and Answer Bank facts.
> - **Smart 3-Tier Answer Bank:** Includes Student / Fresher Smart-Defaults, 1-click chips for work authorization, notice period, and relocation, and Just-in-Time learning as real forms ask new questions.
> - **Company Ranking & Collision-Safe Referrer Outreach:** Identifies relevant connections, alumni, recruiters, and hiring-team members per employer, guards against contacting the same person twice for overlapping roles, and waits for your approval before sending.
> - **Human-in-the-Loop Application Autofill:** Fills LinkedIn Easy Apply and 27+ major ATS portals (Greenhouse, Lever, Workday, Ashby, Workable, Naukri, Instahyre, Wellfound, Zoho Recruit, Keka, Darwinbox, and more), automatically pausing in **Needs You** for logins, security checks, missing answers, or final submission review.
>
> **Private & Safe by Design:**
> - **100% Local Storage:** Your CV, profile, Answer Bank, jobs, contacts, and conversations stay in your browser (`chrome.storage.local` and IndexedDB).
> - **Zero Credential Capture & Zero CAPTCHA Bypass:** Never reads passwords or session cookies, and never automates CAPTCHA/security challenges.
> - **No Unattended Spam:** Applications pause before submit by default (`submitPolicy: 'review'`), and outreach drafts wait for explicit user approval.

---

## 2. Permission-by-Permission & Host Justifications

| Permission / Host Pattern | Store Review Justification (Copy-Paste) |
|---|---|
| **`storage` & `unlimitedStorage`** | Persists the user's local CV text, structured candidate profile, Answer Bank facts, discovered jobs, application queue state, and cross-channel conversation metadata locally inside `chrome.storage.local` and IndexedDB without requiring a cloud account or risking storage eviction. |
| **`sidePanel`** | Renders the compact Referral Scout companion panel beside LinkedIn and ATS job pages so users can check opportunity context, trigger autofill, or approve outreach drafts without losing their active tab. |
| **`scripting` & `tabs`** | Required to open/focus user-initiated workflow tabs (LinkedIn profile read, LinkedIn job search, ChatGPT prompt tab, Gmail reply check, or external ATS portals) and inject the sandboxed autofill / closed-Shadow-DOM HUD scripts only when triggered by the user. |
| **`alarms`** | Schedules periodic background queue lease recovery (`runner.ts`) and paced outreach checks when the MV3 service worker wakes up, avoiding continuous background polling. |
| **`power`** | Requests temporary system wake lock via `chrome.power` strictly while a user-initiated batch application or scan is actively running, and releases it immediately upon pause or completion. |
| **`contextMenus`** | Adds a toolbar right-click menu allowing users to switch their preferred launch surface between the full Workbench tab and the Side Panel. |
| **`notifications`** | Alerts the user only when an active workflow reaches a human-in-the-loop pause gate (e.g., login required, security check, or submission confirmation needed in Today / Needs You). |
| **`host_permissions` (`linkedin.com`, `chatgpt.com`, `mail.google.com`)** | Core supported workflows: reading the signed-in user's profile, job listings, and contacts on LinkedIn (only when initiated by the user); running structured CV/JD reconciliation prompts through the user's own signed-in `chatgpt.com` session; and drafting/checking Gmail replies locally through the signed-in Gmail tab without requesting restricted Gmail REST API OAuth scopes. |
| **`optional_host_permissions` (`api.openai.com`, `media.licdn.com`, `https://*/*`, `http://*/*`)** | Never granted at install. Requested strictly per-origin at runtime via browser permission prompt: `api.openai.com` only if the user enters their own OpenAI API key; `media.licdn.com` only if they opt to use their LinkedIn photo; and `https://*/*` / `http://*/*` strictly for the single employer/ATS origin where the user clicks **"Fill this application"**. |

---

## 3. Privacy Practices & Data Usage Questionnaire Answers

### Chrome Web Store Privacy Tab & Edge Partner Center Data Disclosures
- **Does your extension collect or use user data?**
  - **Yes (Local Processing Only):** All candidate profile, CV, job, contact, and conversation data is stored and processed **locally on the user's device** (`chrome.storage.local` + IndexedDB).
  - **Optional Opt-In Ping (Off by Default):** Only if the user explicitly enables *"Allow one-time usage counting"* in Settings does the extension send a single anonymous install UUID (`uid`) and LinkedIn display name/handle to `https://referral-scout.vercel.app/api/ping`. No CV, email, phone, job, or message data is ever sent.
- **Data Categories Checked (Handled Locally on User Initiation):**
  - **Personally identifiable information:** Local Candidate Profile (name, email, phone, address) entered or uploaded by the user solely for autofilling their own job applications.
  - **Website content:** Job descriptions and employer/ATS form fields read strictly when the user triggers discovery or autofill on that page.
  - **Personal communications:** Only when the user triggers Gmail reply sync or LinkedIn outreach, read locally inside their own browser tab to match replies to tracked job opportunities.
- **Limited Use & Non-Sale Certifications (Check ALL 3):**
  1. **I do not sell or transfer user data to third parties**, outside of the approved use cases.
  2. **I do not use or transfer user data for purposes that are unrelated to my item's single purpose.**
  3. **I do not use or transfer user data to determine creditworthiness or for lending purposes.**

---

## 4. Reviewer Testing Instructions (Offline / No-Login-Required Walkthrough)

Store reviewers do **not** need a private LinkedIn account, Gmail account, or paid ChatGPT Plus subscription to verify the extension's core functionality:

1. **Install & Open Workbench:** Load the unpacked extension or install from `.zip`. Click the **Referral Scout** toolbar icon → click **Open setup dashboard** (or **Expand in Full Workbench →**) to open `workbench.html`.
2. **Test Offline CV Upload & Profile Review:**
   - Navigate to **Profile** (`#profile`) → upload any sample PDF/DOCX resume (or paste resume text).
   - Verify local PDF.js extraction works entirely offline with zero external network calls.
3. **Test Answer Bank & Pre-Flight Readiness:**
   - Navigate to **Answer Bank** (`#answers`) → click **Student / Fresher Mode** or toggle 1-click chips (`Work authorization`, `Notice period`, `Relocate`).
   - Verify values save immediately to IndexedDB and persist across page reloads.
4. **Test Campaign Creation & Command Centre:**
   - Navigate to **Campaign** (`#setup`) → create a sample campaign (e.g., *"Product Intern"*, *"Remote"*).
   - Navigate to **Overview / Today** (`#overview`), **Jobs** (`#jobs`), **Applications** (`#applications`), **People & Conversations** (`#people`), and **Outcomes** (`#activity`) to verify every screen renders cleanly without console errors or crashes when LinkedIn/ChatGPT/Gmail are disconnected.
5. **Verify Safety & Reset Controls:**
   - Navigate to **Settings** (`#settings`) → verify **Export a backup** downloads a clean JSON backup (excluding API keys) and **Delete everything** cleanly wipes all local IndexedDB + `chrome.storage` state.

---

## 5. Store Visual Asset Checklist

| Asset | Required Dimensions | Format & Alpha Rule | Status |
|---|---|---|---|
| **Extension Icon** | `16x16`, `32x32`, `48x48`, `128x128` | PNG | Verified in `public/icons/` & `dist/icons/` |
| **Store Screenshots (1–5)** | `1280x800` or `640x400` | PNG or JPEG, **NO alpha/transparency** | `docs/screenshots/*.png` verified `alpha=false` (600x1500 README previews; export 1280x800 captures for Store upload) |
| **Small Promo Tile** | `440x280` | PNG or JPEG, **NO alpha/transparency** | Required before Chrome Web Store publish |
| **Marquee Promo Tile (Optional)** | `1400x560` | PNG or JPEG, **NO alpha/transparency** | Optional for featured placement |
