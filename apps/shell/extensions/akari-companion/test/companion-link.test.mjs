import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { CompanionLink } from '../lib/node/companion-link.js';

const LOCAL_SERVER_AVAILABLE = await new Promise(resolve => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.listen(0, '127.0.0.1', () => probe.close(() => resolve(true)));
});
const serverTest = LOCAL_SERVER_AVAILABLE
  ? test
  : (name, fn) => test(name, { skip: 'sandbox cannot bind a localhost fixture server' }, fn);

const waitFor = async (predicate, message = 'timed out') => {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

async function fixtureServer({ validProof = true } = {}) {
  const token = 'fixture-token';
  const posts = [];
  const eventResponses = [];
  const eventHeaders = [];
  let manifests = 0;
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/companion/manifest?')) {
      manifests += 1;
      const nonce = new URL(request.url, 'http://127.0.0.1').searchParams.get('nonce');
      const proof = validProof
        ? createHmac('sha256', token).update(nonce).digest('hex')
        : '0'.repeat(64);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ protocol: 0, name: 'fixture', proof }));
      return;
    }
    if (request.url === '/companion/events') {
      eventHeaders.push(request.headers);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      response.flushHeaders();
      eventResponses.push(response);
      return;
    }
    if (request.method === 'POST' && request.url?.startsWith('/companion/')) {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        posts.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        response.writeHead(204);
        response.end();
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = { port: server.address().port, token };
  return {
    address, posts, eventResponses, eventHeaders,
    manifests: () => manifests,
    send(index, instruction) {
      eventResponses[index].write(`id: ${instruction.id}\ndata: ${JSON.stringify(instruction)}\n\n`);
    },
    async close() {
      eventResponses.forEach(response => response.destroy());
      await new Promise(resolve => server.close(resolve));
    }
  };
}

serverTest('manifest の proof が不正なら実行も状態送信もしない', async () => {
  const fixture = await fixtureServer({ validProof: false });
  let executions = 0;
  const link = new CompanionLink({
    readAddress: async () => fixture.address,
    execute: async instruction => { executions += 1; return { id: instruction.id, ok: true }; }
  });
  try {
    link.start();
    await waitFor(() => fixture.manifests() === 1);
    await new Promise(resolve => setTimeout(resolve, 30));
    await link.sendState({ type: 'light', seq: 1, selection: [], panels: [] });
    assert.equal(executions, 0);
    assert.equal(fixture.posts.length, 0);
    assert.equal(fixture.eventResponses.length, 0);
  } finally {
    link.stop();
    await fixture.close();
  }
});

serverTest('SSE を順に実行し重複を再実行せず light/docs を各 1 POST で送る', async () => {
  const fixture = await fixtureServer();
  let executions = 0;
  const link = new CompanionLink({
    readAddress: async () => fixture.address,
    execute: async instruction => {
      executions += 1;
      return { id: instruction.id, ok: true, value: { done: true } };
    }
  });
  try {
    link.start();
    await waitFor(() => fixture.eventResponses.length === 1);
    const instruction = { id: 'one', kind: 'getState' };
    fixture.send(0, instruction);
    await waitFor(() => fixture.posts.filter(post => post.path === '/companion/results').length === 1);
    fixture.send(0, instruction);
    await waitFor(() => fixture.posts.filter(post => post.path === '/companion/results').length === 2);
    assert.equal(executions, 1);
    await link.sendState({ type: 'light', seq: 1, selection: [], panels: [] });
    await link.sendState({
      type: 'docs', seq: 2, projectSessionId: 'session-1',
      edit: { sha256: 'a', text: '{}' }, captions: { sha256: 'b', text: '[]' }
    });
    const states = fixture.posts.filter(post => post.path === '/companion/state').map(post => post.body);
    assert.deepEqual(states.map(state => state.type), ['light', 'docs']);
    link.stop();
    const count = fixture.posts.length;
    await link.sendState({ type: 'light', seq: 3, selection: [], panels: [] });
    assert.equal(fixture.posts.length, count);
  } finally {
    link.stop();
    await fixture.close();
  }
});

serverTest('実行中を含む 64 件を超えた指示へ busy を返す', async () => {
  const fixture = await fixtureServer();
  let executions = 0;
  const never = new Promise(() => {});
  const link = new CompanionLink({
    readAddress: async () => fixture.address,
    execute: async instruction => { executions += 1; await never; return { id: instruction.id, ok: true }; }
  });
  try {
    link.start();
    await waitFor(() => fixture.eventResponses.length === 1);
    for (let index = 1; index <= 65; index += 1) {
      fixture.send(0, { id: `q-${index}`, kind: 'getState' });
    }
    await waitFor(() => fixture.posts.some(post => post.body.error === 'busy'));
    const busy = fixture.posts.find(post => post.body.error === 'busy');
    assert.equal(busy.body.id, 'q-65');
    assert.equal(executions, 1);
  } finally {
    link.stop();
    await fixture.close();
  }
});

serverTest('dropQueued は未実行分を stale-session で返す', async () => {
  const fixture = await fixtureServer();
  let executions = 0;
  const never = new Promise(() => {});
  const link = new CompanionLink({
    readAddress: async () => fixture.address,
    execute: async instruction => { executions += 1; await never; return { id: instruction.id, ok: true }; }
  });
  try {
    link.start();
    await waitFor(() => fixture.eventResponses.length === 1);
    fixture.send(0, { id: 'active', kind: 'getState' });
    fixture.send(0, { id: 'queued-1', kind: 'getState' });
    fixture.send(0, { id: 'queued-2', kind: 'getState' });
    await waitFor(() => executions === 1);
    link.dropQueued('stale-session');
    await waitFor(() => fixture.posts.filter(post => post.body.error === 'stale-session').length === 2);
    assert.equal(executions, 1);
  } finally {
    link.stop();
    await fixture.close();
  }
});

serverTest('再接続で Last-Event-ID を送り backoff を 2/5/10 秒にする', async () => {
  const fixture = await fixtureServer();
  const timers = [];
  let addressAvailable = true;
  const link = new CompanionLink({
    readAddress: async () => addressAvailable ? fixture.address : undefined,
    execute: async instruction => ({ id: instruction.id, ok: true }),
    setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimeout: timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); }
  });
  try {
    link.start();
    await waitFor(() => fixture.eventResponses.length === 1);
    fixture.send(0, { id: 'processed-1', kind: 'getState' });
    await waitFor(() => fixture.posts.some(post => post.path === '/companion/results'));
    fixture.eventResponses[0].end();
    await waitFor(() => timers.length === 1);
    assert.equal(timers[0].ms, 2000);
    timers.shift().fn();
    await waitFor(() => fixture.eventResponses.length === 2);
    assert.equal(fixture.eventHeaders[1]['last-event-id'], 'processed-1');
    addressAvailable = false;
    fixture.eventResponses[1].end();
    await waitFor(() => timers.length === 1);
    assert.equal(timers[0].ms, 2000);
    timers.shift().fn();
    await waitFor(() => timers.length === 1);
    assert.equal(timers[0].ms, 5000);
    timers.shift().fn();
    await waitFor(() => timers.length === 1);
    assert.equal(timers[0].ms, 10000);
    timers.shift().fn();
    await waitFor(() => timers.length === 1);
    assert.equal(timers[0].ms, 10000);
  } finally {
    link.stop();
    await fixture.close();
  }
});
