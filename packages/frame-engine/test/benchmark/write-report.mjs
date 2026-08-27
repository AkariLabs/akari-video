import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(directory, '../..');
const benchmark = JSON.parse(readFileSync(resolve(directory, '.generated/benchmark-results.json'), 'utf8'));
const goldenPath = resolve(packageDirectory, 'test/golden/.generated/results.json');
const golden = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : null;
if (golden?.pass !== true || golden.semantic?.pass !== true || golden.parity?.length !== 28) {
  throw new Error('the current 28-point passing golden result is required before writing the cuts path report');
}

const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};
const hashShort = value => typeof value === 'string' ? value.slice(0, 16) : '—';
const skipped = value => value && typeof value.skipped === 'string' ? value.skipped : null;
const status = value => value == null ? '結果なし' : skipped(value) ? `skipped: ${skipped(value)}` : '完了';
const measured = (value, render) => value == null
  ? 'skipped: 結果なし'
  : skipped(value)
    ? `skipped: ${skipped(value)}`
    : render(value);

const goldenRows = golden.parity.map(sample =>
  `| ${sample.label} | ${(sample.timeUs / 1e6).toFixed(3)} | ${sample.differingPixels} | ${sample.maxDelta} | ${sample.previewSha256 === sample.exportSha256 ? '一致' : '不一致'} | \`${hashShort(sample.previewSha256)}…\` |`
).join('\n');
const stageMetrics = skipped(benchmark.profile?.stages) ? null : benchmark.profile?.stages;
const stageRows = stageMetrics
  ? Object.entries(stageMetrics).map(([stage, value]) =>
      `| ${stage} | ${value.classification ?? '—'} | ${value.relationship ?? '—'} | ${value.count} | ${number(value.p50Ms)} | ${number(value.p95Ms)} | ${number(value.maxMs)} | ${number(value.perFrameContributionMs)} |`
    ).join('\n')
  : `| skipped | — | ${skipped(benchmark.profile?.stages) ?? '段階別結果なし'} | — | — | — | — | — |`;
const transitionRows = Object.entries(golden.semantic.transitionMeasurements ?? {}).map(([label, value]) =>
  `| ${label} | ${value.meanRgb.map(number).join(', ')} | ${value.topMeanRgb.map(number).join(', ')} | ${value.bottomMeanRgb.map(number).join(', ')} | ${number(value.halfDistance)} |`
).join('\n') || '| 未取得 | — | — | — | — |';

const phases = benchmark.phases ?? {};
const repeatedRuns = Array.isArray(phases.runs) ? phases.runs : [];
const phaseRows = [
  'exportRawFfmpeg',
  'exportWebCodecs',
  'runRenderCut',
  'psnr',
  'profileDecodeAndCache',
  'gopAndWarmup',
  'ipcComparison'
].map(name => `| ${name} | ${status(phases[name])} | ${number(phases[name]?.phaseElapsedMs ?? phases[name]?.elapsedMs ?? phases[name]?.totalMs)} |`).join('\n');
const skippedPhases = Array.isArray(benchmark.skippedPhases) ? benchmark.skippedPhases : [];
const skippedRows = skippedPhases.length
  ? skippedPhases.map(value => `- ${value.name}: ${value.reason}`).join('\n')
  : '- なし';

const decodeControl = benchmark.profile?.decodeControls;
const gop = benchmark.profile?.gop;
const ipc = benchmark.ipc;
const raw = benchmark.encoders?.ffmpegPipe;
const webCodecs = benchmark.encoders?.webCodecs;
const renderCut = benchmark.renderCut;
const psnr = benchmark.psnr;
const ratio = benchmark.ratio?.v2ToRenderCut;
const rawRunSamples = repeatedRuns.flatMap(value => skipped(value.exportRawFfmpeg) ? [] : [value.exportRawFfmpeg.totalMs]);
const webCodecsRunSamples = repeatedRuns.flatMap(value => skipped(value.exportWebCodecs) ? [] : [value.exportWebCodecs.totalMs]);
const renderCutRunSamples = repeatedRuns.flatMap(value => skipped(value.runRenderCut) ? [] : [value.runRenderCut.elapsedMs]);
const ratioSamples = Array.isArray(benchmark.ratio?.samples) ? benchmark.ratio.samples : [];
const repeatedRatio = value => skipped(value.exportWebCodecs)
  || skipped(value.runRenderCut)
  || !(value.runRenderCut.elapsedMs > 0)
  ? null
  : value.exportWebCodecs.totalMs / value.runRenderCut.elapsedMs;
