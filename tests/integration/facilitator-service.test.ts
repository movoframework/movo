import { describe, expect, it } from "vitest";
import { createFacilitatorApp } from "../../apps/facilitator/src/app.ts";
import type { FacilitatorStellarSigner } from "../../packages/core/src/index.ts";
import {
  createFacilitator,
  resolveFacilitatorConfig,
  TRANSPORT_REASONS,
} from "../../packages/facilitator/src/index.ts";
import { FIXTURE_API_KEY, FIXTURE_STELLAR_SEED, findLeakedSecrets } from "../support/secrets.ts";

/**
 * The facilitator HTTP surface, driven over real HTTP request objects.
 *
 * Hono's `app.request()` runs the full routing, header and body pipeline without a listening
 * socket, so this suite exercises the actual transport rather than calling the handlers
 * directly — which is the point: §27 says a subtly wrong response shape is worse than an
 * unimplemented endpoint, and shape is a transport property.
 *
 * No Stellar network is touched. Every path here either terminates in the service tier or in
 * `/supported`, which `x402Facilitator` answers synchronously from its registrations. Real
 * verification and settlement are proven on testnet in `tests/e2e/facilitator-settlement.test.ts`.
 */

const SPONSORS = [
  "GBVMPGDRMNNJF6F27KWYG4TYMSZKG6CU7HHFNKNLLDAZW6AAAGXO6MDV",
  "GD3V7LHLRZQ5YWWFLTT5CSTSKNHASAMNMOEQ2T7MA5FNOK3C7GTXRPLV",
];

function signer(address: string): FacilitatorStellarSigner {
  return {
    address,
    signAuthEntry: async () => ({ signedAuthEntry: "", signerAddress: address }),
    signTransaction: async () => ({ signedTxXdr: "", signerAddress: address }),
  } as unknown as FacilitatorStellarSigner;
}

interface Harness {
  readonly app: ReturnType<typeof createFacilitatorApp>;
  readonly logs: { readonly [key: string]: unknown }[];
}

function harness(
  overrides: Parameters<typeof resolveFacilitatorConfig>[0] | undefined = undefined,
): Harness {
  const logs: { readonly [key: string]: unknown }[] = [];
  const facilitator = createFacilitator(
    resolveFacilitatorConfig(
      overrides ?? { networks: [{ network: "stellar:testnet", signers: SPONSORS.map(signer) }] },
    ),
  );
  return { app: createFacilitatorApp({ facilitator, log: (record) => logs.push(record) }), logs };
}

const WELL_FORMED = {
  x402Version: 2,
  paymentPayload: {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "10000",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      payTo: "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM",
      maxTimeoutSeconds: 300,
    },
    payload: { transaction: "AAAA" },
  },
  paymentRequirements: {
    scheme: "exact",
    network: "stellar:testnet",
    amount: "10000",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    payTo: "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM",
    maxTimeoutSeconds: 300,
    resource: { url: "https://example.test/weather" },
  },
};

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://facilitator.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("the wire contract HTTPFacilitatorClient expects", () => {
  it("serves GET /supported", async () => {
    const response = await harness().app.request("http://facilitator.test/supported");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("serves POST /verify and POST /settle", async () => {
    const { app } = harness();

    // Both reject this payload — the point is that the routes exist and answer in the
    // protocol's own shape, which is what makes the rejection legible to a stock client.
    expect((await app.fetch(post("/verify", "{"))).status).toBe(400);
    expect((await app.fetch(post("/settle", "{"))).status).toBe(400);
  });

  it("answers an unknown endpoint with 404 rather than a framework default", async () => {
    const response = await harness().app.request("http://facilitator.test/nope");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found" });
  });

  it("emits the Stellar kind with extra.areFeesSponsored, field for field", async () => {
    const response = await harness().app.request("http://facilitator.test/supported");
    const body = (await response.json()) as {
      kinds: { x402Version: number; scheme: string; network: string; extra?: unknown }[];
      extensions: string[];
      signers: Record<string, string[]>;
    };

    // Compared against the shape the public reference facilitator publishes for
    // stellar:testnet, recorded in docs/CONFORMANCE.md:
    //   {"x402Version":2,"scheme":"exact","network":"stellar:testnet",
    //    "extra":{"areFeesSponsored":true}}
    expect(body.kinds).toContainEqual({
      x402Version: 2,
      scheme: "exact",
      network: "stellar:testnet",
      extra: { areFeesSponsored: true },
    });
    expect(Array.isArray(body.extensions)).toBe(true);
    expect(body.signers["stellar:*"]).toEqual(SPONSORS);
  });
});

