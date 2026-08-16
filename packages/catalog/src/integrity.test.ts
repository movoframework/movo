import { describe, expect, it } from "vitest";
import { createCatalog } from "./catalog.js";
import {
  checkFieldSizes,
  checkRouteTemplate,
  checkSchemaRefs,
  DEFAULT_FIELD_CAPS,
} from "./integrity.js";
import { ADVERSARIAL_CONTROLS, INGEST_REASONS } from "./reasons.js";
import { SqliteCatalogStore } from "./store/sqlite.js";
import type { CatalogStore, IngestContext } from "./types.js";

/**
 * AC7.5 — the six adversarial integrity tests, each failing closed with a distinct reason.
 *
 * **These assert on real state, not on a reason string.** §B.2 recorded the sharpest instance of
 * the rule to date: M6's concurrency gate grepped a reason for `/seq/` and reported green over
 * 190 failed settlements, because upstream had collapsed the distinguishing reason into an
 * opaque one. So every test below asserts what the **store** contains — the row did not land,
 * the owner is unchanged, the count did not move — and treats the reason as a secondary signal.
 * A reason is evidence about what the code said; the store is evidence about what it did.
 */

const SELLER = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";
const ATTACKER = "GBVMPGDRMNNJF6F27KWYG4TYMSZKG6CU7HHFNKNLLDAZW6AAAGXO6MDV";
const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** A well-formed bazaar declaration for an HTTP resource. */
function declaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    info: {
      input: {
        type: "http",
        method: "GET",
        discoverable: true,
        queryParams: { city: { type: "string", description: "IATA airport code" } },
      },
      output: { type: "object" },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { input: { type: "object" }, output: { type: "object" } },
      required: ["input"],
    },
    ...overrides,
  };
}

function context(options: {
  payTo?: string;
  resourceUrl?: string;
  routeTemplate?: string;
  serviceName?: string;
  description?: string;
  iconUrl?: string;
  tags?: string[];
  extension?: Record<string, unknown>;
  echoedPayTo?: string;
}): IngestContext {
  const payTo = options.payTo ?? SELLER;
  const resource = {
    url: options.resourceUrl ?? "https://weather.example/weather/SFO",
    ...(options.serviceName === undefined ? {} : { serviceName: options.serviceName }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.iconUrl === undefined ? {} : { iconUrl: options.iconUrl }),
    ...(options.tags === undefined ? {} : { tags: options.tags }),
  };

  return {
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "stellar:testnet",
        amount: "10000",
        asset: ASSET,
        payTo: options.echoedPayTo ?? payTo,
        maxTimeoutSeconds: 300,
      },
      // Upstream reads the resource block from the PAYLOAD, not from `accepted`. Verified
      // against `extractDiscoveryInfo` in the installed package, not assumed.
      resource,
      payload: { transaction: "AAAA" },
      extensions: {
        bazaar: {
          ...(options.extension ?? declaration()),
          ...(options.routeTemplate === undefined ? {} : { routeTemplate: options.routeTemplate }),
        },
      },
    },
    paymentRequirements: {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "10000",
      asset: ASSET,
      payTo,
      maxTimeoutSeconds: 300,
      resource,
      ...(options.routeTemplate === undefined
        ? {}
        : { extra: { routeTemplate: options.routeTemplate } }),
    } as IngestContext["paymentRequirements"],
    settleResponse: {
      success: true,
      transaction: "0".repeat(64),
      network: "stellar:testnet",
      payer: "GCX3VGY6ND44NV5WC7S4XSBEY3MX2VPMTB7A4ZWKZPMP67JI7MZLP77W",
    },
  };
}

async function freshStore(): Promise<CatalogStore> {
  return SqliteCatalogStore.open(":memory:");
}

