import assert from 'node:assert/strict';
import test from 'node:test';

test('耳のサービスパスは契約どおり', async () => {
    const { AKARI_EAR_SERVICE_PATH } = await import('../lib/common/ear-protocol.js');
    assert.equal(AKARI_EAR_SERVICE_PATH, '/services/akari-ear');
});

test('区画の frontend module を公開する', async () => {
    const module = await import('../lib/browser/akari-vibe-dock-frontend-module.js');
    assert.ok(module.default);
});
