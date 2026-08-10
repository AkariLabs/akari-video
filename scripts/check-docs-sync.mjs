#!/usr/bin/env node
// docs 内の「スキル数」手書き表記・スキルカタログのリンク網羅・契約索引のリンク網羅が
// 正本（skills/ ディレクトリ数・docs/contract-*.md 一覧）とドリフトしていないかを検査する。
// gen-skills-index.mjs と同じ流儀（依存ゼロ・fail(msg) で exit 1・console.log で成功報告）。
// 検査専用スクリプト（生成モードはない・常に検査する）。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => { console.error(`check-docs-sync: ${msg}`); process.exit(1); };

const errors = [];

const skillNames = readdirSync(join(root, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const skillCount = skillNames.length;

// 検査 1: スキル数の手書き表記が skills/ の実数と一致するか。
// パターンが見つからない場合も fail する（表記が消えた/表現が変わったことを検知するため）
const numberChecks = [
  { file: 'README.md', patterns: [/agent_skills-(\d+)-ff8a00/, /the (\d+)-skill map/, /\((\d+) of them\)/] },
  { file: 'README.ja.md', patterns: [/agent_skills-(\d+)-ff8a00/, /(\d+) スキルの一枚地図/] },
  { file: 'docs/README.md', patterns: [/ships as (\d+) agent-side skills/] },
  { file: 'docs/README.ja.md', patterns: [/(\d+) のエージェント側スキル/] },
  { file: 'docs/skills.md', patterns: [/split into \*\*(\d+) skills\*\*/] },
  { file: 'docs/skills.ja.md', patterns: [/\*\*(\d+) のスキル\*\*/] },
  { file: '.claude-plugin/marketplace.json', patterns: [/編集スキル一式（(\d+) 本）/] },
];

for (const { file, patterns } of numberChecks) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m) {
      errors.push(`${file}: パターンが見つからない（表記が消えた/変わった可能性）— ${pattern}`);
      continue;
    }
    const found = Number(m[1]);
    if (found !== skillCount) {
      errors.push(`${file}: スキル数表記が ${found} だが skills/ の実数は ${skillCount} — パターン ${pattern}`);
    }
  }
}

// 検査 2: スキルカタログ（EN/JA）が skills/*/ 全件へのリンクを持つか
for (const catalog of ['docs/skills.md', 'docs/skills.ja.md']) {
  const text = readFileSync(join(root, catalog), 'utf8');
  const missing = skillNames.filter((name) => !text.includes(`../skills/${name}/SKILL.md`));
  if (missing.length) errors.push(`${catalog}: リンクが欠落しているスキル — ${missing.join(', ')}`);
}

// 検査 3: 契約索引（docs/README.md・docs/README.ja.md）が docs/contract-*.md 全件へのリンクを持つか
const contractFiles = readdirSync(join(root, 'docs'), { withFileTypes: true })
  .filter((e) => e.isFile() && /^contract-.*\.md$/.test(e.name))
  .map((e) => e.name)
  .sort();

for (const indexFile of ['docs/README.md', 'docs/README.ja.md']) {
  const text = readFileSync(join(root, indexFile), 'utf8');
  const missing = contractFiles.filter((name) => !text.includes(`./${name}`));
  if (missing.length) errors.push(`${indexFile}: リンクが欠落している契約ファイル — ${missing.join(', ')}`);
}

if (errors.length) fail(errors.join('\n'));
console.log(
  `check-docs-sync: drift なし（スキル数 ${skillCount} 件・契約 ${contractFiles.length} 件・数値検査 ${numberChecks.length} ファイル・カタログ/索引網羅 4 ファイル）`
);
