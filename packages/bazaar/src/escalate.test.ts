import { compileApp, defineApp, defineResource, MOVO_ERROR_CODES } from "@movoframework/core";
import { describe, expect, it } from "vitest";
import { validateDiscoveryStrict } from "./escalate.js";

/**
 * Severity escalation — D3's second contribution.
 *
 * Every assertion here is that a finding **appears** for input upstream would silently drop.
 * That is deliberate: the discarded WIP's validator called upstream inside a `try/catch`,
 * discarded the return value, and would have produced zero findings for every input in this
 * file while looking like it delegated (amendment 007 §1). Asserting "the function ran" would
 * have passed for that code too.
 */

const PAY_TO = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";

function compileWith(overrides: {
  serviceName?: string;
  tags?: readonly string[];
  iconUrl?: string;
  path?: string;
}): ReturnType<typeof compileApp> {
  const resource = defineResource({
    method: "GET",
    path: overrides.path ?? "/weather/:city",
    price: "$0.001",
    discovery: {},
    ...(overrides.serviceName === undefined ? {} : { serviceName: overrides.serviceName }),
    ...(overrides.tags === undefined ? {} : { tags: overrides.tags }),
    ...(overrides.iconUrl === undefined ? {} : { iconUrl: overrides.iconUrl }),
    handler: () => ({ ok: true }),
  });

  return compileApp(defineApp({ resources: [resource] }), {
    config: { payTo: PAY_TO, discovery: { enabled: true } },
    env: {},
  });
}

describe("the ordinary case", () => {
  it("reports nothing for a resource whose metadata upstream accepts", () => {
    // The positive baseline. A suite that only checked failures would pass while escalation
    // flagged everything, which is just as useless as flagging nothing.
    const compiled = compileWith({
      serviceName: "Example Weather",
      tags: ["weather", "forecast"],
      iconUrl: "https://example.com/icon.png",
    });

    expect(validateDiscoveryStrict(compiled)).toEqual([]);
  });

  it("reports nothing for a resource that declares no discovery", () => {
    const resource = defineResource({
      method: "GET",
      path: "/private",
      price: "$0.001",
      serviceName: "x".repeat(64),
      handler: () => ({ ok: true }),
    });
    const compiled = compileApp(defineApp({ resources: [resource] }), {
      config: { payTo: PAY_TO },
      env: {},
    });

    // No discovery declared, so nothing is going in a catalog and nothing is escalated —
    // even though the serviceName would be rejected if it were.
    expect(validateDiscoveryStrict(compiled)).toEqual([]);
  });
});

