# Spec Amendment 007 — M4 WIP review, D3 reaffirmed, upstream API corrections

**Applies to:** `MOVO_FINAL_ARCHITECTURE_SPEC.md` §5.7, §22 (M4 prompt); `packages/bazaar`,
`packages/core/src/protocol`
**Trigger:** A WIP M4 implementation (commit `a9065a1`) produced by GitHub Copilot was reviewed
before continuation. Six of eight files are discarded; two are retained with fixes. The review
established that the commit never compiled and was never run.
**Status:** binding — supersedes §5.7 and the M4 prompt where they conflict

---

## What happened, and why the review is trusted

A partial M4 implementation was carried over from a different agent. Rather than build on it, it
was reviewed as an external PR. The review is trusted here for one specific reason: it did not
read upstream's documentation and infer behaviour — it **ran the installed `@x402/extensions`
package** and recorded actual outputs (`isValidServiceName("café") → false`,
`validateRouteTemplate("%2e%2e%2f") → undefined`, and so on). Every claim that upstream already
implements a given rule is therefore backed by an observed result, not an assumption. This is
the same standard M2 met by deriving the USDC contract id rather than trusting an asset code.

**Established fact:** `packages/bazaar/package.json` in the WIP declared no `dependencies`, so
neither `@movoframework/core` nor `@x402/extensions` resolved. `tsc --build` produced 12 errors;
the code had never executed. Every behavioural claim in its comments (`"SSRF defense"`,
`"Implements all documented rejection causes"`) is unverified assertion over code that has never
run. This is the purest form of the amendment 004 §6 plausible-fake pattern: confident prose
describing untested behaviour.

## 1. D3 reaffirmed — the discarded files violated it outright

Six files are discarded, ~890 of 1,131 lines. The controlling reason is D3 / AC4.8: Movo derives
and escalates; it does not reimplement Bazaar validators. `[FACT — probed live]` upstream
`@x402/extensions` already implements every rule the WIP rewrote:

| WIP file | Reimplemented what upstream already exports |
|---|---|
| `serviceMeta.ts` | `isValidServiceName`, `sanitizeTags`, `isValidIconUrl`, `sanitizeResourceServiceMetadata` — including its own printable-ASCII regex and its own SSRF/loopback checks |
| `routeTemplate.ts` | `validateRouteTemplate` — including the percent-encoded traversal case it presented as its own security contribution |
| `validate.ts` | A parallel validator with its own `BAZAAR_E_*` code namespace, outside M1's single `MOVO_E_*` registry |
| `types.ts` | Declaration shapes upstream already types |

Three of the four were caught by the narrow-waist lint rule (they import `@x402/extensions`
directly, which only `packages/core/src/protocol/**` may do). `serviceMeta.ts` escaped the lint
only because it was unreachable — the linter fires on files it can resolve, and nothing resolved.

**Two files also embody amendment 004 §6 specifically:**

- `query.ts` returns `{ resources: [] }` unconditionally from both methods. It typechecks,
  satisfies its signature, and would report every catalog as empty. A plausible fake.
- `validate.ts` calls upstream `validateDiscoveryExtension(config)` inside a `try/catch` and
  **discards its return value**. Upstream returns `{ valid, errors }`; it does not throw. So the
  one genuine upstream call in the file is a no-op catching an exception that never comes —
  delegation that is present in the source and absent in behaviour. This is the most deceptive
  instance of the pattern seen so far, because a grep for "does this call upstream" passes.

## 2. Two files retained

**`responses.ts` — retained with fixes.** The only WIP file addressing something upstream does
not provide. `[FACT — confirmed from upstream source]` `@x402/core` has an internal
`logExtensionResponsesHeader` but exports no public `EXTENSION-RESPONSES` decoder; the wire
format (base64 JSON keyed by extension key, fields `status` / `rejectedReason`) was confirmed
from source, not guessed. Required fixes: return the four-state union
(`success` | `processing` | `rejected` | `unknown`) rather than `undefined` for absent/malformed/
missing — `unknown` is load-bearing per §5.7 and AC4.3, and collapsing three situations into
`undefined` reintroduces the false-failure-signal problem amendment 004 §1 already ruled on;
rename to `readCatalogOutcome` per §5.7; use the repo's runtime-neutral base64 decode, not
`Buffer`.

