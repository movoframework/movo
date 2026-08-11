import { describe, expect, it } from "vitest";
import { MovoError } from "../errors/MovoError.js";
import { STELLAR_PUBNET_CAIP2, STELLAR_TESTNET_CAIP2 } from "../protocol/index.js";
import { defineConfig } from "./defineConfig.js";
import {
  ALLOW_PUBNET_ENV_VAR,
  configFromEnv,
  DEFAULT_FACILITATOR_TIMEOUT_MS,
  DEFAULT_FACILITATOR_URL,
  DEFAULT_MAX_TIMEOUT_SECONDS,
  type EnvRecord,
  resolveConfig,
} from "./resolve.js";

/**
 * Every test passes an explicit `env` record. Defaulting to `process.env` is right for a real
 * program and wrong for a test: a developer with `MOVO_PAY_TO` exported would otherwise see
 * different results from CI, which is the precise class of bug provenance exists to expose.
 */
const NO_ENV: EnvRecord = {};

const PAY_TO_CONFIG = "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3";
const PAY_TO_ENV = "GDIONU2OOPFE5TAVLPNITGJH6KUIEAHJOTG2SDH3D332LNJ5B6C5LCAR";
const PAY_TO_RESOURCE = "GC6CSXBV4C6RL3HEDTW57KXYXSSXKAWKGYDEOSATXM3XNKXSR2VRYN3K";
const PAY_TO_ARGUMENT = "GC5OLUZ4WANPN6VT7YGTK2SRMZG762KOVKJXHWIO4K57UBASO2FMNRET";

describe("defaults", () => {
  it("resolves a usable testnet configuration from nothing at all", () => {
    const resolved = resolveConfig({ env: NO_ENV });

    expect(resolved.env).toEqual({ value: "testnet", source: "default" });
    expect(resolved.network).toEqual({ value: STELLAR_TESTNET_CAIP2, source: "default" });
    expect(resolved.payTo).toEqual({ value: undefined, source: "default" });
    expect(resolved.facilitator.url).toEqual({
      value: DEFAULT_FACILITATOR_URL,
      source: "default",
    });
    expect(resolved.facilitator.timeoutMs.value).toBe(DEFAULT_FACILITATOR_TIMEOUT_MS);
    expect(resolved.defaults.maxTimeoutSeconds.value).toBe(DEFAULT_MAX_TIMEOUT_SECONDS);
    expect(resolved.discovery.enabled.value).toBe(true);
  });

  it("resolves with no argument at all, reading the real process environment", () => {
    // The one test that exercises the `process.env` default path, so the branch is covered
    // rather than assumed. It asserts only the shape, because the ambient environment is not
    // something a test may depend on.
    expect(resolveConfig().network.value).toMatch(/^stellar:/);
  });
});

describe("precedence and provenance (AC1.5)", () => {
  it("reports the correct source for a value set in each of the five layers", () => {
    // `payTo` is set in every layer at once. Each assertion removes the layer above it, so the
    // test proves the ordering rather than just that each layer can win in isolation.
    const layers = {
      config: { payTo: PAY_TO_CONFIG },
      env: { MOVO_PAY_TO: PAY_TO_ENV },
      resource: { payTo: PAY_TO_RESOURCE },
      argument: { payTo: PAY_TO_ARGUMENT },
    } as const;

    expect(resolveConfig({ env: NO_ENV }).payTo).toEqual({ value: undefined, source: "default" });

    expect(resolveConfig({ env: NO_ENV, config: layers.config }).payTo).toEqual({
      value: PAY_TO_CONFIG,
      source: "config",
    });

    expect(resolveConfig({ config: layers.config, env: layers.env }).payTo).toEqual({
      value: PAY_TO_ENV,
      source: "env",
    });

    expect(
      resolveConfig({ config: layers.config, env: layers.env, resource: layers.resource }).payTo,
    ).toEqual({ value: PAY_TO_RESOURCE, source: "resource" });

    expect(resolveConfig(layers).payTo).toEqual({ value: PAY_TO_ARGUMENT, source: "argument" });
  });

  it("tracks provenance independently per setting", () => {
    const resolved = resolveConfig({
      config: { payTo: PAY_TO_CONFIG, facilitator: { timeoutMs: 5_000 } },
      env: { MOVO_FACILITATOR_URL: "https://facilitator.example/" },
    });

    expect(resolved.payTo.source).toBe("config");
    expect(resolved.facilitator.timeoutMs.source).toBe("config");
    expect(resolved.facilitator.url).toEqual({
      value: "https://facilitator.example/",
      source: "env",
    });
    expect(resolved.defaults.maxTimeoutSeconds.source).toBe("default");
  });

  it("treats an absent key as silence, not as an instruction to unset a lower layer", () => {
    // A higher layer that says nothing must not erase a lower one. Otherwise precedence would
    // depend on whether a key was written as absent or as explicitly undefined — a difference
    // that is invisible when reading a config file.
    const resolved = resolveConfig({
      config: { payTo: PAY_TO_CONFIG },
      env: NO_ENV,
      argument: { network: STELLAR_TESTNET_CAIP2 },
    });
    expect(resolved.payTo).toEqual({ value: PAY_TO_CONFIG, source: "config" });
  });

  it("lets a resource override the price and the timeout it inherits", () => {
    const resolved = resolveConfig({
      config: { defaults: { price: "$0.001", maxTimeoutSeconds: 60 } },
      env: NO_ENV,
      resource: { price: "$0.05", maxTimeoutSeconds: 120 },
    });

    expect(resolved.defaults.price).toEqual({ value: "$0.05", source: "resource" });
    expect(resolved.defaults.maxTimeoutSeconds).toEqual({ value: 120, source: "resource" });
  });
});

