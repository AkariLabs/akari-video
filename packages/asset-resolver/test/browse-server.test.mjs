import assert from 'node:assert/strict';
import test from 'node:test';
import { startBrowseServer } from '../src/browse-server.mjs';
import { setupFixtureEnv } from './helpers.mjs';
import { writeFileSync } from 'node:fs';

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
