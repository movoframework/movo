/**
 * A buyer script: discover a resource, then pay for it.
 *
 * Run it with `node src/buyer.ts` once the server is up and `STELLAR_PRIVATE_KEY` holds a funded
 * testnet **buyer** seed with a USDC trustline.
 *
 * The budget is the part worth reading twice. A 402 is a **claim**, not a fact — a server can
 * name any `payTo` and any amount it likes, and the facilitator will faithfully settle whatever
 * was signed, because settling what was signed is its job. The buyer is the only party that can
 * refuse, which makes these four settings security controls rather than conveniences.
 */

import { queryCatalog } from "@movoframework/bazaar";
import { createBudget, createMovoClient } from "@movoframework/client";
import { createEd25519Signer } from "@movoframework/core/client";

const secret = process.env["STELLAR_PRIVATE_KEY"];
if (secret === undefined) {
  throw new Error(
    "STELLAR_PRIVATE_KEY is required: a buyer signs payment authorisations, so it needs a key. Use a funded testnet account with a USDC trustline.",
  );
}

const facilitatorUrl = process.env["MOVO_FACILITATOR_URL"] ?? "https://www.x402.org/facilitator";
const serverUrl = process.env["SERVER_URL"] ?? "http://localhost:4021";

// ─── Discover ─────────────────────────────────────────────────────────────────────────────
//
// A facilitator is not obliged to operate a catalog, so an empty result may mean this one does
// not rather than that nothing matched.
const catalog = queryCatalog(facilitatorUrl);
const found = await catalog.search({ query: "weather" });
process.stdout.write(`catalog returned ${String(found.resources.length)} resource(s)\n`);

// ─── Pay ──────────────────────────────────────────────────────────────────────────────────

const budget = createBudget({
  maxAmountPerRequest: "10000", // 0.001 USDC at 7 decimals
  maxTotalSpend: "100000", // 0.01 USDC for this process
  allowedNetworks: ["stellar:testnet"],
  onRefusal: (refusal) => {
    process.stderr.write(`refused: ${refusal.code} — ${refusal.reason}\n`);
  },
});

const client = createMovoClient({
  signer: createEd25519Signer(secret, "stellar:testnet"),
  network: "stellar:testnet",
  budget,
});

const response = await client.fetch(`${serverUrl}/weather/SFO`);
process.stdout.write(`${String(response.status)} ${await response.text()}\n`);
process.stdout.write(`spent ${budget.spent()} base units\n`);