**`declare.ts` — rebuild, keep only the delegation shape.** Delegating to
`declareDiscoveryExtension` is the right spine. Everything around it is discarded: `const config:
any` (forbidden, and the reason wrong field names went unchecked — it wrote the inner body-type
discriminator `"queryParams"|"body"` where upstream's `input: { type: "http"|"mcp" }` was
required); passing `resource.input` (a Standard Schema) where JSON Schema is required, with the
Standard-Schema-to-JSON-Schema derivation that is the actual work of `deriveDiscovery` missing
entirely; no `inputSchema` override (§22 requires it and a test for it); `console.warn`-then-
return-`{}` on failure, which bypasses the logger's redaction and makes a mis-declared resource
silently undiscoverable; and the wrong public name (`toDiscoveryExtension` rather than
`deriveDiscovery(resource, resolvedConfig)`, the latter dropping project-level serviceName/tags/
iconUrl inheritance).

## 3. Upstream API corrections — §22 was written against APIs that differ

`[FACT — from installed declarations]`

1. **`declareMcpDiscoveryExtension` does not exist.** There is one `declareDiscoveryExtension`
   that dispatches on whether `toolName` is present in the input. §22 names two functions. This
   is a real divergence from the prompt but a benign one — the capability exists under a single
   entry point rather than two. `deriveDiscovery` dispatches accordingly; it does not call a
   second, non-existent function.

2. **No public `EXTENSION-RESPONSES` decoder exists upstream.** This is a genuine gap, not a
   Movo oversight, and is the justification for `responses.ts` existing at all. Per §22's shim
   rule, it is flagged as a candidate upstream contribution. Movo's decoder is confined to
   `responses.ts` and matches the wire format confirmed from upstream source.

## 4. Structural blocker — the waist must be extended first

`@x402/extensions/bazaar` is **not currently re-exported through
`packages/core/src/protocol/`**. Until it is, `packages/bazaar` has no lawful way to reach the
upstream validators D3 requires it to delegate to — every attempt would trip the narrow-waist
rule. Therefore the **first** task of the M4 rebuild, before any `packages/bazaar` code, is to
extend the protocol module with the `@x402/extensions/bazaar` surface Movo consumes
(`declareDiscoveryExtension`, `validateDiscoveryExtension`, `validateDiscoveryExtensionSpec`,
`validateRouteTemplate`, `isValidServiceName`, `isValidIconUrl`, `sanitizeTags`,
`sanitizeResourceServiceMetadata`, `bazaarResourceServerExtension`, `withBazaar`,
`checkIfBazaarNeeded`, and the relevant types). This is the same pattern M2 followed for
`@x402/express` at the `@movoframework/core/server` subpath (amendment 004 §3).

## 5. `$ref` schema validation — deferred, not adopted

`validate.ts`'s `validateSchemaForRefs` addresses something upstream may not cover. It is out of
scope regardless: §22 never asks for `$ref` validation and AC4.8 forbids Movo-owned validators.
If it is a real security gap it goes **upstream** per the shim rule, with a local shim marked
for deletion only if M4 genuinely cannot proceed without it — which it can. Deferred.

## 6. The rebuild order

1. Extend `packages/core/src/protocol/` with the `@x402/extensions/bazaar` surface (§4 above).
2. `deriveDiscovery(resource, resolvedConfig)` — real Standard-Schema → JSON-Schema derivation,
   `inputSchema` override with a test, single-function MCP dispatch (§3.1).
3. `validateDiscoveryStrict(compiledApp)` — call upstream validators, **use their return
   values**, escalate each soft-drop to an error-level `Finding` in the existing `MOVO_E_*`
   registry. No `BAZAAR_E_*` namespace.
4. `queryCatalog(facilitatorUrl)` over the real `withBazaar` — not a stub.
5. `readCatalogOutcome` returning the four-state union (retained `responses.ts`, fixed).
6. Register `bazaarResourceServerExtension` in `@movoframework/server` behind
   `checkIfBazaarNeeded`.
7. Then `packages/client` — budget, `createMovoClient`, typed `call()`.

## 7. The gate did its job

AC4.8 — "every validation call resolves to an upstream export" — would have failed on four of
the eight WIP files. The check works. The discarded ~890 lines are real effort, and D3 discards
them regardless of that effort, exactly as the rule is written to.

## 8. Note for the M4 completion report

Whoever completes M4 must, in the final report, confirm: the narrow-waist extension was done
first and `packages/bazaar` imports `@x402/*` nowhere; `validateDiscoveryStrict` uses upstream's
returned `{valid, errors}` rather than wrapping upstream in a try/catch; `queryCatalog` reaches
a real facilitator and is not a stub; `readCatalogOutcome` returns all four states with a test
for `unknown`; and the AC4.8 "resolves to an upstream export" test passes against the rebuilt
files. Each is a place the discarded WIP failed, so each is a place the rebuild must be shown to
succeed rather than assumed to.
