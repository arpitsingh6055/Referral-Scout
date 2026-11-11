# Changelog

All versions below were built on 11 November 2026 on the `cleanup/linkedin-only` branch.
What is and is not proven on the live site is recorded in `docs/live-verification.md`.

## 0.15.3
- Remember button was invisible in browsers with an ad blocker. Blockers such as Stands AdBlocker hide any `div` placed directly under `<html>` that has an inline `z-index` (rule `head ~ div[style*="z-index"]`). The button is now its own element in `<body>`, with no inline style, positioned from a stylesheet inside its shadow root.
- If something still hides it, it is moved once and the page console says so.
- The button is built with DOM calls only. LinkedIn enforces Trusted Types, which blocks `innerHTML` and stopped the original version from ever creating the button.

## 0.15.2
- Remember button: now shown on every LinkedIn profile and job page (except your own profile), even when LinkedIn's layout can't be read. Before, it stayed hidden unless the top card was recognised exactly.
- Click it, write a note (for example the role that is open at their company), press Save. The note box is part of the button, not a second step.
- A failed save now says so ("Refresh this LinkedIn tab and try again") instead of doing nothing.
- Typing a note no longer triggers LinkedIn keyboard shortcuts. A top card left over from the previous profile is ignored when LinkedIn changes page without reloading.
- Not yet confirmed on the live site; see `docs/live-verification.md`.

## 0.22.0: renamed to Referral Scout
- The extension is now **Referral Scout**, because its job is finding jobs and the people who can refer you, not cold outreach. Name, description, toolbar title, icons, welcome screen, the button on LinkedIn pages, the export file name and the docs all use it.
- Your saved data is untouched: the local database keeps its old internal name so nothing is lost on update.
- The GitHub repository is still `cold-contact-pro`; rename it in the repository settings when convenient (GitHub redirects the old address).

## 0.21.0: redesigned side panel
- **Home is the landing screen.** One status card shows where you are (Find jobs, Choose, Find people, Reach out), what is happening now, the one next action, and today's and this week's invitation budget.
- **Needs you** lists every decision in one place with the action on the row: approve messages, "Only them / Look wider" for a company where you already know people, reminders, people needing attention. When it is empty the panel says you can close it.
- **Bottom navigation**: Home, Jobs, People, Saved, Activity. A red badge appears only where something needs you. Settings moved behind the icon at the top; troubleshooting and data export moved into Settings.
- The status card, counters and notices no longer repeat on every screen. Each screen has its own title and one job.
- Settings opens with only the target role and location; messages, limits, CV and general outreach are collapsed. Save stays visible while you scroll.
- New visual system: stronger hierarchy, pill buttons, clickable pipeline counters, selected state on chosen companies, light and dark themes, reduced-motion support.
- Checked by rendering nine screen states in headless Chrome with sample data; not yet looked at inside Edge's side panel.

## 0.20.0: ChatGPT decides who to ask at each company
- After you confirm the companies, **one ChatGPT prompt covers all of them**. For each company it says what kind of company it is (enterprise, mid-size, scale-up, startup), which job titles to search for, which titles not to approach as a stranger, and how to word the note, the message to people you already know, and the follow-up.
- The prompt carries worked examples: at Microsoft a Sales Intern applicant should reach campus recruiters and sales managers, not the CEO or CFO; at a 40-person startup the founder and head of the function are the right people.
- Recruiters, talent acquisition and HR are searched at every company regardless of the plan.
- The reply is checked, not trusted: top-executive titles are removed for any company ChatGPT itself calls an enterprise, and wording without the required placeholders is discarded in favour of the built-in text.
- If ChatGPT is signed out or gives no usable reply, the status line says so and the search continues on the built-in rules by company size. ChatGPT is asked at most twice per run: once for search terms, once for the companies.
- Each job card shows the plan (company type, who is being asked, who is not).
- Not yet run in Edge; see `docs/live-verification.md`.

## 0.19.0: job search and referral pipeline
The product is now built around jobs, not general outreach.

- **Find jobs and referrals** is the main button. It plans the search, reads LinkedIn job results for your target role and its parallel titles (an "operations intern" search also tries supply chain, logistics, procurement and so on), and offers one job per company, best first.
- **You confirm the companies.** The best matches are pre-ticked; companies where LinkedIn says you have connections or alumni rank higher. You choose 3, 4 or 5 invitations per company.
- **One ChatGPT prompt per set of target roles**, cached: parallel job titles, which titles to approach at large, mid-size and small companies, and the wording of the note and messages. If ChatGPT is unavailable the built-in plan is used and you are told.
- **Company size decides who is asked.** The size is read from the company page. At a large company strangers who are founders, directors or VPs are dropped; recruiters, HR, team leads, senior consultants and associates are targeted. At a small company founders and heads are.
- **People you already know come first.** If you know anyone at a company the extension stops and asks: ask only them, or also look for stronger referrers.
- General networking outreach is no longer on the home screen; it is under Setup.
- Checked live: the LinkedIn job list (25 rows read with title, company, location and the "connections work here" hint). Not yet run in Edge end to end.