describe("serviceName escalation", () => {
  it("raises an error-level finding for a name upstream would drop", () => {
    const findings = validateDiscoveryStrict(compileWith({ serviceName: "x".repeat(33) }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe("error");
    expect(findings[0]?.id).toBe("bazaar.service-name");
    expect(findings[0]?.title).toContain("GET /weather/:city");
  });

  it("raises one for a non-ASCII name, without Movo owning the character rule", () => {
    const findings = validateDiscoveryStrict(compileWith({ serviceName: "Café Weather" }));

    expect(findings.map((finding) => finding.id)).toEqual(["bazaar.service-name"]);
  });
});

describe("tag escalation", () => {
  it("raises a finding when upstream would truncate the list", () => {
    const findings = validateDiscoveryStrict(compileWith({ tags: ["a", "b", "c", "d", "e", "f"] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("bazaar.tags");
    expect(findings[0]?.title).toContain("1 of 6");
  });

  it("names which tags would be lost", () => {
    const findings = validateDiscoveryStrict(compileWith({ tags: ["weather", "café"] }));

    expect(findings[0]?.detail).toContain("café");
    expect(findings[0]?.detail).toContain("weather");
  });
});

describe("iconUrl escalation", () => {
  it.each([
    ["http://127.0.0.1/icon.png", "loopback"],
    ["http://localhost/icon.png", "localhost"],
    ["https://192.168.1.5/icon.png", "private range"],
  ])("raises a finding for %s (%s)", (iconUrl) => {
    const findings = validateDiscoveryStrict(compileWith({ iconUrl }));

    expect(findings.map((finding) => finding.id)).toEqual(["bazaar.icon-url"]);
    expect(findings[0]?.level).toBe("error");
    expect(findings[0]?.detail).toContain("SSRF");
  });
});

describe("route template escalation", () => {
  it("raises a finding for a path upstream rejects as a catalog key", () => {
    // M1 already rejects wildcards at defineResource, so the reachable case here is a path that
    // is structurally legal for Express but not for a catalog key.
    const findings = validateDiscoveryStrict(compileWith({ path: "/weather/%2e%2e%2f" }));

    expect(findings.map((finding) => finding.id)).toContain("bazaar.route-template");
  });
});

describe("codes and registry", () => {
  it("uses only codes from the MOVO_E_* registry, never a BAZAAR_E_* namespace", () => {
    // The discarded WIP invented its own code namespace outside M1's registry, which meant no
    // docs page and no entry in the generated error reference.
    const findings = validateDiscoveryStrict(
      compileWith({
        serviceName: "x".repeat(33),
        tags: ["a", "b", "c", "d", "e", "f"],
        iconUrl: "http://127.0.0.1/icon.png",
      }),
    );

    expect(findings.length).toBeGreaterThanOrEqual(3);

    for (const finding of findings) {
      expect(finding.docs).toBeDefined();
      const code = (finding.docs ?? "").split("/").pop() ?? "";
      expect(MOVO_ERROR_CODES as readonly string[]).toContain(code);
      expect(code.startsWith("MOVO_")).toBe(true);
    }
  });

  it("gives every finding an actionable fix", () => {
    const findings = validateDiscoveryStrict(compileWith({ iconUrl: "http://127.0.0.1/i.png" }));

    expect(findings[0]?.fix).toBeDefined();
    expect((findings[0]?.fix ?? "").length).toBeGreaterThan(40);
  });
});

describe("declaration consistency (post-enrichment shape)", () => {
  it("catches a required input field with no matching discovery.example", async () => {
    // The real case this check exists for, and one upstream only reports at request time as a
    // logged warning. A schema demanding `city` with no example supplying it produces a listing
    // whose own example would not satisfy it — so an agent copying the example gets a 400.
    const { deriveDiscovery } = await import("./derive.js");
    const { z } = await import("zod/v4");

    const resource = defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      input: z.object({ city: z.string().describe("City name") }),
      discovery: {}, // no example
      handler: () => ({ ok: true }),
    });

    const compiled = compileApp(defineApp({ resources: [resource] }), {
      config: { payTo: PAY_TO, discovery: { enabled: true } },
      env: {},
    });

    const { extension } = await deriveDiscovery(
      resource,
      compiled.resolvedConfig,
      "GET /weather/:city",
    );
    const route = (compiled.routes as Record<string, { extensions?: Record<string, unknown> }>)[
      "GET /weather/:city"
    ];
    if (route !== undefined && extension !== undefined) route.extensions = extension;

    const findings = validateDiscoveryStrict(compiled);

    expect(findings.map((finding) => finding.id)).toContain("bazaar.extension-consistency");
    expect(findings.find((f) => f.id === "bazaar.extension-consistency")?.detail).toContain("city");
  });

  it("passes once an example is supplied", async () => {
    const { deriveDiscovery } = await import("./derive.js");
    const { z } = await import("zod/v4");

    const resource = defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      input: z.object({ city: z.string().describe("City name") }),
      discovery: { example: { city: "SFO" } },
      handler: () => ({ ok: true }),
    });

    const compiled = compileApp(defineApp({ resources: [resource] }), {
      config: { payTo: PAY_TO, discovery: { enabled: true } },
      env: {},
    });

    const { extension } = await deriveDiscovery(
      resource,
      compiled.resolvedConfig,
      "GET /weather/:city",
    );
    const route = (compiled.routes as Record<string, { extensions?: Record<string, unknown> }>)[
      "GET /weather/:city"
    ];
    if (route !== undefined && extension !== undefined) route.extensions = extension;

    expect(validateDiscoveryStrict(compiled)).toEqual([]);
  });
});
