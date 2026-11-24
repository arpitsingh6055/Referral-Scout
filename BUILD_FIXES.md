# TypeScript build fixes

Date: 2026-11-25

This follow-up addresses the three TypeScript diagnostics reported after running `pnpm build` on the UX redesign source package.

## Changes

1. `src/ui/setup.ts`
   - Removed the unused `defaultSettings` import. The setup module no longer references it.

2. `src/ui/workbench/api.ts`
   - Changed the generic message envelope's `data` field from `unknown` to `T` (`data?: T`).
   - This makes the typed result of `ask<NetworkState>(...)` available to `sendNetwork` without an unsafe or incomplete `{}` inference. The background network message handler returns the network state in `data` for successful network requests.

3. `src/ui/workbench/preview.ts`
   - Added `usageReporting: false` to the mock `WorkspaceView`, matching the product's opt-in privacy default and the required `WorkspaceView` contract.

## Validation status

- Confirmed each reported source location is corrected.
- Confirmed the updated source package is a valid ZIP archive.
- A full `pnpm build` could not be run in the authoring environment because `pnpm` and project dependencies were unavailable. The global TypeScript compiler also could not start project checking because `@types/chrome` and `@types/node` were not installed. An npm dependency installation attempt timed out.

Run this on a machine with the lockfile dependencies installed:

```bash
pnpm install --frozen-lockfile
pnpm build
```
