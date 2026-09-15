# @movoframework/stellar

## 0.1.0

### Minor Changes

- acecc44: Ship the mount and the Stellar preflight diagnostics, and prove a real settled payment.

  **`@movoframework/server`.** `mountExpress` and `mountNodeHttp` compose upstream rather than
  wrapping it: compile, build a `FacilitatorClient`, construct an `x402ResourceServer` with
  `ExactStellarScheme` registered, wrap it in an `x402HTTPResourceServer`, and hand that to
  `paymentMiddlewareFromHTTPServer`. `MountResult.server` exposes the raw resource server so
  consumers can attach the upstream hooks that can abort and recover. The mount point is
  `FromHTTPServer` rather than `FromConfig` because `FromConfig` hides the object all seven
  lifecycle hooks hang off — and those hooks are where diagnostics live.

  **`@movoframework/stellar`.** Six preflight checks — account, trustline, asset, facilitator,
  expiry, clock — each returning a `Finding` and never throwing for a negative result. The
  trustline check verifies the asset's **issuer**, derived from the contract's own `name()`, not
  just the asset code: anyone can issue an asset called USDC, and a trustline to the wrong issuer
  looks correct in a wallet while still being unable to receive payment. The asset check reads
  decimals from the contract rather than assuming 7. No Stellar constant is defined anywhere in
  the package.

  **`@movoframework/core`.** The narrow waist gains the Stellar RPC and Horizon helpers preflight
  needs, plus a `./server` subpath carrying the resource server, facilitator client, Stellar scheme
  and Express middleware. The subpath exists so the main entry stays free of Express and the
  Stellar SDK — importing `@movoframework/core` must not load an HTTP framework. `PAYMENT_HEADERS`
  declares the three wire header names once, so no other package writes them as literals.

  **Evidence.** A real payment settled on Stellar testnet in Circle USDC, independently confirmed
  from Horizon by the test itself: transaction
  `e05853dac4902d8ceead5bc66fd314be0dc1e3e5a12cb04ed73e09693dd4a048`, ledger 4101310. The
  transaction's source account is the facilitator's, so fees were sponsored and the buyer paid none
  of them. Recorded in `docs/CONFORMANCE.md`.

  Invariants I1–I6 are asserted against the real Express middleware with a stub facilitator, each
  verified against the installed middleware source before being written. A new
  `pnpm check:protocol-purity` gate fails the build if either package starts constructing XDR,
  handling signatures, or writing `PAYMENT-*` header literals — and if `packages/core` ever imports
  `@stellar/stellar-sdk` directly.

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
