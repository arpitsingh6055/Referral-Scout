## Summary
Describe the user-facing or engineering problem and the changes made.

## Verification
- [ ] `pnpm format:check` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes (MV3 CSP, version parity, zero source maps or unsafe code)

## Safety & Store Compliance
- [ ] Preserves `trustedExtension` sender validation and default human-in-the-loop review gates
- [ ] Introduces no broad `host_permissions` or external credentials handling
