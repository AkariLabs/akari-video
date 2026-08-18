// 保存バイト等価の検証（ラッパー独立実測）。
// 旧 = HEAD の packages/edit-store/lib（$SP/baseline 側）、新 = worktree の同 lib。
// moveCut 系の書き込み全文が旧経路（moveCutInSource → 必要なら writeTimelineTracksInSource の 2 段）と
// 新経路（moveCutAndPruneTracksInSource の 1 段）でバイト一致することを確かめる。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [, , oldLib, newLib, fieldtestEdit] = process.argv;
const OLD = require(oldLib);
const NEW = require(newLib);

let failures = 0;
function check(name, expected, actual) {
  const ok = expected === actual;
  if (!ok) failures++;
  const eb = Buffer.from(expected, 'utf8');
  const ab = Buffer.from(actual, 'utf8');
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} (old ${eb.length}B / new ${ab.length}B, sha eq=${eb.equals(ab)})`);
  if (!ok) {
    for (let i = 0; i < Math.max(eb.length, ab.length); i++) {
      if (eb[i] !== ab[i]) { console.log(`  first diff at byte ${i}: old=${JSON.stringify(expected.slice(i - 40, i + 40))} new=${JSON.stringify(actual.slice(i - 40, i + 40))}`); break; }
    }
  }
}

// 1) 実プロジェクト（fieldtest）の edit.json、prune なしの移動
const real = readFileSync(fieldtestEdit, 'utf8');
for (const [at, track] of [[13.5, undefined], [0, undefined], [2.25, 1], [7, 0]]) {
  check(
    `fieldtest moveCut at=${at} track=${track}`,
    OLD.moveCutInSource(real, 0, at, track),
    NEW.moveCutAndPruneTracksInSource(real, 0, at, track, undefined, []).source
  );
}

// 2) trackState 付き（トラック挿入経路）
const state = { '0': 1 };
check(
  'fieldtest moveCut with trackState',
  OLD.moveCutInSource(real, 0, 3, undefined, state),
  NEW.moveCutAndPruneTracksInSource(real, 0, 3, undefined, state, []).source
);

// 3) 宣言済みトラックありの合成 fixture、prune ありの移動（旧 2 段 = 新 1 段）
const declared = `${JSON.stringify({
  version: 0,
  output: { width: 1920, height: 1080, fps: 30 },
  source: { path: 'media/source.mov' },
  cuts: [
    { in: 0, out: 2, at: 0, track: 0 },
    { in: 2, out: 4, at: 0, track: 1 }
  ],
  timeline: {
    tracks: [
      { id: 'cuts-0', kind: 'cuts', ref: 0, label: 'クリップ 1' },
      { id: 'cuts-1', kind: 'cuts', ref: 1 }
    ]
  }
}, null, 2)}\n`;

// 旧経路の再現: moveCut を書いたあと、reload 後の「空になった宣言」を writeTimelineTracksInSource で消す
const oldStep1 = OLD.moveCutInSource(declared, 0, 4, 1);
const oldParsed = JSON.parse(oldStep1);
const oldTracks = oldParsed.timeline.tracks.map(t => ({ ...t }));
const occupied = new Set(oldParsed.cuts.map(c => (Number.isInteger(c.track) && c.track >= 0 ? c.track : 0)));
const oldAfter = oldTracks.filter(t => t.kind !== 'cuts' || occupied.has(t.ref ?? 0));
const oldStep2 = OLD.writeTimelineTracksInSource(oldStep1, oldAfter);
const fresh = NEW.moveCutAndPruneTracksInSource(declared, 0, 4, 1, undefined, ['cuts-0']);
check('declared-tracks moveCut + prune (old 2 writes vs new 1 write)', oldStep2, fresh.source);
console.log('prunedTracks.after ids =', JSON.stringify(fresh.prunedTracks?.after.map(t => t.id)));

// 4) prune 対象が実は使用中なら消さない（旧経路も消さない）
const stillUsed = NEW.moveCutAndPruneTracksInSource(declared, 1, 5, 0, undefined, ['cuts-0']);
check('declared-tracks: 使用中トラックは prune しない', OLD.moveCutInSource(declared, 1, 5, 0), stillUsed.source);
console.log('  (case4) prunedTracks =', JSON.stringify(stillUsed.prunedTracks ?? null));

console.log(failures === 0 ? 'BYTE-EQUIVALENCE: PASS' : `BYTE-EQUIVALENCE: FAIL (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
