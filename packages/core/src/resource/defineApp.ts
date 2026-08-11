/**
 * `defineApp` — explicit registration, which is the documented default.
 *
 * Spec §1.8 D6 keeps directory scanning as an opt-in rather than the norm, and OQ-4 defaults
 * to opt-in until M2 decides otherwise. The reason is not taste: a scan makes the set of paid
 * routes depend on the filesystem at boot, which is exactly the kind of thing that differs
 * between a laptop and a container and produces a route that is unpaid in production.
 *
 * No scanning is implemented at M1. The scan requires filesystem access, and `compileApp` is
 * specified as pure; wiring the two together is a decision that belongs with the CLI, which
 * owns the process boundary.
 */

import { MovoError } from "../errors/MovoError.js";
import type { AnyMovoResource, MovoApp } from "./types.js";

/** What an author passes to {@link defineApp}. */
export interface MovoAppInit {
  readonly resources: readonly AnyMovoResource[];
}

/**
 * Declare an application from an explicit list of resources.
 *
 * @param init - The resource list
 * @returns The application
 */
export function defineApp(init: MovoAppInit): MovoApp {
  if (init === null || typeof init !== "object" || !Array.isArray(init.resources)) {
    throw new MovoError(
      "MOVO_E_APP_INVALID",
      "defineApp expects { resources: [ … ] } with each entry produced by defineResource.",
      { context: { receivedType: typeof init } },
    );
  }

  for (const [index, resource] of init.resources.entries()) {
    if (
      resource === null ||
      typeof resource !== "object" ||
      typeof resource.handler !== "function"
    ) {
      throw new MovoError(
        "MOVO_E_APP_INVALID",
        `resources[${String(index)}] is not a resource produced by defineResource.`,
        { context: { index, receivedType: typeof resource } },
      );
    }
  }

  return { resources: init.resources };
}
