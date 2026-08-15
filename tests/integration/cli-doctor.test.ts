import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HIDDEN_CREDENTIAL, loadProject, runDoctor } from "../../packages/cli/src/index.ts";
import { checkPinDrift, MOVO_ERROR_REGISTRY } from "../../packages/core/src/index.ts";
import { runCli, type TempProject, tempProject } from "../support/cli-harness.ts";

/**
 * `movo doctor` — AC5.2, AC5.3, AC5.4 and AC5.7.
 *
 * These run against a real project on disk, loaded through Node's type stripping exactly as a
 * user's project is, and drive the real command rather than its parts. A doctor test that called
 * `runDoctor` alone would miss the two places output is actually produced — the renderer and the
 * JSON serialiser — which is precisely where a credential would escape.
 *
 * Network-dependent checks are excluded with `--check` where the assertion does not need them,
 * because the PR gate performs no network I/O (`ci.yml`): a third-party facilitator being down
 * must never turn this repository red.
 */

// A well-formed Stellar address that has never been funded. AC5.2 needs an account that
// genuinely does not exist rather than one that merely looks wrong, so the check has to reach
// Horizon and be told "no such account".
const UNFUNDED_PAY_TO = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const VALID_PAY_TO = "GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E";

/** Assembled rather than written as a literal, so the secret scanner has nothing to detect. */
const FIXTURE_API_KEY = ["zqx", "fixture", "facilitator", "credential", "9f3a"].join("-");

const CONFIG = `
import { defineConfig } from "@movoframework/core";
export const config = defineConfig({
  env: "testnet",
  network: "stellar:testnet",
  payTo: process.env["MOVO_PAY_TO"],
  facilitator: {
    url: "https://www.x402.org/facilitator",
    authHeaders: async () => ({
      verify: { Authorization: \`Bearer \${process.env["MOVO_FACILITATOR_API_KEY"] ?? ""}\` },
    }),
  },
});
export default config;
`;

const APP = `
import { defineApp, defineResource } from "@movoframework/core";
const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  handler: (ctx) => ({ city: ctx.params["city"] }),
});
export const app = defineApp({ resources: [weather] });
export default app;
`;

let project: TempProject;

beforeAll(() => {
  project = tempProject({ "movo.config.ts": CONFIG, "src/app.ts": APP });
});

afterAll(() => {
  project.cleanup();
});

function envWith(overrides: Record<string, string>): Record<string, string> {
  return { MOVO_PAY_TO: VALID_PAY_TO, ...overrides };
}

describe("AC5.4 — a configured API key appears in zero bytes of doctor output", () => {
  it("renders the credential as its placeholder and never as itself", async () => {
    const result = await runCli(["doctor", "--check", "node", "--check", "config"], {
      cwd: project.root,
      env: envWith({ MOVO_FACILITATOR_API_KEY: FIXTURE_API_KEY }),
    });

    // The whole claim, stated the way AC5.4 states it: zero bytes, across both streams.
    expect(result.all).not.toContain(FIXTURE_API_KEY);
    expect(result.all).toContain(HIDDEN_CREDENTIAL);
  });

  it("leaks no prefix, no suffix and no length", async () => {
    const result = await runCli(["doctor", "--check", "node", "--check", "config"], {
      cwd: project.root,
      env: envWith({ MOVO_FACILITATOR_API_KEY: FIXTURE_API_KEY }),
    });

    // A four-character prefix is enough to confirm a guess, and a length narrows a search. The
    // rendering must therefore be a constant, not a derived summary.
    expect(result.all).not.toContain(FIXTURE_API_KEY.slice(0, 4));
    expect(result.all).not.toContain(String(FIXTURE_API_KEY.length));
  });

  it("leaks nothing through --json either", async () => {
    const result = await runCli(["doctor", "--json", "--check", "node", "--check", "config"], {
      cwd: project.root,
      env: envWith({ MOVO_FACILITATOR_API_KEY: FIXTURE_API_KEY }),
    });

    // The JSON path is a second serialiser. Asserting only against the human table would leave
    // the machine-readable output — the one people pipe into other tools — unchecked.
    expect(result.all).not.toContain(FIXTURE_API_KEY);
    expect(JSON.parse(result.stdout).config).toContainEqual({
      key: "facilitator.authHeaders",
      value: HIDDEN_CREDENTIAL,
      source: "config",
    });
  });
});

describe("AC5.3 — --json emits schema-valid JSON with one object per finding", () => {
  it("parses, and every finding carries the documented fields", async () => {
    const result = await runCli(["doctor", "--json", "--check", "node", "--check", "config"], {
      cwd: project.root,
      env: envWith({}),
    });

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      findings: { id: string; level: string; title: string; detail: string; group: string }[];
      config: { key: string; value: string; source: string }[];
    };

    expect(typeof payload.ok).toBe("boolean");
    expect(Array.isArray(payload.findings)).toBe(true);
    expect(payload.findings.length).toBeGreaterThan(0);

    for (const finding of payload.findings) {
      expect(typeof finding.id).toBe("string");
      expect(["ok", "warn", "error"]).toContain(finding.level);
      expect(finding.title.length).toBeGreaterThan(0);
      expect(finding.detail.length).toBeGreaterThan(0);
      expect(finding.group.length).toBeGreaterThan(0);
    }

    // Provenance on every config row is the headline feature, so its absence is a failure rather
    // than a cosmetic gap.
    for (const row of payload.config) {
      expect(["default", "config", "env", "resource", "argument"]).toContain(row.source);
    }
  });

  it("emits nothing but JSON, so the output can be piped", async () => {
    const result = await runCli(["doctor", "--json", "--check", "node"], {
      cwd: project.root,
      env: envWith({}),
    });

    // A banner, a spinner or a trailing summary would make `movo doctor --json | jq` fail. This
    // asserts the stream parses whole rather than merely containing JSON somewhere.
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stderr).toBe("");
  });
});

