# Security policy

## Movo never accepts payer private keys server-side

This is a design invariant, not a recommendation. A Movo resource server needs **no Stellar
key at all**: it names a `payTo` address and a price, and the buyer signs. The server
configuration type admits no payer key, so a Movo application cannot become a custody surface
by misconfiguration.

Movo also never generates, derives, stores or persists a private key in any package, and never
takes custody of funds.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report privately through GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability). If that is unavailable to you, open a public issue that
contains *only* a request for a private contact channel and no technical detail.

What to expect:

- Acknowledgement of your report.
- An assessment, and a fix or a documented mitigation.
- **Coordinated disclosure within 90 days** of the report, or sooner by mutual agreement.
- A published advisory. Credit is given unless you ask us not to.

Security fixes may ship as a patch release to any supported minor version.

## Scope

In scope: the `@movo/*` packages, `create-movo-app`, the repository's compliance tooling, and
(once it exists) the facilitator service under `apps/facilitator`.

Out of scope, and better reported upstream:

- Vulnerabilities in `@x402/*` — report to the
  [x402 Foundation](https://github.com/x402-foundation/x402).
- Vulnerabilities in `@stellar/stellar-sdk` or the Stellar network itself.
- The behaviour of third-party facilitators that Movo can be configured to call.

## Handling secrets in this repository

- `.gitignore` covers `.env`, `.env.*`, `*.key`, `*.pem` and `secrets/`.
- CI runs a secret scan on every push and pull request.
- Any Stellar key used in development or in a spike is **testnet-only** and is never committed.
  Treat a testnet seed that reaches a commit as compromised and rotate it — testnet keys are
  worthless, but the habit is what protects a pubnet key later.
- Never log a payment payload, a payment header, or a facilitator credential. Redaction is a
  construction-time property in Movo, not an output-time filter.

## Threats Movo is designed against

| Threat | Control |
|---|---|
| Server-side key custody | The type system permits no payer key in server configuration |
| Secret exposure in logs or errors | Construction-time redaction, property-tested |
| A hostile 402 naming an arbitrary `payTo` or amount | Buyer-side policy — amount cap, `payTo` allowlist, network allowlist — enforced *before* signing |
| Accidental pubnet spend | Testnet by default; pubnet requires an explicit opt-in; the in-process facilitator refuses pubnet |
| Handler executing without payment | Owned upstream; asserted by Movo's tests against the real middleware |
| Supply-chain or licence contamination | Exact pins on the protocol path, committed lockfile, licence gate, scheduled audit, install scripts allowed only for named packages |

Controls listed here are delivered across milestones M0–M8; this file describes the policy the
implementation is held to.
