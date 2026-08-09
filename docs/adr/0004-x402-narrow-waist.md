# ADR-0004 — The x402 narrow waist

- **Status:** Accepted
- **Date:** 2026-08-09
- **Milestone:** M0
- **Relates to:** spec §1.5 P2, §1.8 D1, §4.2 invariant 3, ADR-0001, ADR-0002

## Context

`@x402/*` is the protocol source of truth for Movo, and it moves fast. Version 2.21.0 was
published on 2026-08-04; the release cadence is roughly weekly; and the packages pin each other
with tight `~` ranges, so a bump in one generally implies a bump in all.

Movo has eight core-track packages. Protocol types — `PaymentRequirements`, `PaymentPayload`,
`RouteConfig`, `FacilitatorClient`, the Stellar scheme classes — are naturally reached for in
most of them. If each package imports `@x402/*` directly, an upstream breaking change produces
compile errors scattered across the whole monorepo, in files whose authors were not thinking
about protocol compatibility when they wrote them, with no single place to absorb the change.

Movo also makes a strong public claim: that it reimplements no x402 or Stellar protocol
primitive. A claim of that kind needs to be mechanically checkable, or it decays into a
promise that a busy afternoon quietly breaks.

## Decision

**Only files under `packages/core/src/protocol/**` may import from `@x402/*`. Everywhere else
imports what it needs from `@movo/core`.**

Enforced by Biome in `biome.jsonc`:

```jsonc
"linter": {
  "rules": {
    "style": {
      "noRestrictedImports": {
        "level": "error",
        "options": {
          "patterns": [{ "group": ["@x402/*", "@x402/**"], "message": "MOVO NARROW WAIST …" }]
        }
      }
    }
  }
},
"overrides": [
  { "includes": ["packages/core/src/protocol/**"],
    "linter": { "rules": { "style": { "noRestrictedImports": "off" } } } }
]
```

The pattern matches deep subpaths as well as package roots, so
`@x402/stellar/exact/server` is caught as surely as `@x402/core`.

### The rule is proven to fire, not assumed to

`tests/unit/narrow-waist.test.ts` writes a genuine violation to
`packages/stellar/src/`, runs the real Biome binary over it, asserts the real diagnostic,
and deletes the file. It also asserts the *negative*: that the same import inside
`packages/core/src/protocol/` is permitted, so the override cannot silently widen or vanish.

This is not ceremony. During M0 the configuration was first written as `biome.json` with an
explanatory comment above the rule. Biome parses `biome.json` as **strict JSON** and, on
reaching the comment, **silently truncated the configuration** — the linter reported success
while the most important rule in the repository was not loaded at all. Nothing failed. The
only reason it was caught is that a test asserted the rule *fires*.

Two consequences were adopted from that:

1. The configuration lives in **`biome.jsonc`**, which Biome parses as JSON-with-comments and
   discovers automatically. A gate this important must not be disableable by a comment.
2. Every future compliance gate in this repository ships with a test that proves it fails on a
   fixture designed to violate it. A gate nobody has watched fail is indistinguishable from a
   gate that does not work.

## Consequences

- An upstream breaking change is confined to one directory: one file to read, one file to
  edit, one diff to review — and a natural place for a reviewer with protocol context to be
  the required approver.
- `docs/COMPATIBILITY.md` has a single, well-defined derivation point.
- The "Movo reimplements no protocol primitive" claim becomes checkable: protocol code cannot
  spread, because protocol *imports* cannot spread.
- The cost is one indirection and some re-export boilerplate in
  `packages/core/src/protocol/index.ts`. This is the intended cost.
- A consumer who wants an unaliased x402 type imports it from `@x402/core` in their own code.
  Movo's boundary governs Movo's source, not its users'. This must stay documented, since it
  is the one place Movo's abstraction deliberately stops.
- The protocol module is a re-export surface, not a redesign surface. Re-exporting an upstream
  type under a different name would reintroduce the `@movo/x402` problem inside a directory
  (ADR-0002). Renaming is permitted only with a recorded reason.

At M0 `packages/core/src/protocol/` contains no files: no package has code yet, so there is
nothing to re-export. The rule and its test are in place first, deliberately, so that the
boundary exists before the first import that would test it.

## Alternatives rejected

**A published `@movo/x402` façade package.** Rejected in ADR-0002. It achieves the same
isolation at the cost of a version, a publish cadence, a changelog and a compatibility promise
— none of which a directory needs.

**Convention plus code review.** Rejected. The boundary must hold on the afternoon when
someone needs one type in a hurry, which is exactly when review attention is scarcest.

**A dependency-graph check in `check-track-isolation.ts` instead of a lint rule.** Rejected:
the linter already parses every file, reports at the exact import site with a fixable
diagnostic, and shows the developer the error in their editor before they commit. A separate
script would report the same thing later and less precisely.

**Allowing type-only `import type` from `@x402/*` anywhere.** Rejected. Type-only imports are
where upstream breaking changes surface *first*, so exempting them would exempt the majority of
the churn this rule exists to contain.
