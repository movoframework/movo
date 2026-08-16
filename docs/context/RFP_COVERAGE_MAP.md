# Movo — SCF RFP Requirement Coverage Map

**RFP:** SCF #45 — *X402 Facilitator with Bazaar (discovery) support*
**Purpose:** (1) the recorded rationale discharging the §26 SCF decision gate — **decision: BUILD**;
(2) the "reasoning for a limited scope" the RFP submission requires; (3) the pre-M6 checklist of
scope the RFP adds beyond spec v2 §24/§25.
**Verdict on the gate:** the RFP deliverable *is* a facilitator + a Stellar-native Bazaar under a
permissive licence. Consuming a hosted facilitator cannot satisfy it. M2's hosted-path settlement
was necessary groundwork, not a substitute. **Proceed to the M6/M7 track.**

---

## 1. Coverage — RFP requirement → milestone → status

Status legend: **✓ covered** (spec commits to it) · **⚠ gap** (RFP requires; spec silent or explicitly defers) · **↑ upstream** (delivered by `@x402/stellar`, Movo composes and asserts).

| RFP § | Requirement | Milestone | Status |
|---|---|---|---|
| 3.1 | verify / settle / supported on testnet **and pubnet** | M6 | ✓ AC6.1–6.4 |
| 3.1 | strict Soroban auth-entry validation (signed, exact call/asset/amount/recipient, not replayed/expired) | — | ↑ `@x402/stellar`; M6 asserts via conformance |
| 3.1 | classic keypairs **and custom `__check_auth` accounts** | M6 | ⚠ **gap** — no explicit smart-account test in §24 |
| 3.1 | any SEP-41 token, USDC default, 7-decimal amounts | — | ↑ upstream (M2 confirmed USDC/7dp) |
| 3.1 | fee sponsorship + `extra.areFeesSponsored` | M6 | ✓ AC6.3 |
| 3.1 | non-custodial; tampering fails verification | M6 | ✓ AC6.6 (four-position non-custody test) |
| 3.1 | testnet free/keyless; mainnet fee **configurable** | M6 | ✓ AC6.9, §24.10 |
| 3.1 | caller auth / metering / rate limiting, configurable | M6 | ✓ §24.3 |
| 3.1 | package hosted + self-hosted, **incl. self-facilitation inside a resource server** | M6 | ⚠ **gap** — self-hostable ✓, but the self-facilitation-in-resource-server pattern is not a named deliverable |
| 3.2 | `GET /discovery/resources` with `type`/`payTo`/`network`/`extensions`/`limit`/`offset` | M7 | ✓ AC7.2 |
| 3.2 | `GET /discovery/search` — real NL ranking, `partialResults`, cursor pagination | M7 | ✓ AC7.3–7.4 + eval harness §25.13 |
| 3.2 | automatic cataloging at settle, no separate registration | M7 | ✓ AC7.1 |
| 3.2 | catalog HTTP **and** MCP tools, `(url, toolName)` keyed | M7 | ✓ AC7.7 |
| 3.2 | catalog integrity / soft-drop / `routeTemplate` percent-decode-before-traversal | M7 | ✓ AC7.5 (six adversarial tests fail-closed) |
| 3.2 | `EXTENSION-RESPONSES` cataloging outcomes | M7 | ✓ AC7.6 |
| 3.2 | track the spec as it evolves; interoperate; not a walled garden | M7 | ✓ §25.11, §25.14 |
| 3.2 | seller-side discovery-metadata helpers, per-parameter descriptions | M4/M7 | ✓ (M4 `deriveDiscovery`; M7 refines) |
| 3.2 | off-chain index by default; on-chain registry optional stretch | M7 | ✓ §25.7 (correctly deferred) |
| 3.3 | MCP discovery server: search + paid-call, structured errors, non-null reason | M7 | ✓ §25.12 (`bazaar.search/get/paidCall`), AC7.8–7.9 |
| 3.4 | `exact` scheme on Stellar | M2 | ✓ done, Gate 1 |
| 3.4 | **`upto` scheme — implementation + authoring `scheme_upto_stellar.md` upstream** | — | ⚠ **gap (largest)** — §24.14 puts it out of scope; §26 names it a kill criterion |
| 3.4 | do not foreclose `batch-settlement` / `auth-capture` | design | ✓ deferred by RFP too; keep extension points |
| 3.5 | auth entries, ledger expiration, trustlines, Soroban limits, throughput | M6 | ✓/↑ (throughput AC6.8 channel accounts; rest upstream) |
| 3.6 | permissive OSI licence; **no AGPL/SSPL/GPL** in the path | all | ✓ hard rule 2, AC6.7 |
| 3.6 | wire-level conformance; stock client; e2e suite both networks; hash per network per scheme; non-null reason | M6/M7/M8 | ✓ AC6.4/6.5 — **this is the stock-client suite assigned to M8** |
| 3.6 | security: replay/front-running resistance; no listing/pricing spoofing | M6/M7 | ✓ §24.8, §25.8 |
| 3.6 | **third-party security review via the Audit Bank before the mainnet production tag** | — | ⚠ **gap** — no audit-engagement step in the spec |
| 3.6 | UX: docs→paid discoverable endpoint in <1hr | M5/M7 | ✓ M5 quickstart |
| 3.6 | 99%+ uptime, degraded-mode story; post-grant maintenance | M6/M7 | ✓ operational surface + maintenance commitment |
| 5 | role-based dev guide (seller/buyer-agent/operator), **contributed to Stellar Developer Docs** | M7/M8 | ⚠ partial — guide ✓ (§25.16); upstreaming to Stellar docs not a named step |
| 5 | ≥2 end-to-end example integrations | M7 | ✓ §25.16 |
| 5 | production service + operational runbook + monitoring | M6 | ✓ §24.16 |

