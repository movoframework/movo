# Integrating an agent

This page is for the person writing the agent, not the person running the catalog. For the server
side see [the discovery server](./discovery-server.md).

## The shape of the loop

An agent that can pay has four steps available to it, and only the first three are free:

1. **search** — `bazaar.search` with a description of what you need
2. **read** — `bazaar.get` for the full record, including the parameter schema and the listing's
   settlement and failure counts
3. **decide** — is it worth the price named in `accepts[0].amount`?
4. **pay** — `bazaar.paidCall`, which either returns the resource or a rejection naming why

Step 3 is the one worth building deliberately. The price is in the search result, so an agent can
compare before it commits, and `failureCount` relative to `settlementCount` tells it whether other
callers got what they paid for.

## A minimal agent

```ts no-check
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const agent = new Client({ name: "my-agent", version: "1.0.0" });
await agent.connect(new StdioClientTransport({ command: "movo-bazaar-mcp" }));

const found = await agent.callTool({
  name: "bazaar.search",
  arguments: { query: "current weather by airport code", network: "stellar:testnet" },
});
const { ok, resources } = found.structuredContent as {
  ok: boolean;
  resources: { id: string; accepts: { amount: string }[] }[];
};

if (ok && resources.length > 0) {
  const cheapest = resources.reduce((best, next) =>
    BigInt(next.accepts[0].amount) < BigInt(best.accepts[0].amount) ? next : best,
  );

  const paid = await agent.callTool({
    name: "bazaar.paidCall",
    arguments: { id: cheapest.id, arguments: { city: "SFO" } },
  });
  console.log(paid.structuredContent);
}
```

Note what is absent: no URL, no price, no schema, no import of the seller's declaration. That is
what "no pre-baked integration" means. `examples/mcp-agent` is this, complete and runnable against
testnet.

## Reading results

Every result carries `ok`. Branch on it before anything else.

```ts no-check
const result = paid.structuredContent as
  | { ok: true; data: unknown; payment: { transaction: string | null } }
  | { ok: false; code: string; reason: string; fix: string };

if (!result.ok) {
  // `code` is stable and documented; `reason` is never null and never empty.
  switch (result.code) {
    case "MOVO_E_BUDGET_EXCEEDED":
      // Too expensive for this operator's cap. Try a cheaper listing — do not retry this one.
      break;
    case "MOVO_E_MCP_SETTLE_FAILED":
      // The payment did not settle and the output was withheld. Re-issuing the call is safe.
      break;
    default:
      break;
  }
}
```

**Do not parse `reason`.** It is written for a human reading a log and may be reworded. `code` is
the branching signal and is permanent — a code is never reused for a different meaning.

## Things that will surprise you

**A refusal is not an error.** Rejections come back with `isError` unset, as ordinary structured
content. If your agent framework only surfaces `isError`, you will see a "successful" tool call
whose payload says `ok: false`. Branch on `ok`.

**The budget is not yours.** There is no argument that raises the cap. If `MOVO_E_BUDGET_EXCEEDED`
keeps firing, that is the operator telling you what this agent is allowed to spend. Escalate to a
human rather than looping.

**`maxTotalSpend` is cumulative across the server's lifetime.** `bazaar.paidCall` returns
`budget.remaining` on every success. Read it. An agent that plans ten calls against a budget with
room for three should discover that before the fourth, not during it.

**A paid route that returns 4xx costs nothing.** Upstream cancels settlement on status ≥ 400, so
`MOVO_E_MCP_CALL_FAILED` after a bad request means a failed call, not a lost payment. Fix the
arguments and retry.

**`partialResults: true` is common.** It means one retriever was degraded or the page was
truncated. Semantic search requires the operator to have enabled the embedding model; a
lexical-only catalog reports `partialResults` on every non-trivial query. Treat it as "there may be
better matches", not as a failure.

**Prefer `id` over `url`.** Addressing by `id` means the URL comes from the catalog. Addressing by
`url` means it comes from whatever your model produced, and a model that hallucinated a URL will
happily try to pay it — the `http`/`https` restriction and the budget are the only things between
that and a real payment.

## Testing an agent without spending anything

Set `maxAmountPerRequest: "1"`. Every paid call is refused before a payment is created, and you can
exercise the whole discovery-and-decide loop with no signature ever produced and nothing settled.
`examples/mcp-agent` ends by doing exactly this.

## See also

- [The MCP discovery server](./discovery-server.md)
- [Buyer budgets](../security/buyer-budgets.md)
- [Search quality](../discovery/search-quality.md) — what the ranking actually does
