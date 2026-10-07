import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeMaterialCardMeta } from '../lib/common/material-card-layout.js';

const meta = { durationSeconds: 12.5, createdAt: '2024-01-02T00:00:00.000Z', importedAt: '2024-01-03T00:00:00.000Z' };

test('analysis duration wins over probed duration', () => {
    assert.deepEqual(mergeMaterialCardMeta({ durationSeconds: 9, analyzed: true }, meta), {
        durationSeconds: 9, analyzed: true, createdAt: meta.createdAt, importedAt: meta.importedAt
    });
});

test('metadata supplies duration without analysis', () => {
    assert.deepEqual(mergeMaterialCardMeta({ analyzed: false }, meta), {
        durationSeconds: 12.5, analyzed: false, createdAt: meta.createdAt, importedAt: meta.importedAt
    });
});
