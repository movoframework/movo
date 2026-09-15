# @movoframework/client

Buyer-side budget accounting, typed resource clients and payment outcome decoding.

The buyer side: budget accounting that refuses before a signature is produced, typed resource clients, and decoding of the payment outcome. `maxAmountPerRequest` and `maxTotalSpend` are both enforced against what a real settlement reports, not against a synthetic amount.

## Install

```bash
pnpm add @movoframework/client
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
