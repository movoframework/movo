/**
 * §1.16 layer 4 — the dedicated stock-client conformance suite. **The RFP's literal acceptance
 * test** (§3.6: reviewers point stock SDK code at the deliverable rather than read a conformance
 * claim), deferred to M8 in writing since amendment 004 §8 and now built.
 *
 * ## What makes this different from the e2e suite, given both use a stock buyer
 *
 * `tests/e2e/*` is Movo's own end-to-end test: it happens to build its buyer from upstream
 * packages under the narrow-waist exemption, which is why the *client* half of layer 4 has been
 * satisfied in substance since M2. What was missing is the **separation and the matrix**. One
 * suite serving as both the project's end-to-end test and its interoperability evidence cannot
 * tell a reader which of the two claims it just falsified, and it proves one network and one
 * scheme because that is all it was ever asked to drive.
 *
 * This suite exists to answer one question and no other: **does an unmodified upstream client
 * complete a payment through the Movo stack, on every network and every scheme the deployment
 * advertises, and does every rejection carry a machine-readable reason?** It does not test Movo's
 * internals. It formalises what M6's 7/7 upstream e2e run demonstrated ad hoc; it does not
 * replace that run, which remains the stronger evidence because the *harness* is upstream's too.
 *
 * ## Three properties this suite has that a conformance claim cannot
 *
 * 1. **The schemes are read from the deployment, not from this file.** The matrix comes from the
 *    facilitator's own `/supported`. A deployment that advertises a scheme with no stock client
 *    registered here **fails** rather than skipping — a scheme advertised and never proven by a
 *    third-party client is precisely the gap this suite exists to close, so it must be loud.
 * 2. **The networks are a matrix, not a constant.** Both networks the RFP names are present from
 *    the start; pubnet is a configuration flip behind a deliberate opt-in (see
 *    `tests/support/conformance-networks.ts`). A network that cannot run is reported UNVERIFIED
 *    with its reason, never dropped.
 * 3. **Settlement is confirmed from Horizon**, which is neither the server under test nor the
 *    facilitator that reported success. Asserting on the `PAYMENT-RESPONSE` header alone would
 *    let a fabricated settlement pass (spec §11.3).
 *
 * Gated behind `MOVO_E2E=1` and never part of the PR gate.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFacilitatorApp } from "../../apps/facilitator/src/app.ts";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  defineApp,
  defineResource,
  PAYMENT_HEADERS,
  type PaymentRequirements,
} from "../../packages/core/src/index.ts";
import {
  createFacilitator,
  facilitatorConfigFromEnv,
  resolveFacilitatorConfig,
} from "../../packages/facilitator/src/index.ts";
import { mountExpress } from "../../packages/server/src/index.ts";
import { type ConformanceNetwork, selectNetworks } from "../support/conformance-networks.ts";

const ENABLED = process.env["MOVO_E2E"] === "1";

/**
 * The stock client for each scheme, by scheme name.
 *
 * Every value here constructs an **unmodified upstream** scheme client. Nothing Movo-shaped may
 * appear in this map: the moment it does, the suite stops being third-party evidence. When
 * `upto` ships (RFP §3.4, committed phase 2) it is added here and the matrix picks it up from
 * `/supported` with no other change.
 */
const STOCK_SCHEME_CLIENTS: {
  readonly [scheme: string]: (network: string, buyerKey: string) => Promise<unknown>;
} = {
  exact: async (network, buyerKey) => {
    const { ExactStellarScheme } = await import("@x402/stellar/exact/client");
    const { createEd25519Signer } = await import("@x402/stellar");
    return new ExactStellarScheme(createEd25519Signer(buyerKey, network as never));
  },
};

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current conditions",
  mimeType: "application/json",
  handler: (ctx) => ({ city: ctx.params["city"], tempC: 14, conditions: "foggy" }),
});

interface Deployment {
  readonly facilitatorUrl: string;
  readonly sellerUrl: string;
  close(): Promise<void>;
}

/** One row of the published evidence table. */
interface SettlementEvidence {
  readonly network: string;
  readonly scheme: string;
  readonly hash: string;
  readonly ledger: number;
  readonly successful: boolean;
}