const repeatedRunRows = repeatedRuns.length
  ? repeatedRuns.map(value => `| ${value.run} | ${measured(value.exportRawFfmpeg, phase => number(phase.totalMs))} | ${measured(value.exportWebCodecs, phase => number(phase.totalMs))} | ${measured(value.runRenderCut, phase => number(phase.elapsedMs))} | ${number(repeatedRatio(value))} |`).join('\n')
  : '| skipped | — | — | — | — |';
const repeatSummaryRows = [
  ['minimum', values => values.length ? Math.min(...values) : null],
  ['median', median],
  ['maximum', values => values.length ? Math.max(...values) : null]
].map(([label, summarize]) =>
  `| **${label}** | ${number(summarize(rawRunSamples))} | ${number(summarize(webCodecsRunSamples))} | ${number(summarize(renderCutRunSamples))} | ${number(summarize(ratioSamples))} |`
).join('\n');
const crossesTarget = typeof benchmark.ratio?.minimum === 'number'
  && typeof benchmark.ratio?.maximum === 'number'
  && benchmark.ratio.minimum < 1
  && benchmark.ratio.maximum > 1;
const targetSpread = crossesTarget
  ? `**注意: min=${number(benchmark.ratio.minimum)}〜max=${number(benchmark.ratio.maximum)} が目標 1.0 を跨いでいる。判定代表値は median=${number(benchmark.ratio.median)} だが、run 間変動を併記して G2 で扱う。**`
  : `min=${number(benchmark.ratio?.minimum)}〜max=${number(benchmark.ratio?.maximum)} は目標 1.0 を跨いでいない。`;
const dominant = benchmark.profile?.dominantStage;
const exclusiveRanking = Array.isArray(benchmark.profile?.exclusiveRanking)
  ? benchmark.profile.exclusiveRanking
  : [];
const oneShotStages = Array.isArray(benchmark.profile?.oneShotStages)
  ? benchmark.profile.oneShotStages
  : [];
const rankingRows = exclusiveRanking.length
  ? exclusiveRanking.map((value, index) =>
      `| ${index + 1} | ${value.name} | ${value.count} | ${number(value.p50Ms)} | ${number(value.perFrameContributionMs)} |`
    ).join('\n')
  : '| skipped | — | — | — | — |';
const oneShotRows = oneShotStages.length
  ? oneShotStages.map(value => `| ${value.name} | ${value.count} | ${number(value.p50Ms)} |`).join('\n')
  : '| なし / skipped | — | — |';
const ipcTransit = stageMetrics?.ipcTransit;
const finalSurfaceNames = ['tick', 'copyTo', 'planeCompact', 'upload', 'shaderGpu'];
const surfaceFloorMs = stageMetrics && typeof benchmark.frameCount === 'number'
  ? finalSurfaceNames.reduce((sum, name) => sum + (stageMetrics[name]?.perFrameContributionMs ?? 0), 0) * benchmark.frameCount
  : null;
const finalResidualMs = surfaceFloorMs != null && !skipped(webCodecs) && typeof webCodecs?.totalMs === 'number'
  ? webCodecs.totalMs - surfaceFloorMs
  : null;
const decision = typeof ratio !== 'number'
  ? '**G1 最終比は未取得**。skipped フェーズを解消して再測定する。'
  : ratio <= 1
    ? `**G1 GO**。median 最終比 ${number(ratio)} は目標 \`v2/render-cut ≤ 1.0\` を満たした。`
    : `**G1 自動 GO 条件は未達**。median 最終比 ${number(ratio)}。G2 では、per-frame exclusive 最大寄与 ${dominant ? `${dominant.name}=${number(dominant.perFrameContributionMs)}ms/frame` : '未取得'}、surface path 推計 ${number(surfaceFloorMs)}ms、encode queue / chunk IPC / mux / scheduling 残差 ${number(finalResidualMs)}ms を物理床候補として、現行出口を許容するか decode backend / mux を追加変更するか裁定する。`;
