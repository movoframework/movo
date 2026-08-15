# ADR-0010 — The Bazaar boundary

- **Status:** Accepted
- **Date:** 2026-08-14
- **Milestone:** M4
- **Related:** ADR-0004 (narrow waist), ADR-0007 (Stellar boundary), Spec Amendment 007
- **Implements:** D3

## Context

Bazaar is the part of Movo most likely to grow a parallel implementation, and it already did once.
A partial M4 written by a different agent produced four files reimplementing validators upstream
already ships — service-name checks, an SSRF icon-URL check, route-template traversal detection,
a tag sanitiser — and was discarded in review (amendment 007). Roughly 890 lines went.

The pull is easy to understand. Upstream's validators return booleans and sanitised copies; Movo
wants findings with fixes. Writing the check locally is the shortest path from one to the other,
and each individual instance looks reasonable. That is exactly why the rule has to be structural
rather than a matter of judgement at each call site.

## Decision

**Movo contributes derivation and severity escalation. Upstream validates. There is no third
option.**

| Concern | Owner |
|---|---|
| What is a valid service name, tag, icon URL, route template | `@x402/extensions` |
| Building the wire declaration | `@x402/extensions` (`declareDiscoveryExtension`) |
| Enriching the 402 with the declaration | `@x402/extensions` (`bazaarResourceServerExtension`) |
| Catalog storage, ranking, inclusion policy | **The facilitator** — not Movo |
| **Deriving the declaration from a Movo resource** | **Movo** |
| **Turning a silent soft-drop into a build-time error** | **Movo** |

### Why the rule is structural

`isValidIconUrl` is an **SSRF control**. If Movo ships a second one and the two drift, a URL Movo
blesses and a facilitator rejects is a support ticket — and a URL Movo blesses and a facilitator
*accepts* is a security finding. Neither is worth the convenience of a local copy, and "we will
keep them in sync" is not a plan that survives a year.

So it is enforced, not asked for. `pnpm check:upstream-validators` fails on a declared validator
function, a regular-expression literal, or a restated length constant anywhere in
`packages/bazaar` — and it also fails if the package stops importing upstream validators at all,
because a package that validates nothing would otherwise satisfy every negative rule while doing
nothing. Proof-of-failure fixtures cover all four cases.

### The waist had to be extended first

`packages/bazaar` may not import `@x402/*`, and D3 requires it to call upstream's validators.
Those two rules leave exactly one lawful path, and it runs through
`packages/core/src/protocol/bazaar.ts`. Building the package before the waist is what forced the
discarded WIP into writing its own validators: its imports did not resolve, and a local
implementation was the only way to make anything compile.

The waist is now four modules in one directory — root, `server`, `bazaar`, `client` — each behind
its own subpath so that importing `@movoframework/core` never loads an HTTP framework, a signing
stack, or `ajv`. Same boundary, organised by what a consumer actually needs (amendment 004 §3).

## Escalation reads upstream's return value

Upstream's validators return `{ valid, errors }`. **They do not throw.** The discarded WIP wrapped
one in a `try/catch` and discarded its return value, producing delegation that was present in the
source and absent in behaviour — a grep for "does this call upstream" passed, and the function
never produced a finding for any input.

Every call here uses the returned value, and the tests assert that findings **appear** for
known-bad input rather than that the function ran. Asserting "it did not throw" would have passed
for the broken version too.

Two validators are used, answering different questions:

- `validateDiscoveryExtensionSpec` — protocol invariants, safe on a pre-enrichment declaration
- `validateDiscoveryExtension` — internal consistency, expects the **post-enrichment** shape

The second needs `info.input.method`, which upstream's enrichment supplies at request time from
the route. Movo supplies the same value from the route key before validating, so the check runs
against the shape that will exist. That is not validation and not invention: it is the exact value
enrichment will use, and it moves a warning upstream only logs at request time into a build-time
finding.

## JSON Schema derivation has a real limit, and it is stated rather than hidden

Standard Schema v1 describes validation — a `validate` function and, at type level, input and
output types. It carries no JSON Schema and no way to produce one, so a vendor-neutral conversion
is not merely unimplemented but inexpressible.

Movo resolves an input schema in four steps: an explicit override, an existing JSON Schema, a
vendor converter, or nothing plus a warning. The only converter today is Zod v4, reached by
optional dynamic import so Zod is never a dependency — a Valibot project pays nothing, a Zod
project gets derivation free.

Zod's classic v3 schemas are **not** convertible; only the v4 shape carries the internals
`toJSONSchema` reads. Both report vendor `"zod"`, so the converter detects the flavour and the
finding names the actual fix rather than reporting a generic failure.

Step four is a warning rather than silence because an agent choosing whether to pay for an
endpoint reads its parameter schema. A listing without one is a listing it has to guess at.

## Consequences

`@movoframework/bazaar` is about 400 lines across five modules, and most of it is explanation.
That is the correct size for a package whose job is to call four upstream functions and explain
what they said.

`deriveDiscovery` is **async**, because vendor conversion may reach an optional converter by
dynamic import. It runs at compile and mount time, never per request. `compileApp` stays pure and
synchronous; the mount derives, attaches, then asks `checkIfBazaarNeeded` — in that order, because
the question is only answerable after derivation has run.

**Movo cannot promise catalog inclusion**, and the documentation leads with that rather than
burying it. Declaring metadata does not create a listing; a listing is created by the facilitator
you configured, when a buyer pays and echoes your declaration, and only if that facilitator
operates a catalog. Over-claiming discovery is the fastest available route to losing the
credibility of the audience this framework needs.

## Two upstream findings worth carrying forward

**`declareMcpDiscoveryExtension` does not exist.** §22 names it; the installed package exports one
`declareDiscoveryExtension` that dispatches on `toolName`. Benign, but asserted in
`upstream-conformance.test.ts` so a change is caught by a test.

**No public `EXTENSION-RESPONSES` decoder exists upstream.** `@x402/core` has an internal
`logExtensionResponsesHeader` and exports nothing. This is the one genuine gap Movo fills, it is
confined to `readCatalogOutcome`, and it is a candidate upstream contribution. A conformance test
fails if upstream ever ships one, at which point Movo should delete its decoder and delegate.
