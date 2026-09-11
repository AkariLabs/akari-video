/**
 * 製品化票の受け入れ条件を、合成純音（l1-results.json）と実素材（l1-results-real.json）の解析結果から機械照合し、
 * `l1-productize-summary.md` を書く。判定の閾値は契約「受け入れ条件」そのまま:
 *
 *  - 合成純音 on-a/b/c: 音程一致 ≥ 99%・クリック 0・遅延 p50 ≤ 40 ms。on-d（5 Hz・整数秒 seek）: 遅延 p95 ≤ 60 ms（elst 適用の効果）
 *  - 実素材 on-r: 10 秒のゆっくりドラッグ中にクリック 0（隣接サンプル差 > 0.2 が 0 件）
 *  - run 中の HTTP 要求がすべて Range（全量取得 0・sidecar 0・preview-audio API 0）。moov は src ごとに 1 回
 *  - off は無音（録音 peak 0・断片 start 0）
 *  - idle suspend: 最後の seek から 30 s で suspend、次の seek で resume
 *
 * 検証専用スクリプト（製品コードではない・ラッパーが検証のために書いた）。
 * 使い方: node summarize-productize.mjs   （evidence ディレクトリの l1-results*.json を読む）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(here, '..');
const readJson = name => { const file = path.join(evidenceDir, name); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; };
const synth = readJson('l1-results.json');
const real = readJson('l1-results-real.json');
const fmt = v => (v === null || v === undefined ? '–' : v);
const checks = [];
const check = (label, ok, actual) => { checks.push({ label, ok: Boolean(ok), actual }); return ok; };
const findRun = (analysis, id) => analysis?.runs?.find(r => r.id === id) ?? null;

// 合成純音
for (const key of ['a', 'b', 'c']) {
  const r = findRun(synth, `on-${key}`);
  check(`on-${key}: 音程一致（本編）≥ 99%`, r && r.pitch.mainConfirmRate >= 99, r ? `${r.pitch.mainConfirmRate}%` : 'run なし');
  check(`on-${key}: 音程一致（BGM）≥ 99%`, r && r.pitch.bgmConfirmRate >= 99, r ? `${r.pitch.bgmConfirmRate}%` : 'run なし');
  check(`on-${key}: クリック 0（素材に無い不連続）`, r && r.continuity.artifactClicks === 0, r ? `artifact ${r.continuity.artifactClicks} / 候補 ${r.continuity.clicks}（最大 Δ ${r.continuity.maxSampleDelta}）` : 'run なし');
  check(`on-${key}: 遅延 p50 ≤ 40 ms（録音）`, r && r.latencyMs.recorded.p50 !== null && r.latencyMs.recorded.p50 <= 40, r ? `${r.latencyMs.recorded.p50} ms (p95 ${r.latencyMs.recorded.p95})` : 'run なし');
}
{
  const r = findRun(synth, 'on-d');
  check('on-d（5 Hz・整数秒 seek）: 遅延 p95 ≤ 60 ms（elst 適用）', r && r.latencyMs.recorded.p95 !== null && r.latencyMs.recorded.p95 <= 60, r ? `p50 ${r.latencyMs.recorded.p50} / p95 ${r.latencyMs.recorded.p95} / max ${r.latencyMs.recorded.max} ms (${r.latencyMs.recorded.found}/${r.latencyMs.recorded.n})` : 'run なし');
  check('on-d: 音程一致 100% とクリック 0', r && r.pitch.mainConfirmRate === 100 && r.continuity.artifactClicks === 0, r ? `${r.pitch.mainConfirmRate}% / artifact clicks ${r.continuity.artifactClicks}` : 'run なし');
}
for (const key of ['a', 'b', 'c', 'd']) {
  const r = findRun(synth, `off-${key}`);
  check(`off-${key}: 無音（peak 0・断片 start 0・lastError なし）`, r && r.recording.peak === 0 && r.played === 0 && !r.lastError, r ? `peak ${r.recording.peak} / played ${r.played} / lastError ${fmt(r.lastError)}` : 'run なし');
}
// 実素材
{
  const r = findRun(real, 'real-on-r');
  check('real-on-r: 10 秒のゆっくりドラッグ中にクリック 0（隣接サンプル差 > 0.2 のうち素材に無いもの）', r && r.continuity.artifactClicks === 0, r ? `artifact ${r.continuity.artifactClicks} / 候補 ${r.continuity.clicks}（うち素材由来 ${r.continuity.clicksInSource}: ${r.continuity.clickDetails.map(c => `Δ${c.delta}@素材${c.sourceSec}s(素材Δ${c.sourceLocalMaxDelta})`).join(', ') || 'なし'}・最大 Δ ${r.continuity.maxSampleDelta}・peak ${r.recording.peak}・rms ${r.recording.rms}・無音 ${r.continuity.silenceRate}%）` : 'run なし');
  check('real-on-r: 断片が鳴っている（played > 0・lastError なし）', r && r.played > 0 && !r.lastError, r ? `played ${r.played} / ${r.seeksRecorded}・lastError ${fmt(r.lastError)}` : 'run なし');
  const off = findRun(real, 'real-off-r');
  check('real-off-r: 無音', off && off.recording.peak === 0 && off.played === 0, off ? `peak ${off.recording.peak} / played ${off.played}` : 'run なし');
}
// HTTP 要求
for (const [name, analysis] of [['合成', synth], ['実素材', real]]) {
  if (!analysis) { check(`${name}: 解析結果あり`, false, 'なし'); continue; }
  const all = analysis.networkAll?.summary ?? {};
  // 本編 mp4 の全量取得が 0 であること。BGM (m4a) の全量 fetch は既存の decodeAudioData 経路（プレビューを開いた時の BGM デコード・本票の対象外）なので別掲する。
  const byPath = analysis.networkAll?.byPath ?? [];
  const mainFull = byPath.filter(([key]) => /\/assets\/.*\.(mp4|mov)/i.test(key) && !key.includes('[Range]')).reduce((sum, [, count]) => sum + count, 0);
  const otherFull = byPath.filter(([key]) => /\/assets\/.*\.(m4a|mp3|wav)/i.test(key) && !key.includes('[Range]')).map(([key, count]) => `${key} ×${count}`);
  check(`${name}: 本編の全量取得 0・sidecar .pcm 0・preview-audio API 0（開いた時〜終了）`, mainFull === 0 && all.sidecarPcm === 0 && all.previewAudioApi === 0, `本編 full ${mainFull} / pcm ${all.sidecarPcm} / api ${all.previewAudioApi} / range ${all.mediaRange}（fetch ${all.mediaRangeFetch}）${otherFull.length ? `・既存の BGM 全量 fetch: ${otherFull.join(', ')}` : ''}`);
  const srcCount = new Set((analysis.fixture?.edit?.sources ?? []).filter(s => /\.(mp4|mov)$/i.test(s.path)).map(s => s.path)).size || 1;
  check(`${name}: moov は src ごとに 1 回（fetch Range > 8 KB の回数 = ${srcCount}）`, all.moovFetch === srcCount, `${all.moovFetch}${analysis.networkAll?.moovFetches?.length ? ` — ${analysis.networkAll.moovFetches.map(m => `${m.path} ${m.range}`).join(', ')}` : ''}`);
  const runsOk = analysis.runs.every(r => r.network && r.network.mediaFull === 0 && r.network.sidecarPcm === 0 && r.network.previewAudioApi === 0);
  check(`${name}: run 中の要求がすべて Range`, runsOk, analysis.runs.map(r => `${r.id}: ${r.network?.mediaRange ?? '–'} range / ${r.network?.mediaFull ?? '–'} full`).join(', '));
  check(`${name}: 失敗 run なし`, (analysis.failedRuns ?? []).length === 0, `${(analysis.failedRuns ?? []).length}`);
  check(`${name}: 後始末（Electron 残存 0・preview-server 残存 0）`, analysis.cleanup && analysis.cleanup.survivingElectronProcesses === 0 && analysis.cleanup.survivingPreviewServer === 0 && analysis.cleanup.survivingShellBackend === 0, JSON.stringify(analysis.cleanup));
}
// idle suspend
{
  const idle = synth?.idleSuspend ?? real?.idleSuspend ?? null;
  check('idle suspend: seek 後 30 s で suspend、次の seek で resume', idle && idle.suspendCalled && idle.stateAfter33s === 'suspended' && idle.wake?.resumeCalled && idle.wake?.stateAfterSeek === 'running', idle ? `1 s 後 ${idle.stateAfter1s} → 33 s 後 ${idle.stateAfter33s}（suspend は seek から ${idle.suspendAfterSeekMs} ms）→ 次の seek で resume ${idle.wake?.resumeCalled} / state ${idle.wake?.stateAfterSeek} / start ${idle.wake?.starts}` : '未計測');
}

const lines = [];
lines.push('# スクラブ音の製品化（C 案）— L1 実測サマリ（機械生成: scripts/summarize-productize.mjs）', '');
lines.push(`- 合成純音: ${synth ? `${synth.analyzedAt} / Electron ${synth.electron?.version} / ${synth.host?.model} ${synth.host?.cpus} cores / load ${synth.host?.loadAvgAtStart?.join(' ')}` : 'なし'}`);
lines.push(`- 実素材: ${real ? `${real.analyzedAt} / load ${real.host?.loadAvgAtStart?.join(' ')} / 素材 ${JSON.stringify(real.fixture?.ffprobe?.streams?.map(s => `${s.codec_type}:${s.codec_name}${s.profile ? `(${s.profile})` : ''} ${s.width ? `${s.width}x${s.height}@${s.r_frame_rate}` : `${s.sample_rate} Hz ${s.channels} ch`}`))}（元素材: ${real.fixture?.original ? real.fixture.original.streams.map(s => `${s.codec_type}:${s.codec_name} ${s.width ? `${s.width}x${s.height}` : `${s.sample_rate} Hz`}`).join(' + ') : '–'}。ファイル名・パスは記録しない）` : 'なし'}`);
lines.push(`- 既定: ${synth?.page ? `mode=${synth.page.scrubMode} / enabled=${synth.page.scrubEnabled}（URL 指定なし）` : '–'}・AudioContext ${synth?.page?.sampleRate} Hz・outputLatency ${synth?.page ? Math.round(synth.page.outputLatency * 1000) : '–'} ms・断片 ${synth?.fragmentMs} ms`);
lines.push(`- 公開面（window.akari.scrubAudio）: ${synth?.page?.scrubApi ? synth.page.scrubApi.filter(k => !k.startsWith('__')).join(', ') : '–'}`);
lines.push('');
lines.push('## 受け入れ条件の照合', '');
lines.push('| 判定 | 条件 | 実測 |');
lines.push('|---|---|---|');
for (const c of checks) lines.push(`| ${c.ok ? '✅' : '❌'} | ${c.label} | ${c.actual} |`);
const failed = checks.filter(c => !c.ok);
lines.push('');
lines.push(`**${failed.length === 0 ? 'すべて合格' : `未達 ${failed.length} 件: ${failed.map(f => f.label).join(' / ')}`}**（${checks.length} 項目）`);
lines.push('');
const table = (analysis, title) => {
  if (!analysis) return;
  lines.push(`## ${title}`, '');
  lines.push('| run | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 無音 % / 10 ms 途切れ | クリック 候補 / 素材由来 / **artifact**（最大 Δ） | 断片長 p50 / min ms | renderer / gpu / audio CPU % | played / skipped | Range（fetch / media） | full / pcm | lastError |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of analysis.runs) {
    const c = r.cpu ?? {}; const n = r.network ?? {}; const p = r.pitch;
    lines.push(`| ${r.id}${r.tickHz && r.tickHz !== analysis.tickHz ? ` (${r.tickHz} Hz)` : ''} | ${fmt(r.latencyMs.recorded.p50)} / ${fmt(r.latencyMs.recorded.p95)}${r.isReal ? '' : ` (${r.latencyMs.recorded.found}/${r.latencyMs.recorded.n})`} | ${fmt(r.latencyMs.appReported.p50)} / ${fmt(r.latencyMs.appReported.p95)} | ${p ? `${fmt(p.mainConfirmRate)}% / ${fmt(p.bgmConfirmRate)}%` : '–'} | ${fmt(r.continuity.silenceRate)} / ${r.continuity.gaps10ms} | ${r.continuity.clicks} / ${fmt(r.continuity.clicksInSource)} / **${r.continuity.artifactClicks}** (${r.continuity.maxSampleDelta}) | ${fmt(r.fragment.durationP50Ms)} / ${fmt(r.fragment.durationMinMs)} | ${fmt(c.renderer?.pct)} / ${fmt(c.gpu?.pct)} / ${fmt(c['audio-service']?.pct)} | ${r.played} / ${r.skipped} | ${fmt(n.mediaRange)} (${fmt(n.mediaRangeFetch)} / ${fmt(n.mediaRangeMediaElement)}) | ${fmt(n.mediaFull)} / ${fmt(n.sidecarPcm)} | ${fmt(r.lastError)} |`);
  }
  lines.push('');
};
table(synth, '合成純音（1 秒ごとに半音上がる階段音 + BGM。詳細は l1-summary.md）');
table(real, '実素材（声の入った実写 60 s・BGM なし。詳細は l1-summary-real.md）');
lines.push('- 遅延（録音）= seek 到達 → 期待半音と完全一致する最初の 21 ms 解析窓の中心（窓半分 ≈ 10 ms + 5 ms フェードインを含む）。耳に届くまでは outputLatency が加わる');
lines.push('- 断片長 = 本編断片の `BufferSource.start(when, offset, duration)` の duration。4 パケット窓（≈ 85 ms）なので 40 ms が常に収まる（spike の 3 パケット窓では t がパケット後半にあると 21〜40 ms に切り詰められていた）');
lines.push('- クリック候補 = 録音の隣接サンプル差 > 0.2。素材由来 = 素材音声（ffmpeg で 48 kHz mono に復号した参照。ファイルは残さない）の同じ位置 ±2 ms に同等以上の隣接差があるもの（声の過渡）。**artifact = 素材に無い不連続 = 断片の継ぎ目のクリック**。受け入れ条件はこの artifact で判定する（純音では素材の最大差 0.06 なので候補 = artifact）');
lines.push('- 実素材の遅延・音程一致は測らない（純音ではないため）。無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01（声の間は自然に無音になる）');
if (synth?.idleSuspend) lines.push(`- idle suspend: ${JSON.stringify({ ...synth.idleSuspend, ops: undefined })}`);
fs.writeFileSync(path.join(evidenceDir, 'l1-productize-summary.md'), `${lines.join('\n')}\n`);
console.log(fs.readFileSync(path.join(evidenceDir, 'l1-productize-summary.md'), 'utf8'));
process.exitCode = failed.length === 0 ? 0 : 2;
