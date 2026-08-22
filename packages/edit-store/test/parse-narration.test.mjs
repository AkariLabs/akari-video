import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEdit } from '../lib/migrate/legacy-parse.js';

const base = {
  version: 0,
  output: { width: 1280, height: 720, fps: 30 },
  source: { path: 'source.mp4', proxy: null },
  cuts: [{ in: 0, out: 5 }]
};

test('parseEdit は audio.narration を表示用最小形で返す', () => {
  const parsed = parseEdit(JSON.stringify({
    ...base,
    audio: {
      narration: [
        { id: 'n-0001', path: 'narration/n-0001.mp3', t: 1.5, gain_db: -6, script: 'こんにちは', reading: 'こんにちわ', provenance: { provider: 'voicevox', credit: 'VOICEVOX:テスト' } },
        { id: 'n-0002', path: 'narration/n-0002.mp3', t: 6, provenance: { provider: 'human' } }
      ]
    }
  }));
  assert.equal(parsed.audioNarration.length, 2);
  assert.deepEqual(parsed.audioNarration[0], {
    id: 'n-0001', t: 1.5, path: 'narration/n-0001.mp3', gainDb: -6, script: 'こんにちは',
    reading: 'こんにちわ', provenance: { provider: 'voicevox', credit: 'VOICEVOX:テスト' }
  });
  assert.deepEqual(parsed.audioNarration[1], {
    id: 'n-0002', t: 6, path: 'narration/n-0002.mp3', provenance: { provider: 'human' }
  });
  assert.equal(parsed.warnings.length, 0);
});

test('parseEdit は不正・重複ナレーションを警告つきで除外する', () => {
  const parsed = parseEdit(JSON.stringify({
    ...base,
    audio: {
      narration: [
        { id: 'n-0001', path: 'a.mp3', t: 0 },
        { id: 'n-0001', path: 'b.mp3', t: 1 },
        { id: 'n-0003', path: '', t: 2 },
        { id: 'n-0004', path: 'c.mp3', t: -1 },
        { id: 'n-0005', path: 'd.mp3', t: 3, gain_db: 99 }
      ]
    }
  }));
  assert.deepEqual(parsed.audioNarration.map(n => n.id), ['n-0001', 'n-0005']);
  assert.equal(parsed.audioNarration[1].gainDb, undefined);
  assert.ok(parsed.warnings.length >= 4);
});

test('parseEdit は narration 無しでも空配列を返す（後方互換）', () => {
  const parsed = parseEdit(JSON.stringify(base));
  assert.deepEqual(parsed.audioNarration, []);
});
