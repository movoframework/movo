/**
 * Standard Schema → JSON Schema.
 *
 * This is the part of `deriveDiscovery` that does actual work, and the part the discarded M4
 * WIP omitted entirely — it passed the Standard Schema object straight through to a field
 * upstream types as `Record<string, unknown>` JSON Schema, which typechecks under `any` and
 * produces a declaration no catalog can read (Spec Amendment 007 §2).
 *
 * **The structural limitation, stated plainly.** Standard Schema v1 describes *validation*:
 * a `~standard.validate` function and, at type level, the input and output types. It carries
 * no JSON Schema and no way to produce one. So a vendor-neutral conversion is not merely
 * unimplemented here, it is not expressible. Any library claiming otherwise is either
 * depending on a specific vendor or guessing.
 *
 * Movo therefore resolves an input schema in four steps, most explicit first:
 *
 *   1. an explicit `inputSchema` on the resource's discovery block — always wins
 *   2. a value that already *is* a JSON Schema
 *   3. a vendor Movo can convert without taking a dependency on it (currently Zod, reached by
 *      optional dynamic import — absent Zod, this step simply does not fire)
 *   4. nothing, plus a `MOVO_W_DISCOVERY_SCHEMA_UNDERIVED` finding saying so
 *
 * Step 4 is a warning rather than a silent omission because an agent choosing whether to pay
 * for an endpoint reads its parameter schema; a listing without one is one the agent has to
 * guess at. Silence here would be the failure mode this whole milestone is built to avoid.
 */

import { type Finding, findingFromCode, type StandardSchemaV1 } from "@movoframework/core";

/** A JSON Schema document, as upstream's declaration input expects it. */
export type JsonSchema = Record<string, unknown>;

/** What {@link toJsonSchema} produces. */
export interface SchemaDerivation {
  /** The JSON Schema, when one could be resolved. */
  readonly schema?: JsonSchema;
  /** How it was resolved, for diagnostics and for tests to assert the path taken. */
  readonly via: "override" | "json-schema" | "vendor" | "none";
  /** The vendor that supplied a converter, when `via` is `"vendor"`. */
  readonly vendor?: string;
  /** Raised when nothing could be resolved. */
  readonly finding?: Finding;
}

/**
 * Whether a value already looks like a JSON Schema document.
 *
 * Deliberately shallow: the presence of `type`, `properties`, `$schema` or a composition
 * keyword is enough to treat the value as JSON Schema and hand it to upstream, which validates
 * it properly. Movo does not validate JSON Schema itself — that would be a Movo-owned validator,
 * which D3 forbids.
 *
 * @param value - Candidate schema
 * @returns `true` when the value should be passed through as JSON Schema
 */
export function isJsonSchema(value: unknown): value is JsonSchema {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if ("~standard" in candidate) return false;
  return (
    "type" in candidate ||
    "properties" in candidate ||
    "$schema" in candidate ||
    "anyOf" in candidate ||
    "oneOf" in candidate ||
    "allOf" in candidate
  );
}

/**
 * The Standard Schema vendor of a value, when it declares one.
 *
 * @param value - Candidate schema
 * @returns The vendor string, or undefined
 */
export function schemaVendor(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const marker = (value as { "~standard"?: { vendor?: unknown } })["~standard"];
  if (typeof marker !== "object" || marker === null) return undefined;
  return typeof marker.vendor === "string" ? marker.vendor : undefined;
}

/**
 * Convert a Zod schema, if Zod is present in the consumer's tree.
 *
 * Reached by dynamic import so that Zod is never a dependency of `@movoframework/bazaar` —
 * neither runtime nor peer. A project that uses Valibot pays nothing for this, and a project
 * that uses Zod gets derivation for free. If the import fails for any reason, derivation falls
 * through to the warning path rather than throwing: a schema Movo cannot convert is a
 * documentation gap in someone's listing, not a reason to fail their build.
 *
 * `zod/v4` is the subpath that exposes `toJSONSchema`; it is present inside Zod 3.25+ as well
 * as Zod 4, which is why the import target is the subpath rather than the package root.
 *
 * @param schema - A Zod schema
 * @returns The converted JSON Schema, or undefined when conversion is unavailable
 */
