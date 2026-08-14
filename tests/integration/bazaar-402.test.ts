import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { queryCatalog, readCatalogOutcome } from "../../packages/bazaar/src/index.ts";
import {
  type AnyMovoResource,
  decodePaymentRequiredHeader,
  defineApp,
  defineResource,
  type Finding,
  PAYMENT_HEADERS,
} from "../../packages/core/src/index.ts";
import { mountExpress } from "../../packages/server/src/index.ts";
import { StubFacilitator } from "../support/stub-facilitator.ts";

/**
 * The Bazaar extension on the real 402 path, and the catalog client against a real HTTP server.
 *
 * AC4.2 is the contrast test and the reason this file exists: a loopback `iconUrl` produces an
 * **error-level finding** at build time *and* a runtime 402 that still emits, with that field
 * soft-dropped by upstream. Asserting only one half would miss the entire point of severity
 * escalation — Movo does not change what upstream does on the wire, it changes when the author
 * finds out.
 */

const PAY_TO = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";

interface Harness {
  readonly url: string;
  readonly findings: readonly Finding[];
  close(): Promise<void>;
}

async function mount(resource: AnyMovoResource): Promise<Harness> {
  const findings: Finding[] = [];
  const application = express();
  application.use(express.json());

  await mountExpress(application as never, defineApp({ resources: [resource] }), {
    facilitator: new StubFacilitator(),
    config: { config: { payTo: PAY_TO, discovery: { enabled: true } }, env: {} },
    onFinding: (finding) => void findings.push(finding),
  });

  const server = createServer(application);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    findings,
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("AC4.1 — the declaration reaches the 402", () => {
  it("emits extensions.bazaar on the PAYMENT-REQUIRED, passing upstream validation", async () => {
    const resource = defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      description: "Current conditions",
      serviceName: "Example Weather",
      tags: ["weather"],
      iconUrl: "https://example.com/icon.png",
      input: z.object({ city: z.string().describe("City name or IATA code") }),
      discovery: { example: { city: "SFO" }, outputExample: { tempC: 14 } },
      handler: () => ({ tempC: 14 }),
    });

    const harness = await mount(resource);
    try {
      const response = await fetch(`${harness.url}/weather/SFO`);
      expect(response.status).toBe(402);

      const decoded = decodePaymentRequiredHeader(
        response.headers.get(PAYMENT_HEADERS.required) as string,
      );

      // The extension travels on the PaymentRequired, which is what a buyer echoes back and what
      // the facilitator catalogues from.
      expect(decoded.extensions).toBeDefined();
      const serialised = JSON.stringify(decoded.extensions);
      expect(serialised).toContain("city");
      expect(serialised).toContain("City name or IATA code");

      // Nothing was escalated: the metadata is all valid.
      expect(harness.findings.filter((finding) => finding.level === "error")).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("emits no bazaar extension for a resource that declares no discovery", async () => {
    const resource = defineResource({
      method: "GET",
      path: "/private",
      price: "$0.001",
      handler: () => ({ ok: true }),
    });

    const harness = await mount(resource);
    try {
      const response = await fetch(`${harness.url}/private`);
      const decoded = decodePaymentRequiredHeader(
        response.headers.get(PAYMENT_HEADERS.required) as string,
      );

      expect(JSON.stringify(decoded.extensions ?? {})).not.toContain("bazaar");
    } finally {
      await harness.close();
    }
  });
});

describe("AC4.2 — escalation and soft-drop, asserted together", () => {
  it("raises an error-level finding AND still serves a 402 with the field dropped", async () => {
    const resource = defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      serviceName: "Example Weather",
      // A loopback icon URL. Upstream's SSRF control drops it silently; Movo says so loudly.
      iconUrl: "http://127.0.0.1:8080/icon.png",
      input: z.object({ city: z.string().describe("City name or IATA code") }),
      discovery: {},
      handler: () => ({ tempC: 14 }),
    });

    const harness = await mount(resource);
    try {
      // ── Half one: Movo escalated it to an error at build time ──────────────────────────
      const iconFindings = harness.findings.filter((finding) => finding.id === "bazaar.icon-url");

      expect(iconFindings).toHaveLength(1);
      expect(iconFindings[0]?.level).toBe("error");
      expect(iconFindings[0]?.fix).toBeDefined();

      // ── Half two: upstream still served the 402, unchanged ─────────────────────────────
      const response = await fetch(`${harness.url}/weather/SFO`);
      expect(response.status).toBe(402);

      const header = response.headers.get(PAYMENT_HEADERS.required);
      expect(header).not.toBeNull();

      const decoded = decodePaymentRequiredHeader(header as string);

      // The request is still payable. Escalation changed nothing about the wire — that is the
      // whole contrast AC4.2 is testing.
      expect(decoded.accepts[0]?.payTo).toBe(PAY_TO);
      expect(decoded.extensions).toBeDefined();

      // Where the drop actually happens, corrected from the first draft of this test: the 402
      // carries `resource.iconUrl` through untouched. `sanitizeResourceServiceMetadata` runs on
      // the *catalog ingest* side, when a facilitator extracts discovery info from a settled
      // payment. So the field survives the response and vanishes later, at someone else's
      // server — which makes the silence worse, not better, and the build-time finding more
      // valuable rather than less.
      expect(decoded.resource.iconUrl).toBe("http://127.0.0.1:8080/icon.png");

      const { sanitizeResourceServiceMetadata } = await import(
        "../../packages/core/src/protocol/bazaar.ts"
      );
      const catalogued = sanitizeResourceServiceMetadata(decoded.resource);

      // Dropped at ingest…
      expect(catalogued.iconUrl).toBeUndefined();
      // …while the valid metadata survives, so this is a soft-drop and not a rejection.
      expect(catalogued.serviceName).toBe("Example Weather");
    } finally {
      await harness.close();
    }
  });

  it("fails the mount when strictDiscovery is enabled", async () => {
    // The deploy-gate posture: a listing that will silently lose fields should not ship.
    const resource = defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      iconUrl: "http://127.0.0.1:8080/icon.png",
      discovery: {},
      handler: () => ({ ok: true }),
    });

    const application = express();
    await expect(
      mountExpress(application as never, defineApp({ resources: [resource] }), {
        facilitator: new StubFacilitator(),
        config: { config: { payTo: PAY_TO, discovery: { enabled: true } }, env: {} },
        strictDiscovery: true,
      }),
    ).rejects.toMatchObject({ code: "MOVO_E_DISCOVERY_EXTENSION_INVALID" });
  });
});

