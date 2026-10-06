#!/usr/bin/env node
// Merge measured CDP and render-cut results into the required four-column matrix.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { recordsDir } from './records.mjs';

const evidence = recordsDir;
const prefix = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !prefix.includes('tl-caption-motion-render')) throw new Error('dedicated fixture prefix required');
const read = async file => { try { return JSON.parse(await readFile(file)); } catch { return null; } };
const columns = ['previewLegacy', 'previewPolicy', 'exportOsr', 'exportAuto'];
const rows = [];
const gpuChunks = [];
for (const start of [0, 20, 40, 60]) {
  const manifest = await read(path.join(`${prefix.replace(/matrix$/u, 'gpu')}-${start}`, 'manifest.json'));
  if (manifest) gpuChunks.push({ manifest,
    legacy: await read(path.join(evidence, `export-legacy-auto-gpu-${start}.json`)),
    policy: await read(path.join(evidence, `export-policy-auto-gpu-${start}.json`)) });
}
const unsupportedManifest = await read(path.join(`${prefix.replace(/matrix$/u, 'unsupported')}-0`, 'manifest.json'));
const unsupportedAuto = unsupportedManifest ? {
  manifest: unsupportedManifest,
  legacy: await read(path.join(evidence, 'export-legacy-auto-unsupported-0.json')),
  policy: await read(path.join(evidence, 'export-policy-auto-unsupported-0.json')),
} : null;
for (const start of [0, 20, 40, 60, 80]) {
  const manifest = await read(path.join(`${prefix}-${start}`, 'manifest.json'));
  if (!manifest) throw new Error(`missing chunk manifest ${start}`);
  const previews = {
    legacy: await read(path.join(evidence, `preview-legacy-${start}.json`)),
    policy: await read(path.join(evidence, `preview-policy-${start}.json`)),
  };
  const exports = {
    'legacy-osr': await read(path.join(evidence, `export-legacy-osr-${start}.json`)),
    'policy-osr': await read(path.join(evidence, `export-policy-osr-${start}.json`)),
  };
  const status = (result, key) => {
    if (!result) return { pass: false, reason: '未実測' };
    if (result.launchError) return { pass: false, reason: result.launchError };
    if (result.renderExit !== undefined && result.renderExit !== 0) return { pass: false, reason: `書き出し exit ${result.renderExit}: ${result.renderError || ''}`.trim() };
    const row = result.rows?.find(item => item.key === key);
    if (!row) return { pass: false, reason: 'この行は未実測' };
    if (key === 'owner:typewriter' && result.typewriterFinal?.pass === false) {
      return { pass: false, reason: `文字送り終端と対照の差分が大きい: ${result.typewriterFinal.changed} px`, checks: row.checks };
    }
    const failedMotion = row.checks?.filter(check => !check.pass).map(check => check.reason
      ? `${check.slot}: ${check.reason}` : `${check.slot}: 差分 ${check.changed} px / 平均 ${Number(check.mean).toFixed(3)}`) ?? [];
    const failedNeutral = row.neutral?.included && !row.neutral.pass
      ? [`見た目差: 中立 ${row.neutral.changed ?? '?'} px / 平均 ${Number(row.neutral.mean).toFixed(3)}`] : [];
    const failedRich = row.richHalf && !row.richHalf.pass ? ['リッチ文字の半分表示または層構造が不一致'] : [];
    return { pass: row.pass === true, reason: row.pass ? null : [...failedMotion, ...failedNeutral, ...failedRich].join('、') || '判定に失敗',
      checks: row.checks, neutral: row.neutral, richHalf: row.richHalf,
      selectedEngine: result.selectedEngine ?? null, autoReasonJa: row.autoReasonJa ?? null };
  };
  for (const item of manifest.rows) {
    const osrLegacy = status(exports['legacy-osr'], item.key), osrPolicy = status(exports['policy-osr'], item.key);
    const gpuChunk = gpuChunks.find(chunk => chunk.manifest.rows.some(row => row.key === item.key));
    const gpuStatus = (result) => {
      const measured = status(result, item.key);
      return measured.pass && result.selectedEngine !== 'gpu'
        ? { pass: false, reason: `auto の選択は ${result.selectedEngine ?? '不明'}（GPU 経路未検証）`, checks: measured.checks }
        : measured;
    };
    const osrFallbackStatus = (result) => {
      const measured = status(result, item.key);
      if (!measured.pass) return measured;
      if (result.selectedEngine !== 'osr') return { ...measured, pass: false,
        reason: `auto の選択は ${result.selectedEngine ?? '不明'}（OSR 降格未確認）` };
      if (!/[ぁ-んァ-ン一-龯]/u.test(measured.autoReasonJa ?? '')) return { ...measured, pass: false,
        reason: 'OSR 降格の日本語理由がない' };
      return measured;
    };
    const autoLegacy = gpuChunk ? gpuStatus(gpuChunk.legacy) : osrFallbackStatus(unsupportedAuto?.legacy);
    const autoPolicy = gpuChunk ? gpuStatus(gpuChunk.policy) : osrFallbackStatus(unsupportedAuto?.policy);
    const combine = (a, b) => ({ pass: a.pass && b.pass, reason: [!a.pass && `従来: ${a.reason}`, !b.pass && `display_policy: ${b.reason}`].filter(Boolean).join(' / ') || null, variants: { legacy: a, policy: b } });
    rows.push({ key: item.key, animation: item.animation, remeasured: true,
      previewLegacy: status(previews.legacy, item.key), previewPolicy: status(previews.policy, item.key),
      exportOsr: combine(osrLegacy, osrPolicy), exportAuto: combine(autoLegacy, autoPolicy) });
  }
}
const counts = Object.fromEntries(columns.map(column => [column, { pass: rows.filter(row => row[column].pass).length, fail: rows.filter(row => !row[column].pass).length }]));
const neutral = rows.flatMap(row => [row.previewLegacy.neutral, row.previewPolicy.neutral,
  row.exportOsr.variants.legacy.neutral, row.exportOsr.variants.policy.neutral,
  row.exportAuto.variants.legacy.neutral, row.exportAuto.variants.policy.neutral]).filter(Boolean);
