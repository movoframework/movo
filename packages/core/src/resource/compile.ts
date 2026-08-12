/**
 * `compileApp` — resources plus configuration become an `@x402/core` `RoutesConfig`.
 *
 * Entirely pure: no network, no filesystem, no clock. That is what lets `movo doctor` analyse
 * a project without booting it, keeps the unit suite hermetic, and makes compilation something
 * a test can assert on exactly rather than approximately (spec §10 M1, point 3).
 *
 * **`routes` is the raw upstream type, deliberately.** It is not wrapped, renamed or narrowed.
 * A developer can take `compileApp(app).routes` straight to `paymentMiddleware` and never
 * import `@movoframework/server` at all. That escape hatch is a stability promise (spec §5.3),
 * and AC1.1 asserts it holds at the type level against the installed `@x402/express`.
 *
 * **What compilation deliberately does not do.** It does not convert decimals, build headers,
 * contact a facilitator, or model the payment lifecycle. `x402ResourceServer` owns verify →
 * handler → settle with its own abort and recover hooks; Movo composes it and never
 * reimplements it (spec §1.8 D2).
 *
 * `extensions.bazaar` is deliberately absent at M1. `discoveryDeclared` records which routes
 * *would* carry it, so M4 has the route keys it needs without M1 guessing at a shape that
 * upstream is still moving.
 */

import { type ConfigLayers, type ResolvedConfig, resolveConfig } from "../config/resolve.js";
import { type Finding, findingFromCode } from "../diagnostics.js";
import { MovoError } from "../errors/MovoError.js";
import {
  EXACT_SCHEME,
  type Network,
  type PaymentOption,
  type RouteConfig,
  type RoutesConfig,
} from "../protocol/index.js";
import { isStandardSchema, type StandardSchemaV1 } from "./standard-schema.js";
import type { AnyMovoResource, HttpMethod, MovoApp, MovoPrice } from "./types.js";

/** A handler paired with the route it was compiled for. */
export interface CompiledHandler {
  /** `"GET /weather/:city"` — the route key, matching the key in `routes`. */
  readonly routeKey: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly resource: AnyMovoResource;
}

/** The output of {@link compileApp}. */
export interface CompiledApp {
  /** The raw `@x402/core` shape, ready for `paymentMiddleware` without a cast. */
  readonly routes: RoutesConfig;
  /** Route key → handler. */
  readonly handlers: ReadonlyMap<string, CompiledHandler>;
  /** Route keys that will carry a Bazaar declaration once M4 derives one. */
  readonly discoveryDeclared: readonly string[];
  /** The application-level resolved configuration, with provenance. */
  readonly resolvedConfig: ResolvedConfig;
  /** Static findings. Never network-derived. */
  readonly diagnostics: readonly Finding[];
}

/**
 * The route key for a resource: `"<METHOD> <path>"`.
 *
 * The format is upstream's, confirmed in the M0 spike: a key with no space matches any verb,
 * and a key with one matches that verb only.
 *
 * @param method - HTTP method
 * @param path - Resource path
 * @returns The route key
 */
export function routeKeyFor(method: HttpMethod, path: string): string {
  return `${method} ${path}`;
}

/**
 * Best-effort detection of input schema fields without a description.
 *
 * Standard Schema exposes validation, not introspection, so there is no vendor-neutral way to
 * ask a schema whether its fields are described. This inspects the Zod-shaped `shape` when it
 * is present and reports nothing otherwise, which is the honest behaviour: a warning that
 * silently never fires for Valibot users would be worse than one that is documented as
 * vendor-limited.
 *
 * @param schema - The resource's input schema
 * @returns Names of fields carrying no description
 */
function undescribedFields(schema: StandardSchemaV1<unknown, unknown>): readonly string[] {
  const shape = (schema as { shape?: unknown }).shape;
  if (typeof shape !== "object" || shape === null) return [];

  const undescribed: string[] = [];
  for (const [name, field] of Object.entries(shape as Record<string, unknown>)) {
    if (typeof field !== "object" || field === null) continue;
    const description = (field as { description?: unknown }).description;
    if (typeof description !== "string" || description.length === 0) undescribed.push(name);
  }
  return undescribed;
}

function priceFor(resource: AnyMovoResource, config: ResolvedConfig, routeKey: string): MovoPrice {
  const price = resource.price ?? (config.defaults.price.value as MovoPrice | undefined);
  if (price !== undefined) return price;

  throw new MovoError(
    "MOVO_E_PRICE_MISSING",
    `${routeKey} has no price, and defaults.price is not set in configuration either. A paid route with no price cannot produce payment requirements.`,
    { context: { routeKey } },
  );
}

function payToFor(resource: AnyMovoResource, config: ResolvedConfig, routeKey: string): string {
  const payTo = resource.payTo ?? config.payTo.value;
  if (payTo !== undefined) return payTo;

  throw new MovoError(
    "MOVO_E_PAYTO_MISSING",
    `${routeKey} has no payTo, and neither configuration nor MOVO_PAY_TO supplies one. There is no account to be paid.`,
    { context: { routeKey } },
  );
}