describe("the environment layer", () => {
  it("reads exactly the MOVO_* variables it is documented to read", () => {
    const fromEnv = configFromEnv({
      MOVO_ENV: "testnet",
      MOVO_NETWORK: STELLAR_TESTNET_CAIP2,
      MOVO_PAY_TO: PAY_TO_ENV,
      MOVO_FACILITATOR_URL: "https://facilitator.example/",
      MOVO_STELLAR_RPC_URL: "https://rpc.example/",
    });

    expect(fromEnv).toEqual({
      env: "testnet",
      network: STELLAR_TESTNET_CAIP2,
      payTo: PAY_TO_ENV,
      facilitator: { url: "https://facilitator.example/" },
      stellar: { rpcUrl: "https://rpc.example/" },
    });
  });

  it("never reads the facilitator API key into configuration", () => {
    // The credential is read inside an authHeaders provider at request time, so it never lands
    // on the config object and cannot be reached by anything that walks it.
    const fromEnv = configFromEnv({ MOVO_FACILITATOR_API_KEY: "super-secret" });
    expect(JSON.stringify(fromEnv)).not.toContain("super-secret");
    expect(fromEnv).toEqual({});
  });

  it("rejects an invalid MOVO_ENV rather than silently falling back", () => {
    expect(() => resolveConfig({ env: { MOVO_ENV: "staging" } })).toThrowError(
      expect.objectContaining({ code: "MOVO_E_ENV_INVALID" }),
    );
  });
});

