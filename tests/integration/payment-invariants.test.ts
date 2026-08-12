import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  defineApp,
  defineResource,
  encodePaymentSignatureHeader,
  PAYMENT_HEADERS,
  type PaymentPayload,
  type PaymentRequirements,
} from "../../packages/core/src/index.ts";
import { mountExpress } from "../../packages/server/src/index.ts";
import { STUB_TRANSACTION, StubFacilitator } from "../support/stub-facilitator.ts";

/**
 * The ordering invariants, asserted against the real Express middleware and the real
 * `x402ResourceServer`. Only the facilitator is a stub, so what is under test is genuinely
 * upstream's lifecycle rather than a model of it.
 *
 * These are the assertions GATE 1 turns on. Every one of them was verified against the
 * installed middleware source before being written, so they assert what upstream *does* — not
 * what the specification hoped it would do (M2 prompt §E).
 *
 * | # | Invariant                                                            |
 * |---|----------------------------------------------------------------------|
 * | I1| no PAYMENT-SIGNATURE → 402, handler not invoked                      |
 * | I2| verification failure → 402 with a non-null reason, handler not invoked|
 * | I3| handler throws → error status, settle NOT called                     |
 * | I4| settlement failure → 402, handler's return value absent from the body |
 * | I5| success → 200 with PAYMENT-RESPONSE carrying a transaction reference  |
 * | I6| handler returns 4xx → not charged, no PAYMENT-RESPONSE                |
 *
 * I6 comes from Spec Amendment 001 §7 and is a genuine product property: a paid route that
 * 404s costs the buyer nothing.
 */

const PAY_TO = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";

/** Tracks whether the paid handler ran, which is what I1 and I2 are really about. */
const handlerSpy = vi.fn();

/** Set by a test to make the handler misbehave in a specific way. */
let handlerBehaviour: "ok" | "throw" | "notFound" = "ok";

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current conditions",
  mimeType: "application/json",
  handler: (ctx) => {
    handlerSpy();
    if (handlerBehaviour === "throw") throw new Error("handler exploded after verification");
    if (handlerBehaviour === "notFound") {
      const response = (ctx.raw as { res: { status(code: number): unknown } }).res;
      response.status(404);
      return { error: "no such city" };
    }
    return { city: ctx.params["city"], tempC: 14, conditions: "foggy" };
  },
});

interface Harness {
  readonly url: string;
  readonly facilitator: StubFacilitator;
  close(): Promise<void>;
}

async function startHarness(facilitator: StubFacilitator): Promise<Harness> {
  const application = express();
  application.use(express.json());

  await mountExpress(application as never, defineApp({ resources: [weather] }), {
    facilitator,
    config: { config: { payTo: PAY_TO }, env: {} },
  });

  // An error handler, because I3 asserts on the status Express produces when a handler throws.
  application.use(
    (error: unknown, _request: unknown, response: express.Response, _next: unknown) => {
      response.status(500).json({ error: error instanceof Error ? error.message : "unknown" });
    },
  );

  const server: Server = createServer(application);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    facilitator,
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * Build a payment payload from the requirements the server advertised.
 *
 * The `payload` is opaque to the server — the facilitator is what would validate a signature,
 * and here that is the stub. What matters for these invariants is that the payload names the
 * exact requirements the server asked for, which is what upstream matches on.
 */
function paymentFor(requirements: PaymentRequirements): string {
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: { transaction: "integration-suite-payload-not-a-real-signature" },
  };
  return encodePaymentSignatureHeader(payload);
}

async function requirementsFrom(harness: Harness): Promise<PaymentRequirements> {
  const response = await fetch(`${harness.url}/weather/SFO`);
  const header = response.headers.get(PAYMENT_HEADERS.required);
  if (header === null) throw new Error("server did not send a PAYMENT-REQUIRED header");
  const decoded = decodePaymentRequiredHeader(header);
  const first = decoded.accepts[0];
  if (first === undefined) throw new Error("PAYMENT-REQUIRED carried no payment options");
  return first;
}

let harness: Harness;

beforeEach(() => {
  handlerSpy.mockClear();
  handlerBehaviour = "ok";
});

