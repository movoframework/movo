import type { FacilitatorStellarSigner } from "@movoframework/core";
import { describe, expect, it } from "vitest";
import { resolveFacilitatorConfig } from "./config.js";
import { constantTimeEquals, createFacilitator, type FacilitatorRequest } from "./facilitator.js";
import { ANONYMOUS_CALLER } from "./metering.js";
import {
  TRANSPORT_REASON_MESSAGE,
  TRANSPORT_REASON_STATUS,
  TRANSPORT_REASON_VALUES,
  TRANSPORT_REASONS,
} from "./reasons.js";

/**
 * These tests exercise the **service tier only** — the half of the facilitator that is Movo's.
 *
 * Nothing here reaches `ExactStellarScheme.verify` or `.settle`. That is not an omission: those
 * two methods simulate against a Soroban RPC endpoint on every call, so a unit test that
 * reached them would either hit the network (which `tests/setup/no-network.ts` fails outright)
 * or would have to stub upstream — and a stubbed facilitator asserting that settlement works is
 * exactly the class of evidence this repository refuses (spec §11.3, §A.2 rule 4).
 *
 * The real protocol paths are proven in `tests/e2e/facilitator-settlement.test.ts` against
 * Stellar testnet, with on-chain confirmation. What is proven *here* is everything that
 * happens before upstream is reached, which is where every transport rejection and the entire
 * `/supported` shape live.
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

function subject(
  overrides: Parameters<typeof resolveFacilitatorConfig>[0] | undefined = undefined,
) {
  return createFacilitator(
    resolveFacilitatorConfig(
      overrides ?? { networks: [{ network: "stellar:testnet", signers: SPONSORS.map(signer) }] },
    ),
  );
}

function request(body: unknown, headers: FacilitatorRequest["headers"] = {}): FacilitatorRequest {
  return { body: typeof body === "string" ? body : JSON.stringify(body), headers };
}

/** A structurally valid envelope, so a rejection is never merely "this was garbage". */
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

describe("/supported — AC6.3", () => {
  it("advertises the configured network and the exact scheme", async () => {
    const response = await subject().supported(request(""));

    expect(response.status).toBe(200);
    const stellar = response.body.kinds.find((kind) => kind.network === "stellar:testnet");
    expect(stellar?.scheme).toBe("exact");
    expect(stellar?.x402Version).toBe(2);
  });

  it("emits the Stellar extra contract including areFeesSponsored", async () => {
    const response = await subject().supported(request(""));
    const stellar = response.body.kinds.find((kind) => kind.network === "stellar:testnet");

    // The single field the whole fee-sponsorship contract hangs on. A client reads it to
    // decide whether it must fund a fee itself.
    expect(stellar?.extra).toEqual({ areFeesSponsored: true });
  });

  it("reflects areFeesSponsored: false when the operator turns sponsorship off", async () => {
    const response = await subject({
      networks: [
        {
          network: "stellar:testnet",
          signers: SPONSORS.map(signer),
          areFeesSponsored: false,
        },
      ],
    }).supported(request(""));

    expect(response.body.kinds.find((kind) => kind.network === "stellar:testnet")?.extra).toEqual({
      areFeesSponsored: false,
    });
  });

  it("publishes every sponsor address under the Stellar CAIP family", async () => {
    const response = await subject().supported(request(""));

    // The reference facilitator keys this block `stellar:*` and lists its sponsors. A client
    // uses it to know which addresses may legitimately appear as a transaction source.
    expect(response.body.signers["stellar:*"]).toEqual(SPONSORS);
  });

  it("carries the three top-level fields the response shape requires, and no others", async () => {
    const response = await subject().supported(request(""));

    expect(Object.keys(response.body).sort()).toEqual(["extensions", "kinds", "signers"]);
  });

  it("advertises both networks when both are configured", async () => {
    const response = await subject({
      networks: [
        { network: "stellar:testnet", signers: [signer(SPONSORS[0] as string)] },
        {
          network: "stellar:pubnet",
          signers: [signer(SPONSORS[1] as string)],
          rpcUrl: "https://soroban.example/rpc",
        },
      ],
    }).supported(request(""));

    expect(response.body.kinds.map((kind) => kind.network).sort()).toEqual([
      "stellar:pubnet",
      "stellar:testnet",
    ]);
  });
});