describe("AC7.5 — the six adversarial integrity attacks fail closed", () => {
  it("names exactly the six attacks the criterion lists", () => {
    // Enumerating the criterion rather than restating it: a seventh control added without a
    // test fails here.
    expect(Object.keys(ADVERSARIAL_CONTROLS)).toHaveLength(6);
    expect(new Set(Object.values(ADVERSARIAL_CONTROLS)).size).toBe(6);
  });

  it("1. refuses to let one seller overwrite another's listing — and the owner is unchanged", async () => {
    const store = await freshStore();
    const catalog = createCatalog({ store });

    const first = await catalog.ingest(context({ payTo: SELLER }));
    expect(first.status).toBe("success");
    const id = (first as { id: string }).id;
    const before = await store.get(id);

    const attack = await catalog.ingest(context({ payTo: ATTACKER }));

    // The state assertion is the real one.
    const after = await store.get(id);
    expect(after?.payTo).toBe(SELLER);
    expect(after?.lastUpdated).toBe(before?.lastUpdated);
    expect(await store.count()).toBe(1);

    expect(attack.status).toBe("rejected");
    expect((attack as { rejectedReason: string }).rejectedReason).toBe(
      INGEST_REASONS.ownerMismatch,
    );
    await store.close();
  });

  it("2. refuses a forged payTo — nothing lands at all", async () => {
    const store = await freshStore();
    const catalog = createCatalog({ store });

    const attack = await catalog.ingest(context({ payTo: SELLER, echoedPayTo: ATTACKER }));

    expect(await store.count()).toBe(0);
    expect(attack.status).toBe("rejected");
    expect((attack as { rejectedReason: string }).rejectedReason).toBe(INGEST_REASONS.payToForged);
    await store.close();
  });

  it("3. refuses percent-encoded traversal, decoding BEFORE the check", () => {
    // The bypass this defends: `%2e%2e%2f` is not `../` to a naive check but is to anything
    // that decodes. And `%252e%252e` needs two passes.
    for (const attack of [
      "/weather/%2e%2e%2f%2e%2e%2fadmin",
      "/weather/%252e%252e%252fadmin",
      "/weather/../../etc/passwd",
    ]) {
      const result = checkRouteTemplate(attack);
      expect(result.ok, `expected refusal for ${attack}`).toBe(false);
      if (!result.ok) {
        expect(result.refusal.reason).toBe(INGEST_REASONS.routeTemplateInvalid);
      }
    }
  });

  it("3b. still accepts an ordinary template, so the control is precise rather than strict", () => {
    // Upstream's template dialect is Express-style `:param`, NOT OpenAPI-style `{param}` —
    // `isValidRouteTemplate("/weather/{city}")` is false. Verified against the installed
    // package rather than assumed, and it is the dialect Movo's own `defineResource` paths
    // already use, so a Movo seller's template is valid upstream by construction.
    expect(checkRouteTemplate("/weather/:city").ok).toBe(true);
    expect(checkRouteTemplate("/weather").ok).toBe(true);
    expect(checkRouteTemplate("/weather/{city}").ok).toBe(false);
  });

  it("4. refuses a loopback iconUrl — nothing lands", async () => {
    const store = await freshStore();
    const catalog = createCatalog({ store });

    for (const icon of [
      "http://127.0.0.1:8080/icon.png",
      "http://localhost/icon.png",
      "file:///etc/passwd",
    ]) {
      const attack = await catalog.ingest(context({ iconUrl: icon }));
      expect(attack.status, `expected refusal for ${icon}`).toBe("rejected");
      expect((attack as { rejectedReason: string }).rejectedReason).toBe(
        INGEST_REASONS.iconUrlInvalid,
      );
    }

    expect(await store.count()).toBe(0);
    await store.close();
  });

  it("5. refuses an external $ref anywhere in the declared schema", () => {
    const attacks: readonly unknown[] = [
      { $ref: "https://evil.test/schema.json" },
      { properties: { input: { $ref: "http://169.254.169.254/latest/meta-data" } } },
      { properties: { deep: { items: { $id: "file:///etc/passwd" } } } },
      { $schema: "https://evil.test/draft" },
    ];

    for (const attack of attacks) {
      const result = checkSchemaRefs(attack);
      expect(result.ok, `expected refusal for ${JSON.stringify(attack)}`).toBe(false);
      if (!result.ok) expect(result.refusal.reason).toBe(INGEST_REASONS.schemaRefExternal);
    }
  });

  it("5b. accepts same-document fragments and the standard dialect", () => {
    const result = checkSchemaRefs({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      properties: { city: { $ref: "#/definitions/City" } },
      definitions: { City: { type: "string" } },
    });
    expect(result.ok).toBe(true);
  });

  it("6. refuses oversized fields", () => {
    const cases: readonly [string, Parameters<typeof checkFieldSizes>[0]][] = [
      ["description", { description: "x".repeat(DEFAULT_FIELD_CAPS.description + 1) }],
      ["serviceName", { serviceName: "x".repeat(DEFAULT_FIELD_CAPS.serviceName + 1) }],
      ["resource", { resource: `https://e.test/${"x".repeat(DEFAULT_FIELD_CAPS.resourceUrl)}` }],
      ["tag count", { tags: Array.from({ length: DEFAULT_FIELD_CAPS.tagCount + 1 }, () => "t") }],
      ["tag length", { tags: ["x".repeat(DEFAULT_FIELD_CAPS.tag + 1)] }],
      [
        "extensions",
        { extensions: { bazaar: { blob: "x".repeat(DEFAULT_FIELD_CAPS.extensionsBytes) } } },
      ],
    ];

    for (const [label, fields] of cases) {
      const result = checkFieldSizes(fields);
      expect(result.ok, `expected refusal for oversized ${label}`).toBe(false);
      if (!result.ok) expect(result.refusal.reason).toBe(INGEST_REASONS.fieldTooLarge);
    }
  });

  it("6b. accepts fields at the cap, so the boundary is inclusive and documented", () => {
    const result = checkFieldSizes({
      description: "x".repeat(DEFAULT_FIELD_CAPS.description),
      tags: Array.from({ length: DEFAULT_FIELD_CAPS.tagCount }, () => "t"),
    });
    expect(result.ok).toBe(true);
  });

  it("produces six pairwise-distinct reasons across the six attacks", () => {
    // Distinctness is half of AC7.5. Six attacks reporting one reason is six attacks an
    // operator cannot tell apart and an agent cannot branch on.
    const reasons = Object.values(ADVERSARIAL_CONTROLS);
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const reason of reasons) expect(reason).toBeTruthy();
  });
});

