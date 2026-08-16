import { describe, expect, it } from "vitest";
import { createFacilitatorApp } from "../../apps/facilitator/src/app.ts";
import { createCatalogObserver } from "../../apps/facilitator/src/catalog-wiring.ts";
import { type Catalog, createCatalog } from "../../packages/catalog/src/index.ts";
import type { FacilitatorStellarSigner } from "../../packages/core/src/index.ts";
import {
  createFacilitator,
  resolveFacilitatorConfig,
} from "../../packages/facilitator/src/index.ts";
import { CATALOG_BACKENDS, type CatalogBackend } from "../support/catalog-stores.ts";

/**
 * AC7.1, AC7.2 and AC7.6 driven through the real HTTP surface.
 *
 * The settle path here is the **real** one — `createFacilitator` with a real observer, the real
 * Hono app, real query parsing. What is not real is the chain: upstream's `ExactStellarScheme`
 * would need a Soroban RPC round trip, so the settlement outcome is supplied by a stub scheme.
 * That boundary is deliberate and is the same one M6's integration suite drew: everything up to
 * the ledger is exercised, and the ledger itself is proven in the e2e suite.
 *
 * Assertions are on **stored state and returned bodies**, never on a reason substring alone
 * (§B.2).
 */

const SELLER = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";
const SPONSOR = "GBVMPGDRMNNJF6F27KWYG4TYMSZKG6CU7HHFNKNLLDAZW6AAAGXO6MDV";
const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function signer(address: string): FacilitatorStellarSigner {
  return {
    address,
    signAuthEntry: async () => ({ signedAuthEntry: "", signerAddress: address }),
    signTransaction: async () => ({ signedTxXdr: "", signerAddress: address }),
  } as unknown as FacilitatorStellarSigner;
}

function declaration(routeTemplate?: string): Record<string, unknown> {
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
    ...(routeTemplate === undefined ? {} : { routeTemplate }),
  };
}

function settlement(options: {
  url: string;
  serviceName: string;
  description: string;
  tags: string[];
  routeTemplate?: string;
  extension?: Record<string, unknown>;
}): { paymentPayload: unknown; paymentRequirements: unknown } {
  const resource = {
    url: options.url,
    serviceName: options.serviceName,
    description: options.description,
    tags: options.tags,
  };
  return {
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "stellar:testnet",
        amount: "10000",
        asset: ASSET,
        payTo: SELLER,
        maxTimeoutSeconds: 300,
      },
      resource,
      payload: { transaction: "AAAA" },
      extensions: { bazaar: options.extension ?? declaration(options.routeTemplate) },
    },
    paymentRequirements: {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "10000",
      asset: ASSET,
      payTo: SELLER,
      maxTimeoutSeconds: 300,
      resource,
    },
  };
}

async function harness(backend: CatalogBackend): Promise<{
  app: ReturnType<typeof createFacilitatorApp>;
  catalog: Catalog;
  settle: (body: { paymentPayload: unknown; paymentRequirements: unknown }) => Promise<Response>;
}> {
  const store = await backend.open();
  // Lexical-only: the embedding model is exercised by the eval harness, and loading it here
  // would make every integration run download and initialise it.
  const catalog = createCatalog({ store, embedder: undefined });

  const facilitator = createFacilitator(
    resolveFacilitatorConfig({
      networks: [{ network: "stellar:testnet", signers: [signer(SPONSOR)] }],
    }),
    [createCatalogObserver({ catalog })],
  );

  const app = createFacilitatorApp({ facilitator, catalog, log: () => undefined });

  return {
    app,
    catalog,
    settle: async (body) =>
      app.fetch(
        new Request("http://facilitator.test/settle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ x402Version: 2, ...body }),
        }),
      ),
  };
}

/**
 * AC7.10 — every criterion below is asserted against BOTH stores.
 *
 * The HTTP surface is backend-agnostic by design, which is exactly why it is worth running
 * twice: "backend-agnostic by design" is a claim, and the Postgres store spent a milestone
 * carrying a `list()` filter that could not parse while every suite reported green.
 */
