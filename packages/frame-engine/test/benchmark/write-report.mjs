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
const hashShort = value => typeof value === 'string' ? value.slice(0, 16) : '—';

const goldenRows = golden?.parity?.map(sample =>
  `| ${sample.label} | ${(sample.timeUs / 1e6).toFixed(3)} | ${sample.differingPixels} | ${sample.maxDelta} | ${sample.previewSha256 === sample.exportSha256 ? '一致' : '不一致'} | \`${hashShort(sample.previewSha256)}…\` |`
).join('\n') ?? '| 未取得 | — | — | — | — | — |';
const stageRows = Object.entries(benchmark.profile.stages).map(([stage, value]) =>
  `| ${stage} | ${value.count} | ${number(value.p50Ms)} | ${number(value.p95Ms)} | ${number(value.maxMs)} |`
).join('\n');
const transitionRows = golden?.semantic?.transitionMeasurements
  ? Object.entries(golden.semantic.transitionMeasurements).map(([label, value]) =>
      `| ${label} | ${value.meanRgb.map(number).join(', ')} | ${value.topMeanRgb.map(number).join(', ')} | ${value.bottomMeanRgb.map(number).join(', ')} | ${number(value.halfDistance)} |`
    ).join('\n')
  : '| 未取得 | — | — | — | — |';
const ratio = benchmark.ratio.v2ToRenderCut;
const exclusiveNames = ['tick', 'copyTo', 'planeCompact', 'upload', 'shaderGpu', 'pboWait', 'rowFlip', 'ipcWrite', 'ffmpegDrain'];
const exclusive = exclusiveNames.map(name => ({ name, p50Ms: benchmark.profile.stages[name]?.p50Ms ?? 0 }));
const dominant = exclusive.reduce((best, value) => value.p50Ms > best.p50Ms ? value : best, exclusive[0]);
const finalSurfaceNames = ['tick', 'copyTo', 'planeCompact', 'upload', 'shaderGpu'];
const surfaceFloorMs = finalSurfaceNames.reduce((sum, name) => sum + (benchmark.profile.stages[name]?.p50Ms ?? 0), 0)
  * benchmark.frameCount;
const finalResidualMs = benchmark.encoders.webCodecs.totalMs - surfaceFloorMs;
const decision = ratio <= 1
  ? `**G1 GO**。最終比 ${number(ratio)} は目標 \`v2/render-cut ≤ 1.0\` を満たした。`
  : `**G1 は自動 GO 条件未達**。最終比 ${number(ratio)}。G2 では、下表の exclusive stage と WebCodecs encode の残差を物理床として許容するか、decode backend / mux を追加変更するかを裁定する。`;
const decodeControl = benchmark.profile.decodeControls;
const gop = benchmark.profile.gop;

