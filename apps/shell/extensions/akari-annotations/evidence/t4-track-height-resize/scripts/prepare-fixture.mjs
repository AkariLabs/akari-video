#!/usr/bin/env node
// dogfood コピー（改変禁止の原本ではなく /tmp スクラッチへの rsync 済みコピー）の edit.json に
// 2 本目の cuts トラック（track:1・timeline.tracks に t7 を追加）を 1 クリップぶんだけ足す。
// 目的: 「対象トラックのみ高さが変わる（他トラック不変）」の検証を、実在の dogfood 形状
// （v0 edit.json・実 source.mp4・温キャッシュ）を保ったまま複数 cuts トラックで行うため。
// R6c（トラック追加/削除 UI）は対象外 — ここではアプリの track-insert UI を経由せず
// 直接 JSON を書き換えるだけ（アプリは「既に複数 video トラックがある edit.json」を
// 正しく描画できる必要があり、それ自体は本タスクのスコープ内）。
//
// Usage: node prepare-fixture.mjs <workspaceDir>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , workspaceDirArg] = process.argv;
if (!workspaceDirArg) {
  console.error('usage: prepare-fixture.mjs <workspaceDir>');
  process.exit(1);
}
const editPath = path.join(workspaceDirArg, 'edit.json');

const raw = JSON.parse(await readFile(editPath, 'utf8'));
if (raw.cuts.some(c => c.track === 1)) {
  console.log('fixture already has a track:1 cut, skipping mutation');
  process.exit(0);
}

// 実素材（source.mp4）先頭 5 秒を新トラック(track:1)へ配置。実フィルムストリップ/波形が
// 生成できる本物のクリップにする（この新クリップぶんはまだキャッシュが無いので
// t1 側の「温キャッシュから即復活」検証とは意図的に区別する）。
raw.cuts.splice(1, 0, {
  in: 0,
  out: 5,
  at: 0,
  track: 1,
  transform: { x: 0 }
});

if (!raw.timeline || !Array.isArray(raw.timeline.tracks)) {
  throw new Error('expected raw.timeline.tracks to already exist (real dogfood shape)');
}
const cutsIndex = raw.timeline.tracks.findIndex(t => t.kind === 'cuts' && (t.ref ?? 0) === 0);
if (cutsIndex < 0) {
  throw new Error('expected an existing cuts/ref0 timeline track entry');
}
raw.timeline.tracks.splice(cutsIndex + 1, 0, { id: 't7', kind: 'cuts', ref: 1 });

await writeFile(editPath, JSON.stringify(raw, null, 2));
console.log('fixture prepared: added cuts track ref=1 (timeline track id=t7) with 1 clip [0,5) at t=0');
