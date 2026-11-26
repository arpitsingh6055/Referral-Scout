# Referral Scout Privacy Policy (v0.58.2)

**Effective Date:** 25 November 2026  
**Product:** Referral Scout (Chrome & Edge Manifest V3 Browser Extension)  
**Published Policy URL:** https://referral-scout.vercel.app/privacy

Referral Scout is built on a **local-first, user-controlled architecture**. There is no proprietary Referral Scout cloud account, database, or ad-tracking SDK. Your personal profile, CV files, job search targets, contacts, and application history remain in browser storage on your device unless you explicitly initiate an action using your own third-party sessions (LinkedIn, ChatGPT/OpenAI, Gmail, or a target employer's application portal).

---

## 1. Data Stored Locally on Your Device

Referral Scout stores the following records locally inside your browser (`chrome.storage.local` and extension-owned IndexedDB stores):

- **Candidate Profile & Documents:** Uploaded PDF/DOCX CV files and extracted text, plus your structured identity (name, email, phone, location, LinkedIn/portfolio URLs), education history, work experience, projects, and skills.
- **Answer Bank & Learned Application Responses:** Reusable factual answers (such as work authorization by country, notice period, start date, compensation expectations, and responses remembered when you answer an application prompt). Sensitive diversity/EEO disclosures (gender, disability, veteran, ethnicity) and legal signatures are never inferred from your CV.
- **Job Discovery, Opportunity Workspaces & Campaign Records:** Target roles, locations, discovered job listings, fit assessments, shortlisted roles, company priority pins, pre-flight readiness checks, opportunity notes/outcomes, and queued/submitted application states.
- **Referral Outreach & Cross-Channel Conversations:** Publicly visible profile details of target referrers read from LinkedIn pages you visit/scan, draft outreach notes awaiting your approval, invitation/follow-up timestamps, and locally matched LinkedIn/Gmail conversation thread metadata (`conversations` and `outreach` IndexedDB stores).

**Retention & Deletion Controls:**  
You retain full control of your data. In **Workbench → Settings**, you can export a local JSON backup (`Export data`, which deliberately excludes any optional OpenAI API key), delete your saved CV (`Delete CV`), suppress individual contacts permanently, or wipe all local extension data at once (`Delete everything`). Uninstalling the extension removes browser-managed storage.

---

## 2. Website Sessions & External Transfers You Initiate

Referral Scout never collects or stores your LinkedIn, Google/Gmail, or ChatGPT passwords, authentication cookies, or OAuth refresh tokens. Instead, it operates only through tabs/windows inside your own browser session when you trigger a feature:

- **LinkedIn (`linkedin.com`):** Only after you sign in yourself and start profile reading, job discovery, or referral outreach, Referral Scout reads the visible page elements needed for that task. By default, invitation/message drafts wait for your approval.
- **AI Assistance (`chatgpt.com` or Optional OpenAI API Key):**
  - By default, AI tasks (CV-to-LinkedIn profile reconciliation, job ranking, form field mapping) send only the relevant task prompt and text context through your own signed-in ChatGPT web tab. Raw binary PDF/DOCX attachments are never sent in prompts.
  - If you optionally configure your own OpenAI API key in Settings (`https://api.openai.com/*`), task prompts are sent directly from your browser to OpenAI under your API billing account.
- **Gmail (`mail.google.com`):** Connecting Gmail is optional and not required for job search or LinkedIn workflows. When enabled, Referral Scout interacts strictly with your signed-in Gmail tab to draft messages and check reply status without requesting restricted Gmail API scopes.
- **Employer & ATS Application Portals:** When you click **Fill this application** on an external careers page, your browser prompts you to grant access for that specific site origin (`optional_host_permissions`), fills fields with your saved profile/answers, attaches your CV when requested, and pauses before final submission under the default Review policy.

---

## 3. Optional Anonymous Usage Counting (Off by Default)

Optional one-time usage reporting is **disabled by default** and is never required to use any extension feature.

- If you explicitly opt in (**Settings → Allow one-time usage counting**), the extension transmits a single event to `https://referral-scout.vercel.app/api/ping` containing:
  - A randomly generated per-install identifier (`uid`)
  - Your LinkedIn display name (`name`)
  - Your LinkedIn public handle (`id`)
- **Excluded data:** Usage reporting never includes your CV file or text, email address, phone number, jobs, contacts, outreach drafts, or application history.
- You may disable this setting at any time in Settings to prevent any future transmission.

---

## 4. Chrome Web Store Limited Use & Non-Sale Commitment

Referral Scout complies with browser extension user-data policies:
- We **never** sell, rent, broker, or transfer user data to third parties, data brokers, or advertising networks.
- We **never** use your CV, inbox, browsing history, or profile data for targeted advertising, creditworthiness, or unrelated AI model training.
- Human access to user data does not occur because no user content leaves your device to a Referral Scout server (except the strictly minimal, opt-in install ping described in Section 3).

---

## 5. Contact

Questions, deletion requests, or privacy inquiries: open an issue at the project repository (`https://github.com/arpitsingh6055/Referral-Scout/issues`).
