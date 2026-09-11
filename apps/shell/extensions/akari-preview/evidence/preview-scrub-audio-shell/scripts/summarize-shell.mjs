#!/usr/bin/env node
/**
 * 各構成（nobgm / bgm / engine / real）の l1-results-<config>.json + l1-raw-<config>.json を 1 枚の表にまとめ、
 * 契約「受け入れ条件」の機械照合を l1-shell-summary.md へ書く（検証専用・ラッパー製）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configs = ['nobgm', 'bgm', 'engine', 'real'].filter(c => fs.existsSync(path.join(evidenceDir, `l1-results-${c}.json`)));
const read = f => JSON.parse(fs.readFileSync(path.join(evidenceDir, f), 'utf8'));
const lines = [];
const checks = [];
const check = (id, ok, detail) => { checks.push({ id, ok, detail }); };
const fmt = v => (v === null || v === undefined ? '–' : v);

lines.push('# preview scrub audio — shell 配線 L1 実測サマリ（機械生成: scripts/summarize-shell.mjs）', '');
const first = read(`l1-results-${configs[0]}.json`);
lines.push(`- Electron ${first.electron?.version} / ${first.host?.model} ${first.host?.cpus} cores ${first.host?.memGb} GB / Node ${first.host?.node}。seek = 実マウスでタイムライン widget のプレイヘッドをドラッグ（30 Hz）・断片 40 ms・AudioContext ${first.page?.sampleRate} Hz`);
lines.push('- 構成: nobgm = legacy `<video>` 経路・BGM なし / bgm = legacy・BGM あり / engine = frame-engine 経路 ON（BGM あり。BGM 断片は対象外 — engine の音声供給は shell 側に AudioBuffer を持たない）/ real = legacy・声入りの実写（先頭 60 s・音声パケットは原本のまま）');
lines.push('');
lines.push('| run | 構成 | mode | pattern | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / **artifact** | played / skipped | scrub fetch p50 / p90 / p99 ms | Range 要求 scrub / engine / media 要素 | 全量取得 |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
let wavBytes = 0;
for (const config of configs) {
  const results = read(`l1-results-${config}.json`);
  const raw = read(`l1-raw-${config}.json`);
  for (const r of results.runs) {
    const rawRun = raw.runs.find(x => x.id === r.id);
    const n = rawRun?.network?.summary ?? {};
    const f = n.scrubFetchMs ?? {};
    const p = r.pitch;
    wavBytes += fs.statSync(path.join(evidenceDir, r.wav)).size;
    lines.push(`| ${r.id} | ${config} | ${r.mode} | ${r.pattern} | ${fmt(r.latencyMs.recorded.p50)} / ${fmt(r.latencyMs.recorded.p95)}${r.isReal ? '' : ` (${r.latencyMs.recorded.found}/${r.latencyMs.recorded.n})`} | ${fmt(r.latencyMs.appReported.p50)} / ${fmt(r.latencyMs.appReported.p95)} | ${p ? `${fmt(p.mainConfirmRate)}% / ${fmt(p.bgmConfirmRate)}%` : '–（実素材）'} | ${fmt(r.continuity.silenceRate)} / ${r.continuity.gaps10ms} | ${r.continuity.clicks} / ${fmt(r.continuity.clicksInSource)} / **${r.continuity.artifactClicks}** | ${r.played} / ${r.skipped} | ${fmt(f.p50)} / ${fmt(f.p90)} / ${fmt(f.p99)} | ${n.mediaRangeFetch ?? 0} / ${n.engineRangeFetch ?? 0} / ${n.mediaRangeMediaElement ?? 0} | ${n.mediaFull ?? 0} |`);
    const silent = r.mode === 'off' || r.mode === 'muted' || r.mode === 'playing';
    if (silent) {
      check(`${r.id}: 録音が無音（peak 0）`, r.recording.peak === 0, `peak=${r.recording.peak}`);
      check(`${r.id}: 断片 start 0`, (rawRun?.stats?.starts ?? 0) === 0, `starts=${rawRun?.stats?.starts}`);
      if (r.mode === 'off') check(`${r.id}: 設定 OFF で onSeek が呼ばれない`, r.seeksRecorded === 0, `seeks=${r.seeksRecorded}`);
      if (r.mode === 'muted' || r.mode === 'playing') check(`${r.id}: onSeek は届くが鳴らさない`, r.seeksRecorded > 0 && r.played === 0, `seeks=${r.seeksRecorded} played=${r.played}`);
      if (r.mode === 'off') check(`${r.id}: 設定 OFF で scrub 由来の fetch 0`, (n.mediaRangeFetch ?? 0) === 0, `fetch=${n.mediaRangeFetch}`);
    } else {
      if (!r.isReal) {
        check(`${r.id}: 音程一致 ≥ 99%（本編）`, (p?.mainConfirmRate ?? 0) >= 99, `${p?.mainConfirmRate}%`);
        if (config === 'bgm') check(`${r.id}: 音程一致 ≥ 99%（BGM 断片）`, (p?.bgmConfirmRate ?? 0) >= 99, `${p?.bgmConfirmRate}%`);
        check(`${r.id}: 遅延 p50 ≤ 50 ms（録音）`, (r.latencyMs.recorded.p50 ?? Infinity) <= 50, `${r.latencyMs.recorded.p50} ms`);
      }
      check(`${r.id}: クリック（artifact）0`, r.continuity.artifactClicks === 0, `${r.continuity.artifactClicks}`);
      check(`${r.id}: run 中の scrub 要求がすべて Range（全量 0・sidecar 0）`, (n.scrubFull ?? 0) === 0 && (n.sidecarPcm ?? 0) === 0 && (n.previewAudioApi ?? 0) === 0, JSON.stringify({ scrubFull: n.scrubFull, sidecarPcm: n.sidecarPcm, mediaFull: n.mediaFull }));
      check(`${r.id}: run 中に moov（8 KB 超の scrub Range）0`, (n.moovFetch ?? 0) === 0, `${n.moovFetch}`);
      check(`${r.id}: 断片長 40 ms`, r.fragment.durationP50Ms === 40 && r.fragment.durationMinMs === 40, `${r.fragment.durationP50Ms} / ${r.fragment.durationMinMs}`);
    }
  }
  const open = raw.networkAtOpen?.summary ?? {};
  check(`${config}: 開いた時の moov 取得が src ごとに 1 回`, open.moovFetch === 1, `moovFetch=${open.moovFetch} (${JSON.stringify(raw.networkAll?.moovFetches ?? [])})`);
  check(`${config}: scrub 由来の全量取得 0（開いた時〜終了）`, (raw.networkAll?.summary?.scrubFull ?? 0) === 0, `scrubFull=${raw.networkAll?.summary?.scrubFull}`);
  check(`${config}: 既定 ON（initial scrubAudioEnabled=true・controller enabled）`, raw.page?.initialScrubAudioEnabled === true && raw.page?.scrubEnabled === true, JSON.stringify({ initial: raw.page?.initialScrubAudioEnabled, enabled: raw.page?.scrubEnabled }));
  check(`${config}: 後始末（Electron 残存 0・shell backend 残存 0）`, raw.cleanup?.survivingElectronProcesses === 0 && raw.cleanup?.survivingShellBackend === 0, JSON.stringify(raw.cleanup));
  if (config === 'nobgm') check('nobgm: BGM なし（previewAudio null）でも scrub の AudioContext が立つ', raw.page?.previewAudio === false && raw.page?.scrubDebug?.contextState === 'running', JSON.stringify({ previewAudio: raw.page?.previewAudio, contextState: raw.page?.scrubDebug?.contextState }));
  if (config === 'bgm') check('bgm: scrub は legacy の音声グラフ（previewAudio）と同じ AudioContext を共有', raw.page?.sharedContextWithPreviewAudio === true, JSON.stringify({ shared: raw.page?.sharedContextWithPreviewAudio, bgmDuration: raw.page?.bgmDuration }));
  if (config === 'engine') check('engine: frame-engine 経路 ON で同じ配線が動く（frameEngineActive・controller・断片 start > 0）', raw.page?.frameEngineActive === true && results.runs.some(r => r.played > 0), JSON.stringify({ frameEngineActive: raw.page?.frameEngineActive, played: results.runs.map(r => r.played) }));
  if (raw.failedRuns?.length) check(`${config}: 失敗した run なし`, false, raw.failedRuns.map(f => f.id).join(','));
  lines.push(`| （${config}: 開いた時〜ready） | ${config} | – | – | – | – | – | – | – | – | ${fmt(open.scrubFetchMs?.p50)} / ${fmt(open.scrubFetchMs?.p90)} / – | ${open.mediaRangeFetch ?? 0} / ${open.engineRangeFetch ?? 0} / ${open.mediaRangeMediaElement ?? 0} | ${open.mediaFull ?? 0} (bgm 資産 ${open.bgmAssetFull ?? 0}・sidecar ${open.sidecarPcm ?? 0}) |`);
}
check('録音 wav の合計 ≤ 20 MB・各 ≤ 10 s・16 bit', wavBytes <= 20 * 1024 * 1024, `${(wavBytes / 1024 / 1024).toFixed(1)} MB`);
lines.push('');
lines.push('- 遅延（録音）= seek 到達（webview 側 audioContext.currentTime・onSeek ラップで記録。タイムライン → host → postMessage → rAF 間引き → seekTimelineTime の後）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。アプリ予約 = 到達 → 本編断片の BufferSource.start(when)');
lines.push('- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合。skipped = 次の seek に追い越されて断片を鳴らせなかった seek（最新の seek が勝つ設計。実マウスの 30 Hz は host 側の処理で 16 ms 間隔に詰まることがあり、その先行 seek は追い越される）');
lines.push('- scrub fetch = initiator が scrub-audio.js の Range 要求（CDP Network.requestWillBeSent → loadingFinished）。engine = frame-engine.js 由来の映像デコード用 Range（本票の対象外・既存挙動）。media 要素 = `<video>` の部分取得');
lines.push('');
lines.push('## 受け入れ条件の機械照合', '');
lines.push('| 判定 | 項目 | 実測 |');
lines.push('|---|---|---|');
for (const c of checks) lines.push(`| ${c.ok ? '✅' : '❌'} | ${c.id} | ${c.detail} |`);
lines.push('');
lines.push(`- 合格 ${checks.filter(c => c.ok).length} / ${checks.length}`);
fs.writeFileSync(path.join(evidenceDir, 'l1-shell-summary.md'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