describe("queryCatalog reaches a real facilitator (amendment 007 §8)", () => {
  it("returns what the catalog served, over real HTTP", async () => {
    // A real HTTP server, a real HTTPFacilitatorClient, real withBazaar. The discarded WIP
    // returned `{ resources: [] }` unconditionally; nothing short of a served response can
    // satisfy this test.
    const served = {
      x402Version: 2,
      items: [
        { resourceUrl: "https://weather.example/weather/:city", type: "http" },
        { resourceUrl: "https://quotes.example/quote", type: "http" },
      ],
    };

    const facilitator = express();
    let listPath: string | undefined;
    let searchQuery: string | undefined;

    facilitator.get("/discovery/resources", (request, response) => {
      listPath = request.originalUrl;
      response.json(served);
    });
    facilitator.get("/discovery/search", (request, response) => {
      searchQuery = String(request.query["query"] ?? "");
      response.json({ x402Version: 2, items: [served.items[0]] });
    });

    const server = createServer(facilitator);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const catalog = queryCatalog(`http://127.0.0.1:${String(port)}`);

      const listed = (await catalog.list({ type: "http" })) as unknown as { items: unknown[] };
      expect(listed.items).toHaveLength(2);
      expect(listPath).toContain("type=http");

      const found = (await catalog.search({ query: "weather APIs" })) as unknown as {
        items: unknown[];
      };
      expect(found.items).toHaveLength(1);
      expect(searchQuery).toBe("weather APIs");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});

describe("readCatalogOutcome on a real response", () => {
  it("reports unknown/absent when a server sends no EXTENSION-RESPONSES header", async () => {
    // The common case in production: a facilitator that does not emit the header at all. The
    // buyer must not read that as a cataloging failure.
    const application = express();
    application.get("/paid", (_request, response) => {
      response.json({ ok: true });
    });

    const server = createServer(application);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/paid`);
      const outcome = readCatalogOutcome(response.headers.get("EXTENSION-RESPONSES"));

      expect(outcome).toEqual({ status: "unknown", reason: "absent" });
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
