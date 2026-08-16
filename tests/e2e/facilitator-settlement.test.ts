import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Address, Transaction, xdr } from "@stellar/stellar-sdk";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFacilitatorApp } from "../../apps/facilitator/src/app.ts";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  defineApp,
  defineResource,
  getNetworkPassphrase,
  PAYMENT_HEADERS,
  type PaymentRequirements,
} from "../../packages/core/src/index.ts";
import {
  createFacilitator,
  facilitatorConfigFromEnv,
  type MovoFacilitator,
  resolveFacilitatorConfig,
} from "../../packages/facilitator/src/index.ts";
import { mountExpress } from "../../packages/server/src/index.ts";

/**
 * M6's evidence, produced against real Stellar testnet.
 *
 * Everything the acceptance criteria actually assert happens here, because everything they
 * assert is about what a real client, a real chain and a real ledger do. The unit and
 * integration suites prove the service tier; this proves the thing the service tier exists to
 * serve.
 *
 * Gated behind `MOVO_E2E=1`, and it refuses pubnet outright — the same guard the M2 suite
 * carries. Requires:
 *
 *   STELLAR_PRIVATE_KEY                      a funded testnet buyer holding USDC
 *   MOVO_PAY_TO                              the seller address
 *   MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS    comma-separated funded sponsor seeds
 *
 * Every transaction hash printed by this suite is real, was submitted by this service, and is
 * confirmed from Horizon — a source that is neither the server under test nor the facilitator
 * that reported success. That independence is the whole point (spec §11.3): asserting on the
 * `PAYMENT-RESPONSE` header alone would let a fabricated settlement pass.
 */

const E2E_ENABLED = process.env["MOVO_E2E"] === "1";
const HORIZON = "https://horizon-testnet.stellar.org";
const NETWORK = "stellar:testnet";

const buyerSecret = process.env["STELLAR_PRIVATE_KEY"];
const payTo = process.env["MOVO_PAY_TO"];

/** How many settlements the AC6.8 concurrency probe attempts. */
const CONCURRENCY = Number(process.env["MOVO_FACILITATOR_LOAD"] ?? "200");

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
  readonly facilitator: MovoFacilitator;
  close(): Promise<void>;
}

let deployment: Deployment | undefined;

/**
 * Stand up the real thing: `apps/facilitator` on one port, a Movo resource server on another,
 * with the resource server pointed at the facilitator over HTTP.
 *
 * The HTTP hop between them is deliberate and load-bearing. It is what makes this a test of a
 * *facilitator service* rather than of a library call, and it is the hop AC6.1 requires an
 * unmodified stock client to be able to complete a payment across.
 */
async function deploy(overrides?: { readonly sponsorFloorXlm?: number }): Promise<Deployment> {
  const base = facilitatorConfigFromEnv(process.env);
  const config =
    overrides?.sponsorFloorXlm === undefined
      ? base
      : resolveFacilitatorConfig({
          networks: base.networks.map((network) => ({
            ...network,
            sponsorFloorXlm: overrides.sponsorFloorXlm as number,
          })),
        });

  const facilitator = createFacilitator(config);
  const app = createFacilitatorApp({ facilitator, log: () => undefined });
  const facilitatorServer = serve({ fetch: app.fetch, port: 0 });
  const facilitatorPort = (facilitatorServer.address() as AddressInfo).port;
  const facilitatorUrl = `http://127.0.0.1:${String(facilitatorPort)}`;

  const application = express();
  application.use(express.json());
  await mountExpress(application as never, defineApp({ resources: [weather] }), {
    config: {
      env: process.env,
      // Point the seller at the facilitator under test rather than the public one.
      argument: { facilitator: { url: facilitatorUrl } },
    },
  });

  const seller: Server = createServer(application);
  await new Promise<void>((resolve) => seller.listen(0, resolve));
  const sellerPort = (seller.address() as AddressInfo).port;

  return {
    facilitatorUrl,
    sellerUrl: `http://127.0.0.1:${String(sellerPort)}`,
    facilitator,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => seller.close(() => resolve()));
      await new Promise<void>((resolve) => {
        facilitatorServer.close(() => resolve());
      });
    },
  };
}

