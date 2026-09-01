#!/usr/bin/env node
// results/*.json から受け入れ条件の表（work-only median）を組む。status: running（部分）でも
// runs にある「completed の走」だけを使い、走数を必ず併記する。
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESULTS = path.join(ROOT, 'results');
const pick = (v, d = null) => (Number.isFinite(v) ? v : d);
const med = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.ceil(s.length * 0.5) - 1] : null; };
const fmt = v => (v === null || v === undefined ? '—' : `${v.toFixed(1)} ms`);

// 1 つの結果 JSON から、N ごとに完了した走だけを集めて work-only median を出す
function digest(json, n) {
  const subject = json.subjects?.A?.[String(n)];
  if (!subject) return null;
  const runs = (subject.runs || []).filter(r => r.status === 'completed');
  const opWork = op => med(runs.flatMap(r => r.operations?.[op]?.work?.samplesMs || []));
  const runMedians = op => runs.map(r => pick(r.operations?.[op]?.work?.medianMs)).filter(Number.isFinite);
  const dragWork = which => med(runs.flatMap(r => r.operations?.['4']?.work?.[which]?.samplesMs || []));
  const dragWall = which => med(runs.flatMap(r => r.operations?.['4']?.[which]?.samplesMs || []));
  return {
    status: json.status,
    label: json.label,
    startedAt: json.startedAt,
    loadAtStart: json.environment?.loadAverageAtStart?.[0] ?? null,
    bundleSha: json.environment?.frontendBundle?.sha256?.slice(0, 16) ?? null,
    bundleSource: json.environment?.frontendBundle?.sourceMatch?.slice(0, 8) ?? null,
    shell: json.environment?.shell ?? null,
    totalRuns: (subject.runs || []).length,
    completedRuns: runs.length,
    notReached: (subject.runs || []).filter(r => r.status !== 'completed').map(r => ({ run: r.run, reason: (r.reason || '').split('\n')[0].slice(0, 160) })),
    mountedItems: runs.at(-1)?.operations?.['1']?.itemElements ?? null,
    zoomWork: opWork('2'), zoomRunMedians: runMedians('2'),
    panWork: opWork('3'), panRunMedians: runMedians('3'),
    dragMoveWork: dragWork('move'), dragUpWork: dragWork('pointerup'),
    dragMoveWall: dragWall('move'), dragUpWall: dragWall('pointerup'),
    playbackInterval: med(runs.flatMap(r => r.operations?.['5']?.interval?.samplesMs || []))
  };
}

const files = (await readdir(RESULTS)).filter(f => f.endsWith('.json')).sort();
const table = {};
for (const f of files) {
  let json; try { json = JSON.parse(await readFile(path.join(RESULTS, f), 'utf8')); } catch { continue; }
  if (!json.subjects) continue;
  for (const n of Object.keys(json.subjects.A || {})) {
    const d = digest(json, n);
    if (d) (table[`${d.label}|${n}`] ||= []).push({ file: f, ...d });
  }
}

console.log('# 計測ダイジェスト（work-only median・完了した走のみ）\n');
for (const key of Object.keys(table).sort()) {
  const [label, n] = key.split('|');
  console.log(`## ${label.toUpperCase()} N=${n}`);
  for (const d of table[key]) {
    console.log(`- \`${d.file}\`  status=${d.status}  走=${d.completedRuns}/${d.totalRuns} 完了  load1=${d.loadAtStart?.toFixed(1) ?? '?'}  bundle=${d.bundleSha ?? '?'}  src=${d.bundleSource ?? '?'}`);
    console.log(`  - mounted items: ${d.mountedItems ?? '—'}`);
    console.log(`  - ズーム work median: ${fmt(d.zoomWork)}  (走ごと: ${d.zoomRunMedians.map(v => v.toFixed(1)).join(', ') || '—'})`);
    console.log(`  - パン   work median: ${fmt(d.panWork)}  (走ごと: ${d.panRunMedians.map(v => v.toFixed(1)).join(', ') || '—'})`);
    console.log(`  - ドラッグ move work: ${fmt(d.dragMoveWork)} / pointerup work: ${fmt(d.dragUpWork)}  (実時間 move ${fmt(d.dragMoveWall)} / up ${fmt(d.dragUpWall)})`);
    console.log(`  - 再生 rAF 間隔 median: ${fmt(d.playbackInterval)}`);
    if (d.notReached.length) for (const nr of d.notReached) console.log(`  - not-reached run ${nr.run}: ${nr.reason}`);
  }
  console.log('');
}
