import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFacilitatorAllowed,
  createDevFacilitator,
  DOCTOR_CHECK_IDS,
  loadProject,
  plainStyler,
  renderBanner,
} from "../../packages/cli/src/index.ts";
import { ALL_CHECKS, CHECK_IDS } from "../../packages/stellar/src/index.ts";
import { runCli, type TempProject, tempProject } from "../support/cli-harness.ts";

/**
 * `movo dev` and `movo bazaar validate` — AC5.5, AC5.6, and the in-process pubnet refusal.
 *
 * The dev banner is asserted as text rather than by starting a server: a snapshot that needed a
 * free port would fail for reasons unrelated to verbosity, which is the one thing the snapshot
 * exists to catch.
 */

const PAY_TO = "GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E";

const CONFIG = `
import { defineConfig } from "@movoframework/core";
export const config = defineConfig({
  env: "testnet",
  network: "stellar:testnet",
  payTo: "${PAY_TO}",
  discovery: {
    enabled: true,
    serviceName: "Example Weather",
    tags: ["weather"],
    iconUrl: process.env["ICON_URL"] ?? "https://example.com/icon.png",
  },
});
export default config;
`;

const APP = `
import { defineApp, defineResource } from "@movoframework/core";
import { z } from "zod/v4";
const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather conditions for a city",
  input: z.object({ city: z.string().describe("City name or IATA code") }),
  discovery: { example: { city: "SFO" } },
  handler: (ctx) => ({ city: ctx.params["city"] }),
});
const metrics = defineResource({
  method: "GET",
  path: "/internal/metrics",
  price: "$0.01",
  discovery: false,
  handler: () => ({ requests: 1 }),
});
export const app = defineApp({ resources: [weather, metrics] });
export default app;
`;

let project: TempProject;

beforeAll(() => {
  project = tempProject({ "movo.config.ts": CONFIG, "src/app.ts": APP });
});

afterAll(() => {
  project.cleanup();
});

describe("AC5.5 — the dev banner prints resources and provenance", () => {
  it("names each resource's method, path, price, network and payTo", async () => {
    const loaded = await loadProject({ cwd: project.root, env: {} });
    const banner = renderBanner(
      loaded,
      {},
      {
        cwd: project.root,
        env: {},
        style: plainStyler,
        stdout: () => {},
        stderr: () => {},
      },
    );

    expect(banner).toContain("GET /weather/:city");
    expect(banner).toContain("GET /internal/metrics");
    expect(banner).toContain("$0.001");
    expect(banner).toContain("$0.01");
    expect(banner).toContain("stellar:testnet");
    expect(banner).toContain(PAY_TO);
  });

  it("prints the provenance of every resolved value", async () => {
    const loaded = await loadProject({ cwd: project.root, env: {} });
    const banner = renderBanner(
      loaded,
      {},
      {
        cwd: project.root,
        env: {},
        style: plainStyler,
        stdout: () => {},
        stderr: () => {},
      },
    );

    // Every leaf, not a selection of them. The value of the provenance column is that it is
    // exhaustive: the layer nobody was thinking about is by definition not one you would have
    // chosen to print.
    for (const key of [
      "env",
      "network",
      "payTo",
      "facilitator.url",
      "facilitator.authHeaders",
      "facilitator.timeoutMs",
      "defaults.price",
      "defaults.maxTimeoutSeconds",
      "discovery.enabled",
      "discovery.serviceName",
      "discovery.tags",
      "discovery.iconUrl",
      "stellar.rpcUrl",
    ]) {
      expect(banner, `banner omits ${key}`).toContain(key);
    }

    expect(banner).toContain("from config");
    expect(banner).toContain("from default");
  });

  it("is a stable snapshot, so a verbosity regression shows up in review", async () => {
    const loaded = await loadProject({ cwd: project.root, env: {} });
    const banner = renderBanner(
      loaded,
      { facilitator: "mock" },
      {
        cwd: project.root,
        env: {},
        style: plainStyler,
        stdout: () => {},
        stderr: () => {},
      },
    );

    // The project root is machine-specific; everything else is fixed.
    expect(banner.replace(loaded.root, "<root>")).toMatchSnapshot();
  });
});

