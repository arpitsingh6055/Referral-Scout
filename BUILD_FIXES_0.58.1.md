# Referral Scout 0.58.1 — TypeScript build fixes

This patch addresses the five TypeScript errors reported by the 0.58.0 build.

## Fixes

1. `src/background/workspace.ts`: AI-approved education records are now created with a guaranteed `level` and optional fields are conditionally included. This is compatible with `strict` + `exactOptionalPropertyTypes`; optional properties are omitted rather than assigned `undefined`.
2. `src/ui/workbench/preview.ts`: each illustrative `JobRow` now supplies its required `fitAssessed` state.
3. `src/ui/workbench/screens/overview.ts`: the overview header reads the queued count from `ctx.view.counts`, rather than referencing an out-of-scope `counts` variable.
4. Package and extension manifest versions are bumped to `0.58.1`.

## Validation boundary

- The changed TypeScript files were syntax-transpiled with the globally available TypeScript compiler.
- The ZIP archive was integrity-checked.
- A full `pnpm build` could not be run here because Corepack could not download the pinned `pnpm@11.25.0` from the npm registry (`EAI_AGAIN registry.npmjs.org`). The project dependencies are not installed in this environment. Run `pnpm build` locally to complete semantic typechecking and all Vite build modes.
