# Live verification log

What has and has not been checked against the real, signed-in LinkedIn site. Update this whenever a page reader or action changes.

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
