# Build fixes — Referral Scout 0.58.2

## Reported compiler error

`src/ui/workbench/preview.ts:102` assigned `fitAssessed` to a sample `QueueRow`. That field belongs to `JobRow`, not `QueueRow`.

## Correction

- Removed the misplaced `fitAssessed` property from the first application-queue preview fixture.
- Kept `fitAssessed` on all three sample `JobRow` fixtures, where the property is required.
- Bumped both `package.json` and `manifest.json` to `0.58.2`.

No production queue or job-ranking logic was changed by this patch.

## Validation

- Confirmed the queue fixture no longer contains `fitAssessed`.
- Confirmed each of the three sample job fixtures retains `fitAssessed: true`.
- Confirmed package and manifest versions both equal `0.58.2`.
- ZIP integrity checked after packaging.
- Full project typecheck and Vite build were not run in this environment; run `pnpm build` locally to verify the complete project.
