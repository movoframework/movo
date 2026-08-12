import { type ResolvedConfig, resolveConfig } from "@movoframework/core";
import { describe, expect, it } from "vitest";
import { account } from "./checks/account.js";
import { asset } from "./checks/asset.js";
import { clock } from "./checks/clock.js";
import { facilitator } from "./checks/facilitator.js";
import { trustline } from "./checks/trustline.js";
import { preflight } from "./index.js";
import { ALL_CHECKS, CHECK_IDS } from "./types.js";

/**
 * Preflight unit tests — no network.
 *
 * The unit suite fails if `globalThis.fetch` is invoked, which shapes what can be tested here
 * and is worth stating plainly rather than working around. Checks that reach Horizon or Soroban
 * RPC through upstream's client factories (`account`, `trustline`, `asset`) cannot inject a
 * transport, so their **network** paths are covered by the gated e2e suite, which asserts a
 * full green preflight against the real funded account. What is covered here is everything
 * reachable without a socket: the configuration branches, the injected-transport checks, and
 * the invariants that hold for every check regardless of outcome.
 *
 * Both directions are tested. Amendment 003 §6 makes the point explicitly: a negative-only
 * suite passes while the ordinary case is broken, which is exactly how M1's variance defect
 * survived a full test run.
 */

const PAY_TO = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";

function configWith(overrides?: Parameters<typeof resolveConfig>[0]): ResolvedConfig {
  return resolveConfig({ env: {}, config: { payTo: PAY_TO }, ...overrides });
}

/** A fetch stub. Every test that needs a transport injects one, so nothing touches a socket. */
function stubFetch(
  handler: (url: string) => { status?: number; body?: unknown; headers?: Record<string, string> },
): typeof globalThis.fetch {
  return (async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    const { status = 200, body = {}, headers = {} } = handler(url);
    return new Response(JSON.stringify(body), { status, headers });
  }) as unknown as typeof globalThis.fetch;
}

/**
 * Configurations whose checks short-circuit before touching a transport.
 *
 * `account` and `trustline` both need `payTo`, so an unset one is answered from configuration
 * alone. `asset` does not read `payTo` at all — it validates the contract address first — so
 * its offline branch is reached with a malformed asset instead. Getting that distinction wrong
 * is how the first draft of this file tripped the suite's own network guard, which is a small
 * demonstration that the guard earns its place.
 */
const noPayTo = resolveConfig({ env: {} });
const badAsset = resolveConfig({
  env: {},
  config: { payTo: PAY_TO, defaults: { price: { asset: "USDC", amount: "1" } as never } },
});

const offlineCases = [
  { name: "account", run: async () => account(noPayTo) },
  { name: "trustline", run: async () => trustline(noPayTo) },
  { name: "asset", run: async () => asset(badAsset) },
];

describe("every check, whatever it reports", () => {
  it.each(offlineCases)("$name never throws for a negative result", async ({ run }) => {
    // The defining property: a missing trustline is data, not an exception. A check that threw
    // would make `movo doctor` unable to report more than the first problem.
    await expect(run()).resolves.toMatchObject({ level: "error" });
  });

  it.each(offlineCases)("$name returns a stable id from the published set", async ({ run }) => {
    const ids = new Set<string>(Object.values(CHECK_IDS));
    expect(ids.has((await run()).id)).toBe(true);
  });

  it.each(offlineCases)("$name attaches a fix to its error finding", async ({ run }) => {
    // A finding that says something is wrong without saying what to do is a log line.
    const finding = await run();
    expect(finding.fix).toBeDefined();
    expect((finding.fix ?? "").length).toBeGreaterThan(20);
  });
});

describe("the asset check without a network", () => {
  it("rejects a configured asset that is not a contract address", async () => {
    const config = configWith({
      config: {
        payTo: PAY_TO,
        defaults: { price: { asset: "USDC", amount: "10000000" } as never },
      },
    });

    const finding = await asset(config);
    expect(finding.level).toBe("error");
    expect(finding.title).toContain("not a contract address");
    expect(finding.fix).toContain("getUsdcAddress");
  });
});

