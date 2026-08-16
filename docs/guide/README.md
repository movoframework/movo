# The Movo guide

Three paths, because there are three jobs and they share almost nothing. Pick yours.

| You are… | You want to… | Start here |
|---|---|---|
| **A seller** | Charge for an API and be findable | [Seller](./seller.md) |
| **A buyer or an agent** | Pay for APIs, safely, possibly autonomously | [Buyer and agent](./buyer-and-agent.md) |
| **An operator** | Run a facilitator and a catalog | [Operator](./operator.md) |

Every path ends with something you can actually run against Stellar testnet — free, keyless where
possible, and with a transaction you can look up on Horizon.

## The one idea underneath all three

An HTTP 402 stops being decorative. A resource server answers `402 Payment Required` with machine-
readable terms; a buyer signs an authorisation; a facilitator settles it on Stellar. Movo is the
project framework around that: it makes the seller's side a declaration, the buyer's side typed and
budgeted, and — if the facilitator operates one — makes the resource **discoverable** as a
consequence of having been paid.

## What Movo does not abstract

Worth knowing before you start, because these are deliberate:

- **Keys.** No Movo package generates, derives or stores one. You always supply the signer.
- **The protocol.** Verification, settlement, scheme rules and validators are `@x402/*`. Movo
  composes them; it does not reimplement them.
- **Who lists you.** A catalog belongs to whichever facilitator settled the payment. Movo does not
  promise your resource appears anywhere.

## Before you start

- Node 22 or later
- A Stellar **testnet** account. The seller path needs one to be paid to; the buyer path needs one
  funded with testnet USDC and a trustline.
- Nothing else. The default facilitator is free and keyless.
