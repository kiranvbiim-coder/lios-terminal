import type { Server } from "http";

export function getServerListenOptions(port: number) {
  return {
    port,
    // Loopback-only by default -- correct for the Electron-spawned local
    // backend, which has no business being reachable from the LAN. A
    // user-selected server Home bind (user-owned deployment) must bind other
    // interfaces. Opt-in via HOST rather than flipping the default, so
    // every existing desktop-app launch path is unaffected unless it
    // explicitly asks for this.
    host: process.env.HOST || "127.0.0.1",
  };
}

export interface ListenWithFallbackOptions {
  allowFallback?: boolean;
  maxAdditionalPorts?: number;
}

function listenOnce(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(getServerListenOptions(port));
  });
}

export async function listenWithFallback(
  server: Server,
  preferredPort: number,
  options: ListenWithFallbackOptions = {},
): Promise<number> {
  const maxAdditionalPorts = options.allowFallback ? options.maxAdditionalPorts ?? 20 : 0;
  for (let offset = 0; offset <= maxAdditionalPorts; offset++) {
    const port = preferredPort + offset;
    try {
      await listenOnce(server, port);
      return port;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || offset === maxAdditionalPorts) throw error;
    }
  }
  throw new Error(`Unable to bind a server port starting at ${preferredPort}.`);
}
