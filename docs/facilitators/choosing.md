# Choosing a facilitator

A facilitator verifies a payment and settles it on Stellar. It is the only party in an x402
exchange that needs a funded key, and Movo never becomes one — it consumes upstream's
`FacilitatorClient` interface and adds configuration and diagnostics on top (spec §1.8 D5).

## The options

| | Construction | Network | Use it for |
|---|---|---|---|
| **Hosted** | `HTTPFacilitatorClient({ url, timeoutMs, createAuthHeaders })` | testnet or pubnet | The default. The free keyless testnet facilitator is the quickstart's choice |
| **In-process** | `x402Facilitator` + `ExactStellarScheme` from `@x402/stellar/exact/facilitator` | testnet | A hermetic dev loop with real settlement and no third party. **Arrives in M3** |
| **Mock** | A `FacilitatorClient` returning fixed outcomes | none | Orchestration tests in CI with no funds. **Arrives in M3** |

Movo's `MountOptions.facilitator` accepts `"config"` or a `FacilitatorClient` you supply. The
names `"in-process"` and `"mock"` are deliberately absent until the implementations exist —
offering a name before the thing behind it is a promise, not an API.

## The default: `https://www.x402.org/facilitator`

Free, keyless, supports `exact` on `stellar:testnet`, and **sponsors network fees**. That last
part is worth understanding: in a settled transaction the source account is the facilitator's,
so the buyer pays the asset amount and none of the Stellar fee. You can see it on any settled
transaction — the `source_account` is not the buyer.

Verify what a facilitator actually supports rather than trusting a README:

```bash
curl -s https://www.x402.org/facilitator/supported | jq '.kinds[] | select(.network|startswith("stellar"))'
```

Movo's `facilitator` preflight check does exactly this and reports an error if the configured
scheme and network are not advertised — a facilitator that is up but does not support your
network fails every payment with a message about the payment.

## API-keyed facilitators

Supply the credential as a **function**, never a value:

```ts no-check
import { defineConfig } from "@movoframework/core";

export default defineConfig({
  facilitator: {
    url: "https://facilitator.example",
    authHeaders: async () => ({
      verify: { Authorization: `Bearer ${process.env["MOVO_FACILITATOR_API_KEY"] ?? ""}` },
      settle: { Authorization: `Bearer ${process.env["MOVO_FACILITATOR_API_KEY"] ?? ""}` },
    }),
  },
});
```

A literal string throws `MOVO_E_SECRET_IN_CONFIG` at definition time. The credential is then read
only inside that closure, so it never lands on the configuration object and cannot be reached by
anything that walks it.

Two shape notes, both learned from the installed declarations rather than documentation. The
returned object must be **keyed by request path** — `verify`, `settle`, `supported` — and
upstream throws on a flat `{ Authorization: … }`, which is the obvious thing to write. And
Movo's config field is `authHeaders` while upstream's is `createAuthHeaders`; the translation
happens once, inside `@movoframework/server`.

## The AGPL boundary

Some hosted facilitators are built on the **OpenZeppelin Relayer** and the **x402 Facilitator
Plugin**, which are **AGPL-3.0-or-later**.

**Calling one over HTTP is explicitly permitted.** Invoking a remote network service is not a
derivative work, so configuring `https://channels.openzeppelin.com/x402*` or any other
facilitator as a URL is fine and is unaffected by Movo's licence policy.

**Vendoring, forking, copying, importing or adapting that code is prohibited**, in whole or in
part. Movo ships under Apache-2.0 and a Movo facilitator is designed to be operated as a network
service, so the AGPL's network clause would extend source-provision obligations to every third
party that service serves. Reading the code as public documentation is fine.

`pnpm check:licenses` enforces this on every PR and on a schedule, and is tested against a
planted AGPL fixture so the gate is known to fire rather than assumed to.
