# Referral Scout — Chrome Web Store & Microsoft Edge Add-ons Submission Packet (v0.58.2)

**Verified Release Artifact:** Build cleanly with `pnpm check && pnpm package` (all `43` Vitest suites / `713` tests passing; `dist/` checked via `scripts/check-build.mjs`; architecture documented in [docs/architecture.md](architecture.md)).

---

## 1. Store Listing Metadata

- **Extension Name:** `Referral Scout — Jobs, Referrals & Autofill`
- **Short Name:** `Referral Scout`
- **Tagline / Short Description (113 chars, <=132 limit):**  
  `Find jobs matching your CV, rank referrers, draft outreach, and autofill applications—always under your review.`
- **Category:** Productivity
- **Languages:** English
- **Privacy Policy URL:** `https://referral-scout.vercel.app/privacy` *(mirrors [`docs/privacy.md`](privacy.md))*

### Single-Purpose Description (Chrome Web Store Policy Statement)
> Referral Scout has a single purpose: helping job seekers discover relevant roles, organize their application materials from their own CV/LinkedIn background, request referrals, and autofill job application forms locally inside their browser—with human confirmation before external actions.

### Detailed Store Description
> **Spend less time re-typing forms and hunting for warm intros—without giving up control.**
>
> Referral Scout is a local-first Chrome & Edge assistant built for students, interns, and professionals managing active job searches:
>
> **What Referral Scout helps you do:**
> - **Guided CV & LinkedIn Review:** Upload your PDF or DOCX CV locally, compare it side-by-side against your signed-in LinkedIn profile using your own ChatGPT session (or optional OpenAI API key), resolve any differences in seconds, and save clean structured experience, education, and skills.
> - **Fit-Ranked Job Discovery:** Searches LinkedIn Jobs across related titles and ranks roles transparently against your actual CV requirements—showing why a job fits and what is missing.
> - **Smart 3-Tier Answer Bank:** Designed with a Student / Fresher Smart-Default preset, 1-click chips for availability/work authorization/relocation, and Just-in-Time learning that remembers new answers once as real forms ask.
> - **Company Ranking & Referrer Outreach:** Identifies relevant connections, alumni, recruiters, and hiring-team members per employer, lets you Pin/Boost target companies, drafts personalized notes, and enforces safe weekly budgets.
> - **Human-in-the-Loop Application Autofill:** Fills Easy Apply and 27+ major ATS portals (Greenhouse, Lever, Workday, Ashby, Workable, Naukri, Instahyre, Wellfound, Zoho Recruit, Keka, Darwinbox, and more) step-by-step, automatically pausing in the **Needs You** inbox for logins, CAPTCHAs, unfamiliar questions, or final review.
>
> **Built Private & Safe by Design:**
> - Your CVs, profile, answers, jobs, and outreach records stay locally in your browser (`chrome.storage.local` + IndexedDB).
> - Zero password capture, zero CAPTCHA solving, zero hidden background telemetry (optional anonymous install ping is strictly opt-in and off by default).

---

## 2. Permission Justification Table (For Dashboard Review Form)

| Permission / Host Pattern | Justification Ready to Paste |
| --- | --- |
| **`storage` & `unlimitedStorage`** | Stores the user's local CV text/attachments, structured candidate profile, Answer Bank facts, discovered jobs, application queue state, and progress HUD state directly on-device via `chrome.storage.local` and IndexedDB without size eviction or requiring a proprietary cloud server. |
| **`sidePanel`** | Renders Referral Scout's compact side-panel companion beside LinkedIn and job application pages so users can trigger "Fill this application", approve referral drafts, or inspect live progress without switching windows. |
| **`scripting` & `tabs`** | Required to open/focus user-initiated background work tabs (LinkedIn profile read, LinkedIn job search, ChatGPT prompt tab, Gmail draft check, or external ATS application tabs) and inject the sandboxed autofill / HUD scripts when the user initiates an action. |
| **`alarms`** | Drives periodic background queue scheduling (`runner.ts` lease recovery / stalled-tab cleanup) and paced outreach intervals when the MV3 service worker wakes up, avoiding continuous polling. |
| **`power`** | Keeps the system awake cleanly via `chrome.power` only while a user-initiated batch application/scan session is actively running, and releases wake locks on pause or completion (`service-worker.ts`). |
| **`contextMenus`** | Registers the toolbar/right-click context menu allowing users to switch their preferred launch surface (`Side Panel` vs. `Dashboard Tab`). |
| **`notifications`** | Notifies the user when a running workflow encounters a human-in-the-loop pause gate (e.g., CAPTCHA, login needed, or submission confirmation required in "Needs you"). |
| **`host_permissions` (`linkedin.com`, `chatgpt.com`, `mail.google.com`)** | Core supported destinations: reading the signed-in user's profile/job search/referral contacts on LinkedIn (only on user trigger), submitting structured prompts via the user's own signed-in `chatgpt.com` session, and drafting/checking Gmail replies without requesting broad Gmail REST API OAuth scopes. |
| **`optional_host_permissions` (`api.openai.com`, `media.licdn.com`, `https://*/*`, `http://*/*`)** | Never granted at install. Requested strictly per-origin at runtime: `api.openai.com` only if the user enters a personal OpenAI API key; `media.licdn.com` only if they opt to use their LinkedIn photo on forms; and `https://*/*` / `http://*/*` strictly via Chrome's permission prompt for the single employer/ATS site where the user clicks **"Fill this application"**. |