describe("rejection statuses and reasons over HTTP", () => {
  it("returns 400 and a non-null invalidReason for an unparseable body", async () => {
    const response = await harness().app.fetch(post("/verify", "{not json"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      isValid: false,
      invalidReason: TRANSPORT_REASONS.invalidRequestBody,
    });
  });

  it("returns 413 for an oversized body", async () => {
    const { app } = harness();
    const response = await app.fetch(
      post("/verify", JSON.stringify({ ...WELL_FORMED, pad: "x".repeat(200_000) })),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      invalidReason: TRANSPORT_REASONS.payloadTooLarge,
    });
  });

  it("returns 400 and unsupported_network for a network with no signer", async () => {
    const response = await harness().app.fetch(
      post("/settle", {
        ...WELL_FORMED,
        paymentRequirements: { ...WELL_FORMED.paymentRequirements, network: "stellar:pubnet" },
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; errorReason: string };
    expect(body.success).toBe(false);
    expect(body.errorReason).toBe(TRANSPORT_REASONS.unsupportedNetwork);
  });
});

describe("caller authentication and rate limiting", () => {
  const secured = {
    networks: [{ network: "stellar:testnet" as const, signers: SPONSORS.map(signer) }],
    auth: { mode: "bearer" as const, keys: [{ id: "team-a", secret: FIXTURE_API_KEY }] },
  };

  it("refuses an unauthenticated caller with 401 and a machine-readable reason", async () => {
    const response = await harness(secured).app.fetch(post("/verify", WELL_FORMED));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      invalidReason: TRANSPORT_REASONS.unauthorized,
    });
  });

  it("admits a caller presenting the configured bearer key", async () => {
    const response = await harness(secured).app.request("http://facilitator.test/supported", {
      headers: { authorization: `Bearer ${FIXTURE_API_KEY}` },
    });

    expect(response.status).toBe(200);
  });

  it("refuses a bypass attempt that trims or re-cases the scheme", async () => {
    const { app } = harness(secured);

    for (const attempt of [
      FIXTURE_API_KEY,
      `bearer ${FIXTURE_API_KEY}`,
      `Bearer  ${FIXTURE_API_KEY}x`,
      `Basic ${FIXTURE_API_KEY}`,
    ]) {
      const response = await app.fetch(post("/verify", WELL_FORMED, { authorization: attempt }));
      expect(response.status).toBe(401);
    }
  });

  it("returns 429 with Retry-After once a caller is over budget", async () => {
    const { app } = harness({
      networks: [{ network: "stellar:testnet", signers: SPONSORS.map(signer) }],
      rateLimit: { enabled: true, requestsPerWindowPerKey: 2 },
    });

    await app.request("http://facilitator.test/supported");
    await app.request("http://facilitator.test/supported");
    const limited = await app.fetch(post("/verify", WELL_FORMED));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
    expect(await limited.json()).toMatchObject({ invalidReason: TRANSPORT_REASONS.rateLimited });
  });

  it("holds up under a burst rather than failing open", async () => {
    const { app } = harness({
      networks: [{ network: "stellar:testnet", signers: SPONSORS.map(signer) }],
      rateLimit: { enabled: true, requestsPerWindowPerKey: 10 },
    });

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => app.request("http://facilitator.test/supported")),
    );
    const admitted = responses.filter((response) => response.status === 200).length;

    // A limiter that admitted all fifty would be decorative. Exactly ten is the contract.
    expect(admitted).toBe(10);
  });
});

describe("operational endpoints", () => {
  it("serves /health without touching a chain, so a network blip cannot restart a healthy pod", async () => {
    const response = await harness().app.request("http://facilitator.test/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", networks: ["stellar:testnet"] });
  });

  it("publishes sponsor addresses, floors and the configured operator fee on /metrics", async () => {
    const { app } = harness({
      networks: [{ network: "stellar:testnet", signers: SPONSORS.map(signer) }],
      fees: { settleFeeStroops: 250 },
    });
    const body = (await (await app.request("http://facilitator.test/metrics")).json()) as {
      settleFeeStroops: number;
      networks: { network: string; signers: string[]; floorXlm: number }[];
    };

    // The fee is a configuration value an operator can read back, never a hard-coded one
    // (RFP §3.1).
    expect(body.settleFeeStroops).toBe(250);
    expect(body.networks[0]?.signers).toEqual(SPONSORS);
    expect(body.networks[0]?.floorXlm).toBe(5);
  });

  it("counts rejections per caller on /metrics", async () => {
    const { app } = harness();
    await app.fetch(post("/verify", "{"));

    const body = (await (await app.request("http://facilitator.test/metrics")).json()) as {
      callers: { caller: string; rejectedTotal: number }[];
    };
    expect(body.callers.find((caller) => caller.caller === "anonymous")?.rejectedTotal).toBe(1);
  });
});

describe("logs carry no secret, no payload and no credential", () => {
  it("logs a verify with an authorization header and a seed-shaped payload, and leaks neither", async () => {
    const { app, logs } = harness({
      networks: [{ network: "stellar:testnet", signers: SPONSORS.map(signer) }],
      auth: { mode: "bearer", keys: [{ id: "team-a", secret: FIXTURE_API_KEY }] },
    });

    const payload = {
      ...WELL_FORMED,
      paymentPayload: {
        ...WELL_FORMED.paymentPayload,
        payload: { transaction: `AAAA${FIXTURE_STELLAR_SEED}` },
      },
    };

    await app.fetch(post("/verify", payload, { authorization: `Bearer ${FIXTURE_API_KEY}` }));
    await app.fetch(post("/settle", payload, { authorization: `Bearer ${FIXTURE_API_KEY}` }));

    expect(logs.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(logs);

    // The request carried all three. None may reach a log line: the credential because it is
    // a credential, the payload because it is a signed transaction, and the seed because a
    // seed in a log is a compromised account.
    expect(
      findLeakedSecrets(serialised, [FIXTURE_API_KEY, FIXTURE_STELLAR_SEED, "authorization"]),
    ).toEqual([]);
  });

  it("logs the caller id, the status and the reason — enough to operate on", async () => {
    const { app, logs } = harness();
    await app.fetch(post("/verify", "{"));

    expect(logs[0]).toMatchObject({
      event: "facilitator.verify",
      caller: "anonymous",
      status: 400,
      reason: TRANSPORT_REASONS.invalidRequestBody,
    });
    expect(logs[0]?.["correlationId"]).toBeTypeOf("string");
  });
});
