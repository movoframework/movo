# @movoframework/server

Mount compiled Movo resources onto a Node HTTP framework.

Mounts compiled Movo resources onto a Node HTTP framework. The payment lifecycle is upstream's: the handler runs first with its response buffered, settlement follows, and a throw or a status of 400 or more cancels the charge. Movo asserts those invariants rather than building them.

## Install

```bash
pnpm add @movoframework/server
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