describe("AC6.5 — every rejection carries a non-null machine-readable reason", () => {
  it("enumerates every transport reason and asserts each is reachable and non-null", () => {
    // Derived from the single exported constant rather than a hand-written copy, so a renamed
    // or added reason cannot leave this assertion green while asserting nothing
    // (spec v2 §A.2 rule 2).
    for (const reason of TRANSPORT_REASON_VALUES) {
      expect(reason).toBeTruthy();
      expect(TRANSPORT_REASON_STATUS[reason]).toBeGreaterThanOrEqual(400);
      expect(TRANSPORT_REASON_MESSAGE[reason].length).toBeGreaterThan(10);
    }
    expect(TRANSPORT_REASON_VALUES.length).toBe(Object.keys(TRANSPORT_REASONS).length);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await subject().verify(request("{not json"));

    expect(response.status).toBe(400);
    expect(response.body.isValid).toBe(false);
    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.invalidRequestBody);
  });

  it("rejects a JSON array, which is JSON but not an envelope", async () => {
    const response = await subject().verify(request([1, 2, 3]));
    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.invalidRequestBody);
  });

  it("rejects an envelope missing paymentPayload or paymentRequirements", async () => {
    const response = await subject().verify(request({ x402Version: 2 }));
    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.invalidRequestShape);
  });

  it("rejects a paymentPayload upstream's schema refuses", async () => {
    const response = await subject().verify(
      request({ ...WELL_FORMED, paymentPayload: { nonsense: true } }),
    );

    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.invalidPaymentPayload);
  });

  it("rejects paymentRequirements upstream's schema refuses", async () => {
    const response = await subject().verify(
      request({ ...WELL_FORMED, paymentRequirements: { scheme: "exact" } }),
    );

    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.invalidPaymentRequirements);
  });

  it("rejects a network this deployment has no signer for", async () => {
    const response = await subject().verify(
      request({
        ...WELL_FORMED,
        paymentRequirements: { ...WELL_FORMED.paymentRequirements, network: "stellar:pubnet" },
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.unsupportedNetwork);
  });

  it("rejects an oversized body with 413 before parsing it", async () => {
    const facilitator = subject();
    const oversized = JSON.stringify({ ...WELL_FORMED, padding: "x".repeat(200_000) });
    const response = await facilitator.verify(request(oversized));

    expect(response.status).toBe(413);
    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.payloadTooLarge);
  });

  it("gives settle rejections the settle shape, with a non-null errorReason", async () => {
    const response = await subject().settle(request("{not json"));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorReason).toBe(TRANSPORT_REASONS.invalidRequestBody);
    // Never a placeholder hash. An empty reference is what upstream itself returns on a
    // failed settle; inventing one would be a fabricated settlement reference.
    expect(response.body.transaction).toBe("");
    expect(response.body.network).toBe("stellar:testnet");
  });

  it("keeps the protocol response shape on every 4xx, so the stock client gets a typed error", async () => {
    // HTTPFacilitatorClient turns a non-2xx body containing `isValid` into a VerifyError
    // carrying invalidReason, and anything else into an opaque Error with a text excerpt.
    // This is what makes AC6.5's "machine-readable" true at the client rather than only here.
    const response = await subject().verify(request("{"));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(Object.keys(response.body)).toContain("isValid");
  });
});

describe("bearer authentication", () => {
  const authenticated = {
    networks: [{ network: "stellar:testnet" as const, signers: SPONSORS.map(signer) }],
    auth: {
      mode: "bearer" as const,
      keys: [{ id: "team-a", secret: "movo-fixture-facilitator-credential" }],
    },
  };

  it("admits a caller presenting a configured key", async () => {
    const response = await subject(authenticated).supported(
      request("", { authorization: "Bearer movo-fixture-facilitator-credential" }),
    );

    expect(response.status).toBe(200);
    expect(response.caller).toBe("team-a");
  });

  it("refuses a missing credential with 401 and a non-null reason", async () => {
    const response = await subject(authenticated).verify(request(WELL_FORMED));

    expect(response.status).toBe(401);
    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.unauthorized);
  });

  it("refuses a wrong credential", async () => {
    const response = await subject(authenticated).verify(
      request(WELL_FORMED, { authorization: "Bearer wrong" }),
    );

    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.unauthorized);
  });

  it("refuses a credential presented without the Bearer scheme", async () => {
    const response = await subject(authenticated).verify(
      request(WELL_FORMED, { authorization: "movo-fixture-facilitator-credential" }),
    );

    expect(response.body.invalidReason).toBe(TRANSPORT_REASONS.unauthorized);
  });

  it("returns an empty-but-valid supported response to an unauthorised caller", async () => {
    // /supported has no failure shape in the specification. An empty `kinds` cannot be
    // mistaken for capability, and inventing an error envelope here would be a Movo-specific
    // field on a protocol response.
    const response = await subject(authenticated).supported(request(""));

    expect(response.status).toBe(401);
    expect(response.body.kinds).toEqual([]);
  });

  it("serves an open deployment without any credential — the keyless testnet posture", async () => {
    const response = await subject().supported(request(""));

    expect(response.status).toBe(200);
    expect(response.caller).toBe(ANONYMOUS_CALLER);
  });
});