const physicalFloor = typeof ratio === 'number' && ratio > 1
  ? `未達の物理床は、各出力フレームで省略できない tick / copyTo / compact / upload / shader GPU の実測 p50 積算 ${number(surfaceFloorMs)}ms と、VideoEncoder が符号化 chunk を生成して main の copy mux が閉じるまでの実測残差 ${number(finalResidualMs)}ms に分離できる。raw 出口固有の readback・8MB IPC・raw pipe は after から既に除外済みなので、同じ改善を重ねてもこの二項は縮まない。`
  : '';

const improvements = Array.isArray(benchmark.improvements) ? benchmark.improvements : [];
const improvementRows = improvements.length
  ? improvements.map(value =>
      `| ${value.name} | ${number(value.beforeMs)} | ${number(value.afterMs)} | ${number(value.deltaMs)} | ${number(value.ratio)} | ${value.evidence} |`
    ).join('\n')
  : `| skipped | — | — | — | — | ${skipped(raw) ?? skipped(webCodecs) ?? 'before / after の同一 run 結果なし'} |`;

const decodePlan = measured(decodeControl, value =>
  `full=${number(value.full.totalMs)}ms、事前 cache=${number(value.cached.totalMs)}ms、decode 無し固定面=${number(value.fixed.totalMs)}ms、decode 比率=${number(value.decodeShare)}、cache/full=${number(value.cacheToFullRatio)}、fixed/full=${number(value.fixedToFullRatio)}`
);
const gopPlan = measured(gop, value =>
  `cold p50/p95=${number(value.cold.summary.p50Ms)}/${number(value.cold.summary.p95Ms)}ms、warm p50/p95=${number(value.warm.summary.p50Ms)}/${number(value.warm.summary.p95Ms)}ms、warm/cold=${number(value.warmToColdP50Ratio)}、Lookahead hit p50=${number(value.lookaheadHit.p50Ms)}ms`
);
const ipcPlan = measured(ipc, value =>
  `main invoke copy=${number(value.invoke.p50Ms)}ms、main MessagePort copy=${number(value.messagePort.p50Ms)}ms、main SAB available=${value.sharedBuffer.available}（${value.sharedBuffer.reasonCode}: ${value.sharedBuffer.reason}）、Worker ArrayBuffer transfer=${number(value.worker.arrayBufferTransfer.p50Ms)}ms、Worker SAB=${number(value.worker.sharedBuffer.p50Ms)}ms（available=${value.worker.sharedBuffer.available}）`
);
const ipcBoundaryPenalty = !skipped(ipc)
  && typeof ipc?.invoke?.p50Ms === 'number'
  && typeof ipc?.worker?.arrayBufferTransfer?.p50Ms === 'number'
  && ipc.worker.arrayBufferTransfer.p50Ms > 0
  ? ipc.invoke.p50Ms / ipc.worker.arrayBufferTransfer.p50Ms
  : null;
const encoderPlan = raw == null || webCodecs == null || skipped(raw) || skipped(webCodecs)
  ? `skipped: ${skipped(raw) ?? skipped(webCodecs) ?? '結果なし'}`
  : `raw RGBA→ffmpeg=${number(raw?.totalMs)}ms、WebCodecs→copy mux=${number(webCodecs?.totalMs)}ms、after/before=${number(benchmark.encoders?.webCodecsToFfmpegRatio)}`;

