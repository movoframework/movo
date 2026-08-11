# Compilation

`compileApp` turns resources plus configuration into an `@x402/core` `RoutesConfig`, a handler
map, and a set of static findings. It is the heart of Movo and it is entirely pure.

```ts
import { compileApp, defineApp, defineResource } from "@movoframework/core";

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current conditions",
  handler: () => ({ tempC: 14 }),
});

const compiled = compileApp(defineApp({ resources: [weather] }), {
  config: { payTo: "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3" },
});

compiled.routes;             // RoutesConfig — the raw upstream type
compiled.handlers;           // Map<"GET /weather/:city", CompiledHandler>
compiled.discoveryDeclared;  // route keys that will carry a Bazaar declaration
compiled.resolvedConfig;     // every value with its provenance
compiled.diagnostics;        // static findings — never network-derived
```

## Purity is the point

No network. No filesystem. No clock. Three things follow from that, and each of them is a
feature somebody uses:

- `movo doctor` can analyse a project without booting it, so it is fast and cannot fail because
  a facilitator is having a bad afternoon.
- The unit suite is hermetic, and the suite *fails* if any test performs a real `fetch`.
- Compilation is deterministic, so a test can assert on the exact output rather than
  approximately.

## Route keys

A route key is `"<METHOD> <path>"` — `"GET /weather/:city"`. The format is upstream's: a key
with no space matches any verb, a key with one matches that verb only.

Route keys are the identity of a paid resource, so two resources compiling to the same key is
an error (`MOVO_E_ROUTE_DUPLICATE`) rather than a last-one-wins merge. Silently keeping the last
would make which handler runs depend on array order.

## `routes` is the raw upstream type

`CompiledApp.routes` is `RoutesConfig` from `@x402/core`. It is not wrapped, not renamed and not
narrowed. You can take it straight to upstream's middleware and never import a Movo server
package at all:

```ts no-check
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { compiled } from "./app.js";

const app = express();
app.use(paymentMiddleware(compiled.routes, myResourceServer));
```

That escape hatch is a stability promise, not an accident. It is also mechanically checked: a
compile-time test in `packages/core/src/protocol/` assigns `compiled.routes` to
`Parameters<typeof paymentMiddleware>[0]` with no cast, so the promise fails at `pnpm test` if
upstream's shape ever moves.

## What compilation does not do

It does not convert decimals, build headers, contact a facilitator, or model the payment
lifecycle. `x402ResourceServer` owns verify → handler → settle, with its own abort and recover
hooks. Movo composes it and never reimplements it — see
[the payment lifecycle](payment-lifecycle.md).

It also does not emit `extensions.bazaar` yet. `discoveryDeclared` records which routes *will*
carry a declaration, so the Bazaar milestone has the route keys it needs without this milestone
guessing at a shape upstream is still moving.

## Where each error surfaces

Structural problems throw at `defineResource`; problems that depend on configuration throw at
`compileApp`. A wildcard in a path is wrong however the project is configured. A missing `payTo`
is only wrong once you know configuration does not supply one — and `compileApp` is the first
point at which that is knowable.

| Failure | Raised by | Code |
|---|---|---|
| Wildcard path, bad method, bad price shape | `defineResource` | `MOVO_E_PATH_WILDCARD`, `MOVO_E_METHOD_INVALID`, `MOVO_E_PRICE_*` |
| No `payTo` anywhere | `compileApp` | `MOVO_E_PAYTO_MISSING` |
| No price anywhere | `compileApp` | `MOVO_E_PRICE_MISSING` |
| Duplicate route key | `compileApp` | `MOVO_E_ROUTE_DUPLICATE` |
| Discovery metadata while discovery is disabled | `compileApp` | `MOVO_E_DISCOVERY_DISABLED` |
| Bad network, `payTo`, or env pairing | `resolveConfig` | see [configuration](configuration.md) |

## Diagnostics

`compiled.diagnostics` holds `Finding`s — data, never exceptions. A finding has a stable `id`,
a level, a detail and a fix.

Whether a finding should fail your build is policy, and policy belongs to you:
`movo doctor --fail-on warn` is a flag for exactly that reason. The library reports; the CLI
decides.

One caveat worth stating plainly. `MOVO_W_PARAM_UNDESCRIBED` is detected by inspecting a
Zod-shaped `shape` property, because Standard Schema exposes validation but not introspection —
there is no vendor-neutral way to ask a schema whether its fields are described. Against a
validator Movo cannot introspect, the warning simply does not fire. That is deliberate: a
warning that silently never fires for Valibot users would be worse than one documented as
vendor-limited.
