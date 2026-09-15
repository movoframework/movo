# @movoframework/core

Movo project model, resource compilation, errors and the x402 protocol narrow waist.

The project model every other package composes: `defineResource` / `defineApp`, configuration with provenance, the compiler, the single `MOVO_E_*` error registry, redaction, and the **x402 protocol narrow waist**. Movo never reimplements an x402 or Stellar primitive — everything upstream provides is re-exported through `packages/core/src/protocol/`, and a CI gate enforces that no other package imports `@x402/*` directly.

## Install

```bash
pnpm add @movoframework/core
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
