/**
 * `defineConfig` — a pure identity-with-validation function for `movo.config.ts`.
 *
 * It performs no I/O, reads no environment variable and touches no network. That matters
 * because it runs at module load in the author's config file: a `defineConfig` that read the
 * environment would make the meaning of a config file depend on where it was imported from,
 * and would make `movo doctor`'s static analysis unreliable.
 *
 * Validation here is structural only. Anything that depends on the merged result — whether
 * `env` and `network` agree, whether the pubnet gate is open — happens in `resolveConfig`,
 * where all five layers are present. Validating it earlier would reject configurations that a
 * later layer was about to make valid.
 */

import { type MovoConfigInput, validateConfigInput } from "./schema.js";

/**
 * Declare a Movo configuration.
 *
 * @param input - The configuration written in `movo.config.ts`
 * @returns The same object, validated
 */
export function defineConfig(input: MovoConfigInput): MovoConfigInput {
  validateConfigInput(input, "config");
  return input;
}