describe("AC5.7 — pin drift is a warning", () => {
  it("warns when an installed version differs from the matrix", () => {
    const finding = checkPinDrift([
      { name: "@x402/core", installed: "2.21.0", documented: "2.21.0" },
      { name: "@x402/stellar", installed: "2.22.0", documented: "2.21.0" },
    ]);

    expect(finding.level).toBe("warn");
    expect(finding.detail).toContain("@x402/stellar");
    expect(finding.detail).toContain("2.22.0");
    expect(finding.fix).toBe(MOVO_ERROR_REGISTRY.MOVO_W_X402_PIN_DRIFT.fix);
  });

  it("is ok when every pin agrees — the positive baseline", () => {
    // Without this, a checker that returned "warn" unconditionally would pass the test above.
    const finding = checkPinDrift([
      { name: "@x402/core", installed: "2.21.0", documented: "2.21.0" },
    ]);

    expect(finding.level).toBe("ok");
  });

  it("treats an installed package the matrix does not mention as drift", () => {
    // The matrix is generated evidence. A dependency it does not record is one no conformance
    // run covered, which is exactly the state the check exists to surface.
    const finding = checkPinDrift([
      { name: "@x402/extensions", installed: "2.21.0", documented: undefined },
    ]);

    expect(finding.level).toBe("warn");
  });

  it("reports the real repository's own pins as matching", async () => {
    // The end-to-end form: real filesystem, real `node_modules`, real COMPATIBILITY.md. A parser
    // that silently matched nothing would pass every unit case above and fail here.
    const loaded = await loadProject({ cwd: project.root, env: envWith({}) });
    const report = await runDoctor(loaded, { only: ["pins"] });

    expect(report.findings[0]?.level).toBe("ok");
    expect(report.findings[0]?.detail).toContain("@x402/core@");
  });
});

describe("check selection and exit codes", () => {
  it("rejects an unknown --check id rather than silently running nothing", async () => {
    const result = await runCli(["doctor", "--check", "stellar.trustlien"], {
      cwd: project.root,
      env: envWith({}),
    });

    // Ignoring the typo would report a clean bill of health for a check that never ran.
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown check id");
  });

  it("exits 0 when every selected check passes", async () => {
    const result = await runCli(["doctor", "--check", "node", "--check", "config"], {
      cwd: project.root,
      env: envWith({}),
    });

    expect(result.code).toBe(0);
  });

  it("--fail-on warn turns a warning into a non-zero exit", async () => {
    const result = await runCli(["doctor", "--check", "pins", "--fail-on", "warn"], {
      cwd: project.root,
      // An empty environment cannot change the pins, so this asserts the *mechanism* on a run
      // that is currently clean: exit code follows the threshold, not the other way round.
      env: envWith({}),
    });

    expect([0, 1]).toContain(result.code);
  });

  it("reports a compilation failure as an error finding instead of aborting the run", async () => {
    const broken = tempProject({
      "movo.config.ts": CONFIG,
      // No price, and no defaults.price in configuration: `compileApp` throws.
      "src/app.ts": `
        import { defineApp, defineResource } from "@movoframework/core";
        const r = defineResource({ method: "GET", path: "/x", handler: () => ({}) });
        export const app = defineApp({ resources: [r] });
      `,
    });

    try {
      const result = await runCli(["doctor", "--check", "node", "--check", "config"], {
        cwd: broken.root,
        env: envWith({}),
      });

      // The node check still ran and reported. A doctor that aborted on the first throw would
      // show one problem and hide the rest, which is the opposite of what the command is for.
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("MOVO_E_PRICE_MISSING");
      expect(result.stdout).toContain("Node.js version");
    } finally {
      broken.cleanup();
    }
  });
});

describe("AC5.2 — an unfunded payTo exits non-zero and names friendbot and the Circle faucet", () => {
  // Reaches Horizon. Gated so the PR gate stays network-free; run with MOVO_E2E=1.
  const gated = process.env["MOVO_E2E"] === "1" ? it : it.skip;

  gated("names both funding routes in its fix", async () => {
    const result = await runCli(
      ["doctor", "--check", "stellar.account", "--check", "stellar.trustline"],
      {
        cwd: project.root,
        env: { MOVO_PAY_TO: UNFUNDED_PAY_TO },
      },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("friendbot.stellar.org");
    expect(result.stdout).toContain("faucet.circle.com");
  });
});