describe("§B.2 — the write path is mutex-correct, asserted on state", () => {
  it("lets exactly one of two concurrent conflicting writers win", async () => {
    const store = await freshStore();
    const catalog = createCatalog({ store });

    // Same resource, two different sellers, dispatched together. Read-then-write outside a
    // transaction would let both observe "no owner" and both write; the second would silently
    // steal the listing. The store's compare-and-write is what makes this deterministic.
    const [a, b] = await Promise.all([
      catalog.ingest(context({ payTo: SELLER })),
      catalog.ingest(context({ payTo: ATTACKER })),
    ]);

    const outcomes = [a.status, b.status].sort();
    expect(outcomes).toEqual(["rejected", "success"]);

    // One listing, one owner, and the owner is whichever one won — not a mixture.
    expect(await store.count()).toBe(1);
    const stored = (await store.list({})).items[0];
    expect([SELLER, ATTACKER]).toContain(stored?.payTo);
    await store.close();
  });

  it("keeps a listing's owner stable across many concurrent updates from the owner", async () => {
    const store = await freshStore();
    const catalog = createCatalog({ store });

    await catalog.ingest(context({ payTo: SELLER }));
    await Promise.all(Array.from({ length: 20 }, () => catalog.ingest(context({ payTo: SELLER }))));

    expect(await store.count()).toBe(1);
    expect((await store.list({})).items[0]?.payTo).toBe(SELLER);
    await store.close();
  });
});