describe("the in-process facilitator refuses mainnet", () => {
  it("refuses at the CLI layer, before a process is spawned", () => {
    expect(() => {
      assertFacilitatorAllowed("in-process", "stellar:pubnet");
    }).toThrow(/refuses to start/);
  });

  it("refuses again in the runner, which is what actually constructs it", () => {
    // Two layers on purpose. The CLI's refusal gives a message about the flag the developer
    // typed; the runner's is the one that holds if anything ever spawns it directly.
    expect(() => createDevFacilitator("in-process", "stellar:pubnet", {})).toThrow(
      /stellar:pubnet/,
    );
  });

  it("permits every other combination — the positive baseline", () => {
    // Without this, a guard that threw unconditionally would satisfy both assertions above.
    expect(() => {
      assertFacilitatorAllowed("in-process", "stellar:testnet");
    }).not.toThrow();
    expect(() => {
      assertFacilitatorAllowed("mock", "stellar:pubnet");
    }).not.toThrow();
    expect(() => {
      assertFacilitatorAllowed("config", "stellar:pubnet");
    }).not.toThrow();
  });

  it("refuses the whole run through the real command", async () => {
    const pubnet = tempProject({
      "movo.config.ts": CONFIG.replace("stellar:testnet", "stellar:pubnet").replace(
        'env: "testnet"',
        'env: "pubnet"',
      ),
      "src/app.ts": APP,
    });

    try {
      const result = await runCli(["dev", "--facilitator", "in-process"], {
        cwd: pubnet.root,
        // MOVO_ALLOW_PUBNET is set, so the pubnet interlock passes and the refusal that fires is
        // the facilitator one — a distinct code, because telling the reader to set a variable
        // they have already set is a remedy that does not remedy anything.
        env: { MOVO_ALLOW_PUBNET: "1" },
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("MOVO_E_FACILITATOR_PUBNET_REFUSED");
      expect(result.stderr).not.toContain("MOVO_E_PUBNET_NOT_ENABLED");
    } finally {
      pubnet.cleanup();
    }
  });

  it("builds a mock facilitator without a key, and demands one for in-process", () => {
    expect(createDevFacilitator("mock", "stellar:testnet", {})).not.toBe("config");
    expect(createDevFacilitator("config", "stellar:testnet", {})).toBe("config");

    // The in-process facilitator signs and submits real transactions. Falling back to an unsigned
    // stub when the key is absent would be the plausible-fake shape: it would appear to work.
    expect(() => createDevFacilitator("in-process", "stellar:testnet", {})).toThrow(
      /STELLAR_PRIVATE_KEY/,
    );
  });
});

describe("AC5.6 — movo bazaar validate fails with a specific code on a loopback iconUrl", () => {
  /**
   * A fresh project per case, with the icon URL written in as a literal.
   *
   * Not one project driven by an environment variable: `movo.config.ts` is loaded by dynamic
   * import and the module registry caches it by URL, so the second case would silently re-use the
   * first one's evaluated config and assert against a value it never set. That is the shape of
   * a test that passes while checking nothing.
   */
  function projectWithIcon(iconUrl: string): TempProject {
    return tempProject({
      "movo.config.ts": CONFIG.replace(
        'process.env["ICON_URL"] ?? "https://example.com/icon.png"',
        JSON.stringify(iconUrl),
      ),
      "src/app.ts": APP,
    });
  }

  it("reports MOVO_E_DISCOVERY_ICON_URL_INVALID and exits non-zero", async () => {
    const loopback = projectWithIcon("http://localhost:3000/icon.png");

    try {
      const result = await runCli(["bazaar", "validate"], { cwd: loopback.root, env: {} });

      expect(result.code).toBe(1);
      expect(result.stdout).toContain("MOVO_E_DISCOVERY_ICON_URL_INVALID");
      expect(result.stdout).toContain("SSRF");
    } finally {
      loopback.cleanup();
    }
  });

  it("passes on a public https icon — the positive baseline", async () => {
    // Without this, a validator that rejected every icon would satisfy the assertion above.
    const public_ = projectWithIcon("https://example.com/icon.png");

    try {
      const result = await runCli(["bazaar", "validate"], { cwd: public_.root, env: {} });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("ok");
    } finally {
      public_.cleanup();
    }
  });

  it("emits machine-readable findings under --json", async () => {
    const literal = projectWithIcon("http://127.0.0.1/icon.png");

    try {
      const result = await runCli(["bazaar", "validate", "--json"], {
        cwd: literal.root,
        env: {},
      });

      const payload = JSON.parse(result.stdout) as {
        ok: boolean;
        findings: { id: string; level: string; docs?: string }[];
      };

      expect(payload.ok).toBe(false);
      expect(payload.findings.some((finding) => finding.id === "bazaar.icon-url")).toBe(true);
    } finally {
      literal.cleanup();
    }
  });
});

describe("the doctor check registry", () => {
  it("exposes every Stellar preflight check by its library id", () => {
    // Derived from `ALL_CHECKS` rather than listed again here, so a seventh preflight check
    // cannot be added to the library and silently stay unreachable from the CLI.
    //
    // Asserted against the dotted finding id, because that is the string `--json` reports and
    // therefore the one a reader will type back into `--check`.
    for (const id of ALL_CHECKS) {
      expect(DOCTOR_CHECK_IDS).toContain(CHECK_IDS[id]);
    }
  });

  it("covers environment, configuration and discovery as well", () => {
    expect(DOCTOR_CHECK_IDS).toContain("node");
    expect(DOCTOR_CHECK_IDS).toContain("pins");
    expect(DOCTOR_CHECK_IDS).toContain("config");
    expect(DOCTOR_CHECK_IDS).toContain("bazaar");
  });
});
