#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data = JSON.parse(await readFile(path.join(evidence, 'compare.json'), 'utf8'));
const lines = [
  '# GPU 字幕の動き・見た目 parity',
  '',
  '640×360 / 30fps の実書き出しを比較した。各 fixture は字幕 1 件と単色映像を持つ。GPU と OSR の同一フレームを 10% / 25% / 50% / 90%（登場 0.6 秒の第 2 / 5 / 9 / 16 フレーム）で比較する。',
  '',
  '10% の登場 push・wipe・typewriter は両者無描画で一致するため、描画が始まった 25% も全 fixture で測定した。',
  '',
  `対応対象は **${data.summary.supportedWithin}/${data.summary.supported} 時点で合格**。基準は重心 dcx/dcy ±0.002、矩形 dw/dh ±0.007（フレーム比）。差分画素率は RGB の最大チャンネル差が 16 を超える画素の割合で、追加の観測値として記録した。インク比は背景からの色差総量 GPU/OSR。`,
  '',
  '| fixture | 時点 | GPU−OSR: dcx / dcy / dw / dh / インク比 / 差分画素率 | 判定 |',
  '|---|---:|---|---|',
];
for (const row of data.captures) {
  const d = row.delta;
  const number = (value) => value == null ? '—' : String(value);
  const values = d ? [d.dcx, d.dcy, d.dw, d.dh, d.inkRatio, d.differencePixels].map(number).join(' / ') : '— / — / — / — / — / —';
  const verdict = row.name === 'typewriter-gradient' ? '非対応' : row.within ? 'PASS' : 'FAIL';
  lines.push(`| ${row.name} | ${row.phase}% | ${values} | ${verdict} |`);
}
const owner = data.owner;
const maxDiff = Math.max(...data.captures.filter((row) => row.name !== 'typewriter-gradient')
  .map((row) => row.delta.differencePixels));
lines.push('',
  `対応対象の最大差: |dcx| ${Math.max(...data.captures.filter((r) => r.name !== 'typewriter-gradient').map((r) => Math.abs(r.delta.dcx))).toFixed(6)}、|dcy| ${Math.max(...data.captures.filter((r) => r.name !== 'typewriter-gradient').map((r) => Math.abs(r.delta.dcy))).toFixed(6)}、|dw| ${Math.max(...data.captures.filter((r) => r.name !== 'typewriter-gradient').map((r) => Math.abs(r.delta.dw))).toFixed(6)}、|dh| ${Math.max(...data.captures.filter((r) => r.name !== 'typewriter-gradient').map((r) => Math.abs(r.delta.dh))).toFixed(6)}、差分画素率 ${maxDiff.toFixed(6)}。`,
  '',
  `glitch のクリップ上下端は 0〜18 フレーム全件で比較し、GPU−OSR の最大差は ${data.summary.glitchMaxClipEdgeDifferencePx} px。共通 CSS レシピは 0/30/60/100% の単一クリップ矩形であり、乱数や色ずれを含まない。`,
  `typewriter 50% の可視書記素数の画素インク推定は GPU ${data.typewriter.gpu.estimatedVisibleAt50}/${data.typewriter.gpu.graphemes}、OSR ${data.typewriter.osr.estimatedVisibleAt50}/${data.typewriter.osr.graphemes}。インク比は GPU ${data.typewriter.gpu.inkFractionAt50}、OSR ${data.typewriter.osr.inkFractionAt50}。`,
  `オーナー相当 fixture（glitch 10 件、stroke_inner 1 件、display_policy なし）は edit-lint exit ${owner.lintExit}、auto plan exit ${owner.planExit} / 選択 ${owner.planSelectedEngine} / 非適格警告 ${owner.planIneligibleWarning}、実書き出し exit ${owner.exit} / 選択 ${owner.selectedEngine}。`,
  '',
  'typewriter×fill_gradient は基準側が 50% と 90% で無描画になる。GPU は適格判定で `caption-typewriter-gradient-osr-empty` として拒否されるため、比較欄は空欄にした。',
  '',
  '比較シートは左が OSR、右が GPU。非対応の組み合わせはシートから除外した。各時点の `sheet-10.png` / `sheet-25.png` / `sheet-50.png` / `sheet-90.png` と詳細値 `compare.json` を参照する。',
  '',
  '再現: リポジトリ直下から以下を順に実行する。生成物と中間フレームは OS の一時ディレクトリへ置く。',
  '',
  '```sh',
  'node packages/gpu-export/evidence/tl-gpu-caption-parity/scripts/fixture.mjs',
  'node packages/gpu-export/evidence/tl-gpu-caption-parity/scripts/export.mjs gpu',
  'node packages/gpu-export/evidence/tl-gpu-caption-parity/scripts/export.mjs osr',
  'node packages/gpu-export/evidence/tl-gpu-caption-parity/scripts/export.mjs owner',
  'node packages/gpu-export/evidence/tl-gpu-caption-parity/scripts/compare.mjs',
  'node packages/gpu-export/evidence/tl-gpu-caption-parity/scripts/readme.mjs',
  '```',
  '');
await writeFile(path.join(evidence, 'README.md'), `${lines.join('\n')}\n`);
