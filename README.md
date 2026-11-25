<div align="center">

<img src="public/icons/icon128.png" alt="Referral Scout" width="84" height="84" />

# Referral Scout

**Find jobs that match your CV, prioritize target companies, line up referrers, and autofill applications—always under your review.**

[![MV3 Extension](https://img.shields.io/badge/Manifest-V3-5b5bd6)](#architecture)
[![Node 22+](https://img.shields.io/badge/Node-22%2B-10b981)](#for-developers)
[![Tests](https://img.shields.io/badge/Vitest-43%20suites%20%E2%80%A2%20713%20tests-0ea5e9)](#verification--packaging)

**[Install on Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/referral-scout-jobs-and-/lhfibhgokebhefdagadklckepkbbljhc)** · **[Privacy Policy](docs/privacy.md)** · **[Store Submission Packet](docs/store-submission.md)** · **[Architecture](docs/architecture-v2.md)**

</div>

<p align="center">
  <img src="docs/screenshots/home.png" alt="Side Panel Home" width="260" />
  &nbsp;
  <img src="docs/screenshots/tracker.png" alt="Live Progress & Referral Tracker" width="260" />
  &nbsp;
  <img src="docs/screenshots/jobs.png" alt="Jobs and Referrers per Company" width="260" />
</p>

---

## Core Capabilities

- **Guided CV & LinkedIn Review (`src/ui/workbench/components/guided-review.ts`):** Upload a PDF or DOCX CV and read your signed-in LinkedIn profile locally. ChatGPT compares both (giving CV priority on conflicts), highlights Before/After differences, and commits verified fields atomically into your Candidate Profile and Answer Bank only after you click **Accept & Apply**.
- **6-Stage Floating Progress HUD (`src/shared/progress-store.ts`):** Persistent cross-context bottom HUD synchronized via `chrome.storage.local` across Workbench tabs, Side Panel, and host pages (closed Shadow DOM). Guides you across stages (`Connect LinkedIn` → `CV AI Review` → `Target Role` → `Find Jobs` → `Needs You / Shortlist` → `Queue & Referrals`).
- **CV-Ranked Job Discovery & Application Queue:** Searches LinkedIn Jobs across parallel role titles, filters out mismatches and spam, scores fit against your CV, and runs an unattended, lease-backed application queue supporting LinkedIn Easy Apply and **27+ external ATS portals** (Greenhouse, Lever, Workday, Ashby, SmartRecruiters, iCIMS, BambooHR, Workable, Recruitee, Teamtailor, Naukri, Instahyre, Wellfound, Zoho Recruit, Keka, Darwinbox, Personio, and more).
- **Transparent Company Ranking & Pin Boost (`src/shared/scoring/allocator.ts`):** Ranks target employers and contacts with plain-English score breakdowns (`Relationship`, `Role relevance`, `Hiring relevance`, `Opportunity fit`, `Evidence`) and 1-click **Pin company** boosts that prioritize outreach slots and bypass cooldown delays.
- **Human-in-the-Loop "Needs You" & Answer Bank (`src/ui/workbench/screens/answers.ts`):** Automatically pauses an application (without blocking the queue) whenever it hits sign-in, CAPTCHA/security challenges, final submission review, or unknown fields. Includes a **3-Tier Student-Friendly Answer Bank** with 1-click pill presets, **Student Smart-Defaults**, country-scoped authorization, and Just-in-Time learning from forms.
- **Dual-Engine Safety & Pacing:** Separates the Application Engine from the LinkedIn Referral Engine, respects daily/weekly limits and random pauses, never auto-solves CAPTCHAs, and never submits unreviewed forms unless you explicitly opt in.

---

## End-to-End User Flow

```mermaid
flowchart LR
  S1["1. Connect LinkedIn & Upload CV<br/>(Local PDF/DOCX + /in/me)"] --> S2["2. Guided AI Profile Review<br/>(Before/After diffs + Fast-Path Save)"]
  S2 --> S3["3. Answer Bank & Campaign Goal<br/>(Tier-1 Presets + Student Smart-Defaults)"]
  S3 --> S4["4. Discover & Rank Jobs<br/>(LinkedIn Search + CV Fit Scoring)"]
  S4 --> S5A["5a. Application Queue<br/>(Easy Apply & 27+ ATS Forms)"]
  S4 --> S5B["5b. Company Ranking & Referrals<br/>(Pin Boost + Weekly Budget Allocator)"]
  S5A -->|"Unknown field, login, CAPTCHA or review"| NY["Needs You Inbox & HUD Jump<br/>(Answer once -> Saved to Answer Bank)"]
  NY -->|"Self-healing resume"| S5A
  S5B -->|"Approval queue + Gmail drafts"| OUT["Tracked Replies & Outcomes"]
```

---

## Extension Architecture

```mermaid
flowchart TB
  subgraph Browser_UI["Extension Surfaces (MV3 CSP strict)"]
    WB["Workbench Dashboard<br/>(workbench.html / workbench.js)<br/>Launchpad, Jobs, Needs You, Referrals, Answers, Profile"]
    SP["Side Panel<br/>(sidepanel.html / sidepanel.js)<br/>Quick Fill, Live Referrals & Compact HUD"]
    HUD["Shared 6-Stage HUD Store<br/>(chrome.storage.local + events)"]
  end

  subgraph SW["Background Service Worker (service-worker.js)"]
    WK["workspace.ts & profileStorage.ts<br/>Profile, CV, Facts & Read-Back Sync"]
    CM["campaign.ts & runner.ts<br/>Lease-Backed Queue & Exceptions"]
    NW["network.ts & bridge.ts<br/>LinkedIn Discovery, Outreach & Sync"]
    SEC["security.ts<br/>Sender Validation & Consent Gates"]
  end

  subgraph Pages["Host Web Pages (User-Initiated & Session-Scoped)"]
    LI["linkedin.com<br/>(health.js + remember.ts Shadow HUD)"]
    GPT["chatgpt.com<br/>(DOM AI Automation)"]
    GM["mail.google.com<br/>(Draft & Reply Checks)"]
    ATS["External ATS Portals<br/>(apply.js via runtime optional_host_permissions)"]
  end

  subgraph LocalDB["Local-First Storage"]
    IDB["IndexedDB<br/>(profiles, jobs, companies, applications, exceptions, facts, contacts, events)"]
    CS["chrome.storage.local<br/>(rs_live_progress_v1, rs_profile_snapshot_v1, settings)"]
  end

  WB <-->|"chrome.runtime.sendMessage (trustedExtension)"| SW
  SP <-->|"chrome.runtime.sendMessage (trustedExtension)"| SW
  WB <--> HUD
  SP <--> HUD
  SW <--> IDB
  SW <--> CS
  SW <-->|"tabs / scripting"| Pages
```

---

## Quick Start & Installation

### Option A — Microsoft Edge Add-ons / Unpacked Store ZIP
- **Microsoft Edge Add-ons:** [Install Referral Scout](https://microsoftedge.microsoft.com/addons/detail/referral-scout-jobs-and-/lhfibhgokebhefdagadklckepkbbljhc)
- **Quick Local Install Scripts (v0.58.2):**
  - **Windows (PowerShell):** `powershell -ExecutionPolicy Bypass -File install/install-windows.ps1`
  - **macOS (Bash):** `bash install/install-mac.sh`

### Option B — Build Unpacked from Source (`Chrome` & `Edge`)
Requires **Node.js 22+** (Node 24 recommended) and **pnpm 11.25.0**:

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm build    # builds dist/ and runs MV3 manifest, CSP, icon & asset checks
```

Then load [`dist/`](dist/) in `chrome://extensions` or `edge://extensions` with **Developer mode** enabled → **Load unpacked**.

---

## Verification & Packaging

```bash
pnpm format:check   # Prettier check (src, tests, scripts)
pnpm typecheck      # Strict TypeScript check (tsc --noEmit)
pnpm test           # Vitest suite (43 test files, 713 tests)
pnpm check          # Full CI gate: format + vitest + tsc + vite builds + scripts/check-build.mjs
pnpm package        # Builds & verifies referral-scout.zip with SHA-256 summary
```

---

## Privacy, Safety & Data Control

- **100% Local-First Storage:** Profiles, CVs, job listings, Answer Bank facts, contacts, and logs reside in local IndexedDB / `chrome.storage.local` on your device.
- **No Credential Storage:** Referral Scout never collects passwords, cookies, or Gmail OAuth refresh tokens; it operates inside your own active browser sessions.
- **Opt-In Usage Counting Only:** Disabled by default. When explicitly enabled in Settings, sends only a random install ID, display name, and LinkedIn handle to `https://referral-scout.vercel.app/api/ping`—never CVs, jobs, emails, contacts, or messages.
- **Instant User Controls:** Pause/drain queues, export JSON backups (API keys excluded), or wipe all local state cleanly via **Settings → Delete everything**.

See [PRIVACY POLICY](docs/privacy.md), [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [CHANGELOG.md](CHANGELOG.md).

## License

All rights reserved. Contact the maintainer before reusing or redistributing source code.
