# Configuration

Movo resolves configuration from five layers and records, for every single value, which layer
supplied it.

```ts
import { defineConfig } from "@movoframework/core";

export default defineConfig({
  env: "testnet",
  network: "stellar:testnet",
  payTo: process.env["MOVO_PAY_TO"],

  facilitator: {
    url: "https://www.x402.org/facilitator",
    timeoutMs: 10_000,
  },

  defaults: {
    price: "$0.001",
    maxTimeoutSeconds: 60,
  },

  discovery: {
    enabled: true,
    serviceName: "Example Weather",
    tags: ["weather", "forecast"],
  },
});
```

`defineConfig` is a pure identity-with-validation function. It performs no I/O and reads no
environment variable — if it did, the meaning of your config file would depend on where it was
imported from.

## Precedence

Lowest to highest:

| # | Layer | Source |
|---|---|---|
| 1 | `default` | Movo's built-in defaults |
| 2 | `config` | `movo.config.ts` |
| 3 | `env` | `MOVO_*` environment variables |
| 4 | `resource` | a per-resource override on `defineResource` |
| 5 | `argument` | an explicit argument at the call site |

A layer that says nothing about a setting does not un-set a lower layer. Absence means silence,
never "no" — otherwise precedence would depend on whether a key was written as absent or as
explicitly `undefined`, and that difference is invisible when you read a config file.

## Provenance

```ts
import { resolveConfig } from "@movoframework/core";

const resolved = resolveConfig({
  config: { payTo: "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3" },
  env: { MOVO_FACILITATOR_URL: "https://facilitator.example/" },
});

resolved.payTo.value;             // "GDVA…"
resolved.payTo.source;            // "config"
resolved.facilitator.url.source;  // "env"
resolved.defaults.maxTimeoutSeconds.source; // "default"
```

Every leaf is `{ value, source }`. This is not decoration. The single most common support
conversation about a configurable payment tool is "it is paying the wrong account", and the
answer is always that some layer nobody was thinking about supplied the value. Recording the
source at resolution time turns that conversation into one line of `movo doctor` output.

## Validation

All validation is eager and throws a `MovoError` at `resolveConfig` time — never at request
time. A server that starts with an invalid `payTo` and only discovers it when a buyer tries to
pay has converted a startup error into a customer-facing one.

| Rule | Code |
|---|---|
| `network` must be `stellar:testnet` or `stellar:pubnet` | `MOVO_E_NETWORK_UNSUPPORTED` |
| `payTo` must be a valid Stellar destination address | `MOVO_E_PAYTO_INVALID` |
| `env` and `network` must agree | `MOVO_E_ENV_NETWORK_MISMATCH` |
| `env: "pubnet"` requires `MOVO_ALLOW_PUBNET=1` | `MOVO_E_PUBNET_NOT_ENABLED` |
| `facilitator.authHeaders` must be a function | `MOVO_E_SECRET_IN_CONFIG` |
| `facilitator.url` must be an http(s) URL | `MOVO_E_FACILITATOR_URL_INVALID` |

Two of these deserve their reasoning stated.

**`env` and `network` are never coerced.** If you write `env: "pubnet"` with
`network: "stellar:testnet"`, Movo does not pick one. Guessing which you meant is guessing
about real money, and the guess would be silent.

**The pubnet interlock runs first.** If your configuration has several problems and one of them
is an undeclared intent to touch mainnet, that is the error you get. A safety interlock outranks
a consistency check.

## Environment variables

| Variable | Purpose |
|---|---|
| `MOVO_ENV` | `local`, `testnet` or `pubnet` |
| `MOVO_ALLOW_PUBNET` | Must be exactly `1` to permit `env: "pubnet"` |
| `MOVO_NETWORK` | CAIP-2 network identifier |
| `MOVO_PAY_TO` | The receiving Stellar address. Not a secret |
| `MOVO_FACILITATOR_URL` | Facilitator endpoint |
| `MOVO_FACILITATOR_API_KEY` | **Never read into configuration** — see below |
| `MOVO_STELLAR_RPC_URL` | Soroban RPC override |
| `MOVO_LOG_LEVEL` | `silent`, `error`, `warn`, `info`, `debug` |

`MOVO_ALLOW_PUBNET` must equal `1`. `true`, `yes` and `on` are not accepted. The friction is
deliberate: it makes a mainnet run an explicit act rather than the result of one edited line.

## Credentials

A facilitator credential is supplied as a function, never as a value:

```ts
import { defineConfig } from "@movoframework/core";

export default defineConfig({
  facilitator: {
    url: "https://facilitator.example/",
    authHeaders: async () => ({
      verify: { Authorization: `Bearer ${process.env["MOVO_FACILITATOR_API_KEY"] ?? ""}` },
    }),
  },
});
```

A literal string here throws `MOVO_E_SECRET_IN_CONFIG` at definition time. This is the cheapest
possible control: `MOVO_FACILITATOR_API_KEY` is never read into the configuration object at all,
so it cannot be reached by anything that walks it — a diagnostic dump, a test snapshot, a
printer nobody has written yet. Redaction is the backstop, not the plan.

There is also no field anywhere in `MovoConfig` that a Stellar secret seed would fit into. A
Movo resource server never needs one: it names an address to be paid, and the buyer signs. The
type system is a cheaper custody boundary than a code review.

## What is deliberately absent

`stellar.testnetFeeWorkaround` does not exist. The M0 spike settled on Stellar testnet first
try with no `fee: "1"` transaction clone, so the flag described in the official quickstart is
not required against `@x402/*` 2.21.0 and the public testnet facilitator. If a fee-limit failure
is ever observed it will be filed as a regression with its trigger condition, not coded around
pre-emptively. See `docs/SPIKE_REPORT.md` Q2.
