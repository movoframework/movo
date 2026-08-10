# Compatibility matrix

<!-- GENERATED FILE — DO NOT EDIT BY HAND. Regenerate with `pnpm generate:compat`. -->

Generated at **2026-08-10T19:42:28.367Z**.

This file records what was actually installed and what the configured facilitator actually advertised at the moment of generation. It is evidence, not intent; where it disagrees with the architecture specification, this file is the one describing reality.

## Installed `@x402/*` packages

| Package | Installed version(s) |
|---|---|
| `@x402/core` | `2.21.0` |
| `@x402/express` | `2.21.0` |
| `@x402/extensions` | `2.21.0` |
| `@x402/fetch` | `2.21.0` |
| `@x402/stellar` | `2.21.0` |

`@x402/*` versions are exact-pinned (spec §1.13). A bump is a dedicated PR that regenerates this file and re-runs the conformance workflow.

## Toolchain

| Component | Version |
|---|---|
| Node.js (generating host) | `v24.14.0` |
| Node.js (supported) | `22`, `24`, `26` — CI matrix |
| TypeScript | `7.0.2` |
| pnpm | `10.23.0` |

## Facilitator

| Field | Value |
|---|---|
| URL | `https://www.x402.org/facilitator` |
| Advertised x402 protocol version | `1, 2` |
| Advertised kinds | 11 |

### Supported networks

- `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe`
- `aptos:2`
- `base-sepolia`
- `eip155:84532`
- `hedera:testnet`
- `solana-devnet`
- `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
- `stellar:testnet`
- `xrpl:1`

### Supported schemes

- `batch-settlement`
- `exact`
- `upto`

### Stellar kinds

| Scheme | Network | `extra` |
|---|---|---|
| `exact` | `stellar:testnet` | `{"areFeesSponsored":true}` |

### `extra` flags across all kinds

| Kind · flag | Value |
|---|---|
| exact @ algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe · feePayer | `"G7QWRIJODICBDG6JAVXNKHNTCKTBJZBXTSCGQLSMXSCIKEJ5SNFPEJSFQQ"` |
| exact @ aptos:2 · feePayer | `"0x1be1a717b48c46c83a2a6a53205aff6123610961560b2b08968a344c4da24b1e"` |
| exact @ hedera:testnet · feePayer | `"0.0.9185802"` |
| exact @ solana-devnet · feePayer | `"CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5"` |
| exact @ solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 · features | `{"smartWalletSupported":true}` |
| exact @ solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 · feePayer | `"CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5"` |
| exact @ stellar:testnet · areFeesSponsored | `true` |
| exact @ xrpl:1 · areFeesSponsored | `false` |
| upto @ eip155:84532 · facilitatorAddress | `"0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf"` |

## Raw `/supported` payload

Embedded verbatim so that an upstream shape change is visible in the diff even if the summary above does not yet understand it.

```json
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:84532"
    },
    {
      "x402Version": 2,
      "scheme": "upto",
      "network": "eip155:84532",
      "extra": {
        "facilitatorAddress": "0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf"
      }
    },
    {
      "x402Version": 2,
      "scheme": "batch-settlement",
      "network": "eip155:84532"
    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "extra": {
        "feePayer": "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5",
        "features": {
          "smartWalletSupported": true
        }
      }
    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe",
      "extra": {
        "feePayer": "G7QWRIJODICBDG6JAVXNKHNTCKTBJZBXTSCGQLSMXSCIKEJ5SNFPEJSFQQ"
      }
    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "aptos:2",
      "extra": {
        "feePayer": "0x1be1a717b48c46c83a2a6a53205aff6123610961560b2b08968a344c4da24b1e"
      }
    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "stellar:testnet",
      "extra": {
        "areFeesSponsored": true
      }
    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "hedera:testnet",
      "extra": {
        "feePayer": "0.0.9185802"
      }
    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "xrpl:1",
      "extra": {
        "areFeesSponsored": false
      }
    },
    {
      "x402Version": 1,
      "scheme": "exact",
      "network": "base-sepolia"
    },
    {
      "x402Version": 1,
      "scheme": "exact",
      "network": "solana-devnet",
      "extra": {
        "feePayer": "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5"
      }
    }
  ],
  "extensions": [
    "builder-code",
    "eip2612GasSponsoring",
    "erc20ApprovalGasSponsoring"
  ],
  "signers": {
    "eip155:*": [
      "0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf"
    ],
    "solana:*": [
      "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5"
    ],
    "algorand:*": [
      "G7QWRIJODICBDG6JAVXNKHNTCKTBJZBXTSCGQLSMXSCIKEJ5SNFPEJSFQQ"
    ],
    "aptos:*": [
      "0x1be1a717b48c46c83a2a6a53205aff6123610961560b2b08968a344c4da24b1e"
    ],
    "stellar:*": [
      "GC6CSXBV4C6RL3HEDTW57KXYXSSXKAWKGYDEOSATXM3XNKXSR2VRYN3K",
      "GC5OLUZ4WANPN6VT7YGTK2SRMZG762KOVKJXHWIO4K57UBASO2FMNRET"
    ],
    "hedera:*": [
      "0.0.9185802"
    ],
    "xrpl:*": []
  }
}
```
