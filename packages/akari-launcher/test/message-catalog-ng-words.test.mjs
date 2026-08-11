import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  describeIntake, claudeMissingGuidance, opencodeMissingGuidance, formatUpdateNotice,
  describeVersionStatus, creatorRootFoundNotice, creatorRootNewProjectNotice,
  creatorRootCreatedNotice, creatorRootCreateFailedNotice, creatorRootPromptText,
  describeUpdateCommand, initFoundNotice, initCreatedNotice, initModuleMissingError,
  initFailedError, assetIntroNotice, soundsCompleteNotice, soundsFailedNotice,
  soundsUnavailableError, assetsResolverUnavailableError, describeCliHelp
} from '../src/messages.mjs';
import { run } from '../src/cli.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';

/**
 * タスク契約 2026-08-11-onboarding-o3-firstrun-plain §2・受け入れ条件:
 * 「NG ワード機械検査 green（ユーザー向け文言に Node / monorepo / PATH / env が出ない）」。
 *
 * 対象スコープは指示 §2 が明示する「launcher が出す全ユーザー向け文言
 * （first-run / help / エラー / update 通知）」。具体的には:
 *   1. `messages.mjs` が export する文言生成関数すべて（分岐ごとに代表値で呼ぶ）
 *   2. `cli.mjs` の `run()` が実際に出す行（scaffold 成功時の実ログを丸ごと収集）
 *   3. `bin/akari.mjs` の `--help` / `-h`（Node CLI 版ヘルプ。本タスクで新設）
 *   4. `akari.sh` の `-h|--help` / `--preview -h`（実プロセスとして実行し、実際の
 *      標準出力を検査する — ソースを正規表現で読むより自己修復ロジックの分岐を
 *      すり抜けない）
 *
 * 対象外（監査は行ったが、first-run/help/エラー/update 通知とは対象読者が異なるため
 * 本テストの対象にはしない — 詳細は report.md 「NG ワード監査のスコープ」節）:
 *   - `akari narration` の credentials.env 案内（fal-qwen3 API キー設定という
 *     上級者向け機能の案内であり、ファイル名そのものが手がかりとして必要）
 *   - `akari accept` / `akari capability` / `akari internal` の詳細出力
 *     （内部・開発者向けツールで英語の技術用語をそのまま使う設計）
 *   - `akari.cmd`（Windows 版）: 本タスクのファイル境界外（`akari.sh` の help・文言部のみ
 *     編集可）。目視監査はしたが対象語は見つからなかった（既に O1 で平易化済み）
 */

const NG_WORDS = [
  { pattern: /\bnode(\.js)?\b/i, label: 'Node' },
  { pattern: /monorepo/i, label: 'monorepo' },
  { pattern: /\bPATH\b/, label: 'PATH' },
  { pattern: /\benv\b/i, label: 'env' }
];

function assertNoJargon(text, sourceLabel) {
  const value = String(text);
  for (const { pattern, label } of NG_WORDS) {
    assert.ok(!pattern.test(value), `${sourceLabel} に専門語「${label}」が含まれています: ${JSON.stringify(value)}`);
  }
}

function flatten(...values) {
  const lines = [];
  for (const value of values) {
    if (Array.isArray(value)) lines.push(...value);
    else lines.push(value);
  }
  return lines;
}