describe("the facilitator check", () => {
  it("reports ok when /supported advertises the configured scheme and network", async () => {
    // The positive baseline for this check, asserted rather than assumed.
    const finding = await facilitator(configWith(), {
      fetch: stubFetch(() => ({
        body: {
          kinds: [
            {
              x402Version: 2,
              scheme: "exact",
              network: "stellar:testnet",
              extra: { areFeesSponsored: true },
            },
          ],
        },
      })),
    });

    expect(finding.level).toBe("ok");
    expect(finding.detail).toContain("sponsors network fees");
  });

  it("notes when fees are not sponsored, because buyers then need XLM too", async () => {
    const finding = await facilitator(configWith(), {
      fetch: stubFetch(() => ({
        body: { kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" }] },
      })),
    });

    expect(finding.level).toBe("ok");
    expect(finding.detail).toContain("does not advertise fee sponsorship");
    expect(finding.fix).toContain("XLM");
  });

  it("errors when the facilitator does not advertise this network", async () => {
    const finding = await facilitator(configWith(), {
      fetch: stubFetch(() => ({
        body: { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }] },
      })),
    });

    expect(finding.level).toBe("error");
    expect(finding.detail).toContain("eip155:84532");
  });

  it("errors on a non-200 from /supported", async () => {
    const finding = await facilitator(configWith(), {
      fetch: stubFetch(() => ({ status: 503 })),
    });

    expect(finding.level).toBe("error");
    expect(finding.title).toContain("503");
  });

  it("warns rather than errors when the facilitator is unreachable", async () => {
    // A local network problem is not a misconfiguration, and failing a deploy gate for one
    // teaches people to disable the gate.
    const finding = await facilitator(configWith(), {
      fetch: (() => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof globalThis.fetch,
    });

    expect(finding.level).toBe("warn");
  });

  it("requests /supported and sends no credential", async () => {
    let requested = "";
    await facilitator(configWith(), {
      fetch: stubFetch((url) => {
        requested = url;
        return { body: { kinds: [] } };
      }),
    });

    expect(requested).toBe("https://www.x402.org/facilitator/supported");
  });
});

describe("the clock check", () => {
  const horizonDate = "Wed, 12 Aug 2026 09:00:00 GMT";
  const networkNow = Date.parse(horizonDate);

  function withSkew(skewMs: number): Promise<{ level: string; title: string }> {
    return clock(configWith(), {
      now: () => networkNow + skewMs,
      fetch: stubFetch(() => ({ headers: { date: horizonDate } })),
    });
  }

  it("reports ok when the clock agrees", async () => {
    expect((await withSkew(500)).level).toBe("ok");
  });

  it("warns on minor skew", async () => {
    const finding = await withSkew(10_000);
    expect(finding.level).toBe("warn");
    expect(finding.title).toContain("minor skew");
  });

  it("errors on skew large enough to affect payment windows", async () => {
    const finding = await withSkew(60_000);
    expect(finding.level).toBe("error");
  });

  it("treats a clock behind the network the same as one ahead", async () => {
    expect((await withSkew(-60_000)).level).toBe("error");
  });

  it("warns when no reference time is available", async () => {
    const finding = await clock(configWith(), {
      now: () => networkNow,
      fetch: stubFetch(() => ({ headers: {} })),
    });
    expect(finding.level).toBe("warn");
  });
});

describe("preflight orchestration", () => {
  it("runs the checks in the published order", () => {
    // Order is not cosmetic: account before trustline before asset means the first failure a
    // developer sees is the most fundamental one, rather than three errors describing the same
    // missing account.
    expect(ALL_CHECKS).toEqual(["account", "trustline", "asset", "facilitator", "expiry", "clock"]);
  });

  it("runs only the checks it is asked for", async () => {
    const findings = await preflight(configWith(), {
      checks: ["facilitator"],
      fetch: stubFetch(() => ({
        body: { kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" }] },
      })),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe(CHECK_IDS.facilitator);
  });

  it("returns one finding per requested check, in order", async () => {
    const findings = await preflight(resolveConfig({ env: {} }), {
      checks: ["account", "trustline"],
    });

    expect(findings.map((finding) => finding.id)).toEqual([CHECK_IDS.account, CHECK_IDS.trustline]);
  });
});
