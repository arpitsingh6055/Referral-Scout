# Live verification log

What has and has not been checked against the real, signed-in LinkedIn site. Update this whenever a page reader or action changes.

## 11 November 2026, Remember button on a saved real profile page (v0.15.3)

The owner saved a real profile page from Edge (Stands AdBlocker and Grammarly installed) after loading v0.15.2, and the button was not visible. Findings, reproduced by loading that saved page in Chromium:

| Finding | Detail |
|---|---|
| Detection works on the real page | Name and headline read from the real top card |
| Hidden by an ad blocker | Stands injects `head ~ div[style*="z-index"] { display: none !important }`; the v0.15.2 button was a div under `<html>` with an inline z-index |
| LinkedIn enforces Trusted Types | `require-trusted-types-for 'script'` blocks `innerHTML`; the original button code used it |
| v0.15.3 on the same page | Button is 190 x 38 px at the bottom-left, topmost element there; click, note, Save sent the note |

Not yet confirmed: the same in the owner's live Edge window.

## 11 November 2026, Remember button (v0.15.2)

Run in headless Chromium against simulated LinkedIn pages built from the structures recorded below, with a stand-in for the extension's background. **Not run on the live site.**

| Step | Result |
|---|---|
| Button shows on a person profile, a job page and the jobs split view | Works on simulated pages |
| Button stays when the top card is not recognised | Works on simulated pages |
| Hidden on your own profile and on the feed | Works on simulated pages |
| Click, type a note, Save sends the note; Forget; failed save shows a message | Works on simulated pages |
| Real LinkedIn profile and job pages | NOT checked |

## 11 November 2026 (v0.9.0), read-only session

LinkedIn now serves generated class names (for example `i87k8o`). No `artdeco`, `entity-result`, `global-nav` or `job-card` class exists on the profile, search or jobs pages. Every class-based reader in v0.8.0 returned nothing on the live site.

| Step | Result | How it is found now |
|---|---|---|
| Who is signed in | Works | `linkedin.com/in/me/` redirects to the owner's profile; the page must show an Edit intro link for that address |
| Own profile: name, headline, location, About, Education, Skills | Works | Top card via `componentkey` ending in `Topcard`, sections via `h2` headings; the page scrolls inside `<main>` |
| People search, 2nd and 3rd degree filter | Works, 10 of 10 results on the test page | `role="listitem"` rows; first profile link is the person; "Current: role at company" gives the employer |
| Another person's profile: degree, Connect, Message, More | Works | Degree from the "· 2nd" line; controls by aria-label ("Invite NAME to connect") |
| More menu | Works | `role="menu"` rendered outside the top card, items are `role="menuitem"` |
| Message window | Found | It is inside the open shadow root of `#interop-outlet`; `document.querySelector` cannot see it. Editor, Send button and recipient link were located. Nothing was typed or sent |
| Invitation dialog (Add a note, Send) | NOT checked | Needs a click on Connect, which can send immediately on some layouts |
| Typing into the message editor | Works | Text inserted inside the shadow root, Send became enabled, text deleted and the draft closed. Send was not pressed |
| Typing into the invitation note | NOT checked | |
| Pending marker after an invitation | NOT checked | |
| Sent-message confirmation | NOT checked | |
| ChatGPT personalisation | NOT checked (signed out) | Signed-out ChatGPT marks its form `data-logged-out` and uses `textarea[name="prompt"]`; both are now recognised. The signed-in composer and reply markup are still unchecked |
| Jobs search | Removed | The jobs page has no stable hooks and every v0.8.0 selector returned zero cards. People search already gives the employer |

No invitation or message has been sent by the extension or during testing.

## 11 November 2026, dry run of the real page code

The extension's own page code was run on live LinkedIn with authorization forced to "denied", so nothing could be sent.

| Step | Result |
|---|---|
| `identity` on `/in/me/` | Returned the owner's profile address |
| `search` with a boolean query, 2nd/3rd filter and `page=2` | 10 people, all with degree and location, 8 with a current employer; LinkedIn honoured the page number |
| `relationship` on a 1st-degree profile | `connected` |
| `message` on a 1st-degree profile | Opened the window, matched the recipient, found no history, typed and verified the text, found Send enabled, asked for authorization, was refused and stopped. The draft was then deleted |
| `profile` | **Bug found and fixed:** clicking "see more" controls followed a link out of the profile. The reader no longer clicks anything |

Still not run live: the invitation dialog and its note field, the Pending marker, a real send, and anything on ChatGPT while signed in.

## 11 November 2026, first run in Edge by the owner (v0.9.0) and fixes in v0.10.0