## 2. Scope decisions to state in the submission

The RFP explicitly permits a limited scope with articulated reasoning. Four decisions:

1. **`upto` is deferred to a committed phase 2; v0.1.0 ships `exact` only.** Reasoning: `upto` on
   Stellar has no network spec yet — the work includes *authoring* `scheme_upto_stellar.md`
   upstream through the x402 TSC, and the RFP itself notes SEP-41 allowances cannot enforce
   `upto`'s recipient-binding and single-settlement guarantees without a Soroban contract. That is
   a contract-design-plus-spec-authoring-plus-upstream-coordination effort of a different kind and
   risk profile than the offchain facilitator + catalog. Bundling it into v0.1.0 would delay the
   RFP's highest-value item (the Bazaar). Commit to it as phase 2 with a stated design intent
   (whether it ships a Soroban contract, and if not, the documented weaker trust model), and keep
   the scheme-registration extension point open so it slots in without core rework. **Do not
   foreclose it** — the spec's D-series extension points already allow additional schemes.

2. **On-chain Soroban discovery registry is an explicit non-goal for v0.1.0.** The RFP names it an
   optional stretch; the index is off-chain by default. Reasoning: rent/TTL and per-payment
   double-cost fall outside the per-request hot path the RFP wants protected. Extension point kept.

3. **`batch-settlement` and `auth-capture` are out**, matching the RFP's own phasing. Keep the
   lifecycle-hook and scheme extension points open.

4. **Bazaar carries the emphasis, not the facilitator.** The RFP calls the Bazaar its highest-value
   item and says it should carry the largest budget share. The two-track order (M6→M7) is a
   technical dependency — cataloging attaches to the settle path — not a statement of relative
   effort. Plan M7 as the larger body of work; M6 is the platform it stands on.

## 3. Add to the M6/M7 scope before handoff — the five real gaps

Fold these into §24/§25 (a short spec edit) so an agent does not build against the narrower text:

- **M6 — `__check_auth` smart-account support (AC6.11, new).** The RFP requires classic keypairs
  *and* custom `__check_auth` accounts. `@x402/stellar` may handle both, but M6 must prove it:
  an unmodified stock client backed by a `__check_auth` contract account completes a payment on
  testnet, with an on-chain hash. Verify from the installed declarations whether upstream's
  facilitator scheme accepts smart-account signers before assuming it does.
- **M6 — self-facilitation packaging (add to §24.1 scope + an AC).** Ship and document the
  facilitator running *inside* a resource server (the upstream self-facilitation pattern), not only
  as a standalone `apps/facilitator` service. The RFP names this explicitly.
- **M7 — Stellar Developer Docs contribution (add to §25.16 exit gate).** The role-based guide is
  not only built in-repo but contributed upstream to Stellar Developer Docs. Track it as an
  external-contribution deliverable with its own done-state, since it depends on a third party.
- **M8 (or a post-M7 gate) — Audit Bank engagement.** A third-party security review before any
  mainnet production tag, covering the settlement path, auth-entry validation, and the discovery
  trust boundary. This is a hard RFP deliverable and a process item with external lead time —
  start the engagement conversation early, do not discover it at release.
- **Conformance suite = the RFP's literal acceptance test.** The stock-client conformance suite
  deferred to M8 (v2 §A.3) is not internal hygiene here — it is exactly how reviewers accept the
  deliverable ("point stock SDK code at it rather than read a conformance claim"). It must run on
  **both networks**, publish a settled hash **per network per scheme**, and assert a non-null
  reason on every rejection. Its M8 assignment stands, but its priority is now RFP-acceptance, not
  cleanup.

## 4. What already aligns — do not re-litigate

The spec's core bets match the RFP as written: build on Apache-2.0 `@x402/stellar` rather than
reimplement verify/settle (D1/D4); the AGPL prohibition naming the OpenZeppelin Relayer, its x402
plugin, and the relayer SDK (hard rule 2, RFP §3.6 verbatim); HTTP-call-not-fork of the hosted
facilitator; non-custody as a tested invariant; wire-level conformance via an unmodified stock
client; automatic cataloging; catalog-integrity as a trust boundary; and search quality as a
graded deliverable with an evaluation harness. These were written with the RFP in view and need
no change.
