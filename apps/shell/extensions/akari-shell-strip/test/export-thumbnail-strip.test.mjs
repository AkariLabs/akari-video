import test from 'node:test';
import assert from 'node:assert/strict';
import { currentStripIndex } from '../lib/common/export-thumbnail-protocol.js';

const strip = {
    durationSeconds: 40,
    frames: Array.from({ length: 12 }, (_, index) => ({
        outputSeconds: index === 11 ? 39.967 : index / 12 * 40,
        dataUrl: undefined
    }))
};

test('0% は先頭、100% は末尾の枠を選ぶ', () => {
    assert.equal(currentStripIndex(strip, 0), 0);
    assert.equal(currentStripIndex(strip, 100), 11);
});

test('中間の進捗は最も近い時刻の枠を選ぶ', () => {
    assert.equal(currentStripIndex(strip, 50), 6);
});

test('空または未取得の帯は -1 を返す', () => {
    assert.equal(currentStripIndex({ durationSeconds: 0, frames: [] }, 50), -1);
    assert.equal(currentStripIndex(undefined, 50), -1);
});

test('進捗率を 0〜100 にクランプする', () => {
    assert.equal(currentStripIndex(strip, -20), 0);
    assert.equal(currentStripIndex(strip, 120), 11);
});
