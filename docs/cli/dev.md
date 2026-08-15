# `movo dev`

```bash
movo dev [--facilitator config|in-process|mock] [--port N] [--no-watch]
```

Starts the development server and prints, at boot, everything that decides whether a payment can
succeed.

## The boot output is the feature

```text
movo dev  /home/you/my-api

Resolved configuration
  env                         testnet                                                   from config
  network                     stellar:testnet                                           from config
  payTo                       GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E  from env
  facilitator.url             https://www.x402.org/facilitator                          from config
  facilitator.authHeaders     not set                                                   from default
  facilitator.timeoutMs       10000                                                     from default
  defaults.price              not set                                                   from default
  defaults.maxTimeoutSeconds  60                                                        from config
  discovery.enabled           true                                                      from default
  ...

Facilitator  config

Paid resources  1
  GET /weather/:city  $0.001  stellar:testnet  →  GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E

  listening on http://localhost:4021
```

Four values decide whether a payment works — network, `payTo`, price, facilitator — and each can
be set in five places. Printing the layer that supplied each one turns "it is charging the wrong
account" into one line you can read.

The output is snapshotted in the test suite, so a verbosity regression shows up in review rather
than in someone's terminal.

## The three facilitator modes

| Mode | Facilitator | Network | Use |
|---|---|---|---|
| `--facilitator mock` | `MockFacilitator` | none | Fast inner loop. No keys, no network. |
| `--facilitator in-process` | Upstream's real Stellar facilitator, in this process | `stellar:testnet` | Hermetic end-to-end with **real settlement** |
| `--facilitator config` (default) | `HTTPFacilitatorClient` | `stellar:testnet` | The facilitator you configured |

**`in-process` is not a stub.** It performs genuine verification and genuine on-chain settlement,
which is why it is named that way. It needs `STELLAR_PRIVATE_KEY` — a funded testnet **buyer**
key — because it signs and submits real transactions. Without one it refuses rather than falling
back to something that would appear to work.

**`in-process` refuses `stellar:pubnet`**, and `MOVO_ALLOW_PUBNET=1` does not unlock it:

```text
MOVO_E_FACILITATOR_PUBNET_REFUSED  `movo dev --facilitator in-process` refuses to start on
                                   stellar:pubnet.

  fix   Run `movo dev` against a real facilitator instead — omit --facilitator, or pass
        --facilitator config.
```

This is a different code from `MOVO_E_PUBNET_NOT_ENABLED`, whose fix is to set
`MOVO_ALLOW_PUBNET=1`. That code means "you have not confirmed you intend mainnet". This one
fires *after* you have, and no development scenario wants a development command moving real funds.

## Watching

`node --watch`, which ships with Node. Not chokidar, not nodemon. `--no-watch` turns it off.

The process being watched is a runner that ships with the CLI, not your `src/server.ts`. That is
because the facilitator strings have to be resolved by the package that may depend on
`@movoframework/testing`, which is the CLI and not `@movoframework/server` (amendment 005 §1). The
runner loads your `movo.config.ts` and your app, so saving either restarts the server.

Your `src/server.ts` remains the plain production path for `npm start`, unchanged and untouched
by `movo dev`.

## Port

```bash
movo dev --port 8080
```

Defaults to `4021`. The runner also honours `PORT`.

## What runs where

`movo dev` mounts your app with `mountNodeHttp`, which composes the same middleware `mountExpress`
does. If your `src/server.ts` adds free routes — a `/health` endpoint, static files, anything
mounted before the payment middleware — those are **not** present under `movo dev`, because it
does not run that file. Paid routes are, since those come from your app declaration.

For an inner loop that includes your free routes, run `npm start` directly.
