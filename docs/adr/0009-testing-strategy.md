# ADR-0009 — Testing strategy

- **Status:** Accepted
- **Milestone:** M3

Movo uses upstream's `FacilitatorClient` directly. `MockFacilitator` is a programmable,
network-free orchestration double; it is never evidence of verification or settlement.
`InProcessFacilitator` composes `x402Facilitator` and the Stellar facilitator Exact scheme, so
it performs real verification and settlement on testnet. It deliberately has no HTTP handler:
`/verify`, `/settle`, and `/supported` are the gated M6 facilitator-service surface.

The real facilitator does not reproduce HTTP transport, authentication, metering, rate limiting,
signer-pool operations, cataloging, or any production operator behaviour. The mock does not
reproduce cryptographic verification, simulation, submission, fee sponsorship, or settlement.
