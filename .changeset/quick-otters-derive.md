---
"@movoframework/bazaar": minor
"@movoframework/client": minor
"@movoframework/core": minor
"@movoframework/server": minor
---

Bazaar discovery derivation with severity escalation, and the buyer client with budget
enforcement.

**`@movoframework/bazaar`.** `deriveDiscovery` builds the upstream declaration from the Movo
resource, so the route definition and the discovery metadata cannot drift apart. Input schemas
are converted to JSON Schema where the vendor allows it — Zod v4, reached by optional dynamic
import so Zod is never a dependency — with an explicit `inputSchema` override for everything
else and a warning rather than silence when neither applies. `validateDiscoveryStrict` runs
upstream's validators and turns each silent soft-drop into an error-level `Finding` with a fix.
`queryCatalog` composes `withBazaar` over a real facilitator client. `readCatalogOutcome`
interprets `EXTENSION-RESPONSES` as four states, where `unknown` means no signal and is not a
failure.

**This package implements no validator.** Upstream ships all of them, including the icon-URL SSRF
check and route-template traversal detection. `pnpm check:upstream-validators` enforces AC4.8
mechanically: it fails on a declared validator, a regex literal or a restated length constant,
and also fails if the package stops calling upstream altogether.

**`@movoframework/client`.** `createBudget` builds on upstream's `PaymentPolicy` and adds the
stateful spend accountant a stateless policy cannot provide. Refusal happens before payment
creation, so a refused offer leaves no signature in existence — asserted with a signer spy.
`createMovoClient` composes `x402Client`, the Stellar client scheme and `wrapFetchWithPayment`;
its `call()` reuses the server's own resource declaration so the handler's return type is the
call site's result type with no cast.

**`@movoframework/core`.** The narrow waist gains two modules: `@movoframework/core/bazaar` for
the discovery surface and `@movoframework/core/client` for the buyer surface. Subpaths, so the
main entry never loads `ajv`, a signing stack or an HTTP framework. `DiscoveryDeclaration` gains
optional `inputSchema`, `outputSchema`, `bodyType`, `toolName` and `transport`.

**`@movoframework/server`.** The mount derives each declaration, attaches it to the compiled
route, then registers `bazaarResourceServerExtension` behind `checkIfBazaarNeeded` — in that
order, because the question is only answerable after derivation has run. `strictDiscovery` fails
the mount when escalation finds an error, for deploy gates.

Two upstream findings recorded: `declareMcpDiscoveryExtension` does not exist (one function
dispatches on `toolName`), and no public `EXTENSION-RESPONSES` decoder exists upstream — a
genuine gap and a candidate contribution. Both are asserted by conformance tests that fail if
upstream changes.
