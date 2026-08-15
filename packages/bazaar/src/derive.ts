/**
 * `deriveDiscovery` — build the upstream Bazaar declaration from the Movo resource declaration.
 *
 * This is contribution (i) of D3. The point is not convenience: it is that the route definition
 * and the discovery metadata **cannot drift apart**, because there is only one declaration and
 * the second artefact is derived from it. Upstream's model asks an author to maintain the route,
 * the handler and the discovery declaration separately, and nothing detects when they stop
 * agreeing — a listing that advertises a path you renamed last week is worse than no listing.
 *
 * Movo writes no wire shape here. `declareDiscoveryExtension` produces it; this module decides
 * what to feed in. Three things about the feeding are worth stating, because the discarded WIP
 * got each of them wrong (Spec Amendment 007 §2):
 *
 * **`input.type` is the protocol, not the body encoding.** Upstream's HTTP configs are
 * discriminated by whether the method carries a body: query methods (GET/HEAD/DELETE) take no
 * `bodyType`, body methods (POST/PUT/PATCH) require one. The WIP wrote
 * `input: { type: "queryParams" | "body" }`, conflating the two, which `any` hid.
 *
 * **`inputSchema` is JSON Schema, not a Standard Schema object.** See `./json-schema.ts` — that
 * conversion is the actual work.
 *
 * **Service metadata is not part of this call at all.** `serviceName`, `tags` and `iconUrl`
 * travel on the route's `ResourceInfo`, which `compileApp` already populates from the resource
 * and project config. Passing them to `declareDiscoveryExtension` would put them in the wrong
 * place on the wire; validating them is `validateDiscoveryStrict`'s job.
 */

import type { AnyMovoResource, Finding, HttpMethod, ResolvedConfig } from "@movoframework/core";
import {
  type DeclareDiscoveryExtensionInput,
  declareDiscoveryExtension,
} from "@movoframework/core/bazaar";
import { type JsonSchema, toJsonSchema } from "./json-schema.js";

/** Methods whose request carries no body; upstream types these as query-parameter configs. */
const QUERY_METHODS: readonly HttpMethod[] = ["GET", "HEAD", "DELETE"];

/**
 * Discovery metadata a resource may declare, beyond M1's `example` / `outputExample`.
 *
 * Movo reads these off the resource's `discovery` block. They are optional in every case: a
 * resource that declares `discovery: {}` still produces a valid declaration built from its
 * method, path and schemas.
 */
export interface DiscoveryOverrides {
  /** An example input, shown to agents choosing whether to call the resource. */
  readonly example?: unknown;
  /** An example output. */
  readonly outputExample?: unknown;
  /**
   * An explicit JSON Schema for the input, overriding derivation.
   *
   * Required when the input validator's vendor has no converter, and useful when derivation is
   * lossy — a Zod `.transform()` or a branded type describes something JSON Schema cannot.
   */
  readonly inputSchema?: JsonSchema;
  /** An explicit JSON Schema for the output. */
  readonly outputSchema?: JsonSchema;
  /** Body encoding for methods that carry one. Defaults to `"json"`. */
  readonly bodyType?: "json" | "form-data" | "text";
  /** Declares the resource as an MCP tool rather than an HTTP endpoint. */
  readonly toolName?: string;
  /** MCP transport, when `toolName` is set. */
  readonly transport?: string;
}

/** What {@link deriveDiscovery} produces. */
export interface DerivedDiscovery {
  /**
   * The extension object, keyed by extension name, ready to place on `RouteConfig.extensions`.
   *
   * Undefined when the resource declares no discovery, or opts out with `discovery: false`.
   */
  readonly extension?: Record<string, unknown>;
  /** Findings raised while deriving — currently only the underived-schema warning. */
  readonly findings: readonly Finding[];
}

/**
 * Read the discovery block off a resource, widened to the fields M4 understands.
 *
 * M1 typed `DiscoveryDeclaration` with `example` and `outputExample` only, because M1 had no
 * derivation to feed. Reading the wider shape here rather than changing M1's type keeps the
 * core resource model stable; the fields are additive and optional.
 *
 * @param resource - The resource to read
 * @returns The discovery overrides, or undefined when discovery is absent or opted out
 */
