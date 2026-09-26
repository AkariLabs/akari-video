// 証跡の JSON（tldrag / pvcheck の出力）から回数表を作る: node summarize.mjs <dir> > summary.json
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const dir = process.argv[2];
const rows = [];
for (const f of (await readdir(dir)).filter(f => f.endsWith('.json') && !f.endsWith('.drag.json') && f !== 'summary.json').sort()) {
  const r = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    const s = r.summary; if (!s || s.error) continue;
  // 受理された 0 = ホストが採用して発行した再生位置イベント（k:'event'）のうち 0 秒のもの。受け取っただけの tick（k:'tick'）は数えない
  const accepted0 = (r.log || []).filter(l => l.k === 'event' && l.time < 0.05).length;
  const received0 = (r.log || []).filter(l => l.k === 'tick' && l.time < 0.05).length;
  rows.push({ file: f, card: r.cardSpec ?? r.card, start: s.start, minPlayhead: s.minPlayhead, end: s.end,
    zeroTicksReceived: received0, zeroTicksAccepted: accepted0, transientReset: s.minPlayhead < 0.05 || accepted0 > 0, stuckAtZero: s.end < 0.05, placed: (s.newItems?.length ?? 0) + (s.newCaptions?.length ?? 0) + (s.newSfx ?? 0) });
}
const group = p => rows.filter(r => r.file.startsWith(p));
const count = list => ({ runs: list.length, placed: list.filter(r => r.placed > 0).length, transientReset: list.filter(r => r.transientReset).length, stuckAtZero: list.filter(r => r.stuckAtZero).length });
console.log(JSON.stringify({ groups: Object.fromEntries(['a', 'heavy-a', 'shape', 'text', 'pimg', 'broll', 'pv'].map(p => [p, count(group(p))])), rows }, null, 1));
