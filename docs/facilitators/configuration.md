# Configuring a facilitator

```ts
import { defineConfig } from "@movoframework/core";

export default defineConfig({
  facilitator: {
    url: "https://www.x402.org/facilitator",
    timeoutMs: 10_000,
  },
});
```

| Setting | Default | Notes |
|---|---|---|
| `facilitator.url` | `https://www.x402.org/facilitator` | Also settable with `MOVO_FACILITATOR_URL`. Must be `http` or `https`, else `MOVO_E_FACILITATOR_URL_INVALID` |
| `facilitator.timeoutMs` | `10000` | Applied per request — verify, settle and every `getSupported` attempt |
| `facilitator.authHeaders` | none | A function, never a value. See [choosing](choosing.md) |

## Timeouts are not all equal

A `verify` timeout is a clean failure: nothing has happened, and the buyer can retry.

A **`settle` timeout is indeterminate** — upstream documents this explicitly, and it is worth
repeating because it is the one case where "the request failed" does not mean "nothing
happened". The facilitator may have submitted the transaction and simply not answered in time.
Treat a settle timeout as *unknown*, not as *failed*: check the chain before assuming a payment
did not go through.

## Supplying your own client

Anything implementing upstream's `FacilitatorClient` works, and Movo adds no interface of its
own:

```ts no-check
import { mountExpress } from "@movoframework/server";

await mountExpress(server, app, { facilitator: myFacilitatorClient });
```

This is the seam the M3 testing toolkit uses, and the same one a self-hosted facilitator will
use in M6. A parallel Movo interface would have needed adapters in both directions and would
have broken the moment upstream added a method.

## Checking it before you need it

```ts no-check
import { resolveConfig } from "@movoframework/core";
import { checks } from "@movoframework/stellar";

const finding = await checks.facilitator(resolveConfig());
console.log(finding.level, finding.detail);
```

The check reads `/supported` and reports whether the configured scheme and network are
advertised, and whether fees are sponsored. It sends no credential: the question does not need
one, and probing with a secret to answer it would be a poor trade.

An unreachable facilitator is a **warning**, not an error. A local network problem is not a
misconfiguration, and a preflight that failed a deploy gate for one would be switched off.