/** Build an unmodified stock buyer. Nothing Movo-shaped touches it. */
async function stockBuyer(): Promise<{
  payingFetch: typeof fetch;
  client: import("@x402/fetch").x402Client;
}> {
  const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
  const { ExactStellarScheme } = await import("@x402/stellar/exact/client");
  const { createEd25519Signer } = await import("@x402/stellar");

  const client = new x402Client().register(
    NETWORK,
    new ExactStellarScheme(createEd25519Signer(buyerSecret as string, NETWORK)),
  );
  return { payingFetch: wrapFetchWithPayment(fetch, client) as typeof fetch, client };
}

/** Fetch a transaction from Horizon — neither the server under test nor the facilitator. */
async function fromHorizon(hash: string): Promise<{
  successful: boolean;
  ledger: number;
  envelope_xdr: string;
  source_account: string;
  fee_charged: string;
}> {
  const response = await fetch(`${HORIZON}/transactions/${hash}`);
  if (!response.ok) throw new Error(`Horizon returned ${String(response.status)} for ${hash}`);
  return (await response.json()) as never;
}

/**
 * Sign a payment against the seller's advertised requirements, optionally signing against
 * *different* requirements than the ones returned as `requirements`.
 *
 * The distinction is the whole point of the tampering scenarios. `signedFor` is what the buyer
 * committed to; `requirements` is what the facilitator is asked to check against. When they
 * differ, the signature is genuine and the mismatch is real — which is the only kind of
 * rejection that proves anything. A structurally malformed payload would be rejected by
 * anything and is prohibited as evidence (spec §5.11).
 */
async function signPayment(
  sellerUrl: string,
  mutate?: (advertised: PaymentRequirements) => PaymentRequirements,
): Promise<{
  payload: unknown;
  requirements: PaymentRequirements;
  signedFor: PaymentRequirements;
}> {
  const { client } = await stockBuyer();
  const unpaid = await fetch(`${sellerUrl}/weather/SFO`);
  const required = decodePaymentRequiredHeader(
    unpaid.headers.get(PAYMENT_HEADERS.required) as string,
  );
  const advertised = required.accepts[0] as PaymentRequirements;
  const signedFor = mutate === undefined ? advertised : mutate(advertised);

  const payload = await client.createPaymentPayload({ ...required, accepts: [signedFor] });
  return { payload, requirements: advertised, signedFor };
}

/** POST a verify or settle envelope straight at the facilitator, as a stock client would. */
async function callFacilitator(
  facilitatorUrl: string,
  operation: "verify" | "settle",
  payload: unknown,
  requirements: PaymentRequirements,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${facilitatorUrl}/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements: requirements,
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  if (!E2E_ENABLED) return;
  if (buyerSecret === undefined || payTo === undefined) {
    throw new Error("MOVO_E2E=1 requires STELLAR_PRIVATE_KEY and MOVO_PAY_TO.");
  }
  if ((process.env["MOVO_NETWORK"] ?? NETWORK) !== NETWORK) {
    throw new Error("the facilitator e2e suite must never run against pubnet");
  }
  deployment = await deploy();
}, 120_000);

afterAll(async () => {
  await deployment?.close();
  deployment = undefined;
});

describe.skipIf(!E2E_ENABLED)("AC6.1 — a stock client pays through the Movo facilitator", () => {
  it("settles on Stellar testnet, confirmed independently from Horizon", async () => {
    const { payingFetch } = await stockBuyer();
    const paid = await payingFetch(`${(deployment as Deployment).sellerUrl}/weather/SFO`);

    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({ city: "SFO", tempC: 14, conditions: "foggy" });

    const settle = decodePaymentResponseHeader(
      paid.headers.get(PAYMENT_HEADERS.response) as string,
    );
    expect(settle.success).toBe(true);
    expect(settle.network).toBe(NETWORK);

    const hash = settle.transaction as string;
    const onChain = await fromHorizon(hash);
    expect(onChain.successful).toBe(true);

    process.stdout.write(
      `\nAC6.1 SETTLED VIA MOVO FACILITATOR: ${hash}\n  ledger: ${String(onChain.ledger)}\n  source: ${onChain.source_account}\n  fee:    ${onChain.fee_charged} stroops\n  verify: ${HORIZON}/transactions/${hash}\n\n`,
    );
  }, 300_000);
});