describe("the pubnet interlock (AC1.3)", () => {
  it("throws MOVO_E_PUBNET_NOT_ENABLED when the environment does not enable pubnet", () => {
    expect(() =>
      resolveConfig({
        config: { env: "pubnet", network: STELLAR_PUBNET_CAIP2 },
        env: NO_ENV,
      }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_PUBNET_NOT_ENABLED" }));
  });

  it("throws the pubnet error before the network mismatch error", () => {
    // A safety interlock outranks a consistency check: a developer who has not declared an
    // intent to move real money should be told that first, whatever else is also wrong.
    let caught: unknown;
    try {
      resolveConfig({ config: { env: "pubnet" }, env: NO_ENV });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MovoError);
    expect((caught as MovoError).code).toBe("MOVO_E_PUBNET_NOT_ENABLED");
  });

  it("permits pubnet when the environment enables it explicitly", () => {
    const resolved = resolveConfig({
      config: { env: "pubnet", network: STELLAR_PUBNET_CAIP2 },
      env: { [ALLOW_PUBNET_ENV_VAR]: "1" },
    });
    expect(resolved.env.value).toBe("pubnet");
    expect(resolved.network.value).toBe(STELLAR_PUBNET_CAIP2);
  });

  it("requires exactly 1, not any truthy value", () => {
    expect(() =>
      resolveConfig({
        config: { env: "pubnet", network: STELLAR_PUBNET_CAIP2 },
        env: { [ALLOW_PUBNET_ENV_VAR]: "true" },
      }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_PUBNET_NOT_ENABLED" }));
  });
});

describe("network validation", () => {
  it("rejects a network that is not a Stellar network, naming both valid identifiers", () => {
    let caught: MovoError | undefined;
    try {
      resolveConfig({ config: { network: "ethereum:1" }, env: NO_ENV });
    } catch (error) {
      caught = error as MovoError;
    }

    expect(caught?.code).toBe("MOVO_E_NETWORK_UNSUPPORTED");
    expect(caught?.message).toContain(STELLAR_TESTNET_CAIP2);
    expect(caught?.message).toContain(STELLAR_PUBNET_CAIP2);
  });

  it("rejects stellar:mainnet, which is the name people reach for and is not the identifier", () => {
    expect(() =>
      resolveConfig({ config: { network: "stellar:mainnet" }, env: NO_ENV }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_NETWORK_UNSUPPORTED" }));
  });

  it("rejects the stellar:* wildcard, which a resource server cannot be configured with", () => {
    expect(() => resolveConfig({ config: { network: "stellar:*" }, env: NO_ENV })).toThrowError(
      expect.objectContaining({ code: "MOVO_E_NETWORK_UNSUPPORTED" }),
    );
  });
});

describe("env and network agreement", () => {
  it("refuses a testnet env pointed at pubnet, and names both layers", () => {
    let caught: MovoError | undefined;
    try {
      resolveConfig({
        config: { env: "testnet" },
        env: { MOVO_NETWORK: STELLAR_PUBNET_CAIP2 },
      });
    } catch (error) {
      caught = error as MovoError;
    }

    expect(caught?.code).toBe("MOVO_E_ENV_NETWORK_MISMATCH");
    expect(caught?.context["envSource"]).toBe("config");
    expect(caught?.context["networkSource"]).toBe("env");
  });

  it("treats a local env as targeting testnet", () => {
    expect(resolveConfig({ config: { env: "local" }, env: NO_ENV }).network.value).toBe(
      STELLAR_TESTNET_CAIP2,
    );
  });

  it("never coerces one to match the other", () => {
    expect(() =>
      resolveConfig({
        config: { env: "pubnet", network: STELLAR_TESTNET_CAIP2 },
        env: { [ALLOW_PUBNET_ENV_VAR]: "1" },
      }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_ENV_NETWORK_MISMATCH" }));
  });
});

describe("payTo validation", () => {
  it("accepts a G-account address", () => {
    expect(resolveConfig({ config: { payTo: PAY_TO_CONFIG }, env: NO_ENV }).payTo.value).toBe(
      PAY_TO_CONFIG,
    );
  });

  it("rejects a malformed address", () => {
    expect(() => resolveConfig({ config: { payTo: "not-an-address" }, env: NO_ENV })).toThrowError(
      expect.objectContaining({ code: "MOVO_E_PAYTO_INVALID" }),
    );
  });

  it("rejects a truncated address rather than accepting a prefix", () => {
    expect(() =>
      resolveConfig({ config: { payTo: PAY_TO_CONFIG.slice(0, 20) }, env: NO_ENV }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_PAYTO_INVALID" }));
  });

  it("never puts the address itself in the error context", () => {
    // The address is not a secret, but the context records a length rather than the value so
    // that the habit of not echoing configuration into diagnostics holds uniformly.
    let caught: MovoError | undefined;
    try {
      resolveConfig({ config: { payTo: "GBAD" }, env: NO_ENV });
    } catch (error) {
      caught = error as MovoError;
    }
    expect(caught?.context["payToLength"]).toBe(4);
  });
});

describe("secrets in configuration (AC1.4)", () => {
  it("rejects a literal API key at defineConfig time", () => {
    expect(() =>
      defineConfig({
        // A literal where a provider function belongs — the mistake this guard exists for.
        facilitator: { authHeaders: "Bearer sk-live-abc123" as never },
      }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_SECRET_IN_CONFIG" }));
  });

  it("rejects a literal at resolution time too, whichever layer supplied it", () => {
    let caught: MovoError | undefined;
    try {
      resolveConfig({
        argument: { facilitator: { authHeaders: "Bearer sk-live-abc123" as never } },
        env: NO_ENV,
      });
    } catch (error) {
      caught = error as MovoError;
    }
    expect(caught?.code).toBe("MOVO_E_SECRET_IN_CONFIG");
    expect(caught?.context["layer"]).toBe("argument");
  });

  it("does not echo the rejected value into the error", () => {
    let caught: MovoError | undefined;
    try {
      defineConfig({ facilitator: { authHeaders: "Bearer sk-live-abc123" as never } });
    } catch (error) {
      caught = error as MovoError;
    }
    expect(JSON.stringify(caught?.toJSON())).not.toContain("sk-live-abc123");
  });

  it("accepts a provider function", () => {
    const authHeaders = async (): Promise<{ verify: Record<string, string> }> => ({
      verify: { Authorization: "Bearer read-at-call-time" },
    });
    const resolved = resolveConfig({ config: { facilitator: { authHeaders } }, env: NO_ENV });
    expect(resolved.facilitator.authHeaders).toEqual({ value: authHeaders, source: "config" });
  });
});

describe("facilitator settings", () => {
  it("rejects a facilitator URL that is not parseable", () => {
    expect(() =>
      resolveConfig({ config: { facilitator: { url: "not a url" } }, env: NO_ENV }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_FACILITATOR_URL_INVALID" }));
  });

  it("rejects a non-http scheme", () => {
    expect(() =>
      resolveConfig({
        config: { facilitator: { url: "ftp://facilitator.example/" } },
        env: NO_ENV,
      }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_FACILITATOR_URL_INVALID" }));
  });

  it("rejects a non-positive timeout", () => {
    expect(() =>
      resolveConfig({ config: { facilitator: { timeoutMs: 0 } }, env: NO_ENV }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_TIMEOUT_INVALID" }));
  });

  it("rejects a non-finite timeout", () => {
    expect(() =>
      resolveConfig({
        config: { facilitator: { timeoutMs: Number.POSITIVE_INFINITY } },
        env: NO_ENV,
      }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_TIMEOUT_INVALID" }));
  });

  it("rejects a non-positive default maxTimeoutSeconds", () => {
    expect(() =>
      resolveConfig({ config: { defaults: { maxTimeoutSeconds: -1 } }, env: NO_ENV }),
    ).toThrowError(expect.objectContaining({ code: "MOVO_E_MAX_TIMEOUT_INVALID" }));
  });
});

describe("discovery settings", () => {
  it("carries service metadata through with provenance", () => {
    const resolved = resolveConfig({
      config: {
        discovery: {
          enabled: true,
          serviceName: "Example Weather",
          tags: ["weather"],
          iconUrl: "https://example.com/i.png",
        },
      },
      env: NO_ENV,
    });

    expect(resolved.discovery.serviceName).toEqual({ value: "Example Weather", source: "config" });
    expect(resolved.discovery.tags.value).toEqual(["weather"]);
    expect(resolved.discovery.iconUrl.source).toBe("config");
  });

  it("can be disabled", () => {
    expect(
      resolveConfig({ config: { discovery: { enabled: false } }, env: NO_ENV }).discovery.enabled,
    ).toEqual({ value: false, source: "config" });
  });
});

describe("config input accepts what an author actually writes", () => {
  it("accepts an environment variable read, whose type includes undefined", () => {
    // The most ordinary line in a config file. With a bare `payTo?: string` under
    // exactOptionalPropertyTypes this does not compile, and the workarounds a reader reaches
    // for are worse than the problem: `?? ""` produces an empty address that fails validation
    // later, and `!` asserts something about the environment nobody has checked.
    const fromEnvironment: string | undefined = undefined;
    const config = defineConfig({
      payTo: fromEnvironment,
      network: undefined,
      facilitator: { url: undefined },
      defaults: { price: undefined },
    });

    // An undefined value is silence, so resolution falls through to the default.
    expect(resolveConfig({ config, env: NO_ENV }).payTo).toEqual({
      value: undefined,
      source: "default",
    });
  });

  it("still lets a lower layer win when a higher one is explicitly undefined", () => {
    const resolved = resolveConfig({
      config: { payTo: PAY_TO_CONFIG },
      env: NO_ENV,
      argument: { payTo: undefined },
    });
    expect(resolved.payTo).toEqual({ value: PAY_TO_CONFIG, source: "config" });
  });
});

describe("defineConfig", () => {
  it("returns its input unchanged", () => {
    const input = { env: "testnet", payTo: PAY_TO_CONFIG } as const;
    expect(defineConfig(input)).toBe(input);
  });

  it("performs no environment access of its own", () => {
    // A defineConfig that read the environment would make a config file mean different things
    // depending on where it was imported from, and would make static analysis unreliable.
    expect(defineConfig({ env: "pubnet" })).toEqual({ env: "pubnet" });
  });

  it("rejects an invalid env eagerly", () => {
    expect(() => defineConfig({ env: "staging" as never })).toThrowError(
      expect.objectContaining({ code: "MOVO_E_ENV_INVALID" }),
    );
  });
});
