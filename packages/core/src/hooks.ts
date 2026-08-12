/**
 * Movo hooks — observers, and only observers.
 *
 * A Movo hook cannot abort a request, cannot recover from a failure and cannot change a
 * result. It is told what happened, after it happened. Developers who need control flow use
 * the upstream hooks on `MountResult.server`: `onBeforeVerify` can abort, `onVerifyFailure`
 * can recover, and `onVerifiedPaymentCanceled` reports a machine-readable cancellation reason
 * (docs/SPIKE_REPORT.md Q3).
 *
 * **The split is the point.** There is exactly one implementation of payment control flow in
 * this system and it is upstream's. A Movo hook that could abort would be a second one, with
 * its own ordering semantics to keep in sync — and the ordering semantics of a payment
 * lifecycle are the last thing that should exist in two places (spec §1.8 D2, §5.9).
 *
 * Every payload passes through `redact()` before delivery. A hook is user code and may log
 * whatever it is handed, so a hook never receives a payment payload or an authorisation
 * header — not because the hook is untrusted, but because the alternative is a rule nobody can
 * enforce.
 */

import type { Finding } from "./diagnostics.js";
import { redact } from "./observability/redact.js";
import type { CompiledApp } from "./resource/compile.js";

/** Context common to every request-scoped hook. */
export interface HookContext {
  readonly route: string;
  readonly correlationId: string;
}

/** Context for a settlement outcome. */
export interface SettledContext extends HookContext {
  readonly transaction?: string;
}

/** Context for a failure with a reason from upstream or a facilitator. */
export interface FailureContext extends HookContext {
  readonly reason: string;
}

/** The observer hooks Movo offers. */
export interface MovoHooks {
  readonly onCompile?: (compiled: CompiledApp) => void;
  readonly onFinding?: (finding: Finding) => void;
  readonly onPaymentRequired?: (context: HookContext) => void;
  readonly onVerifyFailure?: (context: FailureContext) => void;
  readonly onSettled?: (context: SettledContext) => void;
  readonly onSettleFailure?: (context: FailureContext) => void;
}

/** Dispatches to hooks, redacting on the way and swallowing hook errors. */
export interface HookDispatcher {
  compiled(compiled: CompiledApp): void;
  finding(finding: Finding): void;
  paymentRequired(context: HookContext): void;
  verifyFailure(context: FailureContext): void;
  settled(context: SettledContext): void;
  settleFailure(context: FailureContext): void;
}

/**
 * Invoke a hook without letting it break the caller.
 *
 * A hook that throws must not fail a payment. Observability is the least important thing
 * happening on this code path, and a metrics call that throws taking down a settlement would
 * be an own goal. The failure is reported to `onFinding` when one is installed, so it is not
 * silently swallowed either.
 */
function safely(run: () => void, report: ((finding: Finding) => void) | undefined): void {
  try {
    run();
  } catch (error) {
    report?.({
      id: "hook.threw",
      level: "warn",
      title: "A Movo hook threw",
      detail: `A hook threw and the error was contained so it could not affect the request: ${
        error instanceof Error ? error.message : String(error)
      }`,
      fix: "Wrap the body of your hook in its own error handling. Movo hooks are observers, so a throwing hook cannot change the outcome of a request and is reported rather than propagated.",
    });
  }
}

/**
 * Build a dispatcher that redacts every payload before delivering it.
 *
 * @param hooks - The hooks to dispatch to; all optional
 * @returns A dispatcher
 */
export function createHookDispatcher(hooks?: MovoHooks): HookDispatcher {
  const report = hooks?.onFinding;

  function deliver<T>(hook: ((payload: T) => void) | undefined, payload: T): void {
    if (hook === undefined) return;
    safely(() => {
      hook(redact(payload) as T);
    }, report);
  }

  return {
    compiled: (compiled) => {
      // `onCompile` is the one hook handed the live object rather than a redacted copy, and
      // the reason is that redaction would destroy it: the handler map would arrive as a plain
      // object and every handler as the string "[function]", so a hook typed to receive a
      // `CompiledApp` would receive something that is not one. A type that lies is worse than
      // a redaction that is unnecessary — and it *is* unnecessary, because a CompiledApp holds
      // routes, handlers, provenance and findings, none of which can carry a credential.
      // `facilitator.authHeaders` is a function that reads its secret at call time from the
      // environment the hook already runs in. `hooks.test.ts` asserts the property directly: a
      // fixture seed placed in the environment appears in zero bytes of every hook payload,
      // this one included.
      const onCompile = hooks?.onCompile;
      if (onCompile === undefined) return;
      safely(() => {
        onCompile(compiled);
      }, report);
    },
    finding: (finding) => {
      if (report === undefined) return;
      safely(() => {
        report(redact(finding) as Finding);
      }, undefined);
    },
    paymentRequired: (context) => {
      deliver(hooks?.onPaymentRequired, context);
    },
    verifyFailure: (context) => {
      deliver(hooks?.onVerifyFailure, context);
    },
    settled: (context) => {
      deliver(hooks?.onSettled, context);
    },
    settleFailure: (context) => {
      deliver(hooks?.onSettleFailure, context);
    },
  };
}
