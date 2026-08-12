# Resources

A resource is the unit of authorship in Movo. One file, one `defineResource` call, one paid
endpoint.

```ts
import { defineResource } from "@movoframework/core";

export default defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather for a city",
  mimeType: "application/json",

  handler: (ctx) => ({ city: ctx.params["city"], tempC: 14, conditions: "foggy" }),
});
```

That object is plain, serialisable data plus exactly one function. `defineResource` validates
it and returns it. There is no registry, no mutable app instance and no side effect — which is
what lets `movo doctor` read a project statically without booting it, and what lets a test
construct a resource without starting a server.

## What a resource declares, and what it inherits

| Field | Required | Inherited from config when absent |
|---|---|---|
| `method`, `path` | yes | — |
| `handler` | yes | — |
| `price` | no | `defaults.price` |
| `network` | no | `network` |
| `payTo` | no | `payTo` |
| `maxTimeoutSeconds` | no | `defaults.maxTimeoutSeconds` |
| `description`, `mimeType` | no | — |
| `serviceName`, `tags`, `iconUrl` | no | `discovery.*` |
| `input`, `output` | no | — |
| `discovery` | no | — |

Inheritance is resolved at compile time, with provenance. `movo doctor` will tell you which
layer supplied each value; see [configuration](configuration.md).

## Prices

Two forms, and no others.

```ts
import { defineResource, getUsdcAddress } from "@movoframework/core";

// A money string. The $ prefix is required.
const byMoney = defineResource({
  method: "GET",
  path: "/cheap",
  price: "$0.001",
  handler: () => ({ ok: true }),
});

// An asset amount: a SEP-41 contract address and an integer amount in base units.
const byAsset = defineResource({
  method: "GET",
  path: "/exact",
  price: { asset: getUsdcAddress("stellar:testnet"), amount: "10000000" },
  handler: () => ({ ok: true }),
});

export const resources = [byMoney, byAsset];
```

Three rules explain most of what Movo rejects here.

**Assets are contract addresses, not tickers.** `{ asset: "USDC" }` throws
`MOVO_E_PRICE_ASSET_ALIAS`. A Stellar SEP-41 asset is identified by a contract address
beginning with `C`. Use `getUsdcAddress(network)` rather than writing one down — an address in
your source is a second copy of a value upstream already exports, and the day the two diverge
is the day money goes somewhere unexpected.

**Amounts are integer strings in base units.** Stellar USDC has 7 decimals, so one USDC is
`"10000000"`. A decimal point in an `amount` is rejected: it is almost always a unit error.
Movo performs no decimal conversion of its own — `convertToTokenAmount` from `@x402/stellar`
does it against the asset's real decimals, and a second implementation of that arithmetic is
the classic route to a payment out by a factor of ten million.

**A bare number is not a price.** `price: 0.001` throws, because `0.001` does not say what it
is 0.001 *of*.

## Paths

Paths are Express-style, must begin with `/`, and use `:name` for parameters.

Wildcards are rejected with `MOVO_E_PATH_WILDCARD`. The reason is not aesthetic: a wildcard
collapses many distinct resources onto one Bazaar catalog key, so a buyer browsing the catalog
sees one entry where there should be several and cannot tell them apart. Use a named parameter.

## Typed input and output

`input` and `output` accept any [Standard Schema](https://standardschema.dev) validator — Zod,
Valibot, ArkType. Movo depends on none of them; the schema library is yours.

```ts
import { defineResource } from "@movoframework/core";
import { z } from "zod";

export default defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",

  input: z.object({ city: z.string().describe("City name or IATA code") }),
  output: z.object({ city: z.string(), tempC: z.number() }),

  handler: (ctx) => ({ city: ctx.input.city, tempC: 14 }),
});
```

The types flow. `ctx.input` is `{ city: string }` because the input schema says so, and the
handler's return type is checked against the output schema. The same declaration is what
`@movoframework/client`'s `call()` will use on the buyer's side, so a change to the handler's
return type surfaces as a type error at the call site rather than as a surprise at runtime.

Describing your input fields is worth the keystrokes. An agent deciding whether to pay for your
endpoint reads the parameter descriptions; an undescribed parameter is one it has to guess at.
Movo raises `MOVO_W_PARAM_UNDESCRIBED` as a warning, not an error — whether that fails your
build is your policy, expressed with `movo doctor --fail-on warn`.

## What a handler knows

```ts no-check
handler: (ctx) => {
  ctx.input;                  // parsed and validated
  ctx.params;                 // path parameters
  ctx.headers;                // request headers
  ctx.correlationId;          // joins this request across logs
  ctx.payment.verified;       // literally `true`
  ctx.payment.amount;         // base units, as a string
  ctx.payment.requirements;   // the upstream PaymentRequirements
  ctx.raw;                    // framework escape hatch
}
```

`ctx.payment.verified` has the literal type `true`, not `boolean`. That encodes an invariant
rather than describing one: a handler does not run on an unverified request.

There is deliberately no settlement result. Settlement happens *after* the handler returns, so a
settlement field here could only ever be empty — and a field whose meaning is "not yet known" is
worse than no field. See [the payment lifecycle](payment-lifecycle.md), including the reason a
paid route cannot stream its response.

## Multiple payment options

`price`, `network` and `payTo` are shorthand for the single-payment-option case. A resource
that needs to accept several options writes the upstream `accepts` array directly on the
compiled route rather than through Movo's shorthand. That escape hatch is documented rather
than hidden: Movo's job is to make the common case short, not to make the general case
unreachable.

## Assembling an application

```ts
import { defineApp, defineResource } from "@movoframework/core";

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  handler: () => ({ tempC: 14 }),
});

export default defineApp({ resources: [weather] });
```

Explicit registration is the documented default. Directory scanning may arrive as an opt-in,
but it will not become the default: a scan makes the set of paid routes depend on the
filesystem at boot, which is exactly the kind of thing that differs between a laptop and a
container and leaves a route unpaid in production.
