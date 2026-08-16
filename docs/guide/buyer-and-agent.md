# Buyer and agent

You want to pay for APIs. There are two versions of that, and the difference is whether you know
the API in advance.

## First: the threat you are defending against

**A 402 is a claim, not a fact.** A hostile or compromised server can name any recipient and any
amount, and nothing in the protocol prevents it. The facilitator will faithfully settle whatever
you signed.

**You are the only party in the exchange who can refuse.** That makes a budget a security control,
not a convenience — and it makes the *moment* of refusal load-bearing. Movo refuses **before** the
payment is created, so a refused offer leaves no signature in existence at all. "We did not submit
it" is a much weaker guarantee than "it does not exist", because a signed authorisation can be
retried by whoever received it, or leak from a log.

Build the budget first. Everything else is downstream of it.

```ts
import { createBudget, createMovoClient } from "@movoframework/client";
import { createEd25519Signer } from "@movoframework/core/client";

const budget = createBudget({
  maxAmountPerRequest: "500000", // 0.05 USDC at 7 decimals
  maxTotalSpend: "10000000", // 1 USDC for this process's lifetime
  allowedNetworks: ["stellar:testnet"],
  allowedPayTo: [process.env["MOVO_PAY_TO"] as string],
  onRefusal: (refusal) => {
    process.stdout.write(`REFUSED (${refusal.code}) ${refusal.reason}\n`);
  },
});

const client = createMovoClient({
  // You build the signer. Movo never generates, derives or stores a key.
  signer: createEd25519Signer(process.env["STELLAR_PRIVATE_KEY"] as string, "stellar:testnet"),
  network: "stellar:testnet",
  budget,
});
```

`allowedPayTo` is the check that stops a hostile 402 naming a recipient you never intended to pay.
Use it whenever you know who you are dealing with.

## Path A — you know the API

Import the seller's resource declaration and call it. The handler's return type becomes your call
site's result type, with no cast and no duplicated interface — a resource is plain serialisable
data that both sides can import.

```ts no-check
import { currentWeather } from "@movoframework/example-discoverable-api";

const result = await client.call(currentWeather, { city: "SFO" }, "http://localhost:4022");

if (result.payment.status === "settled") {
  // `result.data.tempC` is a number here because the resource said so.
  console.log(result.data.city, result.data.tempC);
  console.log(result.payment.transaction);
}
console.log(budget.spent(), budget.remaining());
```

Runnable: `pnpm --filter @movoframework/example-agent-buyer start`.

`result.payment.status` is one of `settled`, `settle_failed`, `payment_required` or `none`.
`payment_required` means no payment was made — inspect `budget.refusals` to find out why rather
than assuming the server was down.

`result.catalog.status` reports what the facilitator said about cataloguing, and `unknown` is
**not** a failure — see [running a catalog](../discovery/running-a-catalog.md#known-upstream-gap)
for why it is currently always `unknown` through an x402 resource server.

## Path B — you do not know the API

This is the agent case, and it is what `@movoframework/mcp` exists for. Connect an agent runtime
to an MCP discovery server and it can search a catalog, read a listing, and pay — with nothing
integrated in advance.

```sh
pnpm --filter @movoframework/example-mcp-agent start
```

Real output from that example, against testnet:

```
bazaar.search "what is the weather at an airport"
  1. Example Weather
     http://127.0.0.1:54858/weather/:city
     Current weather conditions for a city
     price 10000 base units

bazaar.get — settlements 1, failures 0

bazaar.paidCall
  received    {"city":"SFO","tempC":14,"conditions":"foggy"}
  transaction d1b8a02617239d3ed00bf10406eac37a10cf110ee22d7fc80ab411461f23a955
  budget      10000 spent, 990000 remaining

the same call, under an operator cap of one stroop:
  MOVO_E_BUDGET_EXCEEDED
  the paid call … was refused before any payment was created, so no signature exists:
  offer amount 10000 exceeds maxAmountPerRequest 1

  spent after refusal: 0 — nothing was signed or submitted.
```

The URL, the price and the parameter name all came out of the search result. Nothing in that
example's source names them.

See [agent integration](../mcp/agent-integration.md) for the loop, the error codes, and the
surprises.

## Budgets, in detail

| Option | What it stops |
|---|---|
| `maxAmountPerRequest` | A single overpriced call |
| `maxTotalSpend` | A loop that is individually reasonable and collectively ruinous |
| `allowedPayTo` | Paying a recipient you never intended to |
| `allowedNetworks` | A testnet-only buyer being talked onto mainnet by a 402 |

`maxTotalSpend` is the one that matters most for an autonomous agent, and it is worth knowing how
it is counted. Spend is recorded at **settlement**, from the amount the facilitator reports — and
because the `exact` scheme does not report one, from the amount the policy approved, which under
`exact` is the same number by definition of the scheme. Read `budget.remaining()` between calls;
an agent planning ten calls against room for three should find out before the fourth.

The residual, stated rather than hidden: because spend is counted at settlement rather than at
approval, payments genuinely in flight at the same instant are each checked against the total
separately. Counting at approval instead would permanently consume the cap for every payment that
was approved and then failed — an agent that gradually locks itself out, which is worse. Sequential
calls, which is what `bazaar.paidCall` makes, are unaffected.

## Testing without spending

Set `maxAmountPerRequest: "1"`. Every paid call is refused before a payment is created; you can
exercise the whole discover-and-decide loop with no signature produced and nothing settled.

## See also

- [Buyer budgets](../security/buyer-budgets.md)
- [Agent integration](../mcp/agent-integration.md)
- [The payment lifecycle](../concepts/payment-lifecycle.md)
