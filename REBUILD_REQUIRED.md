# Build and release status — Referral Scout 0.56.3

This ZIP contains the updated source tree. It does **not** contain a rebuilt `dist/` directory. I did not copy an older compiled extension into this package because that would silently omit the 0.56.3 changes.

## Build locally

Use Node.js 22+ and the pinned package manager from `package.json`:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm check
```

The build script runs the TypeScript typecheck, three Vite builds (dashboard, content and apply) and `scripts/check-build.mjs`. The `check` script additionally runs formatting and Vitest.

After a successful build, load the generated `dist/` folder through `edge://extensions` → **Load unpacked**.

## Validation done here

- ZIP archive integrity is verified.
- 128 TypeScript source/test/script files passed `transpileModule` syntax transpilation (TypeScript 5.8.3).
- The full project typecheck, Vitest suite and Vite production build were **not** run: the pinned pnpm release could not be downloaded from the npm registry, and `@types/chrome`, project-local dependencies, Vite and Vitest were not installed in this environment.
- Live LinkedIn, ChatGPT, Gmail and ATS interaction QA remains a release requirement.
