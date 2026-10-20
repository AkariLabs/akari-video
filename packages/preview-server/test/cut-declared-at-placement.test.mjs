// 実機バグ 2026-10-20 §1（task/2026-10-20-cuts-keep-declared-at）— プレビュー側の再現。
//
// preview-server の frame-engine-client.ts `normalizedCuts` は、v2 の legacy 投影 cuts を
// frame-engine の連結チェーンへ渡す直前に、直前の終端より前の `at` を捨てる（freeze /
// トランジションの再計算のため）。旧 cuts 投影では別種別トラックの media が同じ `track`
// 番号に衝突していたため、複数物理トラックの静止画が 1 本の連結になり、宣言 at を失って
// 166.8 秒から前詰めに並んでいた。ここでは実物の normalizedCuts を抽出して、
// 報告の構成の各 media アイテムが宣言 at に置かれ、総尺が edit.json の 177.2 秒に
// なることを検査する。

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url);
const { computeCutTrackSegments, projectLegacyEdit, readInternalEdit } =
  require('../../edit-store/lib/index.js');

const CLIENT = path.resolve(import.meta.dirname, '..', 'src', 'frame-engine-client.ts');
const FPS = 30;

function reportedFixture() {
  return {
    version: 2,
    output: { width: 1920, height: 1080, fps: FPS },
    sources: [
      { id: 'bg', path: 'assets/bg.png' },
      { id: 'photo-1', path: 'assets/photo-1.jpg' },
      { id: 'photo-2', path: 'assets/photo-2.jpg' },
      { id: 'card', path: 'assets/card.png' },
    ],
    tracks: [
      {
        id: 'bg-track',
        lane: 'visual',
        items: [
          { id: 'terrain', at: 0, duration: 5004, source: { kind: 'html', path: 'overlays/terrain.html' } },
          { id: 'bg-1', at: 5004, duration: 312, source: { kind: 'media', src: 'bg', in: 0, out: 312 } },
        ],
      },
      {
        id: 'photo-track',
        lane: 'visual',
        items: [
          { id: 'photo-1', at: 1000, duration: 300, source: { kind: 'media', src: 'photo-1', in: 0, out: 300 } },
          { id: 'photo-2', at: 1400, duration: 300, source: { kind: 'media', src: 'photo-2', in: 0, out: 300 } },
        ],
      },
      {
        id: 'card-track',
        lane: 'visual',
        items: [
          { id: 'card-1', at: 390, duration: 150, source: { kind: 'media', src: 'card', in: 0, out: 150 } },
        ],
      },
    ],
  };
}

async function loadNormalizedCuts() {
  const source = await readFile(CLIENT, 'utf8');
  const start = source.indexOf('function normalizedCuts(');
  const end = source.indexOf('function resolvedEngineLayers(');
  assert.ok(start >= 0 && end > start, `${CLIENT}: normalizedCuts not found`);
  const { code } = transformSync(source.slice(start, end), { loader: 'ts', format: 'esm' });
  return vm.runInNewContext(`const resolvedItemAdjust = item => item; ${code}; normalizedCuts`, {});
}

test('報告 §1: 別トラックの単独静止画が preview の連結で宣言 at に置かれる', async () => {
  const normalizedCuts = await loadNormalizedCuts();
  const legacy = projectLegacyEdit(readInternalEdit(reportedFixture()));
  const normalized = normalizedCuts({ version: 1, sources: legacy.sources, cuts: legacy.cuts });
  const placed = computeCutTrackSegments(normalized.map(cut => ({
    ...cut,
    transitionOut: cut.transition_out,
  })));

  const declared = new Map(legacy.cuts.map(cut => [String(cut.src), Number(cut.at)]));
  for (const segment of placed) {
    const src = String(normalized[segment.index].src);
    const at = declared.get(src);
    assert.ok(Math.abs(segment.at - at) <= 1 / FPS,
      `${src}: declared at ${at} but placed at ${segment.at}`);
  }

  // 166.8 + 10.4 秒。前詰め（166.8 から）になっていないこと。
  assert.ok(Math.abs(Math.max(...placed.map(segment => segment.end)) - 177.2) <= 1 / FPS,
    `totalDuration ${Math.max(...placed.map(segment => segment.end))}`);
});
