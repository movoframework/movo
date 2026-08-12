import { describe, expect, it, vi } from "vitest";
import type { Finding } from "./diagnostics.js";
import { createHookDispatcher } from "./hooks.js";
import { compileApp } from "./resource/compile.js";
import { defineApp } from "./resource/defineApp.js";
import { defineResource } from "./resource/defineResource.js";

const PAY_TO = "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3";
const SEED = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const compiled = compileApp(
  defineApp({
    resources: [defineResource({ method: "GET", path: "/x", price: "$0.001", handler: () => 1 })],
  }),
  { config: { payTo: PAY_TO }, env: {} },
);

describe("dispatch", () => {
  it("delivers each hook the payload for its event", () => {
    const onPaymentRequired = vi.fn();
    const onVerifyFailure = vi.fn();
    const onSettled = vi.fn();
    const onSettleFailure = vi.fn();
    const onCompile = vi.fn();

    const dispatcher = createHookDispatcher({
      onCompile,
      onPaymentRequired,
      onVerifyFailure,
      onSettled,
      onSettleFailure,
    });

    dispatcher.compiled(compiled);
    dispatcher.paymentRequired({ route: "GET /x", correlationId: "c1" });
    dispatcher.verifyFailure({ route: "GET /x", correlationId: "c1", reason: "expired" });
    dispatcher.settled({ route: "GET /x", correlationId: "c1", transaction: "abc" });
    dispatcher.settleFailure({ route: "GET /x", correlationId: "c1", reason: "insufficient" });

    expect(onCompile).toHaveBeenCalledWith(compiled);
    expect(onPaymentRequired).toHaveBeenCalledWith({ route: "GET /x", correlationId: "c1" });
    expect(onVerifyFailure).toHaveBeenCalledWith({
      route: "GET /x",
      correlationId: "c1",
      reason: "expired",
    });
    expect(onSettled).toHaveBeenCalledWith({
      route: "GET /x",
      correlationId: "c1",
      transaction: "abc",
    });
    expect(onSettleFailure).toHaveBeenCalledWith({
      route: "GET /x",
      correlationId: "c1",
      reason: "insufficient",
    });
  });

  it("does nothing when no hook is installed", () => {
    const dispatcher = createHookDispatcher();
    expect(() => {
      dispatcher.compiled(compiled);
      dispatcher.finding({ id: "x", level: "warn", title: "t", detail: "d" });
      dispatcher.paymentRequired({ route: "GET /x", correlationId: "c" });
      dispatcher.verifyFailure({ route: "GET /x", correlationId: "c", reason: "r" });
      dispatcher.settled({ route: "GET /x", correlationId: "c" });
      dispatcher.settleFailure({ route: "GET /x", correlationId: "c", reason: "r" });
    }).not.toThrow();
  });

  it("delivers findings to onFinding", () => {
    const onFinding = vi.fn();
    const finding: Finding = { id: "x", level: "warn", title: "t", detail: "d" };
    createHookDispatcher({ onFinding }).finding(finding);
    expect(onFinding).toHaveBeenCalledWith(finding);
  });
});

describe("hooks are observers and cannot affect the request", () => {
  it("contains a throwing hook rather than propagating it", () => {
    // Observability is the least important thing happening on a payment path. A metrics call
    // that throws must not take down a settlement.
    const dispatcher = createHookDispatcher({
      onSettled: () => {
        throw new Error("hook exploded");
      },
    });

    expect(() => dispatcher.settled({ route: "GET /x", correlationId: "c" })).not.toThrow();
  });

  it("reports a throwing hook to onFinding rather than swallowing it silently", () => {
    const onFinding = vi.fn();
    createHookDispatcher({
      onFinding,
      onSettled: () => {
        throw new Error("hook exploded");
      },
    }).settled({ route: "GET /x", correlationId: "c" });

    expect(onFinding).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hook.threw", level: "warn" }),
    );
  });

  it("contains a throwing onFinding without recursing", () => {
    const dispatcher = createHookDispatcher({
      onFinding: () => {
        throw new Error("reporter exploded");
      },
    });
    expect(() =>
      dispatcher.finding({ id: "x", level: "warn", title: "t", detail: "d" }),
    ).not.toThrow();
  });

  it("returns nothing from any dispatch, so a hook has no channel to change an outcome", () => {
    // The dispatcher discards whatever a hook returns and itself returns nothing. There is no
    // path by which an observer could alter a payment — which is the whole distinction between
    // a Movo hook and the upstream hooks on x402ResourceServer.
    const onSettled = vi.fn();
    const dispatcher = createHookDispatcher({ onSettled });

    expect(dispatcher.settled({ route: "GET /x", correlationId: "c" })).toBeUndefined();
    expect(onSettled).toHaveBeenCalledOnce();
  });
});

describe("redaction of hook payloads (AC1.6)", () => {
  it("redacts a secret carried in a request-scoped payload", () => {
    const received: unknown[] = [];
    createHookDispatcher({
      onVerifyFailure: (context) => {
        received.push(context);
      },
    }).verifyFailure({
      route: "GET /x",
      correlationId: "c",
      reason: `signer rejected ${SEED}`,
    });

    expect(JSON.stringify(received)).not.toContain(SEED);
  });

  it("redacts a sensitive key in a finding", () => {
    const received: Finding[] = [];
    createHookDispatcher({
      onFinding: (finding) => {
        received.push(finding);
      },
    }).finding({
      id: "x",
      level: "warn",
      title: "t",
      detail: `token=${SEED}`,
    });

    expect(JSON.stringify(received)).not.toContain(SEED);
  });

  it("hands onCompile the live compiled app, which carries nothing redactable", () => {
    // The one hook not given a redacted copy, because redaction would hand a hook typed to
    // receive a CompiledApp something that is not one — the handler map would arrive as a
    // plain object. The property that makes that safe is asserted here directly.
    const received: unknown[] = [];
    createHookDispatcher({
      onCompile: (app) => {
        received.push(app);
      },
    }).compiled(compiled);

    expect(received[0]).toBe(compiled);
    expect(
      JSON.stringify(compiled, (_key, value: unknown) =>
        value instanceof Map ? [...value.keys()] : value,
      ),
    ).not.toContain(SEED);
  });
});
