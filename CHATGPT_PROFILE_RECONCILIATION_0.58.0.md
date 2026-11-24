# Referral Scout 0.58.0 — ChatGPT-mediated profile creation

## Product decision
LinkedIn capture and CV upload are source-evidence operations, not profile-write operations. The candidate profile is a consequential source of truth used for job fit and application autofill, so extracted data must not be written directly into it.

## New flow
1. Read the signed-in user's LinkedIn profile. The capture remains in the network/source store; it does not seed CandidateProfile.
2. Upload the CV. The original file and extracted text remain local source evidence; the CV is not parsed directly into CandidateProfile.
3. Select **Ask ChatGPT to reconcile CV + LinkedIn**.
4. Referral Scout sends the CV and LinkedIn evidence through the existing signed-in ChatGPT website workflow by default. The optional API configuration remains optional, not a setup requirement.
5. ChatGPT returns a constrained schema. The extension validates the schema before saving a pending draft. Invalid output is rejected and does not modify CandidateProfile.
6. The dashboard shows a review summary and explicit conflicts. The prompt instructs ChatGPT to use the CV value whenever CV and LinkedIn disagree, record both values, and never invent missing facts.
7. The user explicitly approves. Only then are new records added as low-confidence `model` provenance suggestions. Existing profile records are not overwritten; duplicate education, employment, projects and skills are filtered. The profile is requalified after approval.
8. The user can review/edit suggestions in Candidate profile. Model suggestions remain unverified until the user confirms them.

## Dynamic UI
- LinkedIn sign-in CTA is replaced by refresh/open actions once a LinkedIn profile has been captured; the dashboard refreshes state after the operation.
- CV upload changes to replace/manage state once the file is saved.
- ChatGPT reconciliation has its own busy label and stage-by-stage progress updates (ChatGPT opening, composer ready, request sent, thinking/streaming, response validation).
- A pending draft changes the primary CTA to **Review ChatGPT profile draft**.
- After approval, the pending draft is cleared and the workspace reports that suggestions were added; the UI offers reprocessing when sources change.

## Safety and integrity
- No profile write occurs during LinkedIn capture, CV upload, ChatGPT request submission or response validation.
- CV precedence is explicit in the prompt and surfaced conflicts are visible before approval.
- If the CV or LinkedIn capture changes while ChatGPT is processing, the draft is rejected as stale.
- Only schema-valid responses are accepted.
- AI-created records use `source: model`, confidence 0.6, and no `verifiedAt`; they remain suggestions.
- Existing confirmed values are not overwritten.
- A repeated approval filters records already present to avoid common duplicate imports.

## Known boundaries
- This pass requires both a LinkedIn capture and CV text for the combined reconciliation flow.
- The candidate profile model currently has no dedicated certifications collection; certifications are not written into an invented field.
- This is a source archive. The complete pnpm typecheck, Vitest suite, Vite builds and live ChatGPT/LinkedIn browser tests were not run in this environment because dependencies are not installed and the package registry is unavailable. Run the documented build locally before loading the extension.