const settlements: SettlementEvidence[] = [];
const rejections = new Map<string, string>();
const unverified: string[] = [];

/**
 * Stand the Movo stack up for one network: `apps/facilitator` on one port, a Movo resource
 * server on another, with an HTTP hop between them.
 *
 * The hop is load-bearing. Without it this would test a library call rather than a facilitator
 * service, and the service is what a third party integrates against.
 *
 * @param network - The network under test
 * @returns The running deployment
 */
async function deploy(network: ConformanceNetwork): Promise<Deployment> {
  const env = { ...process.env, MOVO_FACILITATOR_NETWORKS: network.caip2 };
  const config = resolveFacilitatorConfig(facilitatorConfigFromEnv(env));

  const facilitator = createFacilitator(config);
  const app = createFacilitatorApp({ facilitator, log: () => undefined });
  const facilitatorServer = serve({ fetch: app.fetch, port: 0 });
  const facilitatorPort = (facilitatorServer.address() as AddressInfo).port;
  const facilitatorUrl = `http://127.0.0.1:${String(facilitatorPort)}`;

  const application = express();
  application.use(express.json());
  await mountExpress(application as never, defineApp({ resources: [weather] }), {
    config: {
      env: { ...process.env, MOVO_NETWORK: network.caip2 },
      argument: { facilitator: { url: facilitatorUrl } },
    },
  });

  const seller: Server = createServer(application);
  await new Promise<void>((resolve) => seller.listen(0, resolve));
  const sellerPort = (seller.address() as AddressInfo).port;

  return {
    facilitatorUrl,
    sellerUrl: `http://127.0.0.1:${String(sellerPort)}`,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => seller.close(() => resolve()));
      await new Promise<void>((resolve) => {
        facilitatorServer.close(() => resolve());
      });
    },
  };
}

/**
 * The schemes a deployment advertises for one network, read from its own `/supported`.
 *
 * @param facilitatorUrl - The running facilitator
 * @param caip2 - The network to filter to
 * @returns The advertised scheme names
 */
async function advertisedSchemes(
  facilitatorUrl: string,
  caip2: string,
): Promise<readonly string[]> {
  const response = await fetch(`${facilitatorUrl}/supported`);
  const body = (await response.json()) as {
    kinds?: readonly { scheme?: string; network?: string }[];
  };
  return [
    ...new Set(
      (body.kinds ?? [])
        .filter((kind) => kind.network === caip2)
        .map((kind) => kind.scheme)
        .filter((scheme): scheme is string => scheme !== undefined),
    ),
  ];
}

/**
 * Build an unmodified upstream buyer for one network and scheme.
 *
 * @param network - The network under test
 * @param scheme - The scheme name, as advertised by `/supported`
 * @param buyerKey - The buyer's secret
 * @returns A paying `fetch` and the raw upstream client
 */
async function stockBuyer(
  network: ConformanceNetwork,
  scheme: string,
  buyerKey: string,
): Promise<{ payingFetch: typeof fetch; client: import("@x402/fetch").x402Client }> {
  const factory = STOCK_SCHEME_CLIENTS[scheme];
  if (factory === undefined) {
    throw new Error(
      `${network.caip2} advertises the "${scheme}" scheme but this suite registers no stock ` +
        "client for it. An advertised scheme no third-party client has ever driven is exactly " +
        "the gap this suite exists to close: add it to STOCK_SCHEME_CLIENTS or stop advertising it.",
    );
  }

  const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
  const client = new x402Client().register(
    network.caip2 as never,
    (await factory(network.caip2, buyerKey)) as never,
  );
  return { payingFetch: wrapFetchWithPayment(fetch, client) as typeof fetch, client };
}

/**
 * Fetch a transaction from Horizon — neither the server under test nor the facilitator.
 *
 * @param horizon - The network's Horizon instance
 * @param hash - The transaction hash
 * @returns The ledger's own account of the transaction
 */
async function fromHorizon(
  horizon: string,
  hash: string,
): Promise<{ successful: boolean; ledger: number }> {
  const response = await fetch(`${horizon}/transactions/${hash}`);
  if (!response.ok) throw new Error(`Horizon returned ${String(response.status)} for ${hash}`);
  return (await response.json()) as { successful: boolean; ledger: number };
}

