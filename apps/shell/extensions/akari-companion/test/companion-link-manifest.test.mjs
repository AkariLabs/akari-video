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

const waitFor = async predicate => {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

async function fixtureServer(manifestFields = {}) {
  const token = 'fixture-token';
  const eventResponses = [];
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/companion/manifest?')) {
      const nonce = new URL(request.url, 'http://127.0.0.1').searchParams.get('nonce');
      const proof = createHmac('sha256', token).update(nonce).digest('hex');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ protocol: 0, name: 'fixture', proof, ...manifestFields }));
      return;
    }
    if (request.url === '/companion/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
      response.flushHeaders();
      eventResponses.push(response);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    address: { port: server.address().port, token },
    eventResponses,
    async close() {
      eventResponses.forEach(response => response.destroy());
      await new Promise(resolve => server.close(resolve));
    }
  };
}

async function observeConnection(manifestFields) {
  const fixture = await fixtureServer(manifestFields);
  const states = [];
  const link = new CompanionLink({
    readAddress: async () => fixture.address,
    execute: async instruction => ({ id: instruction.id, ok: true }),
    onConnectionState: (connected, panel) => states.push({ connected, panel })
  });
  link.start();
  await waitFor(() => states.some(state => state.connected));
  return { fixture, link, states };
}

serverTest('manifest の panelPath と panel を port と一緒に通知する', async () => {
  const observed = await observeConnection({ panelPath: '/panel', panel: { width: 480, height: 220 } });
  try {
    assert.deepEqual(observed.states[0], {
      connected: true,
      panel: { port: observed.fixture.address.port, panelPath: '/panel', panel: { width: 480, height: 220 } }
    });
    observed.fixture.eventResponses[0].end();
    await waitFor(() => observed.states.some(state => !state.connected));
    assert.deepEqual(observed.states.find(state => !state.connected), { connected: false, panel: undefined });
  } finally {
    observed.link.stop();
    await observed.fixture.close();
  }
});

serverTest('不正な panelPath は省いて接続を続ける', async () => {
  const observed = await observeConnection({ panelPath: '//evil/x' });
  try {
    assert.deepEqual(observed.states[0], {
      connected: true, panel: { port: observed.fixture.address.port }
    });
  } finally {
    observed.link.stop();
    await observed.fixture.close();
  }
});

serverTest('枠情報が無い manifest も接続を続ける', async () => {
  const observed = await observeConnection({});
  try {
    assert.deepEqual(observed.states[0], {
      connected: true, panel: { port: observed.fixture.address.port }
    });
  } finally {
    observed.link.stop();
    await observed.fixture.close();
  }
});
