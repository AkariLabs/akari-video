import assert from 'node:assert/strict';
import test from 'node:test';
import { formatConnections } from '../../lib/common/credentials-file.js';

test('設定の provider 表で Fish Audio と Google AI（Gemini）が fal の次に並ぶ', () => {
    const provider = (id, env) => ({ id, auth: 'env-key', env: '${' + env + '}',
        notes: { description: '読み上げ', setup_url: 'https://example.invalid/keys' } });
    const rows = formatConnections([
        provider('google-ai', 'GEMINI_API_KEY'), provider('openrouter', 'OPENROUTER_API_KEY'),
        provider('fish-audio', 'FISH_AUDIO_API_KEY'), provider('fal', 'FAL_KEY')
    ], { values: new Map(), exists: false, secure_permissions: true });
    assert.deepEqual(rows.map(row => row.id), ['fal', 'fish-audio', 'google-ai', 'openrouter']);
    assert.equal(rows[1].label, 'Fish Audio');
    assert.equal(rows[2].label, 'Google AI（Gemini）');
    assert.equal(rows[1].doctor.status, 'unconfigured');
});