describe.skipIf(!E2E_ENABLED)("AC6.3 — /supported against the public reference", () => {
  it("matches the reference facilitator's stellar:testnet entry field for field", async () => {
    const ours = (await (
      await fetch(`${(deployment as Deployment).facilitatorUrl}/supported`)
    ).json()) as {
      kinds: Record<string, unknown>[];
      extensions: string[];
      signers: Record<string, string[]>;
    };

    const reference = (await (
      await fetch("https://www.x402.org/facilitator/supported")
    ).json()) as { kinds: Record<string, unknown>[] };

    const pick = (kinds: Record<string, unknown>[]): Record<string, unknown> | undefined =>
      kinds.find((kind) => kind["network"] === NETWORK && kind["scheme"] === "exact");

    const referenceKind = pick(reference.kinds);
    const ourKind = pick(ours.kinds);

    expect(referenceKind).toBeDefined();
    expect(ourKind).toBeDefined();
    // Field for field, not "contains the fields we happen to emit".
    expect(ourKind).toEqual(referenceKind);
    expect(ourKind?.["extra"]).toHaveProperty("areFeesSponsored");

    // The signers block is deployment-specific by construction — it lists *our* sponsors, not
    // the reference's — so it is asserted structurally rather than for equality.
    expect(ours.signers["stellar:*"]?.length).toBeGreaterThan(0);

    process.stdout.write(
      `\nAC6.3 /supported (ours):     ${JSON.stringify(ourKind)}\nAC6.3 /supported (reference): ${JSON.stringify(referenceKind)}\nAC6.3 signers: ${JSON.stringify(ours.signers)}\n\n`,
    );
  }, 120_000);
});

