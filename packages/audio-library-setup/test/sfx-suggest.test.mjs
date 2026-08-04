import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MEANING_RULES, MEANING_VOCABULARY, suggestSfx } from '../shared/sfx-suggest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const suggestCli = path.join(here, '..', 'bin', 'suggest-sfx.mjs');
const reviewCli = path.join(here, '..', 'bin', 'review-sfx-mapping.mjs');

// akari-sounds Release v0 の SFX / ジングル全 89 id（実カタログから抽出）。
// 対応表が実在しない id を参照していないことの機械検証に使う。Release 更新時はここも更新。
const RELEASE_V0_SFX_JINGLE_IDS = new Set([
  'jingle-achievement-5s', 'jingle-comedy-4s', 'jingle-epic-8s', 'jingle-intro-001',
  'jingle-intro-tech-6s', 'jingle-intro-warm-8s', 'jingle-outro-calm-7s', 'jingle-outro-upbeat-6s',
  'jingle-question-4s', 'jingle-reveal-6s', 'jingle-transition-4s', 'sfx-bell-tree',
  'sfx-blip-beep', 'sfx-blip-marimba', 'sfx-blip-pluck', 'sfx-blip-sine',
  'sfx-blip-xylophone', 'sfx-chime-success', 'sfx-click-bottlecap', 'sfx-click-bright-blip',
  'sfx-click-button-deep', 'sfx-click-camera-shutter', 'sfx-click-clock-tick', 'sfx-click-glass-tap',
  'sfx-click-hollow', 'sfx-click-latch', 'sfx-click-mouse-double', 'sfx-click-mouse-single',
  'sfx-click-soft-ui', 'sfx-click-thock', 'sfx-click-typewriter', 'sfx-click-wood-knock',
  'sfx-comedy-boing', 'sfx-comedy-slide-up', 'sfx-correct-tone', 'sfx-crinkle-short',
  'sfx-ding-single', 'sfx-ding-triple', 'sfx-glitch-stutter-001', 'sfx-glitch-stutter-heavy',
  'sfx-glitch-zap', 'sfx-harp-gliss', 'sfx-heartbeat-single', 'sfx-impact-boom-001',
  'sfx-impact-boom-big', 'sfx-impact-echo', 'sfx-levelup-arp', 'sfx-pickup-blip',
  'sfx-pop-bubble-big', 'sfx-pop-bubble-small', 'sfx-pop-click-001', 'sfx-pop-cork',
  'sfx-pop-ding', 'sfx-pop-fizz', 'sfx-powerdown', 'sfx-powerup',
  'sfx-record-scratch', 'sfx-reverse-swell-001', 'sfx-riser-drum-3s', 'sfx-riser-long-001',
  'sfx-riser-noise-2s', 'sfx-riser-sub-3s', 'sfx-riser-tension-5s', 'sfx-riser-tonal-3s',
  'sfx-riser-vinyl-2s', 'sfx-sand-crunch', 'sfx-scan-sweep', 'sfx-shimmer-sparkle',
  'sfx-slime-squish', 'sfx-snap-dry', 'sfx-star-twinkle', 'sfx-sub-drop-001',
  'sfx-swoosh-down', 'sfx-swoosh-stinger', 'sfx-swoosh-up', 'sfx-tap-castanet',
  'sfx-tap-rim', 'sfx-tap-woodblock', 'sfx-tape-peel', 'sfx-tape-stop-001',
  'sfx-water-bloop', 'sfx-whoosh-air-fast', 'sfx-whoosh-air-soft', 'sfx-whoosh-fabric',
  'sfx-whoosh-long-001', 'sfx-whoosh-paper', 'sfx-whoosh-punchy', 'sfx-whoosh-slow',
  'sting-riser-hit-001',
]);

test('MEANING_RULES は語彙 14 行と完全一致し、first の全 id が Release v0 に実在する（typo 検出）', () => {
  assert.deepEqual(Object.keys(MEANING_RULES).sort(), [...MEANING_VOCABULARY].sort());
  for (const [meaning, rule] of Object.entries(MEANING_RULES)) {
    for (const id of rule.first) {
      assert.ok(RELEASE_V0_SFX_JINGLE_IDS.has(id), `${meaning}: 実在しない id ${id}`);
    }
    assert.ok(rule.first.length + rule.external.length > 0, `${meaning}: 候補が空`);
  }
});

