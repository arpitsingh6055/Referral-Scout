<div align="center">

<img src="public/icons/icon128.png" alt="Referral Scout" width="84" height="84" />

# Referral Scout

**Find jobs that fit you. Get referred.**

A browser extension that searches LinkedIn jobs for the role you want, ranks them by how well they fit your background, finds the people at each company whose referral counts, and drafts the messages for you to approve.

<sub>Chrome &amp; Edge (Manifest V3) · v0.45.5 · Your data stays in your browser</sub>

</div>

<br />

<p align="center">
  <img src="docs/screenshots/home.png" alt="Home: status, what needs you, and the pipeline" width="260" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/tracker.png" alt="Live tracker while jobs are searched" width="260" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/jobs.png" alt="Jobs: the pipeline board and one card per company" width="260" />
</p>

## Install

Referral Scout is not in a browser store yet (it is on its way to Microsoft Edge Add-ons), so installing takes two clicks in your browser's extensions page. The installers do the rest.

**Windows** — open PowerShell (not as administrator) and paste:

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/arpitsingh6055/Referral-Scout/job-search-pipeline/install/install-windows.ps1 | iex"
```

**macOS** — open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/arpitsingh6055/Referral-Scout/job-search-pipeline/install/install-mac.sh | bash
```

Each installer downloads the current release (0.45.5), unpacks it into a fixed folder in your user account, copies that folder's path to the clipboard and opens the extensions page. Then:

1. Turn on **Developer mode**.
2. Click **Load unpacked**, paste the path and select the folder.
3. Pin Referral Scout and click it to open the side panel.

