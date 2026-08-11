/**
 * Movo's published identity — the npm scope and the names derived from it.
 *
 * SINGLE SOURCE OF TRUTH. Nothing else in this repository may write the scope string as a
 * literal: not a package, not a script, not a gate, not a test, and not a test fixture.
 *
 * WHY THIS FILE EXISTS. During M0 the project moved from `@movo/*` to `@movoframework/*`
 * (Spec Amendment 002 §1). The track-isolation gate had the old scope hard-coded twice — once
 * in the regular expression that detects an SCF import, and once again in the fixtures that
 * prove the gate fires. Renaming the scope in the fixtures kept the fixture test green while
 * the gate's regular expression no longer matched anything in real code. A gate that passes
 * its own proof-of-failure test while matching nothing in production is worse than no gate,
 * because it reports success.
 *
 * The rule that prevents a repeat: derive, never repeat. A gate builds its patterns from
 * {@link MOVO_SCOPE}; a fixture is materialised from a template with {@link MOVO_SCOPE}
 * substituted in; and `scope-drift.test.ts` asserts that the constant still describes what
 * the workspace actually publishes, so a rename that misses a package.json fails loudly.
 *
 * The scope is deliberately not the product name. Movo is the product; `@movoframework` is a
 * registry namespace that was available when `movo` was not (Spec Amendment 002 §1). The CLI
 * binary, the config file, the environment prefix, the error codes and every type name keep
 * the Movo name.
 */

/** The npm organisation Movo packages publish under. Never write this string anywhere else. */
export const MOVO_SCOPE = "@movoframework";

/** The product name. Distinct from {@link MOVO_SCOPE}, and deliberately so. */
export const MOVO_PRODUCT_NAME = "Movo";

/** The prefix on every Movo environment variable — `MOVO_PAY_TO`, `MOVO_ENV`, and so on. */
export const MOVO_ENV_PREFIX = "MOVO_";

/**
 * The published name of a Movo package, given its directory name under `packages/`.
 *
 * @param directoryName - Directory name, e.g. `"core"`
 * @returns The scoped package name, e.g. `"@movoframework/core"`
 */
export function movoPackageName(directoryName: string): string {
  return `${MOVO_SCOPE}/${directoryName}`;
}

/**
 * Packages published without the scope.
 *
 * `create-movo-app` is unscoped because `npm create movo-app` resolves to a bare
 * `create-movo-app`, and that string is the first thing in the README (Amendment 002 §2).
 * Listing it here is what lets `scope-drift.test.ts` insist that everything else *is* scoped.
 */
export const UNSCOPED_PACKAGE_DIRECTORIES: readonly string[] = ["create-movo-app"];
