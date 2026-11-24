# Build validation — 0.57.0

## Passed
- `manifest.json` parses as valid JSON.
- `package.json` parses as valid JSON.
- TypeScript transpilation: 126 `.ts`/`.tsx` source, test and script files; zero syntax diagnostics.
- ZIP archive integrity is checked after packaging.

## Not completed
The full build command (`pnpm build`, which runs `tsc --noEmit`, three Vite builds and `scripts/check-build.mjs`) could not be run in this environment. The project has no `node_modules`, and Corepack could not download the pinned `pnpm@11.25.0` package because DNS/network access to `registry.npmjs.org` failed with `EAI_AGAIN`.

The global TypeScript 5.8.3 compiler also cannot run the project's configured typecheck because the project-pinned TypeScript 7.0.2, `@types/chrome`, `@types/node`, Vite, Vitest and Zod packages are not installed. Syntax transpilation is not a substitute for a typecheck or runtime test suite.

No stale `dist/` output is included. The archive is a source package, not a claimed compiled extension build.

## Run locally
```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

If the build passes, load `dist/` in Edge using `edge://extensions` → **Load unpacked**.
