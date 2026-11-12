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

## 0.35.0: replies in your LinkedIn messages
- **The extension knows whose conversation is open.** When you open a conversation in LinkedIn messaging with someone the extension invited or messaged, it recognises them (by LinkedIn's own id once learned, otherwise by a name only one of them has) and quietly keeps the last 20 messages of that conversation on your device. Conversations are never shown in the side panel and never sent to it.
- **A message from them counts as a reply the moment the conversation is seen**, whether or not you have read or answered it. They move to Replied.
- **"Draft a reply with ChatGPT"** appears at the bottom left of that conversation, and only for those people. ChatGPT reads the conversation, the job and your background and writes your next message; the draft is placed in LinkedIn's message box for you to edit. You add any attachment and press Send yourself: the extension never sends it. If the box already has text it asks before replacing it.
- The conversation page was checked live on 12 November 2026 (header link, message items, message box). The button and the draft have not been tried in Edge yet.

## 0.34.1: reply and acceptance checks validated
- **Fixed: "Check for replies now" failed while sending was off.** The acceptance check refused to run unless outreach was active, which stopped the whole check and paused everything. It now runs on request whatever the sending state. Found by a new end-to-end test of the check.
- **Fixed: a person whose name carries a credential ("Priya Sharma, MBA") was treated as a group chat** and skipped. Only real group chats ("… and 2 others") and sponsored messages are left out now.
- Both readers were run against the live pages on 12 November 2026: the messaging list (three conversations: names and "latest message is mine" read correctly) and the connections page (three connections, three profile addresses, newest first).
- New tests: the messaging list from a fixture shaped like the live page, name matching with credentials and pronouns, the connections page, and one check that marks an acceptance and a reply together.

## 0.34.0: you stay in command; replies are checked for you
- **Leave any stage.** During a job search: "Stop here and choose from the N jobs found", or cancel. While people are being found: "Stop searching, reach out to who was found" on Home, and per company "Stop searching here". While reaching out: per company "Stop asking here" takes everyone not yet contacted out of the queue; people already asked are untouched. Pause and Resume work as before.
- **Searching and sending take turns.** People already found at one company are contacted while other companies are still being searched, instead of waiting for every search to finish.
- **Replies are read for you.** Every 2 hours while sending is on, and whenever you press **Check for replies now** on Home, the extension looks at your connections list and at LinkedIn messaging and marks who accepted and who wrote back. It reads the conversation list only (names, and whether the latest message is yours), not the messages. People with the same name as another person you asked are left for you to mark. The messaging list was checked against the live page on 12 November 2026.
- **Clear hand-overs.** When a job search finishes, the panel opens the company list by itself, labelled "Step 2 of 4 · your turn"; Home says "Your turn: Choose your companies". After you confirm companies you are taken back to Home, where the search for people is tracked.
- **People inside a job are one line each**, grouped as Replied, Needs you, Asked and waiting, In the queue, Found, Skipped. Open a line for the message, actions and outcome.

## 0.33.0: new defaults and a clear account warning
- **Ten companies are ticked by default** in the shortlist (was 15); you can still tick up to 20.
- **The daily invitation limit defaults to 30** (was 15). An install still on the old default moves to 30 once; a value you chose yourself is kept. The weekly limit stays at 80.
- **Warnings where the decision is made.** Settings explains that LinkedIn does not allow automated activity and restricts accounts that send too much, and shows a red warning the moment a limit goes above 30 a day or 100 a week, has no limit, or the pause drops under 20 seconds. The shortlist shows how many invitations your choice adds up to and warns above 10 companies or a day's worth.

## 0.32.0: setup ends on Home
- After you answer "what are you looking for?", the panel always opens on **Home**. Before, it could land on Settings if that was the last screen open (for example after "Delete everything").
- **Save changes** in Settings returns to Home.
- Home suggests the optional next steps itself: **Add your CV** and, before the first search, **Check your messages**. A third, **Use your OpenAI API key**, is shown until a key is saved. Each opens Settings at that section; the CV suggestion stays until a CV is added.

## 0.31.0: code split, formatting, README
- **The side panel is no longer one file.** `src/ui/sidepanel.ts` is split into `core` (helpers and shared state), `live` (status and tracker), `setup`, `jobs`, `people`, `activity` and `pipeline`; `sidepanel` keeps only the screen itself. No behaviour changed: the split was done by script and all tests pass unchanged.
- **Prettier formats the whole codebase** (140 columns). The dense one-line style is gone; `pnpm check` and CI now fail on unformatted code. `pnpm format` reformats.
- ESLint was not added: typescript-eslint does not support the project's TypeScript 7 yet. The TypeScript compiler's strict and unused-code checks remain the lint step.
- The pipeline board shows each company on its own line with its five stages under it, so company names are readable in a narrow panel.
- The README describes the current product, with new screenshots.

## 0.30.0: outcome tracking, optional API key, one work window
- **Pipeline.** Home shows the whole way to a referral in six numbers: Companies, Asked, Accepted, Replied, Referred, Applied. Jobs shows the same per company as a board. On anyone you have asked, one press marks "They replied", "Will refer me" or "Can't help"; on a job, "I applied". People has Replied and Will refer filters. Replies are marked by you: the extension does not read your LinkedIn inbox.
- **Optional OpenAI API key** (Settings, ChatGPT connection). With a key and a model name, questions go straight to the API: no ChatGPT tab, no page reading. The default is still the ChatGPT website with nothing to set up. Access to api.openai.com is requested only when you save a key. The key is stored on this device only, is never sent back to the side panel, and is left out of exports. No model name is pre-filled because they change. Not yet tried with a real key.
- **One work window.** LinkedIn and ChatGPT now share a single background window; ChatGPT opens as a tab in it and is closed when its answer is read. The window closes by itself when you pause or when nothing is left to do, and a ChatGPT window left by an older version is closed.
- A request that is refused (for example a job search before a profile is read) no longer lifts a pause.
- Ten new tests cover the handlers behind the buttons: pause, resume, job search, the per-company question, outcomes, the API key, validation errors, skip and approve all.

## 0.29.0: ChatGPT's answer is now read back
- **Fixed: ChatGPT answered but the extension never picked the answer up** ("ChatGPT took too long to answer" while the reply was on screen). The reader depended on ChatGPT's markup: it gave up when turns were nested more than eight levels deep, and read only the first content block of a reply, which is empty when a "thinking" block comes first.
- The reply is now also read **by position**: everything between the end of our own prompt and the message box, whatever the markup looks like. All content blocks of a reply are read, not the first.
- An answer counts as finished as soon as it holds one complete JSON object and has stopped changing for 1.5 seconds. A stray "Stop" control on the page can no longer hold it back.
- LinkedIn's "Verify in 2 minutes" prompt is no longer sent to ChatGPT as your headline.
- Reproduced with two new fake-page tests that fail on the old reader and pass on the new one. Not yet confirmed against the live ChatGPT page.

## 0.28.0: Resume restores exactly what was running
- Pause remembers what was running (sending on or off, referrals only or general outreach). **Resume brings back exactly that**; before, it always switched sending on in referrals-only mode, whatever you had been doing.
- While paused, Home lists what Resume will continue: the job search and how far it got, companies still to search, messages queued, companies waiting for your answer. Pressing Resume confirms the same list.
- Pause followed straight away by Resume no longer does nothing for up to a minute: a request that arrives while the interrupted step is still stopping now runs right after it.
- A problem that pauses things after you had already paused keeps your original state, so Resume still restores it.

## 0.27.0: setup asks what you are looking for
- After your profile is read, setup asks one question, "what are you looking for?" (role and place), instead of assuming "Product Management internship" in India. Home appears only after you answer.
- Existing installs that already have jobs or people are not asked again.
- Home shows the target role large, in its own card with an Edit button.

## 0.26.0: the Current company filter is used even when the job hides the company page
- When a job does not give the company's LinkedIn page, the company is now looked up through LinkedIn's own company search (exact name, preferring the one in the job's location). Its number is then read from the company page, so people searches use LinkedIn's **Current company** filter instead of a bare name search that also returns "ex-" and volunteer mentions.
- Checked live on 12 November 2026 for Ketto: company search rows and the company page link (`currentCompany=["3686501"]`, "201-500 employees") read correctly.
- Only when no company page has exactly that name does the search fall back to the name, and then only people whose current employer matches are kept; the status says so.

## 0.25.0: no quiet hours by default; ChatGPT checks the job list
- **Set hours are off by default** and were switched off once for existing installs. You can still choose "Only 08:00 to 22:00" under Settings, Pace, limits and safety; when work is waiting for those hours, Home shows **Run now anyway**.
- **The shortlist is checked by ChatGPT before you see it.** One prompt removes paid courses and placement schemes, vague agency listings, the wrong function and the wrong level. Removed listings are listed with the reason under the shortlist, never dropped silently. A reply that removes most of the list is ignored, and if ChatGPT is unavailable the list is shown unfiltered and says so.
- LinkedIn's "Promoted" listings are detected, ranked below organic matches and labelled in the shortlist. The "Promoted" label has not been checked against the live page yet.
- A run now uses at most three ChatGPT prompts: search titles, the job list check, who to ask at each company.

## 0.24.0: Pause really pauses; nothing opens by itself
- **Pause everything now stops everything**: job searches, company planning and people searches as well as sending. Before, it only stopped sending and searches kept running. It is offered whenever anything is running, not only while sending.
- **Resume** is the main button while paused and continues from the exact step that was interrupted. Starting something new (a job search, choosing companies, a referral from a job page) also lifts the pause.
- An account-level problem (signed out of LinkedIn, a LinkedIn checkpoint) pauses everything once with the reason, instead of being retried every minute.
- A company whose pages cannot be read no longer blocks the others or a new job search: it is retried, then closed with whatever was found, and the card says so.
- Job cards and settings sections stay closed until you open them. Only a draft waiting for your approval is shown open.

## 0.23.0: live progress tracker, shorter ChatGPT wait
- **Home shows a live tracker** whenever work is running: the step in progress, the steps done and left (each job title being searched, each company being worked), a running clock, how long it normally takes and why, and when the last update arrived. The clock ticks every second so the panel never looks frozen.
- **ChatGPT can no longer hold a run up for 4.5 minutes.** Planning prompts give up after 40 seconds if the question never reached ChatGPT (usually: not signed in) and after 2 minutes in all, close the unused tab, and continue on the built-in plan. Each ChatGPT stage (opening, question sent, writing, answer read) is shown as it happens.
- Larger text on the Home status card and step labels. The panel refreshes every 2.5 seconds instead of 4.
- Job titles in the shortlist are links; the open button reads "View job".
- Not yet run in Edge.

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