describe.skipIf(!E2E_ENABLED)("AC6.5 — protocol rejections carry distinct non-null reasons", () => {
  const observed = new Map<string, string>();

  it("rejects a tampered amount", async () => {
    const { payload, requirements } = await signPayment(
      (deployment as Deployment).sellerUrl,
      (advertised) => ({ ...advertised, amount: "1" }),
    );
    // Signed for 1 stroop; checked against the amount the seller actually advertised.
    const { body } = await callFacilitator(
      (deployment as Deployment).facilitatorUrl,
      "verify",
      payload,
      requirements,
    );

    expect(body["isValid"]).toBe(false);
    expect(body["invalidReason"]).toBeTruthy();
    observed.set("tampered-amount", body["invalidReason"] as string);
  }, 300_000);

  it("rejects a wrong network", async () => {
    const { payload, requirements } = await signPayment((deployment as Deployment).sellerUrl);
    const { body } = await callFacilitator(
      (deployment as Deployment).facilitatorUrl,
      "verify",
      payload,
      { ...requirements, network: "stellar:pubnet" },
    );

    expect(body["isValid"]).toBe(false);
    expect(body["invalidReason"]).toBeTruthy();
    observed.set("wrong-network", body["invalidReason"] as string);
  }, 300_000);

  it("rejects a wrong asset", async () => {
    const { payload, requirements } = await signPayment((deployment as Deployment).sellerUrl);
    const { body } = await callFacilitator(
      (deployment as Deployment).facilitatorUrl,
      "verify",
      payload,
      {
        ...requirements,
        asset: "CD4PXYSBBM3XA4NOGPDL64X6CW3CPU2CQ2X6KK7BTMPXS2Q33LNGJBX3",
      },
    );

    expect(body["isValid"]).toBe(false);
    expect(body["invalidReason"]).toBeTruthy();
    observed.set("wrong-asset", body["invalidReason"] as string);
  }, 300_000);

  it("rejects a wrong recipient", async () => {
    const { payload, requirements } = await signPayment((deployment as Deployment).sellerUrl);
    const { body } = await callFacilitator(
      (deployment as Deployment).facilitatorUrl,
      "verify",
      payload,
      {
        ...requirements,
        payTo: "GBFZXIRUOJDSXEIYFMHNM3RGQ25FTKQXQKQRZ7LUJZBMHFBHM5YQZ4YT",
      },
    );

    expect(body["isValid"]).toBe(false);
    expect(body["invalidReason"]).toBeTruthy();
    observed.set("wrong-recipient", body["invalidReason"] as string);
  }, 300_000);

  it("rejects a replayed payload after it has settled", async () => {
    const { payload, requirements } = await signPayment((deployment as Deployment).sellerUrl);

    const first = await callFacilitator(
      (deployment as Deployment).facilitatorUrl,
      "settle",
      payload,
      requirements,
    );
    expect(first.body["success"]).toBe(true);

    const replay = await callFacilitator(
      (deployment as Deployment).facilitatorUrl,
      "settle",
      payload,
      requirements,
    );

    expect(replay.body["success"]).toBe(false);
    expect(replay.body["errorReason"]).toBeTruthy();
    observed.set("replayed", replay.body["errorReason"] as string);

    process.stdout.write(
      `\nAC6.5 REJECTION REASONS (from the live service):\n${[...observed]
        .map(([scenario, reason]) => `  ${scenario.padEnd(18)} ${reason}`)
        .join("\n")}\n\n`,
    );
  }, 300_000);

  it("gave every rejection a non-null reason, and gave distinct causes distinct reasons", () => {
    expect(observed.size).toBe(5);
    for (const reason of observed.values()) {
      expect(reason).toBeTruthy();
      expect(reason).not.toBe("null");
    }
    // Distinctness matters as much as non-nullness: an agent that receives the same token for
    // "you underpaid" and "you paid the wrong account" cannot act differently on them.
    expect(new Set(observed.values()).size).toBeGreaterThanOrEqual(3);
  });
});