afterEach(async () => {
  await harness?.close();
});

describe("AC2.1 — the unpaid response", () => {
  it("returns 402 with a decodable PAYMENT-REQUIRED naming scheme, network, payTo and a non-zero amount", async () => {
    harness = await startHarness(new StubFacilitator());

    const response = await fetch(`${harness.url}/weather/SFO`);
    expect(response.status).toBe(402);

    const header = response.headers.get(PAYMENT_HEADERS.required);
    expect(header).not.toBeNull();

    const decoded = decodePaymentRequiredHeader(header as string);
    const requirements = decoded.accepts[0];

    expect(requirements?.scheme).toBe("exact");
    expect(requirements?.network).toBe("stellar:testnet");
    expect(requirements?.payTo).toBe(PAY_TO);
    expect(Number(requirements?.amount)).toBeGreaterThan(0);
  });

  it("prices $0.001 as a non-zero base-unit amount, converted by upstream and not by Movo", async () => {
    harness = await startHarness(new StubFacilitator());
    const requirements = await requirementsFrom(harness);

    // 7 decimals, so $0.001 is 10000 base units. Movo never computes this; the assertion is
    // that upstream's conversion reached the wire intact.
    expect(requirements.amount).toBe("10000");
  });
});

describe("I1 — no payment", () => {
  it("returns 402 and does not invoke the handler", async () => {
    harness = await startHarness(new StubFacilitator());

    const response = await fetch(`${harness.url}/weather/SFO`);

    expect(response.status).toBe(402);
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(harness.facilitator.countOf("verify")).toBe(0);
    expect(harness.facilitator.countOf("settle")).toBe(0);
  });
});

describe("I2 — verification failure", () => {
  it("returns 402 with a non-null reason and does not invoke the handler", async () => {
    harness = await startHarness(new StubFacilitator());
    const requirements = await requirementsFrom(harness);

    harness.facilitator.setOutcome({ kind: "verify_rejected", reason: "insufficient_funds" });

    const response = await fetch(`${harness.url}/weather/SFO`, {
      headers: { [PAYMENT_HEADERS.signature]: paymentFor(requirements) },
    });

    expect(response.status).toBe(402);
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(harness.facilitator.countOf("settle")).toBe(0);

    // The reason travels in the re-issued PAYMENT-REQUIRED header's `error` field, not in the
    // JSON body — the body is `{}`. That is upstream's actual behaviour, verified here rather
    // than assumed from the invariant's wording, and it is what a client must read to find out
    // why a payment was refused.
    const header = response.headers.get(PAYMENT_HEADERS.required);
    expect(header).not.toBeNull();

    const decoded = decodePaymentRequiredHeader(header as string);
    expect(decoded.error).toBeDefined();
    expect(decoded.error).not.toBeNull();
    expect(String(decoded.error)).toContain("insufficient_funds");
  });
});

