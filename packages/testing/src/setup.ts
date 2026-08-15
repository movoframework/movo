/**
 * Vitest setup: register Movo's matchers.
 *
 * Preloaded automatically by `movo test`, and available to any project that would rather wire it
 * into its own `vitest.config.ts` as a `setupFiles` entry.
 *
 * It exists as a **module with a side effect** rather than as documentation telling people to
 * write `expect.extend(movoMatchers)` themselves, because the failure mode of forgetting is
 * poor: `expect(response).toBeSettled` is undefined, and the error names a missing property
 * rather than a missing setup file.
 *
 * `vitest` is imported here and nowhere else in the package — importing it at the top of
 * `index.ts` would drag a test runner into the runtime graph of anything importing the toolkit.
 */

import { expect } from "vitest";
import { movoMatchers } from "./matchers.js";

expect.extend(movoMatchers);
