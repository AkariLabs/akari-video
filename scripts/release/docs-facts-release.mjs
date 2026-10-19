#!/usr/bin/env node
// 安定版タグの push 後に main の docs を揃え、ブランチ + PR（権限が無ければ比較リンク）で提案する。
// ロジックはここに置き、.github/workflows/docs-facts-release.yml は薄くする（ローカルで同じことを試せる）。
//
// 手順: タグ形検査 → タグ親の祖先検査 → gen-docs-facts 実行 + shippedTag 照合 →
//        gen-docs-facts --check + check-docs-sync → アップデート投稿の下書き →（変更が無ければ終了）→
//        --dry-run なら diff を要約して終了 → --push ならブランチ + PR。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(here, '..', '..');
const genDocsFacts = join(here, '..', 'gen-docs-facts.mjs');
const checkDocsSync = join(here, '..', 'check-docs-sync.mjs');
const genUpdatePost = join(here, 'gen-update-post.mjs');
const fail = (message) => { console.error(`docs-facts-release: ${message}`); process.exit(1); };

const args = process.argv.slice(2);
let root = defaultRoot;
let tag;
let dryRun = false;
let push = false;
let summary = process.env.GITHUB_STEP_SUMMARY ?? null;
let outDir = tmpdir();
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--tag') tag = args[++i] ?? fail('missing --tag value');
  else if (arg === '--dry-run') dryRun = true;
  else if (arg === '--push') push = true;
  else if (arg === '--summary') summary = args[++i] ?? fail('missing --summary value');
  else if (arg === '--out-dir') outDir = args[++i] ?? fail('missing --out-dir value');
  else if (arg === '--root') root = resolve(args[++i] ?? fail('missing --root value'));
  else fail(`unknown option: ${arg}`);
}
if (!tag) fail('--tag is required');

const git = (...argv) => {
  const result = spawnSync('git', argv, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trimEnd() : null;
};
const run = (script, ...argv) => spawnSync(process.execPath, [script, ...argv], { cwd: root, encoding: 'utf8' });

const summaryLines = [];
const emit = (line) => summaryLines.push(line);
const flush = (code) => {
  const content = summaryLines.length ? `${summaryLines.join('\n')}\n` : '';
  if (summary) {
    mkdirSync(dirname(summary), { recursive: true });
    writeFileSync(summary, content);
  } else {
    process.stdout.write(content);
  }
  process.exit(code);
};

// 変更（tracked のみ）を git status --porcelain から取り出す。gen-docs-facts が触るのは
// すべて追跡対象のファイルなので、未追跡（??、生存マーカーや node_modules など）は「docs の変更」に数えない。
const trackedChanges = () => {
  const status = git('status', '--porcelain') ?? '';
  return status.split('\n').filter((line) => line && !line.startsWith('??')).map((line) => line.slice(3).trim());
};

// 1. タグの形を検査。プレリリース（`-` を含む）なら何もしない。
if (tag.includes('-')) {
  emit(`安定版だけが対象（プレリリース ${tag} は何もしない）`);
  flush(0);
}
if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail(`タグの形が不正です（安定版 vX.Y.Z）: ${tag}`);

// 2. タグの親が HEAD の祖先でなければ、release ブランチを main から切るか先に合流して再実行を促す。
if (git('merge-base', '--is-ancestor', `${tag}^`, 'HEAD') === null) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD') ?? 'HEAD';
  fail(`タグ ${tag} の親が ${branch} に無い。release ブランチを main から切るか、先に main へ合流してから workflow_dispatch で再実行`);
}

// 3. gen-docs-facts を実行し、選ばれた shippedTag が --tag と一致することを確かめる。
{
  const result = run(genDocsFacts, '--root', root);
  if (result.status !== 0) fail(`gen-docs-facts failed:\n${result.stderr.trim()}`);
  const facts = JSON.parse(readFileSync(join(root, 'docs/facts.json'), 'utf8'));
  const actual = facts.meta.shippedTag;
  if (actual !== tag) {
    fail(`docs/facts.json の shippedTag が ${tag} と一致しない（実際: ${actual ?? 'なし'}。より高い安定版が既にある）`);
  }
}

// 4. 生成し直してドリフトが無いことと、docs の契約索引等が揃っていることを検査する。
{
  const check = run(genDocsFacts, '--root', root, '--check');
  if (check.status !== 0) fail(`gen-docs-facts --check failed:\n${check.stderr.trim()}`);
  const sync = run(checkDocsSync);
  if (sync.status !== 0) fail(`check-docs-sync failed:\n${sync.stderr.trim()}`);
}

// 5. アップデート投稿の下書きを吐き、リポの外（out-dir）に書き、要約にもコードブロックで貼る。
let updatePost = '';
{
  const post = run(genUpdatePost, '--root', root, '--tag', tag);
  if (post.status !== 0) fail(`gen-update-post failed:\n${post.stderr.trim()}`);
  updatePost = post.stdout;
  mkdirSync(outDir, { recursive: true });
  const postPath = join(outDir, `update-post-${tag}.txt`);
  writeFileSync(postPath, updatePost);
  emit(`アップデート投稿の下書き（${postPath}）`);
  emit('```text');
  emit(updatePost.replace(/\n$/, ''));
  emit('```');
}

