# Seller

You have an API. You want to be paid per call, and you want agents to be able to find it.

## 1. Scaffold

```sh
npm create movo-app@latest my-api
cd my-api
```

Set `MOVO_PAY_TO` to your Stellar testnet address. **A resource server needs no private key** — it
names an address to be paid and a price; the buyer signs. If you find yourself wanting to put a
secret in a server's environment, something has gone wrong.

```sh
pnpm dev
```

## 2. Declare a paid resource

One declaration carries the route, the price, the types and the discovery metadata. There is no
second file to keep in sync.

```ts
import { defineResource } from "@movoframework/core";
import { z } from "zod/v4";

export const currentWeather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather conditions for a city",
  serviceName: "Example Weather",
  tags: ["weather", "forecast"],

  input: z.object({
    city: z.string().describe("City name or IATA airport code, for example 'SFO'"),
  }),
  output: z.object({ city: z.string(), tempC: z.number(), conditions: z.string() }),

  discovery: {
    example: { city: "SFO" },
    outputExample: { city: "SFO", tempC: 14, conditions: "foggy" },
  },

  handler: (ctx) => ({ city: ctx.params["city"] ?? "unknown", tempC: 14, conditions: "foggy" }),
});
```

Two details that pay for themselves:

- **`zod/v4`, not the classic entry.** Only the v4 schema shape carries the internals
  `toJSONSchema` reads, which is what lets Movo derive your listing's `inputSchema` automatically.
  With a v3 schema Movo raises `MOVO_W_DISCOVERY_SCHEMA_UNDERIVED` and asks for an explicit
  `inputSchema` — it does not guess.
- **`.describe()` on every field.** An agent deciding whether to pay for your endpoint reads the
  parameter descriptions. An undescribed parameter is one it has to guess at.

To keep a route out of the catalog, say so explicitly:

```ts
import { defineResource } from "@movoframework/core";

export const internalMetrics = defineResource({
  method: "GET",
  path: "/internal/metrics",
  price: "$0.01",
  discovery: false,
  handler: () => ({ requests: 1024 }),
});
```

`discovery: false` is not the same as omitting the field. It records that you decided.

## 3. Check before you ship

```sh
pnpm movo doctor
```

Preflight checks the account exists, the trustline is present, the asset resolves, and the derived
discovery declaration passes upstream validation. Findings carry an executable remedy, not a link
to a tutorial.

Turn on `strictDiscovery` in production. A listing that will silently lose fields should stop the
server rather than ship quietly.

## 4. Get paid, and become findable

Run `examples/catalog-quickstart` to watch the whole thing happen:

```sh
pnpm --filter @movoframework/example-catalog-quickstart start
```

It starts a facilitator with a catalog, starts the API, pays it once on testnet, and then prints
the `/discovery/resources` entry and the `/discovery/search` hit. Real output:

```
paying once…
  status      settled
  transaction 730cf646611b8a47cfe6e9c542e64a947d126d578b45bf9012f64245f81d4deb
  verify      https://horizon-testnet.stellar.org/transactions/730cf646611b8a47cfe6e9c542e64a947d126d578b45bf9012f64245f81d4deb

GET /discovery/resources
  Example Weather  http://127.0.0.1:54850/weather/:city
     Current weather conditions for a city
     tags: weather, forecast
     price: 10000 of CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

No registration endpoint was called. The listing exists because someone paid.
```

**That is the whole listing flow.** You did not register anything.

## Declaring metadata does not create a listing

Worth being blunt about, because it is the most common misunderstanding.

Declaring discovery metadata puts it on your 402. A **listing** is created by the facilitator you
configured, when a buyer pays and echoes your declaration, and only if that facilitator operates a
catalog. Point `MOVO_FACILITATOR_URL` at a facilitator that runs one — or run your own, see the
[operator path](./operator.md).

## Declare a `routeTemplate`

Movo derives one from your `path`, and it is what collapses `/weather/SFO`, `/weather/LHR` and ten
thousand other concrete paths into **one** listing. Without it a catalog grows with your traffic
instead of with your number of endpoints.

Templates use Express `:param` syntax. `{param}` is not valid.

## Things that will catch you out

- **A paid route that returns 4xx is not charged for.** Upstream cancels settlement on status ≥
  400. A route that 404s costs the buyer nothing — a deliberate property, but budget for it.
- **You cannot stream a paid response.** Upstream buffers the full response until settlement
  resolves, so SSE and chunked responses do not reach the buyer incrementally. Movo warns
  (`MOVO_W_RESPONSE_NOT_STREAMED`) rather than letting you find out in production.
- **Your listing is owned by the address that was paid.** Nobody else can overwrite it, and you
  cannot move it by changing your `payTo` — that reads as a different seller.

## See also

- [Declaring metadata](../bazaar/declaring-metadata.md)
- [Why isn't my resource visible?](../bazaar/troubleshooting-visibility.md)
- [The payment lifecycle](../concepts/payment-lifecycle.md)
