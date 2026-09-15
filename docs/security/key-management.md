# Key management and the non-custody boundary

The artefact a third-party reviewer reads first. It states what Movo holds, what it never holds,
what an attacker gets from each position they might reach, and what the production key story is
for a pubnet deployment that does not exist yet.

Written **before** the review rather than after it, which is the only order in which it is
useful: a threat model produced to answer findings is a defence, not a model.

**Scope and honesty note.** Movo v0.1.0 is testnet-complete. Everything described under
"Production key story" is an intended design backed by code paths that exist and are exercised on
testnet — it is **not** a description of a running production deployment, because there is not
one. Where this document says a control is *implemented*, there is code and a test. Where it says
*intended*, there is neither, and the distinction is load-bearing.

---

## 1. The boundary, stated once

**Movo never accepts a payer's private key, in any component, on any path.** The buyer signs an
authorisation entry in their own process with their own signer and sends the signed payload over
HTTP. Nothing in `@movoframework/*` has a parameter that takes a buyer secret, and
`SECURITY.md` states the same commitment at the repository's front door.

The facilitator is the only component that holds a key at all, and the key it holds is a
**sponsor** key. A sponsor pays the network fee and supplies the transaction's source account. It
cannot redirect the buyer's transfer, because the transfer is inside an authorisation entry the
buyer signed and the ledger validates against the buyer's signature.

This is asserted, not asserted-about. `tests/e2e/facilitator-settlement.test.ts` checks the
facilitator address against four positions on the **buyer-signed** transaction — transaction
source, operation source, transfer `from`, auth-entry signer — and requires it in none of them.
On the **settled** transaction the facilitator *is* the source and fee payer, because that is
what fee sponsorship is on Stellar; the other three positions must still be clear. See
[CONFORMANCE.md](../CONFORMANCE.md) AC6.6 and spec §B.1 for why the original four-position
formulation was unsatisfiable and how it was corrected.

**What a compromised sponsor key gets an attacker.** It lets them spend that sponsor account's
XLM on transaction fees, and submit transactions sourced from it. It does **not** let them move a
buyer's USDC, redirect a seller's payment, forge a settlement, or mint a catalog listing — every
one of those requires a signature the sponsor key cannot produce. The blast radius of the worst
key in the system is *the fee balance of one channel account*. That property is the reason the
architecture is worth reviewing at all, and any change that widens it is a design regression.

---

## 2. Assets

| Asset | Where it lives | Worst case if lost |
|---|---|---|
| **Sponsor signing keys** | The facilitator process, one per channel account | Fee balance drained; settlement stops when accounts fall below the readiness floor. No buyer or seller funds move. |
| **Buyer keys** | The buyer's own process. **Never** in Movo | Full loss of that buyer's funds — which is why Movo has no path that touches them |
| **Seller funds** | The seller's Stellar account | Not reachable through Movo: `payTo` is in the buyer-signed requirements, and tampering with it fails verification |
| **Buyer budgets** | `@movoframework/client`, in the buyer's process | Over-spend up to the caps. Enforced *before* signing, so a refusal produces no signature at all |
| **Catalog integrity** | `@movoframework/catalog` | Poisoned listings — an agent directed to an attacker's endpoint. The highest-value target in the system after the keys |
| **Developer secrets** | `.env`, CI secrets, logs | Depends on the secret; redaction and a secret-scanning gate exist because a leaked seed in a log is the cheapest possible compromise |

---

## 3. Actors and what each one can try

### Hostile buyer

Signs genuine payloads and tampers with what they commit to, or replays a settled one.

*Controls (implemented).* Verification is upstream's `ExactStellarScheme`, unmodified: amount,
asset, recipient, network and expiry are all checked against the requirements. Replay is caught at
simulation — a settled authorisation entry no longer simulates. Every rejection carries a distinct
machine-readable reason, and the distinctness is asserted, not assumed: a reason-collapse would
let an agent confuse "you already spent this" with "you underpaid" (spec §D.1). Evidence:
CONFORMANCE.md AC6.5 and the layer-4 rejection table.

