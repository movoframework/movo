# @movoframework/facilitator

## 0.1.0

### Minor Changes

- 6c5a708: M6 — the SCF facilitator track.

  Adds `@movoframework/facilitator`, the service tier of a self-hostable Stellar x402
  facilitator, and `apps/facilitator`, a deployable Hono service over it. Both compose
  `x402Facilitator` + `ExactStellarScheme` from `@x402/*` and contain no verification or
  settlement logic of their own — a CI grep (`check:protocol-purity`) now scans both for XDR
  construction and signature handling and fails the build on either.

  New in `@movoframework/facilitator`: `createFacilitator` returning transport-agnostic
  `verify` / `settle` / `supported` handlers plus readiness and metering; `SignerPool` with
  channel accounts, per-account exclusivity and XLM balance floors; external signer/KMS
  injection through a structural `FacilitatorStellarSigner`, so production never needs a raw
  seed in an environment variable; caller authentication, per-key and per-IP rate limiting,
  and a single-sourced registry of service-tier rejection reasons.

  New in `@movoframework/core`: a fourth narrow-waist module on the `./facilitator` subpath,
  re-exporting `x402Facilitator`, the facilitator-subpath `ExactStellarScheme`, upstream's
  payload and requirements schemas, and `createEd25519Signer`. It is separate from
  `./server` so a facilitator deployment does not carry Express. Two error codes added:
  `MOVO_E_FACILITATOR_CONFIG_INVALID` and `MOVO_E_FACILITATOR_SIGNER_UNAVAILABLE`.

  Evidence, on Stellar testnet: an unmodified stock `@x402/fetch` client completes a payment
  through the service with an on-chain-confirmed hash; the same through an in-process
  self-facilitating resource server; `/supported` matches the public reference facilitator's
  `stellar:testnet` entry field for field including `extra.areFeesSponsored`; five distinct
  non-null rejection reasons; the non-custody invariant asserted on both the buyer-signed and
  the settled transaction; and 200 concurrent settlements with 25 sponsors producing 200
  settlements and zero failures. Recorded in `docs/CONFORMANCE.md`. Pubnet is UNVERIFIED.

  No AGPL, SSPL or GPL enters the dependency path. The two dependencies added, `hono` and
  `@hono/node-server`, are MIT.

- M8 — the testnet-complete v0.1.0 release. No new features.

  Adds the dedicated stock-client conformance suite (§1.16 layer 4, the RFP's literal acceptance
  test): an unmodified `@x402/fetch` + `@x402/stellar` client drives a full payment through the Movo
  stack, with the scheme matrix read from the deployment's own `/supported` and the network matrix
  carrying both networks from the start. Settlement is confirmed from Horizon, not from the
  `PAYMENT-RESPONSE` header, and every rejection is asserted to carry a distinct non-null reason.

  Pubnet is a configuration flip rather than a code change, behind an explicit opt-in that is
  separate from its credentials — holding pubnet keys is not sufficient to spend them. v0.1.0 is
  **testnet-complete**: pubnet settlement, the mainnet production tag and the third-party security
  review are the committed production follow-on, not part of this release.

  Release engineering: npm OIDC trusted publishing with automatic provenance and no long-lived
  token, `LICENSE` and repository metadata in every package, `CODEOWNERS`, and the key-management
  threat model the future third-party review reads.

### Patch Changes

- Updated dependencies [acecc44]
- Updated dependencies [5706a06]
- Updated dependencies [23c37aa]
- Updated dependencies [6c5a708]
- Updated dependencies [129d707]
- Updated dependencies
- Updated dependencies [40b0424]
- Updated dependencies [0aa9857]
  - @movoframework/core@0.1.0