- Profile read worked. People search queued 8 people.
- **Every queued person was skipped as "already connected".** Cause, confirmed on the live page: the top card contains a hidden "· 1st" line before the visible "· 2nd". Fixed: only visible lines are read, a visible Connect or Pending button outranks the degree line, and people skipped this way are queued again on the next Start.
- A bare "She/Her" line was being read as the headline. Fixed.
- ChatGPT was never used because it was off by default and required a CV. Now on by default and works from the LinkedIn profile alone.
- The LinkedIn tab took over the owner's window. Pages now open in a separate window that is never focused.
- Long silent gaps between steps. Steps now follow each other after 5 to 12 seconds, and each step is announced.

## 11 November 2026, invitation dialog seen in Edge (owner's screenshots), fixed in v0.14.0

- Step 1 is "Add a note to your invitation?" with **Add a note** and **Send without a note**.
- Step 2 is a different dialog element with a 200-character box, **Cancel**, and a **Send** that stays disabled until text is typed. It also shows how many free notes are left this month.
- v0.13.0 kept looking at the step 1 element after it had been replaced, found no box and no Send, set the person aside and paused everything. The dialog is now looked up again at every step.
- When the free notes run out, the extension backs out and uses Send without a note. This path is covered by a simulated page only; the real upgrade offer has not been seen.
- Not yet seen live: the Pending marker after a real send.

## 11 November 2026, v0.15.0

- `linkedin.com/mynetwork/invite-connect/connections/` checked live (read-only): newest connections first, each row a profile link with "Connected on <date>", 10 rows before scrolling. Used for the 2-hour acceptance check.
- Owner's screenshots confirm: some profiles show Connect on the top card, others show Follow and keep Connect under More. Both paths exist in the code; the More path has run against a simulated page only.
- Not yet seen live: a real send through either path, the 1st-degree filter value `F` in a search address, and a direct message to an existing connection.

## 11 November 2026, v0.17.0 (referrals)

- Company page `linkedin.com/company/dehaat/` checked live: the employee-count link carries `currentCompany=["13396287"]`.
- People search with that filter and `network=["F","S"]` checked live: 10 rows, 7 pages, every person at DeHaat; rows match the reader.
- Not yet run through the extension itself in Edge: the two job-page buttons end to end.

## 12 November 2026, v0.19.0 (job search)

- `linkedin.com/jobs/search-results/?keywords=operations intern&geoId=102713980` checked live: 25 rows. A row is not a link; it carries `componentkey="job-card-component-ref-<id>"`, a "Dismiss <title> job" button, and lines for title, company, location and a hint such as "256 company alumni work here".
- Not yet run through the extension in Edge: the full pipeline, and the ChatGPT plan prompt (ChatGPT has still never completed a task live in this project).

## 0.20.0: per-company plan from ChatGPT (not yet run live)
Covered by tests only (prompt contents, reply checking, one prompt per batch, fallback). Still to confirm in Edge with ChatGPT signed in:
1. Choose two or three companies in "Find jobs and referrals". The status should read "Asking ChatGPT who can refer you at N companies…" once, then "ChatGPT planned who to ask at N companies."
2. Each job card shows "who to ask" with a company type that matches reality (a large company must not list founders or the CEO).
3. With ChatGPT signed out, the status says built-in rules are used and the search still runs.

## 0.30.0 and 0.31.0 (not yet run live)
Covered by tests only. Still to confirm in Edge:
1. **One work window.** Start a job search with the ChatGPT website: ChatGPT opens as a tab in the same background window as LinkedIn and closes after its answer is read. Press Pause: the window closes. Press Resume: it reopens.
2. **API key.** Settings, ChatGPT connection: save a real key and model name (the browser asks to allow api.openai.com), press "Test the key", then run a job search and confirm no ChatGPT tab opens.
3. **Outcomes.** Mark "They replied" and "Will refer me" on a person and "I applied" on a job; the Home numbers and the Jobs board follow.

## 0.34.0 (not yet run live in the extension)
- The messaging conversation list was read on the live page on 12 November 2026: `li.msg-conversation-listitem`, the name in `.msg-conversation-listitem__participant-names`, and a snippet starting "You:" when the latest message is your own. Checked on an account with a single conversation.
- Still to confirm in Edge: "Check for replies now" marks a real reply; searching and sending alternate during a multi-company run; the panel jumps to the company list when a job search finishes.

## 0.35.0 (reply button in LinkedIn messaging; not yet run in the extension)
Checked on the live conversation page, 12 November 2026: `a.msg-thread__link-to-profile` (an encoded member id), `.msg-entity-lockup__entity-title`, `.msg-s-event-listitem` with `--other` on the other person's messages, and the box `.msg-form__contenteditable`.
Still to confirm in Edge: open a conversation with someone the extension messaged; the blue "Draft a reply with ChatGPT" button shows at the bottom left; pressing it places a draft in the message box and sends nothing; a conversation with anyone else shows no button.
