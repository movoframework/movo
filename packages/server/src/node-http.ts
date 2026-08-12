/**
 * `mountNodeHttp` — the same composition, returning a plain Node `RequestListener`.
 *
 * Express is the only adapter `@x402/express` provides, and Movo writes no middleware of its
 * own (spec §1.8 D2). So this does not reimplement the mount for Node's HTTP server; it builds
 * a minimal Express app, mounts onto that, and hands back its request listener. The shape a
 * caller wants — something they can pass to `http.createServer` or a serverless adapter — is
 * satisfied without Movo owning a second implementation of the payment path.
 *
 * The cost is a dependency on Express even for a caller who did not ask for one, which is why
 * it is a peer dependency and why this is documented rather than hidden. The alternative was a
 * hand-written adapter over `HTTPAdapter`, and a second implementation of request translation
 * is exactly the kind of thing that diverges quietly.
 */

import type { MovoApp } from "@movoframework/core";
import { type ExpressLike, type MountOptions, type MountResult, mountExpress } from "./mount.js";

/** A Node HTTP request listener, structurally typed to avoid depending on `node:http`. */
export type RequestListener = (request: unknown, response: unknown) => void;

/** What {@link mountNodeHttp} returns. */
export interface NodeHttpMountResult extends MountResult {
  /** Pass to `http.createServer`, or to any adapter that takes a request listener. */
  readonly listener: RequestListener;
}

/**
 * Mount a Movo application and return a Node request listener.
 *
 * @param app - The Movo application
 * @param options - Facilitator, configuration and hooks
 * @returns The mount result plus a request listener
 */
export async function mountNodeHttp(
  app: MovoApp,
  options?: MountOptions,
): Promise<NodeHttpMountResult> {
  const { default: express } = await import("express");
  const expressApp = express();
  expressApp.use(express.json());

  const result = await mountExpress(expressApp as unknown as ExpressLike, app, options);

  return { ...result, listener: expressApp as unknown as RequestListener };
}