## 0.18.0
- **Ask for referrals now acts.** When the search finishes, the strongest 8 people are contacted without a second approval: people you already know get a message, the others an invitation, paced and within the daily limits. Everyone else stays listed with an "Invite and ask" button.
- If outreach was paused, the click switches on **referral outreach only**: general searching and general contacts stay untouched until you press "Also start general outreach". Pause still stops everything.

## 0.17.2 (referral audit)
- Recruiter searches and recognition now cover HR, HRBP, human resources, people partners and operations, TA, sourcers, campus and early-careers teams. The same wider wording is used in general outreach searches.
- Interns, trainees, students and people marked open to work are left out even when they work at the company.
- A second page of recruiters and HR is read when the first is full; a job title with no clear function no longer causes a repeated search.
- People LinkedIn lists on the job page under "People you can reach out to" are read and ranked by the same rules; a school alum gets a boost and the reason says so.
- The company page link is found on layouts without the About block.
- Someone already found for another job at the same company is shown under each of those jobs.

## 0.17.1
- General outreach now uses LinkedIn's **Locations** filter for the target country instead of typing the place as a keyword (checked live for India). The country is no longer repeated in the keywords, which had been hiding everyone who does not spell it out in their profile.
- LinkedIn's title filter was tried and is ignored for this account, so role terms stay in the keywords.

## 0.17.0
- Referral searches now use LinkedIn's **Current company** filter. The company's number is read once from its company page (the employee-count link), then every search is limited to people who work there now. Checked live on DeHaat: 10 results per page, all at the company, including the person LinkedIn itself suggested.
- Fixed: a headline containing "Ex Tata Group" ruled the person out even though they now work at the target company. Only "ex-<this company>" does.
- New rank "Same team" for people in the job's own function with a mutual connection; unrelated strangers are still dropped.
- Pressing a referral button again on a finished job searches again.
- 0.16.1 and 0.16.2: referral buttons now show in the split job-search view; people-team and senior titles are kept.

## 0.16.0
- **Referrals.** On a LinkedIn job page, two new buttons next to Remember:
  - **Ask for referrals** searches that company for recruiters, the hiring team, founders and people you already know there, ranks them by whose word counts, and prepares a job-specific message (1st degree) or invitation (2nd and 3rd).
  - **My connections here** only lists your 1st-degree connections at that company, strongest first, and contacts nobody until you press Ask for a referral.
- New **Referrals** tab: one card per job with its ranked people, kept separate from general outreach. They also appear in People once queued.
- A referral search runs straight away, even while outreach is paused; sending still follows your approval and limits.
- Checked against two saved LinkedIn pages (a Barclays job and its suggested people): 9 of LinkedIn's 10 suggestions worked somewhere else, which the company check now filters out. The result rows match the people-search reader.
- Not yet run on live LinkedIn: the company keyword search and the job-page buttons.

## 0.15.1
- Settings no longer fail to save silently; the rejected field is named.
- Gap between sends can be set from 5 seconds upward.

## 0.15.0
- Acceptance check every 2 hours from My Network > Connections (one page load for all pending invitations).
- Search uses LinkedIn's degree filter; 1st-degree matches get a direct message, 2nd and 3rd+ get an invitation.
- Connect under the More menu; "Invitation sent to NAME" counts as proof of sending.

## 0.14.0
- Follows LinkedIn's real two-step invitation dialog; sends without a note when the monthly free notes run out.
- One failed send no longer pauses outreach: certain failures retry, slow confirmations are re-checked, never sent twice.

## 0.13.0
- Approve queues instantly; Cancel sending; Approve all. ChatGPT runs in its own window.

## 0.12.x
- Saved tab: job progress, reminders, requests unanswered for 3+ weeks, notes.
- Drafts are editable, with Rewrite with ChatGPT and Use my template.
- CV "processing" step removed; ChatGPT reads the saved CV text directly. Stuck unsent prompts are cleared.

## 0.11.x
- Remember button on LinkedIn profile and job pages.
- Closing line of the first note depends on who is contacted (recruiter, team leader, founder).

## 0.10.x
- Fixed everyone being skipped as "already connected" (hidden "1st" label on profiles).
- Pages open in a separate, unfocused window. Steps follow each other in seconds, each one announced.
- Templates are the default; ChatGPT may only lightly adapt them. Default gap between sends is 30 seconds.

## 0.9.0
- Every LinkedIn reader rebuilt against the live site: by role, label and text instead of class names.
- Removed 43 unreachable source files from the retired Gmail tool, Jobs mode and 14 of 16 storage tables.