/**
 * Sign a genuine payment, optionally committing to different requirements than the ones the
 * facilitator will check against.
 *
 * Every rejection scenario below uses a **real signature over real requirements**. A structurally
 * malformed payload would be rejected by anything and proves nothing about verification.
 *
 * @param deployment - The running stack
 * @param network - The network under test
 * @param scheme - The scheme under test
 * @param buyerKey - The buyer's secret
 * @param mutate - Rewrites what the buyer commits to
 * @returns The signed payload and the requirements to check it against
 */
async function signPayment(
  deployment: Deployment,
  network: ConformanceNetwork,
  scheme: string,
  buyerKey: string,
  mutate?: (advertised: PaymentRequirements) => PaymentRequirements,
): Promise<{ payload: unknown; requirements: PaymentRequirements }> {
  const { client } = await stockBuyer(network, scheme, buyerKey);
  const unpaid = await fetch(`${deployment.sellerUrl}/weather/SFO`);
  const required = decodePaymentRequiredHeader(
    unpaid.headers.get(PAYMENT_HEADERS.required) as string,
  );
  const advertised = required.accepts[0] as PaymentRequirements;
  const signedFor = mutate === undefined ? advertised : mutate(advertised);
  const payload = await client.createPaymentPayload({ ...required, accepts: [signedFor] });
  return { payload, requirements: advertised };
}

/**
 * Ask the facilitator to verify or settle, over HTTP, exactly as a third party would.
 *
 * @param facilitatorUrl - The running facilitator
 * @param operation - `verify` or `settle`
 * @param payload - The signed payment payload
 * @param requirements - The requirements to check against
 * @returns The parsed response
 */
async function callFacilitator(
  facilitatorUrl: string,
  operation: "verify" | "settle",
  payload: unknown,
  requirements: PaymentRequirements,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${facilitatorUrl}/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements: requirements,
    }),
  });
  return (await response.json()) as Record<string, unknown>;
}

const selections = ENABLED ? selectNetworks(process.env) : [];