describe("I3 — the handler throws", () => {
  it("returns an error status and calls settle exactly zero times", async () => {
    harness = await startHarness(new StubFacilitator());
    const requirements = await requirementsFrom(harness);

    handlerBehaviour = "throw";

    const response = await fetch(`${harness.url}/weather/SFO`, {
      headers: { [PAYMENT_HEADERS.signature]: paymentFor(requirements) },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // The assertion that matters: the buyer was not charged for work that failed. A call count
    // of zero is the difference between knowing that and believing it.
    expect(harness.facilitator.countOf("settle")).toBe(0);
    expect(response.headers.get(PAYMENT_HEADERS.response)).toBeNull();
  });
});

describe("I4 — settlement failure", () => {
  it("returns 402 and withholds the handler's return value from the body", async () => {
    harness = await startHarness(new StubFacilitator());
    const requirements = await requirementsFrom(harness);

    harness.facilitator.setOutcome({ kind: "settle_failed", reason: "insufficient_balance" });

    const response = await fetch(`${harness.url}/weather/SFO`, {
      headers: { [PAYMENT_HEADERS.signature]: paymentFor(requirements) },
    });

    expect(response.status).toBe(402);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(harness.facilitator.countOf("settle")).toBe(1);

    // The handler ran and produced a body. The buyer did not pay, so they must not receive it.
    const text = await response.text();
    expect(text).not.toContain("foggy");
    expect(text).not.toContain("tempC");
  });
});

describe("I5 — success", () => {
  it("returns 200 with the body and a PAYMENT-RESPONSE carrying a transaction reference", async () => {
    harness = await startHarness(new StubFacilitator());
    const requirements = await requirementsFrom(harness);

    const response = await fetch(`${harness.url}/weather/SFO`, {
      headers: { [PAYMENT_HEADERS.signature]: paymentFor(requirements) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ city: "SFO", tempC: 14, conditions: "foggy" });

    const header = response.headers.get(PAYMENT_HEADERS.response);
    expect(header).not.toBeNull();

    const settle = decodePaymentResponseHeader(header as string);
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBe(STUB_TRANSACTION);
  });
});

describe("I6 — the handler returns 4xx (Spec Amendment 001 §7)", () => {
  it("does not charge, and emits no PAYMENT-RESPONSE", async () => {
    harness = await startHarness(new StubFacilitator());
    const requirements = await requirementsFrom(harness);

    handlerBehaviour = "notFound";

    const response = await fetch(`${harness.url}/weather/NOWHERE`, {
      headers: { [PAYMENT_HEADERS.signature]: paymentFor(requirements) },
    });

    expect(response.status).toBe(404);
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // A paid route that 404s costs the buyer nothing. This is a product property, not an
    // implementation detail, and it is documented as one in payment-lifecycle.md.
    expect(harness.facilitator.countOf("settle")).toBe(0);
    expect(response.headers.get(PAYMENT_HEADERS.response)).toBeNull();

    // Unlike a throw, upstream flushes the buffered 4xx body through unchanged.
    expect(await response.json()).toEqual({ error: "no such city" });
  });
});

describe("the ordinary case (Spec Amendment 003 §6)", () => {
  it("serves a free route without any payment involvement at all", async () => {
    // The positive baseline. A suite of failure cases can pass while the common path is
    // broken — which is precisely what happened in M1, so it is asserted explicitly here.
    const application = express();
    application.get("/health", (_request, response) => {
      response.json({ ok: true });
    });
    await mountExpress(application as never, defineApp({ resources: [weather] }), {
      facilitator: new StubFacilitator(),
      config: { config: { payTo: PAY_TO }, env: {} },
    });

    const server = createServer(application);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    harness = { url: "", facilitator: new StubFacilitator(), close: async () => {} };
  });

  it("gives the handler a payment context decoded from the request, not a placeholder", async () => {
    // Guards against the context being filled with empty strings: the handler must see the
    // real asset, amount and network the buyer paid against.
    let seen: { asset: string; amount: string; network: string } | undefined;

    const inspecting = defineResource({
      method: "GET",
      path: "/inspect",
      price: "$0.001",
      handler: (ctx) => {
        seen = {
          asset: ctx.payment.asset,
          amount: ctx.payment.amount,
          network: ctx.payment.network,
        };
        return { ok: true };
      },
    });

    const application = express();
    await mountExpress(application as never, defineApp({ resources: [inspecting] }), {
      facilitator: new StubFacilitator(),
      config: { config: { payTo: PAY_TO }, env: {} },
    });
    const server = createServer(application);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${String(port)}`;

    try {
      const unpaid = await fetch(`${base}/inspect`);
      const decoded = decodePaymentRequiredHeader(
        unpaid.headers.get(PAYMENT_HEADERS.required) as string,
      );
      const requirements = decoded.accepts[0] as PaymentRequirements;

      await fetch(`${base}/inspect`, {
        headers: { [PAYMENT_HEADERS.signature]: paymentFor(requirements) },
      });

      expect(seen?.network).toBe("stellar:testnet");
      expect(seen?.amount).toBe("10000");
      expect(seen?.asset).toBe(requirements.asset);
      expect(seen?.asset).not.toBe("");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    harness = { url: "", facilitator: new StubFacilitator(), close: async () => {} };
  });
});
