import assert from 'node:assert/strict';
import test from 'node:test';
import { startBrowseServer } from '../src/browse-server.mjs';
import { setupFixtureEnv } from './helpers.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

async function renderBrowseItem(item) {
  const app = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'browse', 'app.js'), 'utf8');
  const elements = new Map();
  const element = () => ({
    innerHTML: '', appended: [], textContent: '',
    addEventListener(name, fn) { this[`on_${name}`] = fn; },
    append(child) { this.appended.push(child); },
    querySelector() { return element(); },
  });
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    createElement() {
      const template = { content: {} };
      Object.defineProperty(template, 'innerHTML', {
        set(html) { template.content.firstElementChild = { ...element(), html }; },
      });
      return template;
    },
  };
  await runInNewContext(app, {
    document,
    fetch: async () => ({ json: async () => ({ home: '/fixture', items: [item] }) }),
    localStorage: { getItem: () => null },
  });
  const grid = elements.get('#grid').appended[0];
  grid.on_click();
  return { card: grid.html, detail: elements.get('#detail').appended[0].html };
}

test('browse server: /api/items → 一覧、/api/fetch → 取得してライブラリに登録', async () => {
  const { env } = setupFixtureEnv();
  const port = 18910 + Math.floor(Math.random() * 500);
  const server = await startBrowseServer({ env, port, log: () => {} });

  try {
    const itemsRes = await fetch(`http://127.0.0.1:${port}/api/items`);
    assert.equal(itemsRes.status, 200);
    const { items } = await itemsRes.json();
    assert.equal(items.length, 2);
    assert.ok(items.some((i) => i.id === 'mini-still' && i.state === 'available'));
    assert.equal(Object.hasOwn(items.find((i) => i.id === 'mini-paid'), 'files'), false);

    const indexRes = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(indexRes.status, 200);
    assert.match(await indexRes.text(), /AKARI Video/);

    const fetchRes = await fetch(`http://127.0.0.1:${port}/api/fetch`, {
      method: 'POST',
      body: JSON.stringify({ id: 'mini-still' }),
    });
    assert.equal(fetchRes.status, 200);
    const body = await fetchRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.cached, false);

    const itemsAfter = await (await fetch(`http://127.0.0.1:${port}/api/items`)).json();
    assert.ok(itemsAfter.items.some((i) => i.id === 'mini-still' && i.state === 'cached'));

    const lockedRes = await fetch(`http://127.0.0.1:${port}/api/fetch`, {
      method: 'POST',
      body: JSON.stringify({ id: 'mini-paid' }),
    });
    assert.equal(lockedRes.status, 403);
  } finally {
    server.close();
  }
});

test('browse server: locked Pro file URLs do not appear in /api/items', async () => {
  const { env, catalog, catalogPath } = setupFixtureEnv();
  catalog.items[1].files = [{ name: 'private.mp3', url: 'https://example.invalid/private.mp3' }];
  writeFileSync(catalogPath, JSON.stringify(catalog));
  const server = await startBrowseServer({ env, port: 0, log: () => {} });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/items`);
    const body = await response.json();
    const paid = body.items.find(item => item.id === 'mini-paid');
    assert.equal(paid.state, 'locked');
    assert.equal(Object.hasOwn(paid, 'files'), false);
    assert.equal(JSON.stringify(body).includes('private.mp3'), false);
    const media = await fetch(`http://127.0.0.1:${address.port}/media/mini-paid`);
    assert.equal(media.status, 404);
  } finally {
    server.close();
  }
});

test('browse server: cached Pro audio is served and unavailable audio has no player flag', async () => {
  const { env, home, catalog, catalogPath } = setupFixtureEnv();
  catalog.items[1].category = 'audio';
  catalog.items[1].preview = 'preview.png';
  writeFileSync(catalogPath, JSON.stringify(catalog));
  const server = await startBrowseServer({ env, port: 0, log: () => {} });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const before = await (await fetch(`${url}/api/items`)).json();
    assert.equal(before.items.find(item => item.id === 'mini-paid').mediaAvailable, false);
    assert.equal((await fetch(`${url}/media/mini-paid`)).status, 404);

    const dir = path.join(home, 'assets', 'audio', 'mini-paid');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'take.mp3'), 'local audio');
    const after = await (await fetch(`${url}/api/items`)).json();
    assert.equal(after.items.find(item => item.id === 'mini-paid').mediaAvailable, true);
    const response = await fetch(`${url}/media/mini-paid`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'local audio');
  } finally { server.close(); }
});

test('browse server: entitled Pro audio with a media descriptor can be served', async () => {
  const { env, home, catalog, catalogPath } = setupFixtureEnv();
  catalog.items[1].category = 'audio';
  catalog.items[1].files = [{ name: 'take.mp3', url: 'https://example.invalid/take.mp3' }];
  writeFileSync(catalogPath, JSON.stringify(catalog));
  writeFileSync(path.join(home, 'store-credentials.json'), JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_test' }));
  const fetchImpl = async () => ({ ok: true, json: async () => ({ entitlements: ['all-access-pass'] }) });
  const server = await startBrowseServer({ env, fetchImpl, port: 0, log: () => {} });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const state = await (await fetch(`${url}/api/items`)).json();
    assert.equal(state.items.find(item => item.id === 'mini-paid').mediaAvailable, true);
    const media = await fetch(`${url}/media/mini-paid`, { redirect: 'manual' });
    assert.equal(media.status, 302);
    assert.equal(media.headers.get('location'), 'https://example.invalid/take.mp3');
  } finally { server.close(); }
});

test('browse server: entitled Pro audio preview works without public files', async () => {
  const { env, home, catalog, catalogPath } = setupFixtureEnv();
  catalog.items[1].category = 'audio';
  catalog.items[1].preview = 'https://example.invalid/preview.mp3';
  writeFileSync(catalogPath, JSON.stringify(catalog));
  writeFileSync(path.join(home, 'store-credentials.json'), JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_test' }));
  const fetchImpl = async () => ({ ok: true, json: async () => ({ entitlements: ['all-access-pass'] }) });
  const server = await startBrowseServer({ env, fetchImpl, port: 0, log: () => {} });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const state = await (await fetch(`${url}/api/items`)).json();
    assert.equal(state.items.find(item => item.id === 'mini-paid').mediaAvailable, true);
    const media = await fetch(`${url}/media/mini-paid`, { redirect: 'manual' });
    assert.equal(media.status, 302);
    assert.equal(media.headers.get('location'), catalog.items[1].preview);
  } finally { server.close(); }
});

test('browse app omits audio controls when media is unavailable', async () => {
  const item = { id: 'audio-one', title: 'Audio', category: 'audio', state: 'locked', tier: 'pro' };
  assert.doesNotMatch((await renderBrowseItem({ ...item, mediaAvailable: false })).detail, /<audio\b/);
  assert.match((await renderBrowseItem({ ...item, mediaAvailable: true })).detail, /<audio\b/);
});
