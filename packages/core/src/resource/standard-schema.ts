/**
 * The Standard Schema v1 interface.
 *
 * Movo accepts any validator implementing Standard Schema — Zod, Valibot, ArkType — rather
 * than depending on one. The interface is declared here rather than pulled from a package
 * because it is a published *specification* whose whole purpose is to be a shared shape that
 * libraries agree on independently; adding a dependency to obtain a type that carries no
 * runtime code would put a package in the install path of every Movo consumer for nothing.
 * Zod is a devDependency for tests only, which is how it stays a peer in practice.
 *
 * @see https://standardschema.dev
 */

/** A validation issue reported by a Standard Schema validator. */
export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/** The result of validating a value. Success carries the parsed output; failure carries issues. */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] };

/** A validator implementing Standard Schema v1. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

/** The output type a Standard Schema validator produces. */
export type InferOutput<TSchema extends StandardSchemaV1> = NonNullable<
  TSchema["~standard"]["types"]
>["output"];

/**
 * Whether a value implements Standard Schema v1.
 *
 * @param value - Candidate validator
 * @returns `true` when the value carries a v1 `~standard` property
 */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (typeof value !== "object" || value === null) return false;
  const marker = (value as { "~standard"?: { version?: unknown } })["~standard"];
  return typeof marker === "object" && marker !== null && marker.version === 1;
}
