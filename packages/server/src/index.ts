/**
 * `@movoframework/server` — mounting compiled Movo resources onto a Node HTTP framework.
 *
 * This package is small, and that is the design rather than an omission. `@x402/express`
 * already provides the middleware and `x402ResourceServer` already owns the verify → handler →
 * settle lifecycle with abort and recover hooks. What was missing was the assembly: turning a
 * resource declaration and a configuration into the four upstream objects that have to be
 * constructed in the right order and wired to each other.
 *
 * What this package contains: `compileApp`, a facilitator client, a resource server with the
 * Stellar `exact` scheme registered, an HTTP resource server, the upstream middleware, and the
 * route handlers.
 *
 * What it does not contain, and must never contain: header construction, 402 body construction,
 * a payment lifecycle state machine, XDR, or signature verification. A CI gate greps for each
 * of those, with a proof-of-failure fixture, so the claim is checked rather than asserted
 * (AC2.7, ADR-0008).
 */

export { createFacilitatorClient, type FacilitatorOption } from "./facilitator.js";
export {
  type ExpressLike,
  type MountOptions,
  type MountResult,
  mountExpress,
} from "./mount.js";
export {
  mountNodeHttp,
  type NodeHttpMountResult,
  type RequestListener,
} from "./node-http.js";

/** The published version of this package. */
export const VERSION: string = "0.0.0";
