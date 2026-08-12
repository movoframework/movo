import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import {
  createLogger,
  decodePaymentRequiredHeader,
  defineApp,
  defineResource,
  encodePaymentSignatureHeader,
  type LogRecord,
  PAYMENT_HEADERS,
  type PaymentPayload,
  type PaymentRequirements,
} from "../../packages/core/src/index.ts";
import { mountExpress } from "../../packages/server/src/index.ts";
import { FIXTURE_API_KEY, FIXTURE_STELLAR_SEED, findLeakedSecrets } from "../support/secrets.ts";
import { StubFacilitator } from "../support/stub-facilitator.ts";

/**
 * AC2.6 — across a complete paid request, zero occurrences of the fixture secret, the payment
 * payload, or the facilitator auth header in any log line.
 *
 * The test drives a real request from unpaid 402 through to a settled 200 while a credential is
 * present in the environment, in an `authHeaders` provider, and in the resolved configuration —
 * then captures everything Movo emits and everything the mount hands to a hook, and asserts
 * none of it carries a secret.
 *
 * Including the **encoded payment payload** matters as much as the seed. The payload is the
 * buyer's signed authorisation; a server that logged it would be publishing something a third
 * party could inspect, and it is base64, so it does not look like a secret at a glance.
 */

const PAY_TO = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  handler: (ctx) => ({ city: ctx.params["city"], tempC: 14, conditions: "foggy" }),
});

describe("a complete paid request leaks nothing", () => {
  it("emits zero occurrences of the seed, the API key, or the payment payload", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({ level: "debug", sink: (record) => void records.push(record) });

    const hookPayloads: unknown[] = [];
    const facilitator = new StubFacilitator();

    const application = express();
    application.use(express.json());

    const mounted = await mountExpress(application as never, defineApp({ resources: [weather] }), {
      facilitator,
      config: {
        config: {
          payTo: PAY_TO,
          facilitator: {
            // A credential reachable from configuration, exactly as a real API-keyed
            // facilitator would be wired.
            authHeaders: async () => ({
              verify: { Authorization: `Bearer ${FIXTURE_API_KEY}` },
              settle: { Authorization: `Bearer ${FIXTURE_API_KEY}` },
            }),
          },
        },
        env: {
          MOVO_FACILITATOR_API_KEY: FIXTURE_API_KEY,
          STELLAR_PRIVATE_KEY: FIXTURE_STELLAR_SEED,
        },
      },
      hooks: {
        onCompile: (compiled) => void hookPayloads.push(compiled),
        onFinding: (finding) => void hookPayloads.push(finding),
        onPaymentRequired: (context) => void hookPayloads.push(context),
        onSettled: (context) => void hookPayloads.push(context),
        onVerifyFailure: (context) => void hookPayloads.push(context),
        onSettleFailure: (context) => void hookPayloads.push(context),
      },
    });

    // Log the resolved configuration at debug — the loudest thing a developer diagnosing a
    // payment failure would ever do, and the moment a naive logger starts printing credentials.
    logger.debug("resolved configuration", {
      config: mounted.compiled.resolvedConfig as unknown as Record<string, unknown>,
    });
    logger.debug("compiled routes", {
      routes: mounted.compiled.routes as unknown as Record<string, unknown>,
    });

    const server = createServer(application);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${String(port)}`;

    let encodedPayload = "";
    try {
      const unpaid = await fetch(`${base}/weather/SFO`);
      expect(unpaid.status).toBe(402);

      const required = decodePaymentRequiredHeader(
        unpaid.headers.get(PAYMENT_HEADERS.required) as string,
      );
      const requirements = required.accepts[0] as PaymentRequirements;

      const payload: PaymentPayload = {
        x402Version: 2,
        accepted: requirements,
        payload: { transaction: FIXTURE_STELLAR_SEED },
      };
      encodedPayload = encodePaymentSignatureHeader(payload);

      logger.debug("incoming request", {
        headers: { [PAYMENT_HEADERS.signature]: encodedPayload },
      });

      const paid = await fetch(`${base}/weather/SFO`, {
        headers: { [PAYMENT_HEADERS.signature]: encodedPayload },
      });
      expect(paid.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    const secrets = [FIXTURE_STELLAR_SEED, FIXTURE_API_KEY, encodedPayload];

    const logged = JSON.stringify(records);
    expect(findLeakedSecrets(logged, secrets)).toEqual([]);

    const hooked = JSON.stringify(hookPayloads, (_key, value: unknown) =>
      typeof value === "function"
        ? "[function]"
        : value instanceof Map
          ? Object.fromEntries(value)
          : value,
    );
    expect(findLeakedSecrets(hooked, secrets)).toEqual([]);
  });

  it("would have detected a leak, had there been one", () => {
    // Guards the test itself. If the detector stopped matching, every assertion above would
    // pass while proving nothing — the same failure mode a stale proof-of-failure fixture has.
    const leaky = JSON.stringify({ note: `key=${FIXTURE_API_KEY}` });
    expect(findLeakedSecrets(leaky, [FIXTURE_API_KEY])).toEqual([FIXTURE_API_KEY]);
  });
});