for (const selection of selections) {
  const { network } = selection;

  if (!selection.runnable) {
    describe(`layer 4 — ${network.caip2}`, () => {
      it.skip(`is UNVERIFIED: ${selection.reason}`, () => undefined);
    });
    unverified.push(selection.reason);
    continue;
  }

  describe(`layer 4 — an unmodified stock client against the Movo stack on ${network.caip2}`, () => {
    let deployment: Deployment | undefined;
    let schemes: readonly string[] = [];
    const buyerKey = process.env[network.buyerKeyEnv] as string;

    beforeAll(async () => {
      deployment = await deploy(network);
      schemes = await advertisedSchemes(deployment.facilitatorUrl, network.caip2);
    }, 180_000);

    afterAll(async () => {
      await deployment?.close();
      deployment = undefined;
    });

    it("advertises at least one scheme for this network", () => {
      // A deployment that advertises nothing would make every assertion below vacuous — the
      // shape of a suite that passes by having nothing to do.
      expect(schemes.length).toBeGreaterThan(0);
    });

    it("registers a stock client for every advertised scheme", () => {
      const unregistered = schemes.filter((scheme) => STOCK_SCHEME_CLIENTS[scheme] === undefined);
      expect(unregistered).toEqual([]);
    });

    it("settles a payment per advertised scheme, confirmed on-chain", async () => {
      const stack = deployment as Deployment;

      for (const scheme of schemes) {
        const { payingFetch } = await stockBuyer(network, scheme, buyerKey);
        const paid = await payingFetch(`${stack.sellerUrl}/weather/SFO`);

        expect(paid.status, `${scheme}: paid request did not return 200`).toBe(200);

        const settled = decodePaymentResponseHeader(
          paid.headers.get(PAYMENT_HEADERS.response) as string,
        );
        const hash = settled.transaction as string;
        expect(hash, `${scheme}: no transaction reference in PAYMENT-RESPONSE`).toBeTruthy();

        const onChain = await fromHorizon(network.horizon, hash);
        expect(onChain.successful, `${scheme}: ${hash} is not successful on-chain`).toBe(true);

        settlements.push({
          network: network.caip2,
          scheme,
          hash,
          ledger: onChain.ledger,
          successful: onChain.successful,
        });
      }
    }, 300_000);

    it("returns a non-null, machine-readable reason on every rejection", async () => {
      const stack = deployment as Deployment;
      const scheme = schemes[0] as string;

      /**
       * Every scenario is a **genuine signature over a genuine mismatch**, never a malformed
       * payload — anything would reject a malformed payload, so it proves nothing about
       * verification (spec §5.11). `signedFor` rewrites what the buyer commits to; `checkedAgainst`
       * rewrites what the facilitator is asked to check it against. One or the other, never both.
       */
      const scenarios: readonly {
        name: string;
        signedFor?: (advertised: PaymentRequirements) => PaymentRequirements;
        checkedAgainst?: (advertised: PaymentRequirements) => PaymentRequirements;
      }[] = [
        {
          name: "amount tampered",
          // Signed for one stroop; checked against the price the seller actually advertised.
          signedFor: (advertised) => ({ ...advertised, amount: "1" }),
        },
        {
          name: "wrong recipient",
          checkedAgainst: (advertised) => ({
            ...advertised,
            payTo: "GBFZXIRUOJDSXEIYFMHNM3RGQ25FTKQXQKQRZ7LUJZBMHFBHM5YQZ4YT",
          }),
        },
        {
          name: "wrong asset",
          checkedAgainst: (advertised) => ({
            ...advertised,
            asset: "CD4PXYSBBM3XA4NOGPDL64X6CW3CPU2CQ2X6KK7BTMPXS2Q33LNGJBX3",
          }),
        },
        {
          name: "wrong network",
          checkedAgainst: (advertised) => ({ ...advertised, network: "stellar:pubnet" }),
        },
      ];

      for (const scenario of scenarios) {
        const { payload, requirements } = await signPayment(
          stack,
          network,
          scheme,
          buyerKey,
          scenario.signedFor,
        );
        const checked =
          scenario.checkedAgainst === undefined
            ? requirements
            : scenario.checkedAgainst(requirements);
        const body = await callFacilitator(stack.facilitatorUrl, "verify", payload, checked);

        expect(body["isValid"], `${scenario.name}: was not rejected`).toBe(false);

        const reason = body["invalidReason"];
        expect(typeof reason, `${scenario.name}: reason is not a string`).toBe("string");
        expect(reason, `${scenario.name}: reason is empty`).toBeTruthy();
        expect(reason, `${scenario.name}: reason is the string "null"`).not.toBe("null");

        rejections.set(`${network.caip2} · ${scenario.name}`, reason as string);
      }
    }, 300_000);

    it("gave distinct causes distinct reasons", () => {
      const forThisNetwork = [...rejections]
        .filter(([key]) => key.startsWith(network.caip2))
        .map(([, reason]) => reason);
      // §D.1: a reason-collapse is invisible to a test that only checks that rejection happened.
      // An agent handed one token for "you underpaid" and "you paid the wrong account" cannot
      // act differently on them.
      expect(new Set(forThisNetwork).size).toBe(forThisNetwork.length);
    });
  });
}

describe.skipIf(!ENABLED)("layer 4 — published evidence", () => {
  it("reports a settled hash per network per scheme, and every unverified row", () => {
    process.stdout.write(
      `\nLAYER 4 — STOCK-CLIENT CONFORMANCE\n\nSettled (hash per network per scheme):\n${settlements
        .map(
          (row) =>
            `  ${row.network.padEnd(17)} ${row.scheme.padEnd(7)} ${row.hash}  ledger ${String(row.ledger)}`,
        )
        .join("\n")}\n\nRejection reasons:\n${[...rejections]
        .map(([scenario, reason]) => `  ${scenario.padEnd(40)} ${reason}`)
        .join("\n")}\n${
        unverified.length > 0
          ? `\nNot verified:\n${unverified.map((r) => `  ${r}`).join("\n")}\n`
          : ""
      }\n`,
    );

    // The suite must have proved something. An evidence report with no evidence in it is the
    // failure mode this whole layer exists to prevent.
    expect(settlements.length).toBeGreaterThan(0);
    for (const row of settlements) expect(row.successful).toBe(true);
  });
});
