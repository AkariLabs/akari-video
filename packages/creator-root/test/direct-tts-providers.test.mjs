import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONNECTIONS_REGISTRY } from '../src/index.mjs';

test('Fish と Google AI の既定 provider に鍵の席とモデルを持つ', () => {
  const providers = DEFAULT_CONNECTIONS_REGISTRY.providers;
  for (const [id, name, model] of [
    ['fish-audio', 'FISH_AUDIO_API_KEY', 's2.1-pro'],
    ['google-ai', 'GEMINI_API_KEY', 'gemini-3.8-flash-tts'],
  ]) {
    const provider = providers.find(row => row.id === id);
    assert.equal(provider.kind, 'tts');
    assert.equal(provider.auth, 'env-key');
    assert.equal(provider.env, '${' + name + '}');
    assert.equal(provider.models.default, model);
    assert.ok(provider.models.allowed.includes(model));
    assert.match(provider.notes.setup_url, /^https:\/\//);
  }
  // 候補の drama-3 は許可するが、既定は従来どおり s2.1-pro のまま。
  const fish = providers.find(row => row.id === 'fish-audio');
  assert.deepEqual(fish.models, { default: 's2.1-pro', allowed: ['s2.1-pro', 'drama-3'] });
});
