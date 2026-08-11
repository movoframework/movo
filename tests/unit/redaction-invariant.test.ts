import { describe, expect, it } from "vitest";
import { MovoError } from "../../packages/core/src/errors/MovoError.ts";
import { MOVO_ERROR_CODES } from "../../packages/core/src/errors/registry.ts";
import { createHookDispatcher } from "../../packages/core/src/hooks.ts";
import { createLogger, type LogRecord } from "../../packages/core/src/observability/logger.ts";
import { compileApp } from "../../packages/core/src/resource/compile.ts";
import { defineApp } from "../../packages/core/src/resource/defineApp.ts";
import { defineResource } from "../../packages/core/src/resource/defineResource.ts";
import {
  FIXTURE_API_KEY,
  FIXTURE_STELLAR_SEED,
  findLeakedSecrets,
  fixtureStrkey,
} from "../support/secrets.ts";

/**
 * AC1.6 — a fixture Stellar secret seed appears in zero bytes of `MovoError.toJSON()`, logger
 * output, and every hook payload.
 *
 * This is a property test rather than a handful of examples. Examples prove that the paths
 * someone thought of are covered; the property is that *no* path leaks, and the way to test a
 * property is to generate the structures rather than enumerate them. The generator places
 * seeds in the positions they actually reach in practice: as a whole value, inside a longer
 * message, under an innocuous key, under a sensitive key, nested in arrays, and inside an
 * `Error` used as a cause.
 */

const SECRETS: readonly string[] = [FIXTURE_STELLAR_SEED, FIXTURE_API_KEY];
const PAY_TO = "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3";

/**
 * Redaction has exactly two detection mechanisms, and the test respects the difference rather
 * than pretending there is only one.
 *
 * A Stellar seed is caught **by shape**: it can be found wherever it appears, including inside
 * a longer string under a perfectly innocuous key. An opaque credential such as a facilitator
 * API key has no shape at all — it is a string, indistinguishable from a route or a reason —
 * so it is caught only **by the name of the key it sits under**.
 *
 * Asserting that an opaque credential is scrubbed from an arbitrary position would be
 * asserting something no redactor can do. The real control for that class of secret is
 * upstream of redaction entirely: `MOVO_FACILITATOR_API_KEY` is never read into configuration,
 * so it never reaches a payload in the first place.
 */
const SHAPE_DETECTABLE = "shape" as const;
const KEY_DETECTABLE = "key" as const;
type Detection = typeof SHAPE_DETECTABLE | typeof KEY_DETECTABLE;

