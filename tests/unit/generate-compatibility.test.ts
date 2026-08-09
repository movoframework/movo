import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectX402Packages,
  renderCompatibility,
  type SupportedPayload,
} from "../../scripts/generate-compatibility.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const FIXTURE_MODULES = join(REPO_ROOT, "tests", "fixtures", "compat", "modules");

/**
 * A mocked /supported payload shaped like the live one, trimmed to the kinds that matter to
 * Movo plus one non-Stellar kind so the summariser is exercised on a mixed response.
 */
const MOCK_SUPPORTED: SupportedPayload = {
  kinds: [
    { x402Version: 2, scheme: "exact", network: "eip155:84532" },
    {
      x402Version: 2,
      scheme: "exact",
      network: "stellar:testnet",
      extra: { areFeesSponsored: true },
    },
    { x402Version: 2, scheme: "upto", network: "eip155:84532" },
  ],
};

function render(supported: SupportedPayload = MOCK_SUPPORTED): string {
  return renderCompatibility({
    moduleRoots: [FIXTURE_MODULES],
    facilitatorUrl: "https://facilitator.example.test",
    supported,
    toolchain: { node: "v24.14.0", typescript: "7.0.2", pnpm: "10.23.0" },
    generatedAt: "2026-08-09T00:00:00.000Z",
  });
}

describe("installed package discovery", () => {
  it("reads @x402/* versions from a module root", () => {
    const packages = collectX402Packages([FIXTURE_MODULES]);
    expect(packages.map((entry) => entry.name)).toEqual([
      "@x402/core",
      "@x402/express",
      "@x402/stellar",
    ]);
    expect(packages[0]?.versions).toEqual(["2.21.0"]);
  });

  it("returns nothing for a root with no @x402 scope rather than throwing", () => {
    expect(collectX402Packages([join(REPO_ROOT, "does-not-exist")])).toEqual([]);
  });
});

describe("compatibility matrix rendering", () => {
  it("marks the file as generated", () => {
    expect(render()).toContain("GENERATED FILE — DO NOT EDIT BY HAND");
  });

  it("records the exact installed @x402/core version", () => {
    expect(render()).toContain("| `@x402/core` | `2.21.0` |");
  });

  it("records the facilitator URL, protocol version and generation timestamp", () => {
    const markdown = render();
    expect(markdown).toContain("https://facilitator.example.test");
    expect(markdown).toContain("| Advertised x402 protocol version | `2` |");
    expect(markdown).toContain("2026-08-09T00:00:00.000Z");
  });

  it("lists supported networks and schemes", () => {
    const markdown = render();
    expect(markdown).toContain("- `stellar:testnet`");
    expect(markdown).toContain("- `exact`");
    expect(markdown).toContain("- `upto`");
  });

  it("surfaces the Stellar extra flags, including areFeesSponsored", () => {
    const markdown = render();
    expect(markdown).toContain("areFeesSponsored");
    expect(markdown).toContain("exact @ stellar:testnet · areFeesSponsored");
  });

  it("records the toolchain versions", () => {
    const markdown = render();
    expect(markdown).toContain("| TypeScript | `7.0.2` |");
    expect(markdown).toContain("| pnpm | `10.23.0` |");
    expect(markdown).toContain("| Node.js (generating host) | `v24.14.0` |");
  });

  it("embeds the raw payload verbatim so upstream shape drift shows up in the diff", () => {
    expect(render()).toContain(JSON.stringify(MOCK_SUPPORTED, null, 2));
  });

  it("says so plainly when a facilitator advertises no Stellar network", () => {
    const markdown = render({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:1" }] });
    expect(markdown).toContain("advertises no Stellar network");
  });
});