You can read the scripts first: [`install/install-windows.ps1`](install/install-windows.ps1), [`install/install-mac.sh`](install/install-mac.sh). To update later, run the installer again and press **Reload** on the extension. Prefer doing it by hand? Download the zip from [Releases](https://github.com/arpitsingh6055/Referral-Scout/releases), unzip it, and load that folder the same way.

You need to be signed in to **LinkedIn** and to **ChatGPT** (chatgpt.com) in the same browser.

## The problem

A referral is the most reliable way into an interview, and asking for one is slow, repetitive work: find the openings, work out which ones you actually fit, find who at each company could refer you, write to each of them, and remember who answered. Most people give up after two or three companies.

## What Referral Scout does

It runs that routine from a side panel, on your own signed-in LinkedIn:

1. **Find jobs.** It searches LinkedIn Jobs for the role you typed and for similar titles suggested by ChatGPT (an "operations intern" search also tries supply chain, logistics and business operations), and removes adverts, paid courses and roles of the wrong type (internship or full-time).
2. **Rank them by fit.** It reads the full description of each job and asks ChatGPT how strong a candidate you are for it, judged against your whole LinkedIn profile and CV. The best fits go to the top, each with the reason (see below).
3. **You choose the companies.** Nothing is contacted until you confirm.
4. **Find the right people.** At each company it uses LinkedIn's *Current company* filter to find people whose referral counts and who are likely to answer, starting with people you already know.
5. **Reach out, slowly.** People you know get a message; the strongest three to five others get a connection request with a short note written for who they are, and a follow-up once they accept. By default every message waits for your approval.

6. **Fill the application.** Open one job (LinkedIn Easy Apply, or the company's own application page on Greenhouse, Lever, Workday, Ashby and most other sites) and press **Fill this application** in the side panel. ChatGPT, in thinking mode where your plan has it, reads the job and every field on the form and fills it from your profile, CV and saved answers: written answers are specific to that job, your CV is attached to the upload field, and multi-page applications move from step to step by themselves, stopping only at the final review. Steps that LinkedIn or your saved answers already cover are passed in seconds without asking ChatGPT, and thinking mode is used only for written answers. LinkedIn's safety reminder is passed for you, and "Mark this job as a top choice" is ticked, with a message written for that job, while your monthly allowance lasts (you can switch this to ask first). When the site confirms the application was sent (LinkedIn's "Application sent" or a company's thank-you page), the job is marked Applied and Referral Scout starts finding the people at that company who can refer you, with messages that say you have applied; each invitation still waits for your approval unless you chose automatic sending. Anything it cannot know (salary, notice period, visa) is asked once in the side panel and remembered. Fields are outlined on the page so you can check them, **Undo** puts back what was there, and it **never presses Submit**: you do. Passwords, CAPTCHAs, legal declarations and diversity questions are always left to you. Each tab keeps its own fill, so several applications can be open at once. Every written answer can be edited, rewritten or shortened from the panel, and any question can be left for you to answer on the page. Outlines differ in line style as well as colour (solid filled, dashed check, dotted yours) and the page jumps to the first question left for you. On a LinkedIn results list, **Fill the next Easy Apply job** opens the next job you have not applied to and fills it, still stopping before Submit; past 25 applications in a day the panel suggests a break. The side panel lists your recent applications with their referral progress, warns when ChatGPT's page stopped responding last time, and Settings has a **Test ChatGPT** button. The background work window closes itself after 30 idle minutes.

You can also start from any LinkedIn job page with the **Ask for referrals** and **My connections here** buttons. When someone replies, a small card in LinkedIn messaging reminds you which job you asked about and can draft your answer.

## How jobs are ranked

A qualification alone is a poor guide: an MBA who has spent years in sales, or a B.Tech who moved into marketing, fits jobs their degree would not suggest. So ranking uses everything:

- **Your background:** every section of your LinkedIn profile (About, Experience, Education, Skills, Certifications, Projects) and your CV, if you add one.
- **Your qualifications:** a checklist (MBA/PGDM, B.Tech/B.E. CSE-IT-circuit or other branches, M.Tech/M.E., CA/CS/CMA/B.Com, CFA/FRM/CPA), pre-filled from your profile. You can change it.
- **Each job's full description,** read ten jobs at a time per ChatGPT question.

ChatGPT weighs hard requirements (a named degree, years of experience, must-have skills), then function and sector, then your qualification, then the direction you are aiming in, so a career switcher is scored on their combined background. Each job gets a fit score from 0 to 100 and a reason with the biggest gap, for example *"PGDM asked for; sales internship fits; no SQL"*. Badges say whether the match is your qualification, your experience or your field. Nothing is ever removed for a weak fit; it just ranks lower.

Descriptions are read four pages at a time and remembered for 14 days, so repeat searches are faster. **Choose now** stops ranking early and shows what has been ranked.

## Who it asks

The right person depends on the company, so that judgement is made per company:

| Company | Asked | Not asked as a stranger |
|---|---|---|
| Large (Microsoft, Infosys) | Campus recruiters, HR partners, managers and team leads in the job's function | CEO, CFO, VPs, directors |
| Mid-size or scale-up | Talent partners, function managers, head of the function | Founders, unless the company is clearly small |
| Startup | Founder, head of the function, chief of staff, any HR or talent person | |

Recruiters and HR are asked at every company. Interns, students, former employees and "open to work" profiles are never asked.

## Where ChatGPT comes in

ChatGPT plans the search (similar job titles), ranks the jobs, decides who to ask at each chosen company, and writes or adapts the notes and messages. Every answer is checked before use, and the extension carries on with built-in rules whenever ChatGPT is unavailable.

- **The ChatGPT website (default).** Nothing to set up; stay signed in at chatgpt.com. Questions are typed into a tab in the background window and the answer is read back.
- **Your own OpenAI API key (optional).** Faster, and no tab is opened. Set it in Settings. OpenAI bills API use to your account.

## Tracking what came of it

Home shows the whole pipeline in six numbers: **Companies, Asked, Accepted, Replied, Referred, Applied**. Invitations, acceptances and replies are tracked for you; referrals and applications you mark with one press.

## Built to protect your account

LinkedIn's User Agreement does not allow automated activity, and accounts that send too much get restricted. The defaults are deliberately slow, and **you use this at your own risk**.

| Setting | Default |
|---|---|
| Invitations | 30 a day, 80 a week |
| Pending invitations | Stops at 100 outstanding |
| Pause between sends | 30 seconds or more, never a fixed rhythm |
| People per company | 3 (you can choose 4 or 5) |
| Approval | Every invitation and message waits for you (automatic sending is optional) |
| Hours | Any time; an "only 08:00 to 22:00" option is in Settings |

**Pause everything** stops searches and sending at once, and **Resume** continues where it stopped. A LinkedIn sign-out or checkpoint pauses everything with the reason. Background work happens in a separate window that stays behind your own.

## Privacy

- Your LinkedIn profile, CV, job lists, people and messages are stored in your browser, on your device.
- After you agree on the first screen, the extension sends one usage record per LinkedIn account (a random install ID, your name, your LinkedIn profile ID and when you first used it) so we can count users. Nothing else is sent to us, and nothing is sold or used for ads.
- To rank jobs and write messages, prompts in your own ChatGPT account can include your profile and CV text, job descriptions and the public details of people you contact. They follow your ChatGPT history settings.
- Your CV file and, if you choose, your profile photo are kept on your device and attached only to application forms you press **Fill this application** on. The extension reads a company's site only after you allow that one site and press the button; it then sends that form, the job description and your profile and CV text to your ChatGPT account to work out the answers. Answers you choose to remember stay on your device.
- An API key, if you add one, stays on your device and is left out of exports. **Settings → Export saved data** downloads everything; **Delete everything** removes it.

Full policy: **https://referral-scout.vercel.app/privacy**

## Build from source

You need **Node.js 22+** and a Chromium browser (Chrome 120+ or Edge).

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm build      # builds dist/
corepack pnpm package    # builds referral-scout.zip, ready for a store or a release
```

Load `dist/` with **Load unpacked**. After rebuilding, reload the extension and refresh open LinkedIn and ChatGPT tabs.

## Project status

Working, and still young. What is confirmed on the live sites is recorded in [`docs/live-verification.md`](docs/live-verification.md), and changes are in [`CHANGELOG.md`](CHANGELOG.md).

- LinkedIn changes its pages often. When something stops being read, **Settings → Check this LinkedIn page** says which part.
- Location filtering is confirmed for India; other countries and cities fall back to a text match.

## Troubleshooting

| What you see | What to do |
|---|---|
| "ChatGPT was not available" | Sign in at chatgpt.com in the same browser, or add an API key. The run continues on built-in rules either way. |
| The installer says 404 | The release or script is not on GitHub yet; try again later, or download the zip from Releases. |
| Nothing happens after Resume | Open Activity: the newest line says what is being waited for. |
| A company shows "closed early" | LinkedIn pages for it could not be read. Remove the job and add it again from its job page. |
| Buttons or the reply card are missing on LinkedIn | Refresh the LinkedIn tab after installing or updating. |

## Under the hood

TypeScript, Vite, Zod and Vitest. Manifest V3 with a service worker, content scripts and a side panel.

| Folder | What lives there |
|---|---|
| `src/shared` | Pure rules with no browser access: job ranking and its prompts, qualifications, who to ask, how answers are checked |
| `src/background` | The engine (one step at a time), the handlers behind the panel's buttons, tab and window handling, the ChatGPT and API connection |
| `src/content`, `src/parsers` | Reading LinkedIn and ChatGPT pages by role, label and text, never by generated class names |
| `src/ui` | The side panel |
| `install` | The Windows and macOS installers |

```bash
corepack pnpm check     # formatting, tests, typecheck and build, same as CI
```

Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md). Security reports: [`SECURITY.md`](SECURITY.md).

## License

No open-source license has been selected yet; all rights reserved. Discuss before reusing or redistributing the code.

---

<sub>Referral Scout is an independent project. It is not affiliated with, endorsed by, or sponsored by LinkedIn or OpenAI.</sub>
