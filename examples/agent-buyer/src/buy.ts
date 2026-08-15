/**
 * A buyer that refuses to be overcharged.
 *
 * Three things happen here, in order, and the order is the point:
 *
 *   1. a budget is constructed, capping per-request and total spend and naming the only
 *      addresses and networks this buyer will pay
 *   2. the budget's policy is registered with the upstream client, so it filters offers BEFORE
 *      a payment is created — a refused offer leaves no signature in existence
 *   3. only then is a call made
 *
 * The signer is built here, by the caller, from an environment variable. Movo never generates,
 * derives or stores a key.
 */

import { queryCatalog } from "@movoframework/bazaar";
import { createBudget, createMovoClient } from "@movoframework/client";
import { createEd25519Signer } from "@movoframework/core/client";
import { currentWeather } from "@movoframework/example-discoverable-api";

const secret = process.env["STELLAR_PRIVATE_KEY"];
if (secret === undefined) {
  throw new Error("STELLAR_PRIVATE_KEY is required — this is the BUYER's key, never a server's.");
}

const budget = createBudget({
  // 0.05 USDC per request, at 7 decimals.
  maxAmountPerRequest: "500000",
  // 1 USDC in total for this process's lifetime.
  maxTotalSpend: "10000000",
  allowedNetworks: ["stellar:testnet"],
  ...(process.env["MOVO_PAY_TO"] === undefined
    ? {}
    : { allowedPayTo: [process.env["MOVO_PAY_TO"]] }),
  onRefusal: (refusal) => {
    process.stdout.write(`REFUSED (${refusal.code})\n  ${refusal.reason}\n`);
  },
});

const client = createMovoClient({
  signer: createEd25519Signer(secret, "stellar:testnet"),
  network: "stellar:testnet",
  budget,
});

const baseUrl = process.env["MOVO_API_URL"] ?? "http://localhost:4022";

// `call` reuses the SERVER's resource declaration, so `result.data` is typed as the handler's
// return type with no cast and no duplicated interface.
const result = await client.call(currentWeather, { city: "SFO" }, baseUrl);

process.stdout.write(
  [
    `status      ${result.payment.status}`,
    `transaction ${result.payment.transaction ?? "none"}`,
    `spent       ${budget.spent()} of ${budget.remaining() ?? "unlimited"} remaining`,
    "",
    // `catalog.status` is one of four values and `unknown` is NOT a failure — many facilitators
    // never emit the header at all.
    `catalog     ${result.catalog.status}${
      result.catalog.status === "unknown" ? ` (${result.catalog.reason})` : ""
    }`,
    "",
  ].join("\n"),
);

if (result.payment.status === "settled") {
  // `result.data.tempC` is a number here because the resource said so. No cast.
  process.stdout.write(`${result.data.city} is ${String(result.data.tempC)}C\n`);
}

// Browsing a facilitator's catalog is a separate operation from paying, and reports only what
// the facilitator returned. Movo cannot promise inclusion.
const catalog = queryCatalog(
  process.env["MOVO_FACILITATOR_URL"] ?? "https://www.x402.org/facilitator",
);
const listed = await catalog.list({ type: "http" });
process.stdout.write(`\ncatalog reports ${JSON.stringify(listed).length} bytes of listings\n`);