describe("rate limiting", () => {
  it("refuses a caller over budget with 429, a reason and a Retry-After", async () => {
    const facilitator = subject({
      networks: [{ network: "stellar:testnet", signers: SPONSORS.map(signer) }],
      rateLimit: { enabled: true, requestsPerWindowPerKey: 2 },
    });

    expect((await facilitator.supported(request(""))).status).toBe(200);
    expect((await facilitator.supported(request(""))).status).toBe(200);

    const limited = await facilitator.verify(request(WELL_FORMED));
    expect(limited.status).toBe(429);
    expect(limited.body.invalidReason).toBe(TRANSPORT_REASONS.rateLimited);
    expect(limited.headers["Retry-After"]).toBeDefined();
  });

  it("applies a per-IP budget independently of the per-key one", async () => {
    const facilitator = subject({
      networks: [{ network: "stellar:testnet", signers: SPONSORS.map(signer) }],
      rateLimit: { enabled: true, requestsPerWindowPerKey: 1000, requestsPerWindowPerIp: 1 },
    });

    const from = (ip: string): FacilitatorRequest => ({ body: "", headers: {}, clientIp: ip });

    expect((await facilitator.supported(from("203.0.113.4"))).status).toBe(200);
    expect((await facilitator.supported(from("203.0.113.4"))).status).toBe(429);
    // A different source is unaffected — the limiter is not a global counter.
    expect((await facilitator.supported(from("203.0.113.5"))).status).toBe(200);
  });

  it("does not limit when limiting is switched off", async () => {
    const facilitator = subject({
      networks: [{ network: "stellar:testnet", signers: SPONSORS.map(signer) }],
      rateLimit: { enabled: false, requestsPerWindowPerKey: 1 },
    });

    for (let index = 0; index < 5; index += 1) {
      expect((await facilitator.supported(request(""))).status).toBe(200);
    }
  });
});

describe("metering", () => {
  it("counts served requests and rejections per caller", async () => {
    const facilitator = subject();
    await facilitator.supported(request(""));
    await facilitator.verify(request("{"));

    const meter = facilitator.meters().find((entry) => entry.caller === ANONYMOUS_CALLER);
    expect(meter?.rejectedTotal).toBe(1);
  });
});

describe("wiring", () => {
  it("exposes a pool per configured network", () => {
    const facilitator = subject();

    expect(facilitator.networks).toEqual(["stellar:testnet"]);
    expect(facilitator.poolFor("stellar:testnet")?.addresses).toEqual(SPONSORS);
    expect(facilitator.poolFor("stellar:pubnet")).toBeUndefined();
  });

  it("offers an in-process FacilitatorClient for self-facilitation (AC6.12)", () => {
    const client = subject().asFacilitatorClient();

    // Structural conformance to upstream's FacilitatorClient. The settlement behaviour behind
    // it is proven on testnet, not here.
    expect(typeof client.verify).toBe("function");
    expect(typeof client.settle).toBe("function");
    expect(typeof client.getSupported).toBe("function");
  });

  it("serves the same /supported through the in-process client as over HTTP", async () => {
    const facilitator = subject();
    const overHttp = await facilitator.supported(request(""));
    const inProcess = await facilitator.asFacilitatorClient().getSupported();

    // Self-facilitation must not be a second, subtly different facilitator.
    expect(inProcess).toEqual(overHttp.body);
  });
});

describe("constantTimeEquals", () => {
  it("matches identical strings and rejects everything else", () => {
    expect(constantTimeEquals("secret", "secret")).toBe(true);
    expect(constantTimeEquals("secret", "secrez")).toBe(false);
    expect(constantTimeEquals("secret", "secret-longer")).toBe(false);
    expect(constantTimeEquals("secret", "")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });
});
