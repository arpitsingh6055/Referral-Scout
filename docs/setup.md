# First-time setup

1. Build with `pnpm check`, then load or reload dist/ in chrome://extensions.
2. Reload an existing ChatGPT tab so the updated content script is installed.
3. Open the extension and choose **Set up from my CV**.
4. Upload a PDF, DOCX or TXT file under 5 MB, paste CV text, or enter a public file
   link. Google Drive sharing links are converted to download links. If the public
   download returns a login/preview page, upload the downloaded file instead.
5. Read the sharing notice and agree before pressing **Read my CV with ChatGPT**.
   This sends your document to your logged-in ChatGPT website, without an API key.
   No login credentials are read. Keep its automation window visible.
6. Review the extracted name, contact email, education and proof points. Confirm
   that the email is the address you will actually send from in Gmail. Add your
   desired roles, availability, resume link and writing style, then save.
7. Open Settings anytime to edit the profile, Gmail account index, locations and
   campaign preferences. No personal profile is hardcoded into the extension.

You can skip ChatGPT and fill the same form manually. Failed extraction never
silently saves guessed data. Cancel removes the extension's pending CV data, but
cannot recall anything already submitted to ChatGPT. Original upload/text is
removed from the local task on completion/failure; saved profiles use Chrome sync.
Candidates are removed when saved/cancelled, and stale imports are cleared on
startup after a day. ChatGPT has its own data retention and privacy settings.

Provider preference: **ChatGPT first for writing and CV extraction; Gemini first
for research.** CV extraction does not silently send your CV to another provider.

This build includes guided setup, diagnostics, campaign controls, and a complete
mock campaign that does not open websites or send mail. Live automation remains
gated and needs verification in your own Chrome sessions; passing mock tests is not
proof that live selectors work. See implementation-status.md.
The CV driver has fixture/unit tests but still needs a live ChatGPT upload test on
your account. If upload controls change, pasted text remains the simpler fallback.
