import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createStyler,
  HIDDEN_CREDENTIAL,
  parseDocumentedPins,
  plainStyler,
  renderMovoError,
  renderTable,
  renderUnknownError,
  shouldColour,
} from "../../packages/cli/src/index.ts";
import { MovoError } from "../../packages/core/src/index.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

/**
 * The tail of an ANSI SGR sequence: `[` then digits then `m`.
 *
 * Deliberately not matching the ESC byte itself. Writing `\u001B` inside a regular expression
 * literal trips Biome's control-character rule, and escaping around a linter to assert a
 * property the linter is trying to protect is the wrong trade. The bracket-digits-`m` tail is
 * unambiguous in this output: nothing else Movo prints contains it.
 */
const ANSI = /\[\d+m/;

describe("NO_COLOR and non-TTY", () => {
  it("emits colour only when the stream is a terminal", () => {
    expect(shouldColour({ env: {}, isTTY: true })).toBe(true);
    expect(shouldColour({ env: {}, isTTY: false })).toBe(false);
  });

  it("honours NO_COLOR even when it is empty", () => {
    // The specification says "present", not "truthy". Implementations that require a value are
    // the reason people end up setting this twice.
    expect(shouldColour({ env: { NO_COLOR: "" }, isTTY: true })).toBe(false);
    expect(shouldColour({ env: { NO_COLOR: "1" }, isTTY: true })).toBe(false);
  });

  it("lets NO_COLOR beat FORCE_COLOR", () => {
    // A CI system opting in must not override a user's explicit opt-out.
    expect(shouldColour({ env: { FORCE_COLOR: "1", NO_COLOR: "1" }, isTTY: false })).toBe(false);
    expect(shouldColour({ env: { FORCE_COLOR: "1" }, isTTY: false })).toBe(true);
  });

  it("treats TERM=dumb as no colour", () => {
    expect(shouldColour({ env: { TERM: "dumb" }, isTTY: true })).toBe(false);
  });

  it("produces output with no escape sequences at all when colour is off", () => {
    const style = createStyler({ env: { NO_COLOR: "1" }, isTTY: true });
    const rendered = renderMovoError(
      new MovoError("MOVO_E_PAYTO_MISSING", "no account to pay"),
      style,
    );

    expect(rendered).not.toMatch(ANSI);
  });

  it("produces output with escape sequences when colour is on", () => {
    // The positive baseline. Without it, a styler that returned its input unchanged in every
    // case would pass every assertion above.
    const style = createStyler({ env: {}, isTTY: true });
    expect(renderMovoError(new MovoError("MOVO_E_PAYTO_MISSING", "x"), style)).toMatch(ANSI);
  });
});

describe("error presentation", () => {
  it("renders code, message, context, fix and a docs link", () => {
    const rendered = renderMovoError(
      new MovoError("MOVO_E_PAYTO_MISSING", "GET /weather has no payTo", {
        context: { routeKey: "GET /weather" },
      }),
      plainStyler,
    );

    expect(rendered).toContain("MOVO_E_PAYTO_MISSING");
    expect(rendered).toContain("GET /weather has no payTo");
    expect(rendered).toContain("routeKey");
    expect(rendered).toContain("fix");
    expect(rendered).toContain("https://movoframework.github.io/movo/errors/MOVO_E_PAYTO_MISSING");
  });

  it("prints the cause chain, where the real answer usually is", () => {
    const rendered = renderMovoError(
      new MovoError("MOVO_E_APP_INVALID", "could not load app", {
        cause: new Error("Cannot find module 'zod'", { cause: new Error("ERR_MODULE_NOT_FOUND") }),
      }),
      plainStyler,
    );

    expect(rendered).toContain("caused by");
    expect(rendered).toContain("Cannot find module 'zod'");
    expect(rendered).toContain("ERR_MODULE_NOT_FOUND");
  });

  it("redacts a seed interpolated into a message, because MovoError redacts at construction", () => {
    const seed = `S${"A".repeat(55)}`;
    const rendered = renderMovoError(
      new MovoError("MOVO_E_APP_INVALID", `could not load ${seed}`, { context: { seed } }),
      plainStyler,
    );

    // The renderer performs no redaction of its own — this asserts that it does not need to,
    // which is the property that makes every other output path safe too.
    expect(rendered).not.toContain(seed);
  });

  it("gives a non-MovoError no invented code and no docs link", () => {
    const rendered = renderUnknownError(new Error("something broke"), plainStyler);

    expect(rendered).toContain("something broke");
    // A plausible-looking code would send the reader to a page that does not describe what
    // happened to them, which is worse than sending them nowhere.
    expect(rendered).not.toContain("MOVO_E_");
    expect(rendered).not.toContain("/errors/");
  });
});

describe("the table", () => {
  it("aligns columns and never truncates", () => {
    const rendered = renderTable([
      {
        label: "payTo",
        value: "GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E",
        note: "from env",
      },
      { label: "network", value: "stellar:testnet", note: "from config" },
    ]);

    // A truncated Stellar address is a value that has to be retyped from a wallet.
    expect(rendered).toContain("GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E");
    expect(rendered).not.toContain("…");

    const [first, second] = rendered.split("\n");
    expect(first?.indexOf("GCQQ")).toBe(second?.indexOf("stellar:testnet"));
  });

  it("returns an empty string for no rows rather than a header with nothing under it", () => {
    expect(renderTable([])).toBe("");
  });
});

describe("the compatibility matrix parser", () => {
  it("reads the repository's own matrix", () => {
    // Against the real file, not a fixture string. A parser that matched nothing would satisfy
    // every constructed case and silently make the pin check compare an empty set.
    const pins = parseDocumentedPins(
      readFileSync(join(REPO_ROOT, "docs", "COMPATIBILITY.md"), "utf8"),
    );

    expect(pins.size).toBeGreaterThanOrEqual(5);
    expect(pins.get("@x402/core")).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("returns nothing for markdown with no matrix, rather than a stale guess", () => {
    expect(parseDocumentedPins("# Nothing here\n").size).toBe(0);
  });
});

describe("the hidden-credential placeholder", () => {
  it("is a constant that reveals nothing about the value", () => {
    // Asserted against the exported constant rather than a copy of the string, so a renderer
    // that started printing something else cannot pass a test that has stopped describing it.
    expect(HIDDEN_CREDENTIAL).toBe("configured (hidden)");
    expect(HIDDEN_CREDENTIAL).not.toMatch(/\d/);
  });
});