---

## 3. Chrome Web Store Privacy Practices Disclosure Matrix

> **Does your extension collect user data?**
> Note: Chrome Web Store distinguishes "transmitted off-device" vs. local-only storage. Complete the CWS Privacy tab as follows:

| CWS Disclosure Field | Exact Answer | Justification / Scope |
| --- | :---: | --- |
| **Personally Identifiable Information** *(Name, email, phone, address)* | **Stored locally on device** *(Only sent to third-party ATS sites the user chooses to apply to, or optional opt-in display name ping if enabled)* | Saved strictly in browser IndexedDB/`chrome.storage.local` to fill job applications the user initiates. Opt-in ping (`off` by default) excludes email/phone/CV. |
| **Authentication Information** *(Passwords, credentials, cookies)* | **NO (Not Collected)** | Never reads or transmits passwords, cookies, or OAuth tokens; uses user's existing logged-in browser tabs. |
| **Personal Communications** *(Emails, chats)* | **NO centralized collection** *(Read/drafted locally inside user's signed-in Gmail/LinkedIn tabs only upon explicit trigger)* | Never stored or forwarded to Referral Scout servers. |
| **Website Content / Browsing History** | **Only active target job/profile pages when triggered** | Never tracks general browsing history or passive pages. Only reads job/profile DOM when the user opens a job search or clicks Fill. |
| **Financial / Payment / Health Info** | **NO (Not Collected)** | No payment or health fields collected or stored. |
| **3 Limited-Use Certifications** *(No sale, no ads, no unrelated use, no human reading)* | **YES — All Certified** | Zero ads, zero data brokers, zero model training on Referral Scout servers. |

---

## 4. Human Reviewer Testing Instructions

To evaluate **Referral Scout** without needing to configure paid API keys or bypass external login walls:

1. **Install & Open Workbench:** Load the unpacked extension (or install `.zip`), click the extension icon to open the **Side Panel**, then click **Open Dashboard** (`workbench.html`).
2. **Guided Onboarding (No Login Required for Initial UI & Local Storage Checks):**
   - Navigate to **Candidate Profile** (`#profile`) or **Set up** (`#welcome`).
   - Upload any sample `.pdf` or `.docx` resume in **Documents / CV Upload**. Verify local text extraction progress appears in both the page card and the bottom `<FloatingProgressHUD />` without sending files to any external server.
3. **3-Tier Student-Friendly Answer Bank (`#answers`):**
   - Open **Answer Bank** from the sidebar. Observe the top safety-net notice, Tier 1 Core Essentials with 1-click pill presets (`Immediate`, `Yes`, etc.), and click **`Apply Student Smart-Defaults →`** to verify instant persistence across reloads.
4. **Campaign Setup, Needs You & Safety Boundaries (`#setup`, `#needs-you`, `#settings`):**
   - Create a sample campaign (e.g., `Product Intern`, `Remote`). Verify the 6-stage Floating HUD updates its stage and next action label dynamically.
   - Check **Settings** (`#settings`) to inspect the optional usage-reporting toggle (confirmed **OFF** by default), local **Export data** backup JSON, and **Delete everything** full storage reset.
5. **Live Optional Site Flows (When Signed In):**
   - Sign in on `linkedin.com` and `chatgpt.com` in test browser tabs, then click **Read LinkedIn Profile** / **Start Guided AI Review** / **Find Jobs** to observe human-in-the-loop pause gates (`Needs you` & `Review` policies) ensuring zero silent submissions.

---

## 5. Package & Store Visual Asset Checklist

- **Icons Declared & Present in Package (`dist/icons/`):**
  - `icon16.png` (`16×16`)
  - `icon32.png` (`32×32`)
  - `icon48.png` (`48×48`)
  - `icon128.png` (`128×128`)
- **Existing Screenshots in [`docs/screenshots/`](screenshots/):**
  - `home.png`, `tracker.png`, `jobs.png`
- **Recommended Store Graphic Sizes for CWS & Edge Upload Dashboard:**
  - Screenshots (`1280×800` or `640×400` PNG/JPEG, no alpha channel) showcasing: (1) Overview Launchpad + 6-Stage HUD, (2) Guided CV Review Before/After Diffs, (3) 3-Tier Answer Bank + Student Presets, (4) Jobs Fit Breakdown + Company Pin Boost, (5) Needs You Inbox + Side Panel Fill.
  - Small Promo Tile: `440×280` PNG.
