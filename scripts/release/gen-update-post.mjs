#!/usr/bin/env node
// Discord「アップデート」投稿の骨組みを事実（facts.json の shipped 差分・新規スキル）から吐く。
// 見どころは人が書く（機械は書かない）。日本語のみ。
// 見出しとリンクに --tag、差分の起点に --previous（既定 = タグより低い最も高い安定版）を使う。
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(here, '..', '..');
const generator = join(here, '..', 'gen-docs-facts.mjs');
const fail = (message) => { console.error(`gen-update-post: ${message}`); process.exit(1); };

const args = process.argv.slice(2);
let root = defaultRoot;
let tag;
let previous;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--tag') tag = args[++i] ?? fail('missing --tag value');
  else if (arg === '--previous') previous = args[++i] ?? fail('missing --previous value');
  else if (arg === '--root') root = resolve(args[++i] ?? fail('missing --root value'));
  else fail(`unknown option: ${arg}`);
}
if (!tag) fail('--tag is required');
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) fail(`--tag must be a v-prefixed semver: ${tag}`);

const git = (...argv) => {
  const result = spawnSync('git', argv, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trimEnd() : null;
};
const semver = (value) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  return match ? [...match.slice(1, 4).map(Number), match[4] ?? ''] : null;
};
const compareTags = (a, b) => {
  const av = semver(a), bv = semver(b);
  if (!av || !bv) return 0;
  for (let i = 0; i < 3; i += 1) if (av[i] !== bv[i]) return av[i] - bv[i];
  if (av[3] === bv[3]) return 0;
  if (!av[3]) return 1;
  if (!bv[3]) return -1;
  return av[3].localeCompare(bv[3], 'en', { numeric: true });
};

// 既定の --previous: git tag の安定版（`-` を含まない）のうち --tag より低い最も高いもの。
if (!previous) {
  const tags = git('tag', '--list', 'v*');
  if (tags) {
    for (const candidate of tags.split('\n').filter(semver)) {
      if (candidate.includes('-')) continue;
      if (compareTags(candidate, tag) >= 0) continue;
      if (!previous || compareTags(candidate, previous) > 0) previous = candidate;
    }
  }
}
if (previous && !git('rev-parse', '--verify', `${previous}^{commit}`)) fail(`unknown --previous tag: ${previous}`);

// 事実の取り方: gen-docs-facts --print --shipped-tag <previous> を子プロセスで実行して JSON を読む。
// shipped = previous → 現在の tree の語の差分。名前が変わった言葉には ui.ja の分だけ使う。
const renamed = [];
let skillsCount = 0;
let newSkills = [];
if (previous) {
  const gen = spawnSync(process.execPath, [generator, '--print', '--shipped-tag', previous, '--root', root], { encoding: 'utf8' });
  if (gen.status !== 0) fail(`gen-docs-facts failed:\n${gen.stderr.trim()}`);
  const facts = JSON.parse(gen.stdout);
  skillsCount = facts.skills.count;
  const seen = new Set();
  for (const row of facts.shipped) {
    // 名前が変わった言葉は「旧名 → 新名」だけを載せる。previous に無かった語（shipped が null）は
    // 改名ではなく新規の語なので省く。
    if (row.lang !== 'ja' || row.key.startsWith('cli.') || row.shipped == null) continue;
    const pair = `${row.shipped}\u0000${row.current}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    renamed.push(row);
  }
  const added = git('diff', '--name-only', '--diff-filter=A', `${previous}..HEAD`, '--', 'skills/*/SKILL.md');
  if (added) {
    newSkills = added.split('\n').map((path) => path.split('/')[1]).filter(Boolean).sort();
  }
}

const lines = [];
lines.push(`🚀 AKARI Video ${tag} リリース！`);
lines.push('');
lines.push('（ここに見どころを 3〜5 個。1 つ 2 行まで。絵文字 + 短い見出し + 説明の形）');
if (renamed.length) {
  lines.push('');
  lines.push(`📝 名前が変わった言葉（${previous} → ${tag}）`);
  for (const row of renamed) lines.push(`・${row.shipped ?? '（なし）'} → ${row.current}`);
}
if (newSkills.length) {
  lines.push('');
  lines.push('🧩 新しいスキル');
  for (const name of newSkills) lines.push(`・${name}`);
  lines.push(`スキルは全部で ${skillsCount} 本です`);
}
lines.push('');
lines.push('📦 ダウンロード / 詳細');
lines.push(`https://github.com/AkariLabs/akari-video/releases/tag/${tag}`);
lines.push('');
lines.push('💬 フィードバックは Issues か、このサーバーでどうぞ！');
process.stdout.write(`${lines.join('\n')}\n`);