// 6. 変更が無ければ（既に揃っている）その旨を書いて終了。
const changed = trackedChanges();
if (changed.length === 0) {
  emit(`docs に変更なし（${tag}）`);
  flush(0);
}

// 7. --dry-run なら diff と変更ファイル一覧を書いて終了（git の状態は変えない）。
if (dryRun) {
  const diffStat = git('diff', '--stat') ?? '';
  emit('変更ファイル');
  for (const file of changed) emit(`- ${file}`);
  if (diffStat) {
    emit('');
    emit('```text');
    emit(diffStat);
    emit('```');
  }
  flush(0);
}

// 8. --push のときだけブランチ + PR（権限が無ければ比較リンク）。ローカルでは実行しない。
if (push) {
  pushProposal({ tag, changed, updatePost });
}
fail('何もしませんでした（--dry-run か --push を指定してください）');

function pushProposal({ tag, changed, updatePost }) {
  const branch = `docs-facts/${tag}`;
  const identity = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];
  const sh = (argv, opts = {}) => spawnSync('git', argv, { cwd: root, encoding: 'utf8', ...opts });

  sh(['checkout', '-b', branch]);
  for (const file of changed) sh(['add', file]);
  sh([...identity, 'commit', '-m', `[ドキュメント] ${tag} の事実を docs に反映（自動生成）`]);
  const pushed = sh(['push', '--force', 'origin', `HEAD:refs/heads/${branch}`]);
  if (pushed.status !== 0) fail(`push failed:\n${pushed.stderr.trim()}`);

  const body = pullRequestBody({ tag, changed, updatePost });
  const bodyFile = join(outDir, `pr-body-${tag}.md`);
  writeFileSync(bodyFile, body);

  const gh = (argv) => spawnSync('gh', argv, { cwd: root, encoding: 'utf8', env: { ...process.env } });
  const existing = gh(['pr', 'view', branch, '--json', 'url']);
  if (existing.status === 0) {
    gh(['pr', 'edit', branch, '--body-file', bodyFile]);
    emit(`PR を更新しました（${branch}）`);
    flush(0);
  }
  const created = gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', `[ドキュメント] ${tag} の事実を docs に反映（自動生成）`, '--body-file', bodyFile]);
  if (created.status === 0) {
    emit(`PR を作成しました（${branch}）`);
    flush(0);
  }
  // 組織の設定「Allow GitHub Actions to create and approve pull requests」が無効なときの実際の文面は
  // "GitHub Actions is not permitted to create or approve pull requests"（GraphQL createPullRequest）。
  if (/not permitted to create or approve pull requests|pull requests? could not be created|Resource not accessible|403|may not have permission/i.test(`${created.stderr}`)) {
    emit(`PR は作れなかった（組織の設定で Actions の PR 作成が無効）。ブランチ \`${branch}\` を push 済み。比較: https://github.com/AkariLabs/akari-video/compare/main...${branch}?expand=1`);
    flush(0);
  }
  fail(`PR 作成に失敗しました:\n${created.stderr.trim()}`);
}

function pullRequestBody({ tag, changed, updatePost }) {
  const facts = JSON.parse(readFileSync(join(root, 'docs/facts.json'), 'utf8'));
  const diffStat = git('diff', '--stat') ?? '';
  const lines = [];
  lines.push(`[ドキュメント] ${tag} の事実を docs に反映（自動生成）`);
  lines.push('');
  lines.push('## 変更ファイル');
  lines.push('');
  lines.push('```text');
  lines.push(diffStat || '(diff なし)');
  lines.push('```');
  lines.push('');
  if (facts.shipped.length) {
    lines.push('## facts.shipped（前回のタグと現在の語の差分）');
    lines.push('');
    lines.push('| 言語 | 事実 | 配布中 | 現在 |');
    lines.push('|---|---|---|---|');
    for (const row of facts.shipped) {
      lines.push(`| ${row.lang} | ${row.key} | ${row.shipped ?? '（なし）'} | ${row.current} |`);
    }
    lines.push('');
  }
  lines.push('## アップデート投稿の下書き');
  lines.push('');
  lines.push('```text');
  lines.push(updatePost.replace(/\n$/, ''));
  lines.push('```');
  lines.push('');
  lines.push('## 注意');
  lines.push('');
  lines.push('- この PR は GITHUB_TOKEN が作ったので pull_request の CI は走らない。生成直後に `gen-docs-facts --check` と `check-docs-sync` は通している。main へ合流した push の CI で再検査される。');
  lines.push('- 合流するまで main の `check-docs-facts` はタグとの不一致で赤になるので早めに合流する。');
  return `${lines.join('\n')}\n`;
}
