/**
 * `defineResource` — the unit of authorship in Movo.
 *
 * It returns its argument, validated. No registration, no side effect, no hidden state. That
 * is what makes a resource file something `movo doctor` can read statically, something a test
 * can construct without a server, and something serialisable enough to compare across a
 * deployment (spec §1.8 D6 and D7).
 *
 * **Structural errors throw here. Config-dependent errors do not.** A wildcard in a path is
 * wrong however the project is configured, so it is caught at definition. A missing `payTo` is
 * only wrong once you know that config does not supply one, so `compileApp` catches it — the
 * first point at which the answer is knowable (spec §5.2).
 *
 * **Type inference is a feature, not a nicety.** `TIn` flows from the `input` schema into the
 * handler's context, and `TOut` flows from the handler out to `@movoframework/client`'s
 * `call()`, giving end-to-end type safety from the handler's return statement to the buyer's
 * call site. `NoInfer` on the handler's context is what makes the `input` schema the single
 * source of `TIn`; without it, the handler parameter contributes a competing candidate and the
 * inference collapses to `unknown`.
 */

import { MovoError } from "../errors/MovoError.js";
import { validatePrice } from "./price.js";
import type { StandardSchemaV1 } from "./standard-schema.js";
import {
  HTTP_METHODS,
  type HttpMethod,
  type MovoRequestContext,
  type MovoResource,
} from "./types.js";

/** What an author passes to {@link defineResource}. */
export interface MovoResourceInit<TIn, TOut> extends Omit<MovoResource<TIn, TOut>, "handler"> {
  readonly handler: (ctx: MovoRequestContext<NoInfer<TIn>>) => Promise<TOut> | TOut;
}

/** Wildcards in any of the forms Express accepts. */
const WILDCARD = /[*]/;

function assertMethod(method: unknown, where: string): asserts method is HttpMethod {
  if (typeof method === "string" && (HTTP_METHODS as readonly string[]).includes(method)) return;
  throw new MovoError(
    "MOVO_E_METHOD_INVALID",
    `method ${JSON.stringify(method)} on ${where} is not one of ${HTTP_METHODS.join(", ")}.`,
    { context: { where, method } },
  );
}

function assertPath(path: unknown, where: string): asserts path is string {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new MovoError(
      "MOVO_E_PATH_INVALID",
      `path ${JSON.stringify(path)} on ${where} must be a string beginning with "/", for example "/weather/:city".`,
      { context: { where, path } },
    );
  }
  if (WILDCARD.test(path)) {
    throw new MovoError(
      "MOVO_E_PATH_WILDCARD",
      `path ${JSON.stringify(path)} on ${where} contains a wildcard. Use a named parameter such as "/files/:name" instead. ` +
        "A wildcard collapses distinct resources onto one Bazaar catalog key, so a buyer browsing the catalog cannot tell them apart.",
      { context: { where, path } },
    );
  }
}

/**
 * Declare a paid resource.
 *
 * @param resource - The resource declaration
 * @returns The same declaration, validated
 */
export function defineResource<TIn = unknown, TOut = unknown>(
  resource: MovoResourceInit<TIn, TOut>,
): MovoResource<TIn, TOut> {
  const where = `${String(resource.method)} ${String(resource.path)}`;

  assertMethod(resource.method, where);
  assertPath(resource.path, where);

  if (typeof resource.handler !== "function") {
    throw new MovoError(
      "MOVO_E_HANDLER_INVALID",
      `${where} has no handler function. A Movo resource is plain data plus exactly one handler; there is no later registration step that could supply it.`,
      { context: { where, receivedType: typeof resource.handler } },
    );
  }

  if (resource.price !== undefined) validatePrice(resource.price, where);

  if (
    resource.maxTimeoutSeconds !== undefined &&
    (!Number.isFinite(resource.maxTimeoutSeconds) || resource.maxTimeoutSeconds <= 0)
  ) {
    throw new MovoError(
      "MOVO_E_MAX_TIMEOUT_INVALID",
      `maxTimeoutSeconds ${String(resource.maxTimeoutSeconds)} on ${where} must be a positive finite number of seconds.`,
      { context: { where, maxTimeoutSeconds: resource.maxTimeoutSeconds } },
    );
  }

  return resource as MovoResource<TIn, TOut>;
}

/**
 * Re-exported so a caller can name the schema type without reaching into the module layout.
 */
export type { StandardSchemaV1 };
