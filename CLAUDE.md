# Movo — standing rules for Claude Code

Read `docs/context/MOVO_FINAL_ARCHITECTURE_SPEC.md` before any task.

- Implement ONE milestone per session. Never start the next one.
- Never reimplement an x402 or Stellar protocol primitive. If `@x402/core`
  or `@x402/stellar` exports it, import it.
- Only `packages/core/src/protocol/**` may import `@x402/*`.
- Never fake a settlement, a transaction hash, or a conformance result.
  Report UNVERIFIED instead.
- Verify upstream APIs by reading `node_modules/@x402/*/dist/**/*.d.mts`,
  not from memory or doc snippets.
- If you find an architectural conflict, STOP and explain. Do not redesign.