function overridesOf(resource: AnyMovoResource): DiscoveryOverrides | undefined {
  const declaration = resource.discovery;
  if (declaration === undefined || declaration === false) return undefined;
  return declaration as DiscoveryOverrides;
}

/**
 * Derive the upstream Bazaar declaration for one resource.
 *
 * Asynchronous because JSON Schema conversion may reach an optional vendor converter by dynamic
 * import. This runs at compile and mount time, never per request.
 *
 * @param resource - The resource to derive from
 * @param config - Resolved configuration, for project-level discovery settings
 * @param routeKey - Route key such as `"GET /weather/:city"`, used in findings
 * @returns The extension and any findings raised while deriving
 */
export async function deriveDiscovery(
  resource: AnyMovoResource,
  config: ResolvedConfig,
  routeKey = `${resource.method} ${resource.path}`,
): Promise<DerivedDiscovery> {
  const overrides = overridesOf(resource);
  if (overrides === undefined) return { findings: [] };
  if (!config.discovery.enabled.value) return { findings: [] };

  const findings: Finding[] = [];

  const derived = await toJsonSchema(resource.input, overrides.inputSchema, routeKey);
  if (derived.finding !== undefined) findings.push(derived.finding);

  const outputDerived = await toJsonSchema(resource.output, overrides.outputSchema, routeKey);

  // Assembled key by key rather than spread: `exactOptionalPropertyTypes` makes a
  // present-but-undefined field distinct from an absent one, and upstream reads the former as a
  // value — which reaches a buyer's catalog as an empty field rather than an absent one.
  const output: { example?: unknown; schema?: JsonSchema } = {};
  if (overrides.outputExample !== undefined) output.example = overrides.outputExample;
  if (outputDerived.schema !== undefined) output.schema = outputDerived.schema;

  let input: DeclareDiscoveryExtensionInput;

  if (overrides.toolName !== undefined) {
    // MCP. One function, dispatching on `toolName` — there is no separate
    // `declareMcpDiscoveryExtension` in the installed package despite §22 naming one
    // (amendment 007 §3.1, asserted in upstream-conformance.test.ts).
    //
    // Upstream requires `inputSchema` for MCP. Without one there is nothing to declare, so this
    // returns no extension rather than an invalid one; the warning already explains why.
    if (derived.schema === undefined) return { findings };

    const mcp: {
      toolName: string;
      inputSchema: JsonSchema;
      description?: string;
      transport?: string;
      example?: Record<string, unknown>;
      output?: { example?: unknown; schema?: JsonSchema };
    } = { toolName: overrides.toolName, inputSchema: derived.schema };

    if (resource.description !== undefined) mcp.description = resource.description;
    if (overrides.transport !== undefined) mcp.transport = overrides.transport;
    if (
      overrides.example !== undefined &&
      typeof overrides.example === "object" &&
      overrides.example !== null
    ) {
      mcp.example = overrides.example as Record<string, unknown>;
    }
    if (Object.keys(output).length > 0) mcp.output = output;

    input = mcp as DeclareDiscoveryExtensionInput;
  } else {
    const carriesBody = !QUERY_METHODS.includes(resource.method);

    const http: {
      input?: Record<string, unknown>;
      inputSchema?: JsonSchema;
      bodyType?: "json" | "form-data" | "text";
      output?: { example?: unknown; schema?: JsonSchema };
    } = {};

    if (derived.schema !== undefined) http.inputSchema = derived.schema;
    if (
      overrides.example !== undefined &&
      typeof overrides.example === "object" &&
      overrides.example !== null
    ) {
      http.input = overrides.example as Record<string, unknown>;
    }
    // Upstream's body-method config requires `bodyType`; its query-method config has no such
    // field. Setting it on a GET would produce a shape upstream's own validator rejects.
    if (carriesBody) http.bodyType = overrides.bodyType ?? "json";
    if (Object.keys(output).length > 0) http.output = output;

    input = http as DeclareDiscoveryExtensionInput;
  }

  return { extension: declareDiscoveryExtension(input), findings };
}