function routeConfigFor(
  resource: AnyMovoResource,
  config: ResolvedConfig,
  routeKey: string,
): RouteConfig {
  const accepts: PaymentOption = {
    scheme: EXACT_SCHEME,
    network: resource.network ?? config.network.value,
    payTo: payToFor(resource, config, routeKey),
    price: priceFor(resource, config, routeKey),
    maxTimeoutSeconds: resource.maxTimeoutSeconds ?? config.defaults.maxTimeoutSeconds.value,
  };

  // Assembled key by key rather than spread, because `exactOptionalPropertyTypes` makes
  // `{ description: undefined }` distinct from `{}` — and upstream reads a present-but-
  // undefined field as a value, which surfaces as an empty description in a buyer's catalog.
  const route: {
    accepts: PaymentOption;
    description?: string;
    mimeType?: string;
    serviceName?: string;
    tags?: string[];
    iconUrl?: string;
  } = { accepts };

  if (resource.description !== undefined) route.description = resource.description;
  if (resource.mimeType !== undefined) route.mimeType = resource.mimeType;

  const serviceName = resource.serviceName ?? config.discovery.serviceName.value;
  if (serviceName !== undefined) route.serviceName = serviceName;

  // Copied into a fresh mutable array: upstream's `RouteConfig.tags` is `string[]`, and
  // handing it the resource's own readonly array would either need a cast or let a consumer
  // mutate the resource declaration through the compiled route.
  const tags = resource.tags ?? config.discovery.tags.value;
  if (tags !== undefined) route.tags = [...tags];

  const iconUrl = resource.iconUrl ?? config.discovery.iconUrl.value;
  if (iconUrl !== undefined) route.iconUrl = iconUrl;

  return route;
}

/**
 * Compile an application into upstream routes, handlers and static diagnostics.
 *
 * @param app - The application, from `defineApp`
 * @param layers - Configuration layers; the resource layer is supplied per resource internally
 * @returns The compiled application
 */
export function compileApp(app: MovoApp, layers?: ConfigLayers): CompiledApp {
  const resolvedConfig = resolveConfig(layers);

  const routes: Record<string, RouteConfig> = {};
  const handlers = new Map<string, CompiledHandler>();
  const discoveryDeclared: string[] = [];
  const diagnostics: Finding[] = [];

  for (const resource of app.resources) {
    const routeKey = routeKeyFor(resource.method, resource.path);

    if (handlers.has(routeKey)) {
      throw new MovoError(
        "MOVO_E_ROUTE_DUPLICATE",
        `Two resources compile to the same route key ${JSON.stringify(routeKey)}. Route keys are the identity of a paid resource, so keeping the last one silently would make which handler runs depend on array order.`,
        { context: { routeKey } },
      );
    }

    // Each resource is resolved against its own overrides so that provenance stays accurate
    // per route: a resource that names its own payTo must report `source: "resource"`, not
    // inherit the application-level provenance of a value it overrode.
    const resourceOverride: {
      network?: Network;
      payTo?: string;
      price?: MovoPrice;
      maxTimeoutSeconds?: number;
    } = {};
    if (resource.network !== undefined) resourceOverride.network = resource.network;
    if (resource.payTo !== undefined) resourceOverride.payTo = resource.payTo;
    if (resource.price !== undefined) resourceOverride.price = resource.price;
    if (resource.maxTimeoutSeconds !== undefined) {
      resourceOverride.maxTimeoutSeconds = resource.maxTimeoutSeconds;
    }

    const merged = resolveConfig({ ...layers, resource: resourceOverride });

    if (resource.discovery !== undefined && resource.discovery !== false) {
      if (!merged.discovery.enabled.value) {
        throw new MovoError(
          "MOVO_E_DISCOVERY_DISABLED",
          `${routeKey} declares discovery metadata, but discovery.enabled is false in configuration. Either enable discovery, or set discovery: false on the resource to state that it is deliberately not discoverable.`,
          { context: { routeKey } },
        );
      }
      discoveryDeclared.push(routeKey);
    }

    routes[routeKey] = routeConfigFor(resource, merged, routeKey);
    handlers.set(routeKey, {
      routeKey,
      method: resource.method,
      path: resource.path,
      resource,
    });

    if (resource.input !== undefined && isStandardSchema(resource.input)) {
      for (const field of undescribedFields(resource.input)) {
        diagnostics.push(
          findingFromCode(
            "MOVO_W_PARAM_UNDESCRIBED",
            "resource.param-undescribed",
            `${routeKey} parameter "${field}" has no description`,
            `An agent deciding whether to pay for ${routeKey} reads the parameter descriptions. "${field}" has none, so it has to guess what to send.`,
          ),
        );
      }
    }
  }

  return {
    routes,
    handlers,
    discoveryDeclared,
    resolvedConfig,
    diagnostics,
  };
}