/** Deterministic pseudo-random source, so a failure is reproducible from the seed alone. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const INNOCUOUS_KEYS = ["network", "route", "amount", "detail", "payTo", "reason"];
const SENSITIVE_KEYS = ["Authorization", "apiKey", "STELLAR_PRIVATE_KEY", "PAYMENT-SIGNATURE"];

function seedBearingValue(random: () => number, secret: string): unknown {
  const shape = Math.floor(random() * 5);
  if (shape === 0) return secret;
  if (shape === 1) return `could not load ${secret} from disk`;
  if (shape === 2) return [secret, "unrelated"];
  if (shape === 3) return new Error(`upstream rejected ${secret}`);
  return { nested: { deeper: secret } };
}

function generateContext(
  random: () => number,
  secret: string,
  detection: Detection,
): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  const entries = 1 + Math.floor(random() * 4);
  for (let index = 0; index < entries; index += 1) {
    const pool = detection === SHAPE_DETECTABLE && random() < 0.5 ? INNOCUOUS_KEYS : SENSITIVE_KEYS;
    const key = pool[Math.floor(random() * pool.length)] ?? "Authorization";
    context[`${key}_${String(index)}`] = seedBearingValue(random, secret);
  }
  return context;
}

describe("no fixture secret escapes any serialisation path", () => {
  it("holds across 200 generated MovoError shapes and every registry code", () => {
    const random = makeRandom(20_260_811);

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const code = MOVO_ERROR_CODES[iteration % MOVO_ERROR_CODES.length];
      if (code === undefined) continue;
      const secret = fixtureStrkey("S", iteration);

      const error = new MovoError(code, `failure involving ${secret}`, {
        context: generateContext(random, secret, SHAPE_DETECTABLE),
        correlationId: `corr-${String(iteration)}`,
        cause: new Error(`caused by ${secret}`),
      });

      const serialised = JSON.stringify(error.toJSON());
      expect(findLeakedSecrets(serialised, [secret])).toEqual([]);
      expect(findLeakedSecrets(JSON.stringify(error), [secret])).toEqual([]);
      expect(findLeakedSecrets(error.message, [secret])).toEqual([]);
    }
  });

  it("holds for an opaque credential placed under a credential-shaped key", () => {
    const random = makeRandom(2_310_237);

    for (let iteration = 0; iteration < 50; iteration += 1) {
      const error = new MovoError("MOVO_E_SECRET_IN_CONFIG", "facilitator rejected the request", {
        context: generateContext(random, FIXTURE_API_KEY, KEY_DETECTABLE),
      });
      expect(findLeakedSecrets(JSON.stringify(error.toJSON()), [FIXTURE_API_KEY])).toEqual([]);
    }
  });

  it("holds for logger output at every level", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({ level: "debug", sink: (record) => void records.push(record) });
    const random = makeRandom(4_066_852);

    for (const [secret, detection] of [
      [FIXTURE_STELLAR_SEED, SHAPE_DETECTABLE],
      [FIXTURE_API_KEY, KEY_DETECTABLE],
    ] as const) {
      const message = detection === SHAPE_DETECTABLE ? `saw ${secret}` : "saw a credential";
      logger.error(message, generateContext(random, secret, detection));
      logger.warn(message, generateContext(random, secret, detection));
      logger.info(message, generateContext(random, secret, detection));
      logger.debug(message, generateContext(random, secret, detection));
    }

    expect(records.length).toBe(8);
    expect(findLeakedSecrets(JSON.stringify(records), SECRETS)).toEqual([]);
  });

  it("holds for every hook payload", () => {
    // Hook payloads carry fixed, non-sensitive fields — a route, a correlation id, a reason, a
    // transaction reference. Redaction can therefore only act on the *shape* of a value, so
    // this asserts what is actually detectable: a Stellar seed, wherever it appears. An
    // opaque credential placed in a field documented to hold a route is indistinguishable
    // from a route, and no redactor can recover it. That limitation is stated in
    // docs/security/secrets-and-redaction terms in the module docs, and it is why the
    // facilitator API key is never read into configuration in the first place.
    const received: unknown[] = [];
    const record = (payload: unknown): void => void received.push(payload);

    const dispatcher = createHookDispatcher({
      onFinding: record,
      onPaymentRequired: record,
      onVerifyFailure: record,
      onSettled: record,
      onSettleFailure: record,
    });

    const seeds = [FIXTURE_STELLAR_SEED, fixtureStrkey("S", 42)];
    for (const secret of seeds) {
      dispatcher.paymentRequired({ route: `GET /${secret}`, correlationId: secret });
      dispatcher.verifyFailure({ route: "GET /x", correlationId: "c", reason: secret });
      dispatcher.settled({ route: "GET /x", correlationId: "c", transaction: secret });
      dispatcher.settleFailure({ route: "GET /x", correlationId: "c", reason: secret });
      dispatcher.finding({ id: "x", level: "warn", title: secret, detail: `token=${secret}` });
    }

    expect(received.length).toBe(10);
    expect(findLeakedSecrets(JSON.stringify(received), seeds)).toEqual([]);
  });

  it("holds for the compiled application handed to onCompile", () => {
    // `onCompile` receives the live object. The guarantee is not that it was redacted but that
    // there is nothing in a CompiledApp to redact — including when a credential is present in
    // the environment and inside an authHeaders closure.
    const compiled = compileApp(
      defineApp({
        resources: [
          defineResource({ method: "GET", path: "/x", price: "$0.001", handler: () => 1 }),
        ],
      }),
      {
        config: {
          payTo: PAY_TO,
          facilitator: {
            authHeaders: async () => ({
              verify: { Authorization: `Bearer ${FIXTURE_API_KEY}` },
            }),
          },
        },
        env: {
          MOVO_FACILITATOR_API_KEY: FIXTURE_API_KEY,
          STELLAR_PRIVATE_KEY: FIXTURE_STELLAR_SEED,
        },
      },
    );

    const received: unknown[] = [];
    createHookDispatcher({ onCompile: (app) => void received.push(app) }).compiled(compiled);

    const serialised = JSON.stringify(received, (_key, value: unknown) =>
      typeof value === "function"
        ? "[function]"
        : value instanceof Map
          ? Object.fromEntries(value)
          : value,
    );
    expect(findLeakedSecrets(serialised, SECRETS)).toEqual([]);
  });

  it("holds for a resolveConfig failure raised while a credential is in the environment", () => {
    let serialised = "";
    try {
      compileApp(
        defineApp({
          resources: [
            defineResource({ method: "GET", path: "/x", price: "$0.001", handler: () => 1 }),
          ],
        }),
        {
          config: { payTo: "not-an-address" },
          env: {
            MOVO_FACILITATOR_API_KEY: FIXTURE_API_KEY,
            STELLAR_PRIVATE_KEY: FIXTURE_STELLAR_SEED,
          },
        },
      );
    } catch (error) {
      serialised = JSON.stringify((error as MovoError).toJSON());
    }

    expect(serialised).not.toBe("");
    expect(findLeakedSecrets(serialised, SECRETS)).toEqual([]);
  });
});

describe("the fixture secrets are detectable in the first place", () => {
  it("would be found if redaction did nothing", () => {
    // Guards the test itself. If the fixture stopped matching what the detector looks for,
    // every assertion above would pass while proving nothing — the same failure mode as a
    // proof-of-failure fixture that no longer triggers its gate.
    expect(findLeakedSecrets(JSON.stringify({ raw: FIXTURE_STELLAR_SEED }), SECRETS)).toEqual([
      FIXTURE_STELLAR_SEED,
    ]);
    expect(FIXTURE_STELLAR_SEED).toMatch(/^S[A-Z2-7]{55}$/);
  });
});