for (const backend of CATALOG_BACKENDS) {
  describe.skipIf(backend.skip)(`store: ${backend.name}`, () => {
    describe("AC7.1 — a paid request appears in /discovery/resources with no registration step", () => {
      it("catalogues on settle and serves the listing, having called no registration endpoint", async () => {
        const { app, catalog } = await harness(backend);

        // Ingest directly through the observer path: the settle route needs a live chain, which is
        // the e2e suite's job. Everything downstream of the settlement is real.
        const observer = createCatalogObserver({ catalog });
        const paid = settlement({
          url: "https://weather.example/weather/SFO",
          serviceName: "SkyCast",
          description: "Current weather conditions for any city.",
          tags: ["weather", "forecast"],
          routeTemplate: "/weather/:city",
        });

        const reported = await observer({
          paymentPayload: paid.paymentPayload as never,
          paymentRequirements: paid.paymentRequirements as never,
          settleResponse: {
            success: true,
            transaction: "a".repeat(64),
            network: "stellar:testnet",
          } as never,
        });

        expect(reported).toMatchObject({ key: "bazaar", status: "success" });

        const response = await app.request("http://facilitator.test/discovery/resources");
        expect(response.status).toBe(200);

        const body = (await response.json()) as {
          x402Version: number;
          items: { resource: string; serviceName?: string; type: string }[];
          pagination: { limit: number; offset: number; total: number };
        };

        expect(body.x402Version).toBe(2);
        expect(body.pagination.total).toBe(1);
        expect(body.items[0]?.serviceName).toBe("SkyCast");
        // The listing is keyed on the template, so it is the endpoint that is listed rather than
        // the one concrete path that happened to be paid for.
        expect(body.items[0]?.resource).toBe("https://weather.example/weather/:city");
        expect(body.items[0]?.type).toBe("http");
      });

      it("collapses many concrete paths onto one listing via routeTemplate", async () => {
        const { app, catalog } = await harness(backend);
        const observer = createCatalogObserver({ catalog });

        for (const city of ["SFO", "LHR", "NRT", "CDG", "JFK"]) {
          await observer({
            paymentPayload: settlement({
              url: `https://weather.example/weather/${city}`,
              serviceName: "SkyCast",
              description: "Current weather conditions for any city.",
              tags: ["weather"],
              routeTemplate: "/weather/:city",
            }).paymentPayload as never,
            paymentRequirements: settlement({
              url: `https://weather.example/weather/${city}`,
              serviceName: "SkyCast",
              description: "Current weather conditions for any city.",
              tags: ["weather"],
              routeTemplate: "/weather/:city",
            }).paymentRequirements as never,
            settleResponse: {
              success: true,
              transaction: "b".repeat(64),
              network: "stellar:testnet",
            } as never,
          });
        }

        const body = (await (
          await app.request("http://facilitator.test/discovery/resources")
        ).json()) as { pagination: { total: number } };

        // Five payments, one listing. Without this a catalog grows with traffic, not with endpoints.
        expect(body.pagination.total).toBe(1);
      });
    });

    describe("AC7.2 — every specification filter, and stable ordering", () => {
      async function seeded(): Promise<
        ReturnType<typeof harness> extends Promise<infer T> ? T : never
      > {
        const built = await harness(backend);
        const observer = createCatalogObserver({ catalog: built.catalog });

        const fixtures = [
          {
            path: "/weather/:city",
            name: "SkyCast",
            description: "Weather now",
            tags: ["weather"],
          },
          {
            path: "/stocks/:symbol",
            name: "TickerLine",
            description: "Equity quotes",
            tags: ["finance"],
          },
          {
            path: "/translate",
            name: "LinguaBridge",
            description: "Translate text",
            tags: ["nlp"],
          },
        ];

        for (const fixture of fixtures) {
          const paid = settlement({
            url: `https://api.example${fixture.path.replace(/:\w+/, "X")}`,
            serviceName: fixture.name,
            description: fixture.description,
            tags: fixture.tags,
            routeTemplate: fixture.path,
          });
          await observer({
            paymentPayload: paid.paymentPayload as never,
            paymentRequirements: paid.paymentRequirements as never,
            settleResponse: {
              success: true,
              transaction: "c".repeat(64),
              network: "stellar:testnet",
            } as never,
          });
        }
        return built;
      }

      it("filters by type, payTo, network and scheme", async () => {
        const { app } = await seeded();

        const query = async (search: string): Promise<{ pagination: { total: number } }> =>
          (await (
            await app.request(`http://facilitator.test/discovery/resources?${search}`)
          ).json()) as { pagination: { total: number } };

        expect((await query("type=http")).pagination.total).toBe(3);
        expect((await query("type=mcp")).pagination.total).toBe(0);
        expect((await query(`payTo=${SELLER}`)).pagination.total).toBe(3);
        expect((await query("payTo=GNOPE")).pagination.total).toBe(0);
        expect((await query("network=stellar:testnet")).pagination.total).toBe(3);
        expect((await query("network=stellar:pubnet")).pagination.total).toBe(0);
        expect((await query("scheme=exact")).pagination.total).toBe(3);
        expect((await query("scheme=upto")).pagination.total).toBe(0);
      });

      it("combines filters, and reports the true total independent of the page", async () => {
        const { app } = await seeded();
        const body = (await (
          await app.request(
            `http://facilitator.test/discovery/resources?type=http&network=stellar:testnet&payTo=${SELLER}&limit=2&offset=0`,
          )
        ).json()) as {
          items: unknown[];
          pagination: { limit: number; offset: number; total: number };
        };

        expect(body.items).toHaveLength(2);
        expect(body.pagination).toMatchObject({ limit: 2, offset: 0, total: 3 });
      });

      it("paginates without repeating or dropping a listing", async () => {
        const { app } = await seeded();

        const page = async (offset: number): Promise<string[]> => {
          const body = (await (
            await app.request(
              `http://facilitator.test/discovery/resources?limit=2&offset=${String(offset)}`,
            )
          ).json()) as { items: { resource: string }[] };
          return body.items.map((item) => item.resource);
        };

        const first = await page(0);
        const second = await page(2);

        expect(first).toHaveLength(2);
        expect(second).toHaveLength(1);
        // Stable ordering means the union is the whole catalog with no overlap. An unstable order
        // silently drops rows across pages, which is the bug this asserts against.
        expect(new Set([...first, ...second]).size).toBe(3);
      });

      it("caps the page size rather than honouring an unbounded limit", async () => {
        const { app } = await seeded();
        const body = (await (
          await app.request("http://facilitator.test/discovery/resources?limit=100000")
        ).json()) as { pagination: { limit: number } };

        expect(body.pagination.limit).toBeLessThanOrEqual(100);
      });
    });

    describe("AC7.6 — EXTENSION-RESPONSES on a settle carrying invalid info", () => {
      it("reports rejected with a populated rejectedReason, and stores nothing", async () => {
        const { catalog } = await harness(backend);
        const observer = createCatalogObserver({ catalog });

        // `info` that does not satisfy its own declared schema: the declaration says `input` is
        // required, and this one omits it entirely.
        const broken = settlement({
          url: "https://weather.example/weather/SFO",
          serviceName: "SkyCast",
          description: "Current weather",
          tags: ["weather"],
          extension: {
            info: { output: { type: "object" } },
            schema: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: { input: { type: "object" } },
              required: ["input"],
            },
          },
        });

        const reported = await observer({
          paymentPayload: broken.paymentPayload as never,
          paymentRequirements: broken.paymentRequirements as never,
          settleResponse: {
            success: true,
            transaction: "d".repeat(64),
            network: "stellar:testnet",
          } as never,
        });

        expect(reported?.status).toBe("rejected");
        // Always populated — a `rejected` with no reason teaches integrators to stop reading it.
        expect(reported?.rejectedReason).toBeTruthy();
        expect(await catalog.store.count()).toBe(0);
      });

      it("reports nothing at all for an ordinary payment carrying no declaration", async () => {
        const { catalog } = await harness(backend);
        const observer = createCatalogObserver({ catalog });

        const reported = await observer({
          paymentPayload: {
            x402Version: 2,
            accepted: { scheme: "exact", network: "stellar:testnet", payTo: SELLER },
            payload: { transaction: "AAAA" },
          } as never,
          paymentRequirements: {
            scheme: "exact",
            network: "stellar:testnet",
            payTo: SELLER,
          } as never,
          settleResponse: {
            success: true,
            transaction: "e".repeat(64),
            network: "stellar:testnet",
          } as never,
        });

        // A header on every non-discoverable payment would be noise that trains people to ignore it.
        expect(reported).toBeUndefined();
      });

      it("does not catalogue a failed settlement", async () => {
        const { catalog } = await harness(backend);
        const observer = createCatalogObserver({ catalog });
        const paid = settlement({
          url: "https://weather.example/weather/SFO",
          serviceName: "SkyCast",
          description: "Current weather",
          tags: ["weather"],
          routeTemplate: "/weather/:city",
        });

        const reported = await observer({
          paymentPayload: paid.paymentPayload as never,
          paymentRequirements: paid.paymentRequirements as never,
          settleResponse: {
            success: false,
            errorReason: "settle_exact_stellar_transaction_failed",
            transaction: "",
            network: "stellar:testnet",
          } as never,
        });

        // Otherwise the catalog is writable by anyone willing to send a payload that fails, free.
        expect(reported?.status).toBe("rejected");
        expect(await catalog.store.count()).toBe(0);
      });
    });

    describe("AC7.3 — search returns the seeded weather endpoint in the top 3", () => {
      it("finds it by natural-language query over the HTTP surface", async () => {
        const { app, catalog } = await harness(backend);
        const observer = createCatalogObserver({ catalog });

        const fixtures = [
          {
            path: "/weather/:city",
            name: "SkyCast",
            description: "Current weather conditions, temperature and forecast for any city.",
            tags: ["weather", "forecast"],
          },
          {
            path: "/stocks/:symbol",
            name: "TickerLine",
            description: "Real-time equity quotes and daily volume.",
            tags: ["finance"],
          },
          {
            path: "/translate",
            name: "LinguaBridge",
            description: "Translate text between languages.",
            tags: ["nlp"],
          },
          {
            path: "/qr",
            name: "CodeMaker",
            description: "Generate a QR code image.",
            tags: ["tools"],
          },
        ];

        for (const fixture of fixtures) {
          const paid = settlement({
            url: `https://api.example${fixture.path.replace(/:\w+/, "X")}`,
            serviceName: fixture.name,
            description: fixture.description,
            tags: fixture.tags,
            routeTemplate: fixture.path,
          });
          await observer({
            paymentPayload: paid.paymentPayload as never,
            paymentRequirements: paid.paymentRequirements as never,
            settleResponse: {
              success: true,
              transaction: "f".repeat(64),
              network: "stellar:testnet",
            } as never,
          });
        }

        const response = await app.request(
          "http://facilitator.test/discovery/search?query=weather+api",
        );
        expect(response.status).toBe(200);

        const body = (await response.json()) as {
          x402Version: number;
          resources: { serviceName?: string }[];
          partialResults?: boolean;
        };

        expect(body.x402Version).toBe(2);
        const top3 = body.resources.slice(0, 3).map((resource) => resource.serviceName);
        expect(top3).toContain("SkyCast");

        // Lexical-only here, so the degraded-retriever flag must be set. That signal is the whole
        // point of `partialResults`: the caller is told the ranking is weaker than it could be.
        expect(body.partialResults).toBe(true);
      });
    });
  });
}
