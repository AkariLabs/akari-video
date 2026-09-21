import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const mode = process.env.FAKE_VIBE_MODE;
if (mode === 'ignore-end' || mode === 'ignore-term') setInterval(() => {}, 1000);
const record = value => {
  if (process.env.FAKE_VIBE_REPORT) appendFileSync(process.env.FAKE_VIBE_REPORT, `${JSON.stringify({ pid: process.pid, ...value })}\n`);
};
const sockets = new Set();
const events = new Set();
let server;
let input = '';
let token;
let closing = false;
const close = reason => {
  if (closing) return;
  closing = true;
  record({ type: 'stopped', reason });
  for (const socket of sockets) socket.destroy();
  if (server?.listening) server.close(() => process.exit(0));
  else process.exit(0);
};
process.stdin.setEncoding('utf8');
process.stdin.on('end', () => {
  record({ type: 'stdin-end' });
  if (mode !== 'ignore-end' && mode !== 'ignore-term') close('stdin');
});
process.on('SIGTERM', () => {
  record({ type: 'sigterm' });
  if (mode !== 'ignore-term') close('sigterm');
});
process.stdin.on('data', chunk => {
  if (token) return;
  input += chunk;
  const newline = input.indexOf('\n');
  if (newline < 0) return;
  token = JSON.parse(input.slice(0, newline)).token;
  record({ type: 'input', validToken: /^[0-9a-f]{64}$/.test(token),
    tokenInArgv: process.argv.some(value => value.includes(token)),
    tokenInEnv: Object.entries(process.env).some(([key, value]) => key.includes(token) || value.includes(token)),
    serve: process.argv.at(-1) === '--serve', electronNode: process.env.ELECTRON_RUN_AS_NODE === '1' });
  if (mode === 'exit') return close('early-exit');
  if (mode === 'silent' || mode === 'ignore-end' || mode === 'ignore-term') return;
  if (mode === 'invalid') return process.stdout.write('not-json\n');
  if (mode === 'wrong-port') return process.stdout.write('{"type":"listening","port":0,"protocol":0}\n');
  if (mode === 'wrong-protocol') return process.stdout.write('{"type":"listening","port":1,"protocol":1}\n');
  if (mode === 'wrong-type') return process.stdout.write('{"type":"ready","port":1,"protocol":0}\n');
  if (mode === 'oversized') return process.stdout.write('x'.repeat(4097));
  server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url.startsWith('/companion/manifest?')) {
      const nonce = new URL(request.url, 'http://localhost').searchParams.get('nonce');
      const proof = createHmac('sha256', token).update(nonce).digest('hex');
      record({ type: 'manifest', authenticated: true });
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ protocol: 0, proof: mode === 'bad-hmac' ? '0'.repeat(64) : proof, panelPath: '/panel' }));
    } else if (request.url === '/companion/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.flushHeaders();
      events.add(response);
      response.on('close', () => events.delete(response));
      record({ type: 'events' });
    } else {
      let body = '';
      for await (const chunk of request) body += chunk;
      const value = JSON.parse(body || '{}');
      record({ type: request.url, value });
      if (request.url === '/fixture/instruct') {
        for (const stream of events) stream.write(`data: ${JSON.stringify(value)}\n\n`);
      }
      response.end('{}');
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('error', error => { record({ type: 'server-error', code: error.code }); close('server-error'); });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    record({ type: 'listening', port });
    process.stdout.write(`${JSON.stringify({ type: 'listening', port, protocol: 0 })}\nignored stdout\n`);
  });
});
