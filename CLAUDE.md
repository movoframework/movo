# Movo — standing rules for Claude Code

## Read first, in this order — later amendments supersede earlier ones and the spec

1. `docs/context/MOVO_FINAL_ARCHITECTURE_SPEC.md`
2. `docs/context/SPEC_AMENDMENT_001.md`
3. `docs/context/SPEC_AMENDMENT_002.md`
4. `docs/context/SPEC_AMENDMENT_003.md`
5. `docs/context/SPEC_AMENDMENT_004.md`
6. `docs/context/SPEC_AMENDMENT_005.md`
7. `docs/context/SPEC_AMENDMENT_006.md`
8. `docs/SPIKE_REPORT.md` — empirical findings from M0; binding
9. `docs/CONFORMANCE.md` — Gate 1 evidence; binding

## Rules

- Implement ONE milestone per session. Never start the next one.
- Never reimplement an x402 or Stellar protocol primitive. If `@x402/core`
  or `@x402/stellar` exports it, import it.
- Only `packages/core/src/protocol/**` may import `@x402/*` — except
  `tests/e2e/**` and `tests/conformance/**`, which are exempt because they
  act as a genuine third-party buyer using an unmodified upstream client
  (amendment 004 §5).
- Never fake a settlement, a transaction hash, or a conformance result.
  Report UNVERIFIED instead.
- Verify upstream APIs by reading `node_modules/@x402/*/dist/**/*.d.mts`,
  not from memory or doc snippets.
- No gate ships without a proof-of-failure test.
- Single-source every identifier a gate depends on. A gate and its
  proof-of-failure fixture must derive shared strings from one constant,
  never from hardcoded copies that can drift apart.
- Test the ordinary case, not only the failure cases. A negative-only
  suite can pass while the common path is broken.
- Before implementing any check against real external state (a network
  call, a contract read, a signed payload, a settled transaction), verify
  the check fails when the real thing is genuinely absent — not only that
  it passes when handed a plausible value. A stub or fixture that
  typechecks or passes without doing the real thing is a more dangerous
  defect than a missing implementation, because nothing signals its
  absence.
- Before implementing anything that parses or serialises HTTP
  request/response bodies for `verify`, `settle`, or `supported`: that is
  the facilitator service regardless of which package it lives in or how
  small its intended surface is. It belongs behind the M6 gate, not in
  any earlier milestone. If a milestone's own spec text asks for it
  anyway, that is a spec conflict — STOP per the rule below rather than
  build it.
- If you find an architectural conflict, STOP and explain. Do not
  redesign. Report it rather than guess between two readings.
- Packages publish under the `@movoframework/*` npm scope. The product
  name, CLI binary, config filename, environment variable prefix, and
  error code prefix all remain `movo` / `MOVO_` — the scope is a registry
  namespace, not the product name.