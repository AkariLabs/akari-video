#!/usr/bin/env node
/**
 * 各セッション（= Electron 1 本）の l1-results-<session>.json + l1-raw-<session>.json を 1 枚の表にまとめ、
 * 契約「受け入れ条件」の機械照合を l1-shell-summary.md へ書く（検証専用・ラッパー製）。
 *
 * 2026-09-12-scrub-audio-fast-drag 版: 駆動レート（30 / 60 / 120 Hz）と「可聴率」「断片開始間隔」を主指標にした。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSIONS = ['nobgm-60', 'nobgm-120', 'bgm-60', 'engine-60', 'real-60'].filter(s => fs.existsSync(path.join(evidenceDir, `l1-results-${s}.json`)));
const read = f => JSON.parse(fs.readFileSync(path.join(evidenceDir, f), 'utf8'));
const lines = [];
const checks = [];
const check = (id, ok, detail) => { checks.push({ id, ok, detail }); };
const fmt = v => (v === null || v === undefined ? '–' : v);

lines.push('# preview scrub audio — 速いドラッグ対応 L1 実測サマリ（機械生成: scripts/summarize-shell.mjs）', '');
if (!SESSIONS.length) { lines.push('_（l1-results-*.json がありません）_'); fs.writeFileSync(path.join(evidenceDir, 'l1-shell-summary.md'), `${lines.join('\n')}\n`); console.log(lines.join('\n')); process.exit(0); }
const first = read(`l1-results-${SESSIONS[0]}.json`);
lines.push(`- Electron ${first.electron?.version} / ${first.host?.model} ${first.host?.cpus} cores ${first.host?.memGb} GB / Node ${first.host?.node}。seek = 実マウスでタイムライン widget のプレイヘッドをドラッグ・断片 40 ms・AudioContext ${first.page?.sampleRate} Hz`);
lines.push('- セッション: `nobgm-60` = legacy `<video>` 経路・BGM なし（30 / 60 Hz 駆動）/ `nobgm-120` = 同・**vsync 解除で 120 Hz 駆動** / `bgm-60` = legacy・BGM あり / `engine-60` = frame-engine 経路 / `real-60` = 声入りの実写（先頭 60 s・音声パケットは原本のまま）');
lines.push('- パターン: `a` ゆっくり（0→19 s を 9.5 s・×2）/ `b` 速い（0→50 s を 3 s・×16.7）/ `c` 往復（30↔35 s を 6 s・×5）/ **`f` 全長 1 秒走査（0→59 s を 1 s・×59）** / **`d` 全長 0.5 秒往復（0→59→0 s を 0.5 s・×236）** / `r` 実写ゆっくり');
lines.push('');
lines.push('| run | セッション | mode | 駆動 Hz 要求 / 実測 | **可聴率 %** | **断片開始間隔 p50 / p95 ms** | 遅延 p50 / p95 ms（録音） | 音程一致 本編 / BGM | クリック 総数 / 素材由来 / **artifact** | played / skipped | 断片 start 数 | scrub fetch p50 / p90 / p99 ms | 窓 Range p50 / max B | Range 要求 scrub / engine / media 要素 | 全量 |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
let wavBytes = 0;
let wavMaxSec = 0;
for (const session of SESSIONS) {
  const results = read(`l1-results-${session}.json`);
  const raw = read(`l1-raw-${session}.json`);
  const config = results.config;
  for (const r of results.runs) {
    const rawRun = raw.runs.find(x => x.id === r.id);
    const n = rawRun?.network?.summary ?? {};
    const f = n.scrubFetchMs ?? {};
    const rb = n.scrubRangeBytes ?? {};
    const p = r.pitch;
    const g = r.pacing ?? {};
    const stat = fs.statSync(path.join(evidenceDir, r.wav));
    wavBytes += stat.size;
    wavMaxSec = Math.max(wavMaxSec, r.recording.seconds ?? 0);
    lines.push(`| ${r.id} | ${session} | ${r.mode} | ${fmt(g.requestedHz)} / ${fmt(g.measuredSeekHz)} | **${fmt(g.audibleRate)}** | ${fmt(g.fragmentStartIntervalMs?.p50)} / ${fmt(g.fragmentStartIntervalMs?.p95)} | ${fmt(r.latencyMs.recorded.p50)} / ${fmt(r.latencyMs.recorded.p95)}${r.isReal ? '' : ` (${r.latencyMs.recorded.found}/${r.latencyMs.recorded.n})`} | ${p ? `${fmt(p.mainConfirmRate)}% / ${fmt(p.bgmConfirmRate)}%` : '–（実素材）'} | ${r.continuity.clicks} / ${fmt(r.continuity.clicksInSource)} / **${r.continuity.artifactClicks}** | ${r.played} / ${r.skipped} | ${fmt(g.fragmentsStarted)} | ${fmt(f.p50)} / ${fmt(f.p90)} / ${fmt(f.p99)} | ${fmt(rb.p50)} / ${fmt(rb.max)} | ${n.mediaRangeFetch ?? 0} / ${n.engineRangeFetch ?? 0} / ${n.mediaRangeMediaElement ?? 0} | ${n.mediaFull ?? 0} |`);

    const silent = r.mode !== 'on';
    if (silent) {
      check(`${r.id}: 録音が無音（peak 0）`, r.recording.peak === 0, `peak=${r.recording.peak}`);
      check(`${r.id}: 断片 start 0`, (rawRun?.stats?.starts ?? 0) === 0, `starts=${rawRun?.stats?.starts}`);
      if (r.mode === 'off') check(`${r.id}: 設定 OFF で onSeek が呼ばれない`, r.seeksRecorded === 0, `seeks=${r.seeksRecorded}`);
      if (r.mode === 'muted' || r.mode === 'playing') check(`${r.id}: onSeek は届くが鳴らさない`, r.seeksRecorded > 0 && r.played === 0, `seeks=${r.seeksRecorded} played=${r.played}`);
      if (r.mode === 'off') check(`${r.id}: 設定 OFF で scrub 由来の fetch 0`, (n.mediaRangeFetch ?? 0) === 0, `fetch=${n.mediaRangeFetch}`);
      continue;
    }

    // ---- 契約「受け入れ条件」 ----
    const hz = g.requestedHz;
    if (r.pattern === 'f' && hz === 60 && !r.isReal) {
      check(`${r.id}: 【60 Hz・全長 1 秒走査】可聴率 ≥ 70%`, (g.audibleRate ?? 0) >= 70, `${g.audibleRate}%`);
      check(`${r.id}: 【60 Hz・全長 1 秒走査】断片開始間隔 p95 ≤ 150 ms`, (g.fragmentStartIntervalMs?.p95 ?? Infinity) <= 150, `${g.fragmentStartIntervalMs?.p95} ms`);
      check(`${r.id}: 【60 Hz・全長 1 秒走査】artifact クリック 0`, r.continuity.artifactClicks === 0, `${r.continuity.artifactClicks}`);
    }
    if (hz === 120) {
      if (!r.isReal) check(`${r.id}: 【120 Hz 駆動】可聴率 ≥ 60%`, (g.audibleRate ?? 0) >= 60, `${g.audibleRate}%`);
      check(`${r.id}: 【120 Hz 駆動】artifact クリック 0`, r.continuity.artifactClicks === 0, `${r.continuity.artifactClicks}`);
    }
    if (hz === 30 && !r.isReal) {
      check(`${r.id}: 【30 Hz 退行なし】音程一致 ≥ 99%（本編）`, (p?.mainConfirmRate ?? 0) >= 99, `${p?.mainConfirmRate}%`);
      check(`${r.id}: 【30 Hz 退行なし】遅延 p50 ≤ 40 ms`, (r.latencyMs.recorded.p50 ?? Infinity) <= 40, `${r.latencyMs.recorded.p50} ms`);
      if (config === 'bgm') check(`${r.id}: 音程一致 ≥ 99%（BGM 断片）`, (p?.bgmConfirmRate ?? 0) >= 99, `${p?.bgmConfirmRate}%`);
    }
    if (r.pattern === 'a' && hz === 60 && !r.isReal) {
      check(`${r.id}: 【ゆっくり = 現行水準】音程一致 ≥ 99%（本編）`, (p?.mainConfirmRate ?? 0) >= 99, `${p?.mainConfirmRate}%`);
    }
    check(`${r.id}: artifact クリック 0`, r.continuity.artifactClicks === 0, `${r.continuity.artifactClicks}`);
    check(`${r.id}: 前処理なし（run 中の scrub 要求がすべて Range・全量 0・sidecar 0）`, (n.scrubFull ?? 0) === 0 && (n.sidecarPcm ?? 0) === 0 && (n.previewAudioApi ?? 0) === 0, JSON.stringify({ scrubFull: n.scrubFull, sidecarPcm: n.sidecarPcm, mediaFull: n.mediaFull }));
    check(`${r.id}: run 中に moov の再取得なし（box ヘッダ探索 0）`, (n.moovFetch ?? 0) === 0 && (n.boxProbe ?? 0) === 0, `moov=${n.moovFetch} boxProbe=${n.boxProbe}`);
    check(`${r.id}: seek ごとの取得は KB 単位（窓 Range max ≤ 64 KB）`, (rb.max ?? 0) <= 64 * 1024, `max=${rb.max} B / p50=${rb.p50} B`);
    check(`${r.id}: 断片長 40 ms`, r.fragment.durationP50Ms === 40 && r.fragment.durationMinMs === 40, `${r.fragment.durationP50Ms} / ${r.fragment.durationMinMs}`);
  }
  const open = raw.networkAtOpen?.summary ?? {};
  check(`${session}: 開いた時の moov 取得が src ごとに 1 回`, open.moovFetch === 1, `moovFetch=${open.moovFetch} (${JSON.stringify(raw.networkAll?.moovFetches ?? [])})`);
  check(`${session}: scrub 由来の全量取得 0（開いた時〜終了）`, (raw.networkAll?.summary?.scrubFull ?? 0) === 0, `scrubFull=${raw.networkAll?.summary?.scrubFull}`);
  check(`${session}: 既定 ON（initial scrubAudioEnabled=true・controller enabled）`, raw.page?.initialScrubAudioEnabled === true && raw.page?.scrubEnabled === true, JSON.stringify({ initial: raw.page?.initialScrubAudioEnabled, enabled: raw.page?.scrubEnabled }));
  check(`${session}: 後始末（Electron 残存 0・shell backend 残存 0）`, raw.cleanup?.survivingElectronProcesses === 0 && raw.cleanup?.survivingShellBackend === 0, JSON.stringify(raw.cleanup));
  if (config === 'nobgm') check(`${session}: BGM なし（previewAudio null）でも scrub の AudioContext が立つ`, raw.page?.previewAudio === false && raw.page?.scrubDebug?.contextState === 'running', JSON.stringify({ previewAudio: raw.page?.previewAudio, contextState: raw.page?.scrubDebug?.contextState }));
  if (config === 'bgm') check(`${session}: scrub は legacy の音声グラフ（previewAudio）と同じ AudioContext を共有`, raw.page?.sharedContextWithPreviewAudio === true, JSON.stringify({ shared: raw.page?.sharedContextWithPreviewAudio, bgmDuration: raw.page?.bgmDuration }));
  if (config === 'engine') check(`${session}: frame-engine 経路 ON で同じ配線が動く`, raw.page?.frameEngineActive === true && results.runs.some(r => r.played > 0), JSON.stringify({ frameEngineActive: raw.page?.frameEngineActive, played: results.runs.map(r => r.played) }));
  if (raw.failedRuns?.length) check(`${session}: 失敗した run なし`, false, raw.failedRuns.map(f => f.id).join(','));
  lines.push(`| （${session}: 開いた時〜ready） | ${session} | – | – | – | – | – | – | – | – | – | ${fmt(open.scrubFetchMs?.p50)} / ${fmt(open.scrubFetchMs?.p90)} / – | – | ${open.mediaRangeFetch ?? 0} / ${open.engineRangeFetch ?? 0} / ${open.mediaRangeMediaElement ?? 0} | ${open.mediaFull ?? 0} (bgm 資産 ${open.bgmAssetFull ?? 0}・sidecar ${open.sidecarPcm ?? 0}) |`);
}
check('録音 wav の合計 ≤ 20 MB', wavBytes <= 20 * 1024 * 1024, `${(wavBytes / 1024 / 1024).toFixed(1)} MB`);
check('録音 wav が各 ≤ 10 s', wavMaxSec <= 10.05, `max ${wavMaxSec} s`);
lines.push('');
lines.push('- 駆動 Hz 要求 = 実マウスの mousemove 送出レート。実測 = webview の `onSeek` 到達間隔から出した実効レート（アプリの rAF 間引きを通った後）。`nobgm-120` だけ Chromium の vsync / フレームレート上限を外して 120 Hz を通した');
lines.push('- **可聴率** = 駆動区間［最初の seek, 最後の seek + 50 ms］の 5 ms フレームのうち RMS ≥ 0.01 の割合。**断片開始間隔** = 本編断片の `BufferSource.start(when)` の差分（等間隔性）');
lines.push('- **実写（real-*）は素材そのものに無音区間（声の間）があるため、可聴率・断片開始間隔の受け入れ判定の対象外**（クリックと前処理なしの確認だけを行う）');
lines.push('- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合。速いドラッグでは間引きが入るため「鳴った seek の割合（played）」は下がるが、可聴率と等間隔性で評価する');
lines.push('- 窓 Range = スクラブ音が断片のために取る Range のバイト数（moov 取得と box ヘッダ探索 16 B を除く）。moov は `Mp4AudioTrack#open()` の「16 B の box ヘッダ読み → 大きい 1 本」でしか起きないので、その並びで判定する');
lines.push('');
lines.push('## 受け入れ条件の機械照合', '');
lines.push('| 判定 | 項目 | 実測 |');
lines.push('|---|---|---|');
for (const c of checks) lines.push(`| ${c.ok ? '✅' : '❌'} | ${c.id} | ${c.detail} |`);
lines.push('');
lines.push(`- 合格 ${checks.filter(c => c.ok).length} / ${checks.length}`);
fs.writeFileSync(path.join(evidenceDir, 'l1-shell-summary.md'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
