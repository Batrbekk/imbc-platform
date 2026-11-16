import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';

/** Loopback-only SMTP fault relay. Accepted envelopes reach real Mailpit; rejected RCPT gets a real451. */
export async function startSurveySmtpRelay(upstreamUrl: string) {
  const upstream = new URL(upstreamUrl);
  if (upstream.protocol !== 'smtp:' || upstream.hostname !== '127.0.0.1' || upstream.port !== '11035')
    throw new Error('Survey SMTP must use the dedicated loopback Mailpit port11035');
  const sockets = new Set<Socket>();
  const faults = {
    reject: new Set<string>(),
    rejected: 0,
    beforeRecipient: null as null | ((email: string) => Promise<void>),
  };
  const server = createServer((client) => {
    const target = connect({ host: upstream.hostname, port: Number(upstream.port) });
    sockets.add(client);
    sockets.add(target);
    for (const socket of [client, target]) {
      socket.setTimeout(10000, () => socket.destroy());
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {
        client.destroy();
        target.destroy();
      });
    }
    client.on('close', () => target.destroy());
    target.pipe(client);
    let buffer = '',
      data = false;
    let pending = Promise.resolve();
    client.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines: string[] = [];
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) break;
        lines.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
      pending = pending
        .then(async () => {
          for (const line of lines) {
            if (!data) {
              const recipient = /^RCPT TO:\s*<([^>]+)>/i.exec(line)?.[1]?.trim().toLowerCase();
              if (recipient) {
                // Even a miswired test can never relay a non-local recipient.
                if (!recipient.endsWith('.local')) throw new Error('Non-local Survey SMTP recipient refused');
                await faults.beforeRecipient?.(recipient);
                if (faults.reject.has(recipient)) {
                  faults.rejected++;
                  client.write('451 4.3.0 Temporary integration-test recipient failure\r\n');
                  continue;
                }
              }
              if (/^DATA$/i.test(line)) data = true;
            } else if (line === '.') data = false;
            if (!target.destroyed) target.write(`${line}\r\n`);
          }
        })
        .catch(() => {
          client.destroy();
          target.destroy();
        });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Survey SMTP relay did not bind');
  return {
    url: `smtp://127.0.0.1:${address.port}`,
    faults,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