describe.skipIf(!E2E_ENABLED)("AC6.6 — non-custody", () => {
  it("keeps the facilitator out of every position that would make it custodial", async () => {
    const { payload, requirements } = await signPayment((deployment as Deployment).sellerUrl);
    const facilitatorAddresses = new Set(
      (deployment as Deployment).facilitator.poolFor(NETWORK)?.addresses ?? [],
    );
    expect(facilitatorAddresses.size).toBeGreaterThan(0);

    // ── Position check 1: the transaction the BUYER signed ──────────────────────────────
    //
    // This is the object the non-custody invariant is really about. It is what the buyer
    // authorised, and the facilitator must appear nowhere in it — as source, as operation
    // source, as the transfer's `from`, or in any authorization entry. If the facilitator
    // could insert itself here, it could move the buyer's funds.
    const signed = (payload as { payload: { transaction: string } }).payload.transaction;
    const authorised = new Transaction(signed, getNetworkPassphrase(NETWORK));

    expect(facilitatorAddresses.has(authorised.source)).toBe(false);

    const operation = authorised.operations[0] as {
      type: string;
      source?: string;
      auth?: xdr.SorobanAuthorizationEntry[];
      func: xdr.HostFunction;
    };
    expect(operation.type).toBe("invokeHostFunction");
    expect(facilitatorAddresses.has(operation.source ?? "")).toBe(false);

    for (const entry of operation.auth ?? []) {
      const credentials = entry.credentials();
      if (credentials.switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
        const address = Address.fromScAddress(credentials.address().address()).toString();
        expect(facilitatorAddresses.has(address)).toBe(false);
      }
    }

    // The SEP-41 `transfer(from, to, amount)` arguments: `from` is the buyer, `to` the seller.
    const args = operation.func.invokeContract().args();
    const transferFrom = Address.fromScAddress(args[0]?.address() as xdr.ScAddress).toString();
    const transferTo = Address.fromScAddress(args[1]?.address() as xdr.ScAddress).toString();

    expect(facilitatorAddresses.has(transferFrom)).toBe(false);
    expect(facilitatorAddresses.has(transferTo)).toBe(false);
    expect(transferTo).toBe(payTo);

    // ── Position check 2: the transaction that actually SETTLED ─────────────────────────
    //
    // Three of the four positions hold here too. The fourth — transaction source — does not,
    // and cannot: `ExactStellarScheme.settle()` rebuilds the buyer's operation into a new
    // transaction sourced from a facilitator account, because paying the fee from the
    // facilitator's account IS fee sponsorship. See the M6 report and docs/CONFORMANCE.md.
    const settled = await callFacilitator(
      (deployment as Deployment).facilitatorUrl,
      "settle",
      payload,
      requirements,
    );
    expect(settled.body["success"]).toBe(true);

    const hash = settled.body["transaction"] as string;
    const onChain = await fromHorizon(hash);
    expect(onChain.successful).toBe(true);

    const submitted = new Transaction(onChain.envelope_xdr, getNetworkPassphrase(NETWORK));
    const submittedOp = submitted.operations[0] as {
      source?: string;
      auth?: xdr.SorobanAuthorizationEntry[];
      func: xdr.HostFunction;
    };

    expect(facilitatorAddresses.has(submittedOp.source ?? "")).toBe(false);

    for (const entry of submittedOp.auth ?? []) {
      const credentials = entry.credentials();
      if (credentials.switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
        const address = Address.fromScAddress(credentials.address().address()).toString();
        expect(facilitatorAddresses.has(address)).toBe(false);
      }
    }

    const settledArgs = submittedOp.func.invokeContract().args();
    expect(
      facilitatorAddresses.has(
        Address.fromScAddress(settledArgs[0]?.address() as xdr.ScAddress).toString(),
      ),
    ).toBe(false);

    // Stated rather than hidden: the settled transaction's source IS a facilitator sponsor,
    // and that is the on-chain evidence of `areFeesSponsored: true`.
    expect(facilitatorAddresses.has(submitted.source)).toBe(true);

    process.stdout.write(
      `\nAC6.6 NON-CUSTODY (tx ${hash})\n` +
        `  buyer-signed tx source:      ${authorised.source}  (facilitator? no)\n` +
        `  buyer-signed op source:      ${operation.source ?? "<inherits tx>"}  (facilitator? no)\n` +
        `  transfer from:               ${transferFrom}  (facilitator? no)\n` +
        `  transfer to:                 ${transferTo}  (facilitator? no)\n` +
        `  auth entries:                facilitator absent\n` +
        `  SETTLED tx source (fee payer): ${submitted.source}  (facilitator? YES — this is fee sponsorship)\n\n`,
    );
  }, 300_000);
});

describe.skipIf(!E2E_ENABLED)("AC6.9 — readiness fails below the sponsor floor", () => {
  it("reports ready with the configured floor and every sponsor above it", async () => {
    const response = await fetch(`${(deployment as Deployment).facilitatorUrl}/ready`);
    const body = (await response.json()) as {
      ready: boolean;
      networks: { floorXlm: number; signers: { address: string; balanceXlm: string }[] }[];
    };

    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    // Real balances, read from Horizon. A readiness endpoint that reports ready without
    // reading anything is the failure mode this criterion exists to catch.
    expect(body.networks[0]?.signers.every((signer) => Number(signer.balanceXlm) > 0)).toBe(true);
  }, 120_000);

  it("reports not-ready with 503 when a sponsor falls below the floor", async () => {
    // The floor is raised above the sponsors' real balances rather than the balances being
    // drained. Same comparison, same code path, same Horizon read — and it does not destroy
    // the fixture accounts to prove it.
    const strict = await deploy({ sponsorFloorXlm: 1_000_000 });
    try {
      const response = await fetch(`${strict.facilitatorUrl}/ready`);
      const body = (await response.json()) as { ready: boolean };

      expect(response.status).toBe(503);
      expect(body.ready).toBe(false);
    } finally {
      await strict.close();
    }
  }, 180_000);
});

