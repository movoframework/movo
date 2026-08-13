# Testing strategy

| Facilitator | Network | Use | What it does not reproduce |
|---|---|---|---|
| `MockFacilitator` | None | CI orchestration and failure responses | It does not verify signatures, simulate Soroban, submit transactions, sponsor fees, or provide settlement evidence. |
| `InProcessFacilitator` | Stellar testnet | Gated verification and settlement tests | It has no HTTP facilitator endpoints, auth, metering, rate limiting, signer pools, or catalog hooks. |
| Hosted facilitator | Configured network | End-to-end interoperability | It is third-party infrastructure, so availability and policy are outside Movo's control. |

`InProcessFacilitator` performs real verification and real on-chain settlement. It needs a funded
testnet signer supplied by the test author; Movo never generates or stores one.