test('messages.mjs: 全ユーザー向け文言関数（分岐ごとの代表値）に Node / monorepo / PATH / env が出ない', () => {
  const taskLabels = { cut: 'カット', telop: 'テロップ' };
  const samples = flatten(
    describeIntake(null, taskLabels),
    describeIntake({ status: 'draft' }, taskLabels),
    describeIntake({ status: 'submitted', tasks: ['cut'], autonomy: 'checkpoint', target: { duration_s: 60 } }, taskLabels),
    describeIntake({ status: 'submitted', tasks: [], autonomy: 'full-auto', target: { keep_length: true } }, taskLabels),
    claudeMissingGuidance(),
    opencodeMissingGuidance(),
    formatUpdateNotice({ available: true, latestVersion: '1.2.3', currentVersion: '1.0.0', channel: 'prerelease' }),
    formatUpdateNotice({ available: true, latestVersion: '1.2.3', currentVersion: '1.0.0', channel: 'stable' }),
    formatUpdateNotice({ available: false }),
    describeVersionStatus('1.0.0', null),
    describeVersionStatus('1.0.0', { fetched_at: '2026-08-11T00:00:00Z', feed: { product: '1.2.3' } }),
    creatorRootFoundNotice('/home/user/Akari'),
    creatorRootNewProjectNotice('/home/user/Akari', '/home/user/Akari/channels/my-channel/videos/2026-08-11-video'),
    creatorRootCreatedNotice('/home/user/Akari', '/home/user/Akari/channels/my-channel/videos/2026-08-11-video'),
    creatorRootCreateFailedNotice('EACCES: permission denied'),
    creatorRootPromptText('/home/user/Akari'),
    describeUpdateCommand({ currentVersion: '1.0.0', cache: null, dismissed: false }),
    describeUpdateCommand({ currentVersion: '1.0.0', cache: { feed: { product: '1.0.0', channel: 'stable' } }, dismissed: false }),
    describeUpdateCommand({
      currentVersion: '1.0.0',
      cache: { feed: { product: '1.2.0', channel: 'stable', notes_url: 'https://example.com', components: { cli: { tarball: { url: 'https://example.com/x.tgz' } } } } },
      dismissed: false
    }),
    describeUpdateCommand({ currentVersion: '1.0.0', cache: { feed: { product: '1.2.0', channel: 'stable' } }, dismissed: true }),
    initFoundNotice('/home/user/Akari'),
    initCreatedNotice('/home/user/Akari'),
    initModuleMissingError(),
    initFailedError('ENOENT: no such file or directory'),
    assetIntroNotice(),
    soundsCompleteNotice(),
    soundsFailedNotice(),
    soundsUnavailableError(),
    assetsResolverUnavailableError(),
    describeCliHelp()
  );

  assert.ok(samples.length > 25, 'サンプル漏れ検知 — messages.mjs に新しい文言関数を足したらこの一覧にも足す');
  for (const line of samples) {
    assertNoJargon(line, 'messages.mjs');
  }
});

// --- cli.mjs の run() が実際に出す行（scaffold 成功パスの実ログを丸ごと収集）---

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-ng-words-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('cli.mjs run(): 未セットアップフォルダの初回起動ログすべてに Node / monorepo / PATH / env が出ない', async () => {
  await withScratchRoot(async (root) => {
    const logs = [];
    const assets = resolveRepoAssets(repoRoot);
    assert.ok(assets.templateDir, 'モノレポ checkout 内での実行が前提（templates/project-default が見つからない）');

    const result = await run([], {
      projectRoot: root,
      log: (line) => logs.push(line),
      assets,
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: () => ({ status: 0 }),
      env: { ...process.env, AKARI_HOME: join(root, '.akari-home-unused') },
      refreshUpdate: () => {},
      isTTY: false
    });

    assert.equal(result.exitCode, 0);
    assert.ok(logs.length > 3, 'サンプル漏れ検知 — scaffold 成功パスでログが複数行出ているはず');
    for (const line of logs) {
      assertNoJargon(line, 'cli.mjs run()');
    }
  });
});

// --- bin/akari.mjs の --help / -h（Node CLI 版。本タスクで新設）---

test('bin/akari.mjs --help / -h の出力に Node / monorepo / PATH / env が出ない', () => {
  const bin = join(packageRoot, 'bin', 'akari.mjs');
  for (const flag of ['--help', '-h']) {
    const result = spawnSync(process.execPath, [bin, flag], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assertNoJargon(result.stdout, `bin/akari.mjs ${flag}`);
  }
});

// --- akari.sh の -h|--help / --preview -h（実プロセスとして実行し、標準出力を検査する）---
// ソースを正規表現で読むより、self-heal・monorepo 解決を含む実際の起動パスをそのまま
// 通すほうが「本当にユーザーが見る文字列」に近い。akari.sh の help・文言部は本タスクの
// 編集可能範囲そのもの（ファイル境界表）。

const repoRootForShell = resolve(packageRoot, '..', '..');

test('akari.sh --help / --preview --help の出力に Node / monorepo / PATH / env が出ない', () => {
  for (const args of [['--help'], ['--preview', '--help']]) {
    const result = spawnSync('bash', [join(repoRootForShell, 'akari.sh'), ...args], {
      cwd: repoRootForShell,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assertNoJargon(result.stdout, `akari.sh ${args.join(' ')}`);
  }
});