async function convertZod(schema: unknown): Promise<ConversionResult> {
  // Zod's classic (v3) and current (v4) schemas both report vendor "zod", so the vendor string
  // alone does not say whether a schema is convertible. Only v4 carries a `_zod` internal, and
  // `toJSONSchema` reads it — handed a v3 schema it throws on `undefined.def`, which is not a
  // message anyone could act on. Detecting the flavour lets the finding name the actual fix.
  const isModern = typeof schema === "object" && schema !== null && "_zod" in schema;
  if (!isModern) {
    return {
      reason:
        'this is a Zod 3 "classic" schema, which has no JSON Schema converter. Import your schema builder from "zod/v4" (available inside Zod 3.25+ as well as Zod 4), or supply an explicit inputSchema',
    };
  }

  try {
    const zod = (await import("zod/v4")) as {
      toJSONSchema?: (value: unknown, options?: unknown) => JsonSchema;
    };
    if (typeof zod.toJSONSchema !== "function") {
      return { reason: "the installed Zod does not export toJSONSchema" };
    }
    // `io: "input"` asks for the schema of what a caller sends rather than what validation
    // produces. They differ whenever a schema has defaults or transforms, and a catalog is
    // documenting the request, not the parsed result.
    return { schema: zod.toJSONSchema(schema, { io: "input" }) };
  } catch (error) {
    return {
      reason: `Zod could not convert it: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** What a vendor converter reports: a schema, or why it could not produce one. */
type ConversionResult = { schema: JsonSchema; reason?: undefined } | { reason: string };

/** Vendors Movo can convert, and how. Extended by adding a converter, never by adding a rule. */
const CONVERTERS: ReadonlyMap<string, (schema: unknown) => Promise<ConversionResult>> = new Map([
  ["zod", convertZod],
]);

/**
 * Resolve the JSON Schema for a resource's input.
 *
 * @param schema - The resource's Standard Schema validator, if any
 * @param override - An explicit JSON Schema from the discovery block, if any
 * @param where - Route key, for the finding's detail
 * @returns The resolved schema and the path taken to it
 */
export async function toJsonSchema(
  schema: StandardSchemaV1<unknown, unknown> | undefined,
  override: JsonSchema | undefined,
  where: string,
): Promise<SchemaDerivation> {
  // 1. An explicit override always wins. §22 calls for it "for cases where derivation is
  //    lossy", and an author who has written one has made a decision Movo should not second-
  //    guess by re-deriving and preferring its own answer.
  if (override !== undefined) return { schema: override, via: "override" };

  if (schema === undefined) return { via: "none" };

  // 2. Already JSON Schema.
  if (isJsonSchema(schema)) return { schema, via: "json-schema" };

  // 3. A vendor Movo can convert.
  const vendor = schemaVendor(schema);
  let reason: string;

  if (vendor === undefined) {
    reason =
      "it is not a recognisable Standard Schema validator, so Movo has no way to ask it for a schema";
  } else {
    const convert = CONVERTERS.get(vendor);
    if (convert === undefined) {
      reason = `Movo has no JSON Schema converter for the "${vendor}" vendor. Standard Schema describes validation but not conversion, so this cannot be derived automatically`;
    } else {
      const converted = await convert(schema);
      if (converted.reason === undefined) {
        return { schema: converted.schema, via: "vendor", vendor };
      }
      reason = converted.reason;
    }
  }

  // 4. Nothing, and say exactly why — a generic "could not derive" would leave the author with
  //    no idea whether to change library, change import, or write the schema by hand.
  return {
    via: "none",
    finding: findingFromCode(
      "MOVO_W_DISCOVERY_SCHEMA_UNDERIVED",
      "bazaar.schema-underived",
      `${where} declares discovery but its input schema could not be converted to JSON Schema`,
      `${where}: ${reason}. The Bazaar declaration therefore carries no inputSchema, so an agent reading your listing has no parameter documentation.`,
    ),
  };
}
