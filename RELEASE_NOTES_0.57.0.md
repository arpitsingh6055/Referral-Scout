# Release notes — Referral Scout 0.57.0

- Added floating, cross-surface notifications with operating-system fallback for important milestones.
- Added click-through from system notifications to the workbench.
- Connected Overview, Jobs and the empty Application Queue to the real LinkedIn job-discovery workflow.
- Added visible job-search and description-ranking progress to Overview and Jobs.
- Disambiguated job discovery from application-queue execution.
- Removed the manual-specialisation gate from ChatGPT fit ranking; ranking now uses the full LinkedIn/CV background by default.
- Preserved ChatGPT fit and rationale in canonical job records, distinguished deterministic fallback scores, and stopped displaying unassessed jobs as Fit 0.
- Expanded local matching to include employment technologies and project skills.
- Hid stale AI fit after the candidate profile version changes.
- Changed the default Jobs filter to All.
- Kept job-board discovery scope honest: LinkedIn Jobs is the implemented discovery source in this release.
- Preserved local-first storage and existing signed-in browser-session integrations; no API key or backend is required.