test('external 参照はカタログ登録エントリまたは candidates v2 の存続カードを指す（宙に浮いた参照を作らない）', async () => {
  const candidates = JSON.parse(await readFile(path.join(repoRoot, 'catalog', 'audio', 'candidates.json'), 'utf8'));
  const cardIds = new Set(candidates.categories.flatMap((c) => c.items.map((item) => item.id)));
  for (const rule of Object.values(MEANING_RULES)) {
    for (const entry of rule.external) {
      const catalogDir = path.join(repoRoot, 'catalog', 'audio', entry.id);
      assert.ok(
        existsSync(path.join(catalogDir, 'meta.json')) || cardIds.has(entry.id),
        `external 参照先が見つからない: ${entry.id}`,
      );
    }
  }
});

const FIXTURE = {
  tracks: [
    { id: 'jingle-achievement-5s', title: 'Fanfare', kind: 'jingle', files: [{ file: 'jingle-achievement-5s.wav', mp3: 'jingle-achievement-5s.mp3', duration_sec: 5.2 }] },
    { id: 'sfx-chime-success', title: 'Chime', kind: 'sfx', files: [{ file: 'sfx-chime-success.wav', mp3: 'sfx-chime-success.mp3', duration_sec: 1.1 }] },
  ],
};

test('suggestSfx: 宣言順のまま返し、カタログに無い id は absent で正直に返す', () => {
  const result = suggestSfx(FIXTURE, { meaning: '達成・正解' });
  assert.equal(result.first[0].id, 'jingle-achievement-5s');
  assert.equal(result.first[0].kind, 'jingle');
  assert.equal(result.first[0].takes[0].duration_sec, 5.2);
  assert.equal(result.first[1].id, 'sfx-chime-success');
  assert.equal(result.first[2].absent, true, 'フィクスチャに無い sfx-correct-tone は absent');

  assert.throws(() => suggestSfx(FIXTURE, { meaning: '爆発' }), /語彙に無い値/);
});

test('suggestSfx: 外部補完だけの意味（拍手・祝福）も返せる', () => {
  const result = suggestSfx(FIXTURE, { meaning: '拍手・祝福' });
  assert.equal(result.first.length, 0);
  assert.ok(result.external.length >= 1);
  assert.ok(result.external.every((e) => typeof e.note === 'string' && e.note.length > 0));
});

test('CLI suggest-sfx: --json で候補 + ローカルパス + 外部補完の owned 判定を返す', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-sfx-suggest-'));
  try {
    const catalogPath = path.join(root, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify(FIXTURE));
    const result = spawnSync(process.execPath, [
      suggestCli, '--meaning', '達成・正解', '--catalog', catalogPath, '--json',
    ], { encoding: 'utf8', env: { ...process.env, AKARI_HOME: path.join(root, '.akari') } });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.first[0].takes[0].path.includes('akari-sounds-jingle'));
    assert.equal(parsed.first[0].takes[0].exists, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI suggest-sfx: --list は語彙を出し、未導入 + --catalog なしは akari sounds を案内して exit 1', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-sfx-suggest-empty-'));
  try {
    const env = { ...process.env, AKARI_HOME: path.join(root, '.akari') };
    const list = spawnSync(process.execPath, [suggestCli, '--list'], { encoding: 'utf8', env });
    assert.equal(list.status, 0);
    assert.equal(list.stdout.trim().split('\n').length, MEANING_VOCABULARY.length);

    const missing = spawnSync(process.execPath, [suggestCli, '--meaning', '場面転換'], { encoding: 'utf8', env });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /akari sounds/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI review-sfx-mapping: 全 14 意味の節を持つ自己完結 HTML を書き出す（未取得は正直表示）', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-sfx-review-'));
  try {
    const catalogPath = path.join(root, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify(FIXTURE));
    const outPath = path.join(root, 'review.html');
    const result = spawnSync(process.execPath, [
      reviewCli, '--catalog', catalogPath, '--out', outPath,
    ], { encoding: 'utf8', env: { ...process.env, AKARI_HOME: path.join(root, '.akari') } });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(outPath, 'utf8');
    for (const meaning of MEANING_VOCABULARY) {
      assert.ok(html.includes(`data-meaning="${meaning}"`), `意味の節が無い: ${meaning}`);
    }
    assert.match(html, /未取得/);
    assert.match(html, /判定を保存/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
