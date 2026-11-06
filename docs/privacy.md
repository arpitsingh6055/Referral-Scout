# Cold Contact privacy information

**Last updated: 2026-11-05 · LinkedIn workflow, version 0.4**

Cold Contact stores your name, LinkedIn profile URL, headline, location and rendered
About section locally in the extension's IndexedDB database. It also stores your
chosen target, introduction template, shortlisted public profiles, invitation and
message status, action attempts and recovery state.

The extension reads LinkedIn pages using your existing signed-in browser session.
It does not extract passwords, cookies or authentication tokens. Starting outreach
authorizes connection requests and one introduction to each tracked contact after
acceptance. These actions send information to LinkedIn through its page interface.
LinkedIn's own policies and retention apply to that service-side information.

The current workflow does not submit CVs or profiles to ChatGPT or Gemini, access
Gmail, use an AI API, or contact an extension-owned server. There is no analytics or
advertising SDK. New outreach data is not written to Chrome Sync.

**Clear saved outreach** deletes the current LinkedIn workflow's local profile,
preferences, contacts and action history. It does not delete LinkedIn messages,
withdraw invitations or remove legacy version 0.3 campaign records. Old records
remain unused by this build; uninstalling the extension removes its browser-owned
local storage. Previously synced profile data and information already submitted
to external services remain subject to those services' storage and deletion controls.

The current build has no automatic age-based retention for saved profiles. The
shortlist is bounded to 500 contacts, with manual clearing available in the dashboard.
Action-attempt history is trimmed to seven days when a new action is recorded.

Before public distribution, the publisher must supply a public privacy URL and
support contact and verify that these statements match the released build.
