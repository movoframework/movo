# {{projectName}}

A paid HTTP API, settled on Stellar. One route, one price, one handler.

## Next commands, in order

```bash
npm install
cp .env.example .env      # then set MOVO_PAY_TO to your Stellar address
npx movo doctor           # checks everything before you need it
npx movo dev              # starts the server
```

`movo doctor` is the one to run first and to run again whenever something is confusing. It
checks your Node version, your `@x402/*` pins, your configuration, whether your `payTo` account
exists and is funded, whether it has a trustline for the asset you are charging in, whether your
facilitator is reachable and advertises your network — and it prints a fix for each thing it
finds.

## What you get

| Route | Price | |
|---|---|---|
| `GET /health` | free | mounted before the payment middleware |
| `GET /weather/:city` | `$0.001` | paid |

Call the paid route without paying and you get `402` with a `PAYMENT-REQUIRED` header. That
header carries the payment requirements; the response body is empty, which is the protocol's
shape rather than an omission.

## Getting paid, for real

You need a Stellar **testnet** account with a **USDC trustline**. The trustline is the step that,
if skipped, produces a payment failure whose message says nothing about the account that caused
it — which is exactly why `movo doctor` checks it.

1. Create an account and fund it:
   `curl "https://friendbot.stellar.org/?addr=<your G… address>"`
2. Add a USDC trustline using the [Stellar Lab](https://lab.stellar.org).
3. Put the address in `.env` as `MOVO_PAY_TO`.
4. `npx movo doctor` — every Stellar check should read `ok`.

A buyer needs the same trustline plus an actual USDC balance, from
[Circle's faucet](https://faucet.circle.com). The faucet is captcha-gated, so that step is manual
by design.

## Files

```
movo.config.ts        configuration; the `config` layer, overridden by environment variables
src/app.ts            every resource this API serves
src/resources/        one file per resource — route, price and handler in one declaration
src/server.ts         the production server, for `npm start`
src/weather.test.ts   runs with no keys, no funds and no network
```

## Testing

```bash
npm test
```

The generated test uses `MockFacilitator`, so it needs no keys, no funds and no network. It
makes orchestration deterministic; it is not a settlement simulator and does not pretend to be
one. For real settlement, run `movo dev --facilitator in-process` against testnet.

## Development modes

```bash
movo dev                            # your configured facilitator (default)
movo dev --facilitator mock         # no network, no keys, fastest loop
movo dev --facilitator in-process   # REAL testnet settlement, in this process
```

`--facilitator in-process` performs genuine verification and genuine on-chain settlement. It is
named that way so nobody mistakes it for an offline stub, and it refuses to run on mainnet.

## Deploying

There is no `movo build` and no `movo deploy`, deliberately. A Movo app is TypeScript: `tsc` is
sufficient, and a deploy command would imply a platform Movo does not have. Run it anywhere that
runs Node.

Before you deploy: set `MOVO_ENV=pubnet`, `network: "stellar:pubnet"` and `MOVO_ALLOW_PUBNET=1`
— the last one is deliberate friction, and `movo doctor` will tell you if you have set two of
the three.

## Telemetry

None. Movo collects nothing, reports nothing, and phones nowhere.
