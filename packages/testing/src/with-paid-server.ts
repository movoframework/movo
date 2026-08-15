import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ConfigLayers, FacilitatorClient, MovoApp } from "@movoframework/core";
import { mountNodeHttp } from "@movoframework/server";

export interface PaidServer {
  readonly url: string;
  close(): Promise<void>;
}

export interface WithPaidServerOptions {
  readonly facilitator: FacilitatorClient;
  /**
   * Configuration layers, forwarded to the mount.
   *
   * Without this a harness resolves configuration from `process.env` alone, so a generated test
   * only passes on a machine that already has `MOVO_PAY_TO` set — which makes the first run of a
   * fresh scaffold fail for a reason unrelated to the code under test.
   */
  readonly config?: ConfigLayers;
}

/** Mount a paid Movo application on an ephemeral local port. */
export async function withPaidServer(
  app: MovoApp,
  options: WithPaidServerOptions,
): Promise<PaidServer>;
export async function withPaidServer<T>(
  app: MovoApp,
  options: WithPaidServerOptions,
  run: (server: PaidServer) => Promise<T>,
): Promise<T>;
export async function withPaidServer<T>(
  app: MovoApp,
  options: WithPaidServerOptions,
  run?: (server: PaidServer) => Promise<T>,
): Promise<PaidServer | T> {
  const mounted = await mountNodeHttp(app, {
    facilitator: options.facilitator,
    ...(options.config === undefined ? {} : { config: options.config }),
  });
  const server: Server = createServer(mounted.listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const paidServer: PaidServer = {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
  if (run === undefined) return paidServer;
  try {
    return await run(paidServer);
  } finally {
    await paidServer.close();
  }
}