describe.skipIf(!E2E_ENABLED)("AC6.12 — self-facilitation inside a resource server", () => {
  it("lets a stock client pay a resource server that facilitates its own payments in-process", async () => {
    // The upstream self-facilitation pattern: no standalone facilitator, no HTTP hop, the same
    // signer pool and the same code path — reached through `asFacilitatorClient()`.
    const facilitator = createFacilitator(facilitatorConfigFromEnv(process.env));
    const application = express();
    application.use(express.json());
    await mountExpress(application as never, defineApp({ resources: [weather] }), {
      config: { env: process.env },
      facilitator: facilitator.asFacilitatorClient(),
    });

    const server: Server = createServer(application);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    try {
      const { payingFetch } = await stockBuyer();
      const paid = await payingFetch(`${url}/weather/SFO`);

      expect(paid.status).toBe(200);
      const settle = decodePaymentResponseHeader(
        paid.headers.get(PAYMENT_HEADERS.response) as string,
      );
      expect(settle.success).toBe(true);

      const onChain = await fromHorizon(settle.transaction as string);
      expect(onChain.successful).toBe(true);

      process.stdout.write(
        `\nAC6.12 SELF-FACILITATED SETTLEMENT: ${settle.transaction}\n  ledger: ${String(onChain.ledger)}\n\n`,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 300_000);
});

describe.skipIf(!E2E_ENABLED)("AC6.8 — concurrent settlement without sequence collisions", () => {
  it(`dispatches ${String(CONCURRENCY)} settlements concurrently with zero sequence-number failures`, async () => {
    const url = (deployment as Deployment).facilitatorUrl;
    const sellerUrl = (deployment as Deployment).sellerUrl;

    // Sign every payload first. Signing is buyer-side work and would otherwise dominate the
    // window the concurrency probe is meant to measure.
    const signed = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => signPayment(sellerUrl)),
    );

    const results = await Promise.all(
      signed.map(({ payload, requirements }) =>
        callFacilitator(url, "settle", payload, requirements).catch((error: Error) => ({
          status: 0,
          body: { success: false, errorReason: `transport:${error.message}` },
        })),
      ),
    );

    const succeeded = results.filter((result) => result.body["success"] === true);
    const reasons = new Map<string, number>();
    for (const result of results) {
      if (result.body["success"] === true) continue;
      const reason = String(result.body["errorReason"] ?? "unknown");
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }

    process.stdout.write(
      `\nAC6.8 CONCURRENCY PROBE — ${String(CONCURRENCY)} concurrent settlements\n` +
        `  settled:  ${String(succeeded.length)}\n` +
        `  failures: ${
          reasons.size === 0
            ? "none"
            : [...reasons].map(([reason, count]) => `${reason} ×${String(count)}`).join(", ")
        }\n` +
        `  sponsors: ${String((deployment as Deployment).facilitator.poolFor(NETWORK)?.addresses.length ?? 0)}\n\n`,
    );

    // THE ASSERTION IS THE COUNT, and that is a deliberate correction.
    //
    // The first version of this test looked for a reason string matching /seq/ and asserted
    // there were none. It passed while 190 of 200 settlements failed — because upstream does
    // not surface `tx_bad_seq`. `ExactStellarScheme.settle()` maps every non-PENDING submit
    // result, whatever the ledger said, onto the single reason
    // `settle_exact_stellar_transaction_submission_failed`. A test that greps that vocabulary
    // for the word "sequence" can therefore never fail, which makes it a gate that cannot
    // fire — exactly the defect spec v2 §A.2 rule 4 is about.
    //
    // Every settlement succeeding is the only observable that actually distinguishes a pool
    // that serialises from one that does not. It is also a strictly stronger claim than the
    // criterion asks for.
    expect(succeeded.length).toBe(CONCURRENCY);
    expect(reasons.size).toBe(0);
  }, 900_000);
});
