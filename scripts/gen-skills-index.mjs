#!/usr/bin/env node
// AGENTS.md のスキル索引を skills/*/SKILL.md の frontmatter (name / description) から再生成する。
// マーカーコメント間だけを書き換える。--check は再生成結果と現状の diff が出たら exit 1（CI 用）。
// あわせて .claude/skills / .agents/skills の symlink が skills/ と 1:1 で解決することも検査する。
import { readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '<!-- BEGIN GENERATED skills-index — scripts/gen-skills-index.mjs が生成。手で編集しない -->';
const END = '<!-- END GENERATED skills-index -->';

const fail = (msg) => { console.error(`gen-skills-index: ${msg}`); process.exit(1); };
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const skillNames = readdirSync(join(root, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const skills = skillNames.map((name) => {
  const path = join(root, 'skills', name, 'SKILL.md');
  const m = readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  if (!m) fail(`frontmatter がない: skills/${name}/SKILL.md`);
  // 行正規表現ではなく YAML として parse する。Claude Code 実行時と同じ判定にしないと、
  // 不正 YAML（例: 引用符なし値中の「: 」）が索引生成を素通りして実行時だけ落ちる（issue #4）
  let fm;
  try {
    fm = yaml.load(m[1]);
  } catch (e) {
    fail(`frontmatter が YAML として parse できない: skills/${name}/SKILL.md — ${e.message.split('\n')[0]}`);
  }
  if (typeof fm !== 'object' || fm === null) fail(`frontmatter が mapping でない: skills/${name}/SKILL.md`);
  if (!fm.name || !fm.description) fail(`name / description が欠落: skills/${name}/SKILL.md`);
  if (fm.name !== name) fail(`frontmatter name とディレクトリ名が不一致: ${fm.name} != ${name}`);
  return fm;
});

for (const adapter of ['.claude/skills', '.agents/skills', '.codex/skills']) {
  for (const name of skillNames) {
    const link = join(root, adapter, name);
    let target;
    try {
      if (!lstatSync(link).isSymbolicLink()) fail(`${adapter}/${name} が symlink でない（Windows で core.symlinks 無効のまま git clone すると symlink がテキストファイル化する既知の挙動。開発者モードを有効化し \`git config --global core.symlinks true\` を設定してから再 clone するか、docs/dev/windows-build.md の git 手順を参照）`);
      target = realpathSync(link);
    } catch {
      fail(`${adapter}/${name} が欠落または解決不能（skills/${name} への symlink が必要。Windows で core.symlinks 無効のまま clone した場合に典型的に起きる — 開発者モードを有効化し \`git config --global core.symlinks true\` を設定してから再 clone するか、docs/dev/windows-build.md の git 手順を参照）`);
    }
    if (target !== realpathSync(join(root, 'skills', name)))
      fail(`${adapter}/${name} の解決先が skills/${name} でない: ${target}`);
  }
  const extra = readdirSync(join(root, adapter)).filter((n) => !skillNames.includes(n));
  if (extra.length) fail(`${adapter} に skills/ にない項目: ${extra.join(', ')}`);
}

const rows = skills.map(
  (s) => `| \`${s.name}\` | ${s.description.replace(/\|/g, '\\|')} | \`skills/${s.name}/SKILL.md\` |`
);
const block = [
  BEGIN,
  '',
  `スキル数: ${skills.length}`,
  '',
  '| スキル | 発動条件（description） | 正本 |',
  '|---|---|---|',
  ...rows,
  '',
  END,
].join('\n');

const agentsPath = join(root, 'AGENTS.md');
const current = readFileSync(agentsPath, 'utf8');
const pattern = new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`);
if (!pattern.test(current)) fail('AGENTS.md にマーカーが見つからない');
const next = current.replace(pattern, block);

if (process.argv.includes('--check')) {
  if (next !== current) fail('索引がドリフトしています。`npm run gen:skills-index` で再生成してコミットしてください');
  console.log(`gen-skills-index: drift なし（${skills.length} 件）`);
} else {
  writeFileSync(agentsPath, next);
  console.log(`gen-skills-index: ${skills.length} 件で再生成`);
}
