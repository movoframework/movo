/**
 * The resource model's types.
 *
 * A Movo resource is plain, serialisable data plus exactly one handler. There is no registry,
 * no mutable app instance and no side effect at definition time, which is what allows
 * `movo doctor` to analyse a project statically without booting it (spec §1.8 D7).
 */

import type { AssetAmount, Network, PaymentRequirements, Price } from "../protocol/index.js";
import type { StandardSchemaV1 } from "./standard-schema.js";

/** HTTP methods Movo compiles to route keys. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/** The methods, for validation and error messages. */
export const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
];

/**
 * A price written as a currency string, e.g. `"$0.001"`.
 *
 * Narrower than upstream's `Money`, which is `string | number`. Movo requires the `$` prefix
 * so that a price is never a bare number whose units are ambiguous — `0.001` of what, in an
 * asset with 7 decimals, is exactly the question that produces a money bug.
 */
export type MoneyString = `$${string}`;

/** What a resource or config may state as a price. */
export type MovoPrice = MoneyString | AssetAmount;

/**
 * Bazaar discovery metadata declared on a resource.
 *
 * Every field is optional: `discovery: {}` is a complete declaration, because the method, path,
 * description and schemas are already on the resource and derivation reads them from there.
 * What is here is what derivation cannot infer.
 *
 * The declaration is deliberately just data — no JSON Schema type, no MCP type, nothing that
 * would pull the Bazaar surface into the pure core. `@movoframework/bazaar` interprets it.
 */
export interface DiscoveryDeclaration {
  /**
   * An example input, shown to agents choosing whether to call this resource.
   *
   * Worth supplying whenever the input schema has required fields: upstream validates the
   * example against the schema, so an absent one produces a declaration that fails its own
   * consistency check.
   */
  readonly example?: unknown;
  /** An example output. */
  readonly outputExample?: unknown;
  /**
   * An explicit JSON Schema for the input, overriding derivation.
   *
   * Needed when the validator's vendor has no JSON Schema converter, and useful when derivation
   * is lossy — a transform or a branded type describes something JSON Schema cannot.
   */
  readonly inputSchema?: Record<string, unknown>;
  /** An explicit JSON Schema for the output. */
  readonly outputSchema?: Record<string, unknown>;
  /** Body encoding, for methods that carry a body. Defaults to `"json"`. */
  readonly bodyType?: "json" | "form-data" | "text";
  /** Declares the resource as an MCP tool rather than an HTTP endpoint. */
  readonly toolName?: string;
  /** MCP transport, when `toolName` is set. */
  readonly transport?: string;
}

/**
 * What a handler knows about the payment that let it run.
 *
 * `verified: true` is a literal type, not a boolean, encoding that a handler does not run on
 * an unverified request. Verified against the installed declarations: `@x402/core`'s
 * `SkipHandlerDirective` causes the handler to be *skipped*, never to run on a failed verify,
 * and `BeforeVerifyHook`'s `{ skip: true, result }` substitutes a verify result that the
 * operator has themselves declared valid. Neither path delivers an unverified request to a
 * handler. See docs/concepts/payment-lifecycle.md.
 *
 * The settlement result is deliberately absent. Upstream settles *after* the handler
 * (docs/SPIKE_REPORT.md Q1), so a settlement field here could only ever be empty, and a field
 * whose meaning is "not yet known" is worse than no field.
 */
export interface MovoPaymentContext {
  readonly verified: true;
  readonly network: Network;
  readonly asset: string;
  /** Base units, as a string. Never a number: 7-decimal amounts exceed safe integer precision. */
  readonly amount: string;
  readonly payer?: string;
  readonly requirements: PaymentRequirements;
}

/** What a handler receives. */
export interface MovoRequestContext<TIn> {
  /** Parsed and validated from query or body according to the method. */
  readonly input: TIn;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly correlationId: string;
  readonly payment: MovoPaymentContext;
  /** Framework-specific escape hatch. Typed as `unknown` because Movo is not Express-only. */
  readonly raw: { readonly req: unknown; readonly res: unknown };
}

/** A resource as `defineResource` returns it. */
export interface MovoResource<TIn, TOut> {
  readonly method: HttpMethod;
  readonly path: string;
  readonly price?: MovoPrice;
  readonly network?: Network;
  readonly payTo?: string;
  readonly maxTimeoutSeconds?: number;
  readonly description?: string;
  readonly mimeType?: string;
  readonly serviceName?: string;
  readonly tags?: readonly string[];
  readonly iconUrl?: string;
  readonly input?: StandardSchemaV1<unknown, TIn>;
  readonly output?: StandardSchemaV1<unknown, TOut>;
  /** `false` states that the resource is deliberately not discoverable. */
  readonly discovery?: DiscoveryDeclaration | false;
  readonly handler: (ctx: MovoRequestContext<TIn>) => Promise<TOut> | TOut;
}

/**
 * A resource of unknown parameterisation — the element type of a heterogeneous resource list.
 *
 * Each field is erased in the direction its variance requires, and getting this wrong is not a
 * theoretical concern: it decides whether `defineApp({ resources: [a, b] })` compiles when `a`
 * and `b` have different input types, which is the ordinary case.
 *
 * - **`handler`** takes `MovoRequestContext<never>`. The context is a *contravariant* position,
 *   so `never` is what makes every concrete handler assignable — a handler expecting a parsed
 *   `{ city: string }` cannot accept a context typed `unknown`, but `never` flows into anything.
 * - **`input` / `output`** are `StandardSchemaV1<unknown, unknown>`. A schema is *covariant* in
 *   its output, so erasing these to `never` would reject every schema; erasing to `unknown`
 *   accepts them all.
 *
 * Writing `MovoResource<never, unknown>` for the whole interface gets the handler right and the
 * schemas exactly backwards, which shows up as a resource with no `input` failing to join a
 * list. Hence the explicit override rather than a single parameterisation.
 */
export interface AnyMovoResource extends Omit<MovoResource<never, unknown>, "input" | "output"> {
  readonly input?: StandardSchemaV1<unknown, unknown>;
  readonly output?: StandardSchemaV1<unknown, unknown>;
}

/** A collection of resources, as `defineApp` returns it. */
export interface MovoApp {
  readonly resources: readonly AnyMovoResource[];
}

/**
 * Whether a value is an upstream `AssetAmount` rather than a money string.
 *
 * @param price - A price in either form
 * @returns `true` when the price names an asset and an amount in base units
 */
export function isAssetAmount(price: Price | MovoPrice): price is AssetAmount {
  return typeof price === "object" && price !== null;
}
