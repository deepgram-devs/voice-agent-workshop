// Test-only: a listener for the credential tests in common, testing and examples .test.ts.
import { createServer, type AddressInfo } from 'node:net';

export interface CountingServer {
  port: number;
  connections: () => Promise<number>;
  close: () => void;
}

/**
 * A local TCP listener that counts connections and closes each one: where a regression
 * would connect, never Deepgram or the workshop proxy.
 */
export async function countingServer(): Promise<CountingServer> {
  let count = 0;
  const server = createServer((socket) => {
    count += 1;
    socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return {
    port: (server.address() as AddressInfo).port,
    // Let a connection that is on its way be counted.
    connections: () => new Promise((r) => setTimeout(() => r(count), 200)),
    close: () => server.close(),
  };
}
