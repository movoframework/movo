# @movoframework/testing

Facilitator fixtures, the payment failure matrix, harness and assertion matchers for Movo apps.

Facilitator fixtures, the payment-failure matrix, the harness and assertion matchers. `MockFacilitator` fakes being broken in ways a real facilitator cannot be told to fake; `InProcessFacilitator` runs the real scheme against the five signed-payload mutation scenarios.

## Install

```bash
pnpm add @movoframework/testing
```

## Status

**v0.1.0 — testnet-complete.** Every payment claim in this repository is backed by a transaction
hash settled on Stellar **testnet** and confirmed independently from Horizon; see
[docs/CONFORMANCE.md](https://github.com/movoframework/movo/blob/main/docs/CONFORMANCE.md). Pubnet settlement, the mainnet
production tag and the third-party security review are the committed production follow-on and are
recorded as UNVERIFIED until they are done.

Part of [Movo](https://github.com/movoframework/movo) — the project framework and operations toolkit for machine-payable Stellar
APIs, built on the Apache-2.0 `@x402/*` packages rather than reimplementing them.

## Documentation

- [Quickstart](https://github.com/movoframework/movo/blob/main/docs/quickstart.md)
- [Conformance evidence](https://github.com/movoframework/movo/blob/main/docs/CONFORMANCE.md)
- [Compatibility matrix](https://github.com/movoframework/movo/blob/main/docs/COMPATIBILITY.md)

## Licence

Apache-2.0
