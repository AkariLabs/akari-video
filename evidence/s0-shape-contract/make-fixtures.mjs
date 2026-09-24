#!/usr/bin/env node

// 検証専用: 棚（presets/shapes/index.jsonl）から値で写した図形を手書き相当の edit.json に並べる。
// 段直下に v1 の 7 種（1 段に 1 個）、group の中に v0 の旧データ 3 種（既定色の rect・rounded-rect・arrow）を置く。
//
// 使い方: node evidence/s0-shape-contract/make-fixtures.mjs > <出力の edit.json>

import { readFileSync } from 'node:fs';

const rows = new Map(readFileSync(new URL('../../presets/shapes/index.jsonl', import.meta.url), 'utf8')
  .trimEnd().split('\n').map(line => JSON.parse(line)).map(row => [row.id, row]));

function copied(id, overrides = {}) {
  const row = rows.get(id);
  if (!row) throw new Error(`preset not found: ${id}`);
  if (row.kind === 'line') return { kind: 'shape', shape: 'line', params: { ...row.defaults, preset: id, ...overrides } };
  if (row.kind === 'bubble') return { kind: 'shape', shape: 'bubble', params: { ...row.defaults, preset: id, ...overrides } };
  const base = row.rounded_from ? rows.get(row.rounded_from.base) : row;
  return { kind: 'shape', shape: 'path', params: {
    ...row.defaults,
    preset: id,
    path: { d: base.d, vb: base.vb, ...(base.rule ? { rule: base.rule } : {}) },
    ...overrides,
  } };
}

// 1920×1080 を 4 列 × 3 行のます目に割り、ますの左上 + 余白に置く。
const cell = (column, row) => ({ x: column * 480 + 60, y: row * 360 + 50 });
const item = (id, source, column, row) => ({ id, at: 0, duration: 60, transform: cell(column, row), source });

const direct = [
  item('s-star', copied('star-5', { width: 260, height: 260 }), 0, 0),
  item('s-heart', copied('heart-heart', { width: 260, height: 240, fill: '#e11d48' }), 1, 0),
  item('s-rounded-40', copied('basic-square', { width: 320, height: 220, cornerRadius: 40, fill: '#2563eb' }), 2, 0),
  item('s-shout', copied('manga-shout', { width: 340, height: 240 }), 3, 0),
  item('s-dash-arrows', copied('line-dash-tri-tri', { width: 360, height: 60, strokeWidth: 8 }), 0, 1),
  item('s-gradient-circle', copied('basic-circle', { width: 260, height: 260,
    fill: { type: 'linear', angle: 90, stops: [{ color: '#f59e0b', offset: 0 }, { color: '#7c3aed', offset: 1 }] } }), 1, 1),
  item('s-hexagon-ring', copied('polygon-hexagon', { width: 280, height: 260, fill: 'none', stroke: '#16a34a', strokeWidth: 20 }), 2, 1),
];

const legacy = [
  item('v0-rect', { kind: 'shape', shape: 'rect', params: { width: 300, height: 200 } }, 0, 2),
  item('v0-rounded-rect', { kind: 'shape', shape: 'rounded-rect', params: { width: 300, height: 200, fill: '#0ea5e9' } }, 1, 2),
  item('v0-arrow', { kind: 'shape', shape: 'arrow', params: { width: 320, height: 80, stroke: '#111827' } }, 2, 2),
];

const edit = {
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [],
  tracks: [
    { id: 'v-bg', lane: 'visual', name: '背景', items: [
      { id: 'bg', at: 0, duration: 60, source: { kind: 'shape', shape: 'rect',
        params: { width: 1920, height: 1080, fill: '#f5f5f4' } } }] },
    // 同じ段の item は時間で重ねられないので、段直下の図形は 1 段に 1 個ずつ置く。
    ...direct.map(entry => ({ id: `v-${entry.id}`, lane: 'visual', name: entry.id, items: [entry] })),
    { id: 'v-legacy', lane: 'visual', name: '旧データ', items: [
      { id: 'legacy-group', at: 0, duration: 60, source: { kind: 'group' }, items: legacy }] },
  ],
};

process.stdout.write(`${JSON.stringify(edit, null, 2)}\n`);
