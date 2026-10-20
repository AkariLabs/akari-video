import assert from 'node:assert/strict';
import test from 'node:test';
import { adapters, inspectProvider } from '../bin/doctor.mjs';

test('Fish と Google の doctor は鍵をヘッダに置く無料 GET だけを使う', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, body: { cancel: async () => {} } };
  };
  const when = '2026-09-24T00:00:00.000Z';
  for (const [id, name] of [['fish-audio', 'FISH_AUDIO_API_KEY'], ['google-ai', 'GEMINI_API_KEY']]) {
    const result = await inspectProvider({ id, auth: 'env-key', env: '${' + name + '}' },
      { values: new Map() }, when, { env: { [name]: 'dummy-not-a-real-key' } });
    assert.equal(result.doctor.status, 'ok');
    assert.equal(result.key_source, 'env');
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.fish.audio/wallet/self/api-credit');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer dummy-not-a-real-key');
  assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/models');
  assert.equal(calls[1].options.headers['x-goog-api-key'], 'dummy-not-a-real-key');
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.ok(!call.url.includes('dummy-not-a-real-key'));
  }
  assert.ok(adapters['fish-audio'] && adapters['google-ai']);
});