*Residual.* Verification is only as strong as upstream's scheme. Movo composes it deliberately
rather than reimplementing it, so an upstream verification defect is a Movo defect too. The
mitigation is the version pin plus the conformance suite, not independent validation logic —
reimplementing verification to "double-check" upstream would create a second, weaker validator
that can disagree with the one the network actually enforces.

### Hostile seller

Declares discovery metadata designed to poison the catalog or mislead an agent: a traversal in a
`routeTemplate`, a loopback `iconUrl`, an external `$ref` in a schema, a listing claimed on behalf
of another account.

*Controls (implemented).* Ingest derives the listing owner from `paymentRequirements.payTo`, so a
seller can only ever claim their own listing; catalog writes are compare-and-write against the
existing `pay_to`. The six adversarial integrity controls read the **raw** extension from the
payload *before* upstream extraction and escalate anything upstream soft-dropped — because a
control that inspects only post-extraction output reports success on the attack (spec §C.1). The
`$ref` check runs *before* the schema validator, so an attacker-supplied `$ref` URL is never handed
to a resolver on the settle path (spec §D.1).

*Residual.* A seller can still describe a legitimate endpoint dishonestly — accurate metadata for
a service that returns rubbish. No validator detects that. Discovery is a directory, not a
reputation system, and `docs/bazaar/overview.md` says so rather than implying otherwise.

### Hostile facilitator

The one a *seller or buyer* points at. It can lie about settlement, or refuse to settle.

*Controls (implemented).* Movo never treats a facilitator's word as proof. The conformance and
e2e suites take the transaction reference from the `PAYMENT-RESPONSE` header and fetch the
transaction from Horizon — a source that is neither the server under test nor the facilitator that
reported success. A fabricated settlement fails that check.

*Residual.* At runtime a seller's application still trusts its configured facilitator within one
request; Movo surfaces the outcome rather than independently confirming every payment on-chain,
because a Horizon round-trip per request is not a per-request cost the RFP wants paid. Sellers who
need on-chain confirmation have the transaction reference to confirm with.

### Network observer

Sees traffic between buyer, resource server and facilitator.

*Controls (implemented).* Payloads are signed authorisations, not bearer credentials for an
account — observing one does not let the observer spend anything beyond replaying it, which
verification rejects. Redaction covers configuration, headers and hook payloads;
`tests/integration/log-capture.test.ts` drives a complete paid request with a seed, an API key and
an encoded payment payload present and asserts zero occurrences across every log record.

*Residual.* Transport security is the operator's: Movo does not terminate TLS. The runbook says
so plainly.

### Malicious dependency

The supply chain — the way most real compromises now arrive.

*Controls (implemented).* A licence gate with a prohibited-list (no AGPL/SSPL/GPL, the
OpenZeppelin Relayer family named explicitly), gitleaks over full history in CI with `--redact`, a
scheduled dependency audit, exact version pins on every `@x402/*` package, and a `pnpm`
lockfile with `--frozen-lockfile` everywhere. Releases publish with **provenance** from OIDC
trusted publishing — no long-lived npm token exists to steal (see
[ADR-0014](../adr/0014-release-and-versioning.md)).

*Residual.* A compromised upstream release with a valid signature still reaches the pin at the
next bump. The controls make it attributable, not impossible.

---

## 4. The production key story — intended, not deployed

The environment-variable path (`MOVO_FACILITATOR_<NET>_SIGNER_SEEDS`) puts raw seeds in the
process environment. **It is the development path, and `packages/facilitator/src/config.ts` says
so in its own documentation.** It is what testnet uses and it is unsuitable for pubnet.

The production path already exists in the code and is the reason the config module has two
entry points at all: **`resolveFacilitatorConfig` takes signer *objects*, not seeds.** A
`FacilitatorStellarSigner` is an interface — an address plus `signAuthEntry` / `signTransaction`.
An operator supplies an implementation that delegates to whatever holds the key, and no raw seed
ever exists in the Movo process. Nothing in the facilitator inspects how a signature was produced.