const report = `# cuts パス実装・G1 実測レポート

このファイルは \`npm run bench:cuts\` の実走結果から更新される一次資料である。測定対象は
Electron 内の実 Chromium / WebCodecs / WebGL2 と、同じ入力を使う render-cut CLI。

## 条件

- upload path: requested=${benchmark.uploadPath?.requested ?? '—'} / effective=${benchmark.uploadPath?.effective ?? '—'}
- ${benchmark.environment?.userAgent ?? '環境情報未取得'}
- ${benchmark.frameCount ?? '—'} frames / ${benchmark.durationSeconds ?? '—'}s / 1920×1080 / 30fps
- ratio 対象 ${benchmark.ratio?.runs ?? '—'} runs（代表値 median、段階別 profile source run=${benchmark.profile?.sourceRun ?? '—'}）
- v2/render-cut median=${number(benchmark.ratio?.median)} / cold run 除外 steady median=${number(benchmark.ratio?.steadyMedian)}
- 入力 SHA-256: \`${renderCut?.inputSha256 ?? '未取得'}\`（同一 bytes=${renderCut?.sameInputBytes ?? '未取得'}）。cuts は 3.25 秒 × 4、2 番目に transform を含む
- v2 最終出口: canvas → WebCodecs H.264（Annex B）→ ffmpeg copy mux
- 対照: render-cut \`standard\` / \`videotoolbox\`

## フェーズ状態

| phase | status | elapsed ms |
|---|---|---:|
${phaseRows}

skippedPhases:

${skippedRows}

## 反復測定

| run | raw ffmpeg pipe before ms | WebCodecs after ms | render-cut ms | v2/render-cut |
|---:|---:|---:|---:|---:|
${repeatedRunRows}
${repeatSummaryRows}

${targetSpread}

## ゴールデン（preview / export 自出口）

| 点 | 秒 | differing pixels | max delta | PNG SHA-256 | SHA prefix |
|---|---:|---:|---:|---|---|
${goldenRows}

- 全点: **PASS**
- 否定側: differingPixels=${golden.negative?.differingPixels ?? '—'}、comparatorPassed=${golden.negative?.comparatorPassed ?? '—'}
- freeze 出力尺: 宣言 ${number(golden.fixture?.durationSeconds)}s / ffprobe ${number(golden.encoded?.durationSeconds)}s
- freeze 内 2 点の PNG hash: \`${hashShort(golden.parity.find(value => value.label === 'freeze-inside-a')?.exportSha256)}…\` / \`${hashShort(golden.parity.find(value => value.label === 'freeze-inside-b')?.exportSha256)}…\`

## トランジション中間フレーム

| 点 | 全体 mean RGB | 上半分 mean RGB | 下半分 mean RGB | 上下距離 |
|---|---|---|---|---:|
${transitionRows}

dissolve は前後どちらとも異なる中間値、fade-black/white は進行率 0.5 で色プレート、
reveal は上下半分の距離と 2 入力 plan により前後カットの同居を判定する。

## 段階別プロファイル

| stage | class | relationship | count | p50 ms | p95 ms | max ms | per-frame contribution ms |
|---|---|---|---:|---:|---:|---:|---:|
${stageRows}

inclusive は子段を含む wall、exclusive は per-frame ランキング対象、one-shot は export 全体で
一度だけ発生する後処理である。親子は二重計上しない。\`ipcTransit\` は
\`sink.p50 - (ipcWrite.p50 + ffmpegDrain.p50)\` = **${number(ipcTransit?.p50Ms)}ms** として導出した。

### Exclusive per-frame 寄与ランキング

| rank | stage | count | p50 ms | p50 × count / frameCount ms |
|---:|---|---:|---:|---:|
${rankingRows}

支配段は ${dominant ? `**${dominant.name} = ${number(dominant.perFrameContributionMs)}ms/frame**（p50=${number(dominant.p50Ms)}ms、count=${dominant.count}）` : '**skipped**'}。

### One-shot

| stage | count | p50 ms |
|---|---:|---:|
${oneShotRows}

one-shot は per-frame ランキングと per-frame 合計から除外する。

## 律速分離 5 計画

1. 段階別計時: ${stageMetrics ? `${benchmark.frameCount} frames の inclusive / exclusive / one-shot と p50/p95 を上表へ記録。exclusive だけを per-frame 寄与で順位づけ` : `skipped: ${skipped(benchmark.profile?.stages) ?? '結果なし'}`}。
2. decode 対照: ${decodePlan}。
3. GOP / Lookahead / Warmup: ${gopPlan}。cut 境界ごとの直前 keyframe 距離は benchmark JSON の \`details\` に保存。
4. 8MB IPC: ${ipcPlan}。
5. encoder: ${encoderPlan}。

renderer → main の SharedArrayBuffer はプロセス境界を越えず、MessagePortMain では
\`event.data\` が null 化するため測定対象外（\`available:false\`）とした。共有メモリ系の
プロセス越え評価は Phase 4 の WebCodecs 出口評価へ送る。
8MB の renderer → main invoke copy と renderer → Worker ArrayBuffer transfer の実測比は
**${number(ipcBoundaryPenalty)}倍**。raw sink から導出した ipcTransit=${number(ipcTransit?.p50Ms)}ms と
独立 IPC レーン invoke=${number(ipc?.invoke?.p50Ms)}ms を相互検証し、8MB IPC を WebCodecs 最終出口から
外す改善の定量根拠とする。

## 改善の before / after

| 改善 | before ms | after ms | delta ms | after/before | evidence |
|---|---:|---:|---:|---:|---|
${improvementRows}

- profile source run (${benchmark.profile?.sourceRun ?? '—'}) render-cut: ${measured(renderCut, value => `${number(value.elapsedMs)}ms`)}
- **最終 v2/render-cut（median）= ${number(ratio)}**（min=${number(benchmark.ratio?.minimum)} / max=${number(benchmark.ratio?.maximum)}）
- encoded cross-engine PSNR sanity: ${measured(psnr, value => `average=${number(value.averageDb)}dB`)}（pixel equality の判定には使用しない）

${decision}

${physicalFloor}

## 律速の結論

raw path から readback・8MB/frame IPC・raw pipe encode をまとめて外せる WebCodecs path を採用した。
decode は cut ID ごとの独立 lane（同じ parsed MP4 backing store から fork）へ分け、transition の
outgoing / incoming が同じ MP4Clip 状態を交互 seek しない。直前 VideoFrame の表示区間内要求は
所有 clone から返し、freeze の sub-frame 時刻で decoder cursor を不要に進めない。
plane compact は stride が既に tight な native plane では view を返し、texture は初回確保後
\`texSubImage2D\` で再利用する。WebCodecs 直結時は surface consumer が同期点になるため
per-frame \`gl.finish\` を \`gl.flush\` へ替え、profile / golden の GPU timer 経路だけ finish を維持する。
最終 surface path（tick + copyTo + compact + upload + shader GPU）の p50 積算 × ${benchmark.frameCount ?? '—'} frames は
${number(surfaceFloorMs)}ms、WebCodecs 最終 wall との差（encode queue / chunk IPC / mux / scheduling）は
${number(finalResidualMs)}ms。未達時の物理床根拠と G2 裁定はこの二つを分けて扱う。

## timeline-map カーネルへの freeze 昇格素案

現在は frame-engine の \`buildResolvedTimelinePlan\` が、(1) freeze 分を source range に換算して
仮想 cut 尺を伸ばす、(2) その列を \`buildTimelineMap\` へ渡して transition overlap を解決する、
(3) \`playbackSecondsAt\` で出力秒を「前進→静止→前進」の区分写像へ戻す、の 3 段を担う。

G2 で共有カーネルへ上げる場合は、\`packages/edit-store/src/timeline-map.ts\` の
\`buildTimelineMap\` に freeze-aware duration provider を追加し、\`TimelineSegment\` に
\`sourceTimeAt(outputT)\` 相当の宣言データ（freezeAt / freezeDuration）を持たせ、
\`outputToSource\` の線形式を区分写像へ拡張する。transition window はこの拡張後の segment
境界から作る。gap/track 併用時に「後続をどの track cursor だけずらすか」を先に裁定し、
現行の明示例外を無言許容へ変えないことが昇格条件である。

## 既知差分

- render-cut の crop / perspective にある 1px 量子化・区分保持は引き継がず、GPU 上で連続補間する。
- transform の回転は固定 output canvas 内でクリップする。ffmpeg の拡大 bounding box を経由しない。
- cross-engine は encode 後 PSNR の sanity のみ。preview/export 自出口だけを pixel diff 0 / PNG SHA-256 一致で判定する。
`;

writeFileSync(resolve(packageDirectory, 'docs/cuts-path-report.md'), report);
process.stdout.write(`${resolve(packageDirectory, 'docs/cuts-path-report.md')}\n`);
