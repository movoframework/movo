# The MCP discovery server

`@movoframework/mcp` exposes a Bazaar catalog to an agent runtime as three MCP tools:
`bazaar.search`, `bazaar.get` and `bazaar.paidCall`. That is the whole surface. There is no
orchestration, no memory and no planning — those belong to the agent connecting to it, and a
discovery server that also plans is a discovery server nobody can reason about.

The point of it is narrow and worth stating precisely: **an agent can find and pay for an API
that nobody integrated in advance.** Everything it needs — the URL, the price, the network, the
parameter names — arrives in the search result rather than in a config file.

## Building one

```ts
import { createCatalog, SqliteCatalogStore } from "@movoframework/catalog";
import { createEd25519Signer } from "@movoframework/core/client";
import { createMcpDiscoveryServer } from "@movoframework/mcp";

const store = await SqliteCatalogStore.open("movo-catalog.db");
const catalog = createCatalog({ store, embedder: "local" });

const mcp = createMcpDiscoveryServer({
  catalog,
  buyer: {
    // Always supplied by you. No Movo package generates, derives or stores a key.
    signer: createEd25519Signer(process.env["STELLAR_PRIVATE_KEY"] as string, "stellar:testnet"),
    network: "stellar:testnet",
    budget: {
      maxAmountPerRequest: "100000",
      maxTotalSpend: "10000000",
      allowedNetworks: ["stellar:testnet"],
    },
  },
});
```

Then connect `mcp.server` to any MCP transport — stdio for a local agent runtime, streamable HTTP
for a hosted one, or an in-memory pair in tests.

```ts no-check
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

await mcp.server.connect(new StdioServerTransport());
```

## `buyer.budget` is required, and it is not a default

`createMcpDiscoveryServer` throws `MOVO_E_MCP_BUDGET_REQUIRED` if you omit it.

This is deliberate friction. `bazaar.paidCall` hands an autonomous agent the ability to spend from
the signer's account, and the cap is the only thing standing between a bad plan and an empty
wallet. A default cap would be a number this package invented for someone else's money, and no
cap would be no control at all — so the only honest option is to make you state it.

Note what the signature does *not* accept: a ready-made `MovoClient`. A client captures its budget
in a closure where nothing can inspect it, so accepting one would reduce "requires a budget" to a
comment asking the caller to have been careful. Taking the signer, network and budget separately
means the policy is registered by construction and there is no argument you can pass that produces
a paid-call tool without a spend cap.

**The cap belongs to the operator, not to the agent.** There is no tool argument that raises it.

## Refusal happens before signing

An over-budget offer is refused by an upstream `PaymentPolicy`, which runs *before* upstream
creates a payment. So a refused call leaves **no signature in existence** — not an unsubmitted
one, not one discarded in a `catch`. "We did not submit it" is a far weaker guarantee than "it does
not exist", because a signed authorisation can be retried by the server that received it or leak
from a log.

The rejection carries the budget's own code rather than a generic one:

| Code | What the agent should conclude |
|---|---|
| `MOVO_E_BUDGET_EXCEEDED` | Too expensive for this operator's cap. Look for a cheaper resource, or stop. |
| `MOVO_E_BUDGET_PAYTO_NOT_ALLOWED` | This seller is not on the allowlist. Not a pricing problem. |
| `MOVO_E_BUDGET_NETWORK_NOT_ALLOWED` | Wrong network. The resource may exist elsewhere. |

Wrapping all three in one MCP-shaped code would throw away exactly the distinction the agent needs
to decide what to do next.

## The tools

### `bazaar.search`

Natural-language query over the catalog, with optional `type`, `network` and `payTo` filters and
an opaque cursor. Returns each match as the standard discovery wire shape **plus an `id`** — the
handle for the other two tools.

`partialResults: true` means a retriever was degraded or the results were truncated. An agent
deciding whether to rephrase needs the difference between "these are the best matches" and "these
are the best matches one of two retrievers could find".

### `bazaar.get`

One listing, by `id`, or by the `(resource, toolName)` tuple that an MCP listing is catalogued
under. It also carries `settlementCount` and `failureCount` — the listing's track record. An agent
that reads them can prefer a resource that actually works.

### `bazaar.paidCall`

Pays for and calls a resource. Address it by `id` (preferred — the URL then comes from the catalog
rather than from the agent's reconstruction of it) or by an absolute `url`. Supplying both is
refused rather than resolved: they can name different resources and there is no safe way to guess.

Values in `arguments` that match a `:param` in the resource URL are substituted into the path; the
rest become a query string for `GET`/`HEAD`/`DELETE` or a JSON body otherwise. Only `http` and
`https` URLs are accepted — the budget caps what an agent may spend, and this caps what it may
address.

## Every rejection is machine-readable

Rejections are **not** returned as MCP's `isError`. That channel means "the tool blew up", and an
agent reading it learns only that something went wrong. A budget refusal is a well-formed answer to
a well-formed question, so it travels in `structuredContent` like any other result:

```json
{
  "ok": false,
  "code": "MOVO_E_BUDGET_EXCEEDED",
  "reason": "the paid call to https://weather.example.com/weather/:city was refused before any payment was created, so no signature exists: offer amount 10000 exceeds maxAmountPerRequest 1",
  "fix": "Raise maxAmountPerRequest or maxTotalSpend if the offer is legitimate. …"
}
```

`reason` is a required non-empty string on the rejection branch, so a rejection without one does
not typecheck. That is deliberately stronger than a test: a test only checks the rejections someone
remembered to write one for.

`code` always resolves in the single `MOVO_E_*` registry, so it is documented and stable. The full
set this package can produce:

| Code | Meaning |
|---|---|
| `MOVO_E_MCP_BUDGET_REQUIRED` | Construction-time: no budget was supplied. |
| `MOVO_E_MCP_INPUT_INVALID` | Arguments the tool cannot act on. The reason names the field. |
| `MOVO_E_MCP_LISTING_NOT_FOUND` | Nothing is catalogued under that identifier. |
| `MOVO_E_MCP_NO_ACCEPTABLE_OFFER` | A 402 the budget did not refuse but nothing could pay — usually a network or scheme mismatch. |
| `MOVO_E_MCP_CALL_FAILED` | The resource returned a non-success status, or the request did not complete. |
| `MOVO_E_MCP_SETTLE_FAILED` | Payment was submitted but settlement did not succeed. |
| `MOVO_E_BUDGET_*` | The three budget refusals above. |

## Determinism

Nothing in a tool result embeds a timestamp, a duration, a random id or a host name. Two identical
calls against an unchanged catalog produce byte-identical structured content, which is what lets an
agent cache, diff and replay them. `tests/integration/mcp-discovery.test.ts` asserts this on the
serialised form, because that is what crosses the transport.

## What is not here

- **A remote catalog source.** `createMcpDiscoveryServer` reads a local `Catalog`, which is the
  operator's own. `Catalog` is the port, so a source that reads another facilitator's
  `/discovery/*` over HTTP is a straightforward addition — it is not built because nothing in M7
  asks for it, and an unused abstraction is a liability.
- **A per-call spend limit set by the agent.** The operator's budget is the cap. An argument that
  could only tighten it is surface nobody asked for; one that could loosen it is not a cap.
- **Anything beyond three tools.**

## See also

- [Integrating an agent](./agent-integration.md)
- [Buyer budgets](../security/buyer-budgets.md) — the control `bazaar.paidCall` is built on
- [Running a catalog](../discovery/running-a-catalog.md)
- `examples/mcp-agent` — a runnable agent that discovers and pays on testnet
