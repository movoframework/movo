---
"@movoframework/core": minor
---

Implement the Movo core: configuration with provenance, the resource model, the compiler, the
error registry, redaction, and the x402 protocol narrow waist. Everything is pure — no network,
no filesystem, no clock.

**Configuration.** `defineConfig` validates structurally and performs no I/O. `resolveConfig`
merges five layers — defaults, `movo.config.ts`, `MOVO_*` environment variables, a per-resource
override, an explicit argument — and returns every leaf as `{ value, source }` so `movo doctor`
can print where each setting came from. Validation is eager: an invalid `payTo` fails at startup
rather than when a buyer tries to pay. `env: "pubnet"` requires `MOVO_ALLOW_PUBNET=1`, and the
interlock is checked before anything else.

**Resources.** `defineResource` returns plain, serialisable data plus one handler. Input and
output types flow from a Standard Schema validator into the handler's context and out to the
buyer's call site. Prices are a money string (`"$0.001"`) or a SEP-41 asset amount; naming an
asset by ticker throws `MOVO_E_PRICE_ASSET_ALIAS` pointing at `getUsdcAddress`. Movo performs no
decimal conversion of its own. Wildcard paths are rejected.

**Compilation.** `compileApp` produces an `@x402/core` `RoutesConfig`, a handler map, declared
discovery route keys, the resolved configuration and static findings. `routes` is deliberately
the raw upstream type — a compile-time test asserts it is accepted by `@x402/express`'s
`paymentMiddleware` without a cast, so the escape hatch is a checked promise rather than a claim.

**Errors and redaction.** `MovoError` carries a stable code, a fix template and a docs URL built
from a single `DOCS_BASE_URL` constant. Context and message are redacted at construction, not at
log time, so an unredacted value cannot escape through an unanticipated serialisation path.
`docs/reference/errors.md` is generated from the registry and a test asserts they cannot diverge.

**Hooks** are observers only. Control flow stays with the upstream hooks on
`x402ResourceServer`, so there is exactly one implementation of payment ordering in the system.

Also in this change: the unit suite now fails if any test invokes `globalThis.fetch`; the npm
scope and the error-docs base URL are single-sourced with tests that fail if a literal reappears;
and a new gate compiles every TypeScript block in the documentation.
