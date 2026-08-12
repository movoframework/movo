# weather-api

A minimal paid API: one paid route, one free route, settled in USDC on Stellar testnet.

```
GET /health           free
GET /weather/:city    $0.001
```

## Run it

```bash
cp .env.example .env     # then set MOVO_PAY_TO to your G... address
pnpm --filter @movoframework/example-weather-api start
```

The server prints its resolved configuration at boot, with the provenance of every value:

```
weather-api listening on http://localhost:4021
  network   stellar:testnet (from config)
  payTo     GCQQ…2NAM (from env)
  facilitator https://www.x402.org/facilitator (from default)

  free  GET /health
  paid  GET /weather/:city
```

That printout is the answer to "why is it paying the wrong account" — the layer that supplied
each value is recorded at resolution time. See [configuration](../../docs/concepts/configuration.md).

## Try it

The free route needs nothing:

```bash
curl localhost:4021/health
# {"ok":true}
```

The paid route returns 402 with the terms:

```bash
curl -i localhost:4021/weather/SFO
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Miw...
```

Decode that header with `decodePaymentRequiredHeader` from `@movoframework/core` and it names
the scheme, the network, the account to pay, and the amount in base units. To pay it, use any
x402 client — `docs/quickstart.md` walks through one end to end.

## What is worth noticing in the source

**`src/resources.ts`** is the whole authoring surface. One `defineResource` call carries the
method, the path, the price, the schemas and the handler. There is no routes object to keep in
sync with the handler, and no discovery declaration duplicating either.

**`src/server.ts`** contains no payment code. Mounting is one call. The free `/health` route is
an ordinary Express route that the payment middleware never touches — only paths declared
through `defineResource` are protected.

**Nothing anywhere constructs a header, an XDR envelope, or a signature.** That is enforced, not
just intended: `pnpm check:protocol-purity` fails the build if a Movo package starts doing any
of it.

## When it does not work

Run the preflight checks. The most common failure by a wide margin is a missing USDC trustline
on the receiving account, which otherwise surfaces as a rejected payment that says nothing about
the account:

```ts no-check
import { resolveConfig } from "@movoframework/core";
import { preflight } from "@movoframework/stellar";

for (const finding of await preflight(resolveConfig())) {
  console.log(`[${finding.level}] ${finding.title}`);
  if (finding.fix) console.log(`  fix: ${finding.fix}`);
}
```

`docs/stellar/setup.md` covers keypairs, funding and trustlines in order.