const neutralCounts = { included: neutral.filter(item => item.included).length,
  pass: neutral.filter(item => item.included && item.pass).length,
  fail: neutral.filter(item => item.included && !item.pass).length,
  excluded: neutral.filter(item => !item.included).length };
const result = { rows, counts, neutralCounts, totalRows: rows.length, remeasuredKeys: rows.map(row => row.key) };
await writeFile(path.join(evidence, 'results.json'), JSON.stringify(result, null, 2) + '\n');
const metric = check => check.reason ? check.reason : `${check.changed} px / ${Number(check.mean).toFixed(3)}`;
const cell = value => {
  if (value.variants) return `${value.pass ? '合' : `否（${value.reason}）`}<br>従来: ${cell(value.variants.legacy)}<br>policy: ${cell(value.variants.policy)}`;
  const motion = value.checks?.map(check => `${check.slot}@${check.offset}s ${metric(check)}`).join('、') ?? '未実測';
  const neutralText = value.neutral?.included ? `中立@${value.neutral.offset}s ${metric(value.neutral)} ${value.neutral.pass ? '合' : '否（見た目差）'}`
    : value.neutral ? `中立除外: ${value.neutral.reason}` : '中立未実測';
  return `${value.pass ? '合' : `否（${value.reason}）`}<br>${motion}<br>${neutralText}`
    + (value.selectedEngine ? `<br>engine: ${value.selectedEngine}` : '')
    + (value.autoReasonJa ? `<br>${value.autoReasonJa}` : '');
};
const lines = ['# 字幕動きの総当たり結果', '', `対象 ${rows.length} 行は最終コードで全件再実測。合/否は動作時刻の差分と中立時刻の一致で判定した。`,
  `中立チェック: 対象 ${neutralCounts.included}（合 ${neutralCounts.pass} / 否 ${neutralCounts.fail}）、設計上の除外 ${neutralCounts.excluded}。`, '',
  '| 動き | プレビュー従来 | プレビュー display_policy | 書き出し OSR | 書き出し auto |', '|---|---|---|---|---|',
  ...rows.map(row => `| ${row.key} | ${columns.map(column => cell(row[column])).join(' | ')} |`), '',
  '| 列 | 合 | 否 |', '|---|---:|---:|', ...columns.map(column => `| ${column} | ${counts[column].pass} | ${counts[column].fail} |`), ''];
await writeFile(path.join(evidence, 'results.md'), lines.join('\n'));
console.log(JSON.stringify({ totalRows: rows.length, counts, neutralCounts }));