const report = `# cuts パス実装・G1 実測レポート

このファイルは \`npm run bench:cuts\` の実走結果から更新される一次資料である。測定対象は
Electron 内の実 Chromium / WebCodecs / WebGL2 と、同じ入力を使う render-cut CLI。

## 条件

- ${benchmark.environment.userAgent}
- ${benchmark.frameCount} frames / ${benchmark.durationSeconds}s / 1920×1080 / 30fps
- 入力 SHA-256: \`${benchmark.renderCut.inputSha256}\`（同一 bytes=${benchmark.renderCut.sameInputBytes}）。cuts は 3.25 秒 × 4、2 番目に transform を含む
- v2 最終出口: canvas → WebCodecs H.264（Annex B）→ ffmpeg copy mux
- 対照: render-cut \`standard\` / \`videotoolbox\`

## ゴールデン（preview / export 自出口）

| 点 | 秒 | differing pixels | max delta | PNG SHA-256 | SHA prefix |
|---|---:|---:|---:|---|---|
${goldenRows}

- 全点: ${golden?.pass === true ? '**PASS**' : '**未取得 / FAIL**'}
- 否定側: differingPixels=${golden?.negative?.differingPixels ?? '—'}、comparatorPassed=${golden?.negative?.comparatorPassed ?? '—'}
- freeze 出力尺: 宣言 ${number(golden?.fixture?.durationSeconds)}s / ffprobe ${number(golden?.encoded?.durationSeconds)}s
- freeze 内 2 点の PNG hash: \`${hashShort(golden?.parity?.find(value => value.label === 'freeze-inside-a')?.exportSha256)}…\` / \`${hashShort(golden?.parity?.find(value => value.label === 'freeze-inside-b')?.exportSha256)}…\`

## トランジション中間フレーム

| 点 | 全体 mean RGB | 上半分 mean RGB | 下半分 mean RGB | 上下距離 |
|---|---|---|---|---:|
${transitionRows}

dissolve は前後どちらとも異なる中間値、fade-black/white は進行率 0.5 で色プレート、
reveal は上下半分の距離と 2 入力 plan により前後カットの同居を判定する。

## 段階別プロファイル

| stage | count | p50 ms | p95 ms | max ms |
|---|---:|---:|---:|---:|
${stageRows}

\`tick\` / \`copyTo\` / \`planeCompact\` / \`upload\` / \`shaderGpu\` / \`pboWait\` /
\`rowFlip\` は renderer、\`ipcWrite\` / \`ffmpegDrain\` / \`ffmpegClose\` は main で個別計時した。

## 律速分離 5 計画

1. 段階別計時: 上表。GPU shader と CPU wall は別欄。
2. decode 対照: full=${number(decodeControl.full.totalMs)}ms、事前 cache=${number(decodeControl.cached.totalMs)}ms、decode 無し固定面=${number(decodeControl.fixed.totalMs)}ms。decode 比率=${number(decodeControl.decodeShare)}、cache/full=${number(decodeControl.cacheToFullRatio)}。
3. GOP / Lookahead / Warmup: cold p50=${number(gop.cold.summary.p50Ms)}ms、warm p50=${number(gop.warm.summary.p50Ms)}ms、warm/cold=${number(gop.warmToColdP50Ratio)}、Lookahead hit p50=${number(gop.lookaheadHit.p50Ms)}ms。各 cut 境界の直前 keyframe 距離は benchmark JSON の \`details\` に保存。
4. 8MB IPC: invoke p50=${number(benchmark.ipc.invoke.p50Ms)}ms、MessagePort transfer p50=${number(benchmark.ipc.messagePort.p50Ms)}ms、shared buffer p50=${number(benchmark.ipc.sharedBuffer.p50Ms)}ms（available=${benchmark.ipc.sharedBuffer.available}）。
5. encoder: raw RGBA→ffmpeg=${number(benchmark.encoders.ffmpegPipe.totalMs)}ms、WebCodecs→copy mux=${number(benchmark.encoders.webCodecs.totalMs)}ms、比=${number(benchmark.encoders.webCodecsToFfmpegRatio)}。

## before / after と最終 G1 値

- Phase 0 before: v2 10,321.481ms / render-cut 4,074.210ms = **2.533**
- 本実装 raw ffmpeg path: ${number(benchmark.encoders.ffmpegPipe.totalMs)}ms
- 本実装 WebCodecs path（after）: ${number(benchmark.encoders.webCodecs.totalMs)}ms
- 同 run render-cut: ${number(benchmark.renderCut.elapsedMs)}ms
- **最終 v2/render-cut = ${number(ratio)}**
- encoded cross-engine PSNR sanity: average=${number(benchmark.psnr.averageDb)}dB（pixel equality の判定には使用しない）

${decision}

## 律速の結論

raw path から readback・8MB/frame IPC・raw pipe encode をまとめて外せる WebCodecs path を採用した。
decode は cut ID ごとの独立 lane（同じ parsed MP4 backing store から fork）へ分け、transition の
outgoing / incoming が同じ MP4Clip 状態を交互 seek しない。直前 VideoFrame の表示区間内要求は
所有 clone から返し、freeze の sub-frame 時刻で decoder cursor を不要に進めない。
plane compact は stride が既に tight な native plane では view を返し、texture は初回確保後
\`texSubImage2D\` で再利用する。WebCodecs 直結時は surface consumer が同期点になるため
per-frame \`gl.finish\` を \`gl.flush\` へ替え、profile / golden の GPU timer 経路だけ finish を維持する。
exclusive stage の最大 p50 は **${dominant.name} = ${number(dominant.p50Ms)}ms**。
最終 surface path（tick + copyTo + compact + upload + shader GPU）の p50 積算 × ${benchmark.frameCount} frames は
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
