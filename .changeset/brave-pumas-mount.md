---
"@movoframework/server": minor
"@movoframework/stellar": minor
"@movoframework/core": minor
---

Ship the mount and the Stellar preflight diagnostics, and prove a real settled payment.

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