### External signer, concretely

**AWS KMS is the reference target because it can now do this natively.** KMS added
Edwards-curve (EdDSA / Ed25519) asymmetric keys on 7 November 2025, in all regions including
GovCloud and China — before that, Stellar's ed25519 requirement forced either an HSM with custom
firmware or a self-managed signing service, which is why this was not written earlier. A KMS-backed
signer holds a non-exportable key, signs on request, and gives the deployment:

- **no seed at rest anywhere Movo controls** — not in the environment, not in a file, not in
  process memory beyond the signature that comes back;
- **an authorisation boundary that is not the application's** — IAM decides who may invoke
  `kms:Sign` on the key, so compromising the facilitator process is not the same event as
  compromising the key;
- **an audit trail the application cannot suppress** — every signature is a CloudTrail event, so
  "how many settlements were signed" has an answer that does not come from the thing under
  suspicion;
- **rotation without redeployment** — the pool is a list of signer objects, and channel accounts
  are already independent of one another by design.

The same shape fits an HSM, a remote signing service, or a hosted custody provider. Movo's
requirement is exactly one interface method's worth of contract, which is deliberate: the
narrower the contract, the more key custodians can satisfy it.

### What a pubnet deployment additionally needs, none of which is code

1. Funded pubnet sponsor accounts, sized so the readiness floor is meaningful.
2. A signer implementation against the chosen custodian, plus its IAM/authorisation policy.
3. An RPC provider agreement — the facilitator refuses to start on pubnet without an explicit
   Soroban RPC URL, deliberately.
4. Key ceremony, rotation and revocation runbooks: who can sign, who can add a sponsor, what
   happens at 03:00 when one is drained.
5. **The third-party security review** (RFP §3.6, spec §16a) — the longest external lead time and
   the gate on the mainnet production tag. This document is its input.

Items 1–4 are operational; item 5 is a commissioned engagement. None is in v0.1.0, and v0.1.0 does
not claim them.

---

## 5. Residual risks, stated plainly

| Risk | Status | Why it is accepted for a testnet-complete release |
|---|---|---|
| Sponsor seeds in the environment | **Accepted on testnet only** | Testnet funds have no value; the injected-signer path exists for the case where they do |
| No third-party security review | **Open — gates the mainnet tag** | Commissioned engagement with external lead time. v0.1.0 records it as not done rather than substituting a self-assessment |
| Upstream verification is trusted | **Accepted by design** | Reimplementing it would create a second validator that can disagree with the one the network enforces |
| No on-chain confirmation per runtime request | **Accepted** | A Horizon round-trip per request is a cost the protocol's hot path should not carry; the reference is returned so callers can confirm |
| `__check_auth` smart accounts unproven live | **UNVERIFIED, no upstream gap** | Upstream accepts contract credentials and Movo never inspects credential types; the missing artefact is a deployed contract, not a control |
| Catalog cannot detect a dishonest-but-well-formed listing | **Accepted** | Out of scope for a directory; not presented as reputation |

---

## 6. What a reviewer should attack first

Ranked by what would hurt most, to save the reviewer the triage:

1. **Catalog ingest** (`packages/catalog/src/ingest.ts`) — the only place attacker-controlled
   structured data crosses a trust boundary and is stored. The raw-vs-extracted delta check is the
   control most likely to be subtly wrong.
2. **The signer pool** (`packages/facilitator/src/signer-pool.ts`) — leasing, in-flight accounting
   and the balance floor. A lease bug is a settlement-integrity bug, and this code has already had
   one real defect found by measurement rather than review (spec §B.2).
3. **The non-custody assertions** (`tests/e2e/facilitator-settlement.test.ts`) — check that the
   test asserts what §B.1 says it does. A weakened assertion here would be invisible.
4. **Redaction** (`packages/core/src/observability/redact.ts` and the log-capture test) — completeness, not
   presence.
5. **Budget enforcement ordering** (`@movoframework/client`) — that refusal genuinely precedes
   signing on every path, including `callUrl`.
