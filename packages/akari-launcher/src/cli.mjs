import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { createProject } from '../../project-scaffold/src/index.mjs';
import { resolveRepoAssets } from './repo-assets.mjs';
import { detectProjectState } from './project-state.mjs';
import { findClaudeExecutable, findOpencodeExecutable } from './path-lookup.mjs';
import { loadTaskLabels } from './task-labels.mjs';
import { describeIntake, claudeMissingGuidance, opencodeMissingGuidance, describeUpdateCommand, describeVersionStatus, formatUpdateNotice } from './messages.mjs';
import {
  checkForUpdateSync,
  readCacheSync,
  readOwnVersion,
  recordDismissalSync,
  resolveCachePath,
  triggerBackgroundRefresh
} from './update-check.mjs';

/**
 * `akari` ランチャーの本体。3 入口契約（ターミナル `akari` / セッション内 `/akari` /
 * アプリ接続ボタン）のうち、ターミナル入口を実装する:
 *   doctor（接続チェック）→ 未セットアップなら案内 + scaffold → 最後に `claude` を exec。
 *
 * すべての副作用（scaffold・doctor 実行・claude 起動・claude 探索）は options 経由で
 * 差し替え可能にしてあり、node --test から実プロセスを起動せずに分岐を検証できる。
 */
export async function run(args, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const log = options.log ?? ((line) => console.log(line));
  const assets = options.assets ?? resolveRepoAssets();
  const scaffold = options.scaffold ?? defaultScaffold;
  const runDoctor = options.runDoctor ?? defaultRunDoctor;
  const resolveClaude = options.resolveClaude ?? (() => findClaudeExecutable());
  const resolveOpencode = options.resolveOpencode ?? (() => findOpencodeExecutable());
  const spawnClaude = options.spawnClaude ?? defaultSpawnClaude;
  const spawnOpencode = options.spawnOpencode ?? defaultSpawnOpencode;
  const env = options.env ?? process.env;
  const currentVersion = options.currentVersion ?? readOwnVersion();
  
  // --opencode フラグを解析
  const useOpencode = args.includes('--opencode');
  const filteredArgs = args.filter(arg => arg !== '--opencode');

  let state = detectProjectState(projectRoot);

  if (!state.scaffolded) {
    log(`このフォルダーは AKARI Video プロジェクトとしてまだセットアップされていません: ${projectRoot}`);
    if (!assets.templateDir) {
      log('プロジェクト雛形が見つからないため、雛形の作成をスキップしました。');
    } else {
      log('プロジェクトの雛形を作成します…');
      try {
        const report = await scaffold(projectRoot, assets);
        log(`プロジェクトを作成しました（コピー ${report.copy.copiedFiles.length} 件 / 補完 ${report.fallback.writtenFiles.length} 件 / git: ${report.git.action}）。`);
      } catch (error) {
        // scaffold の失敗で claude 起動まで止めない（「最後に claude を exec」は不変条件）。
        log(`プロジェクトの雛形作成でエラーが発生しました（続行します）: ${error instanceof Error ? error.message : String(error)}`);
      }
      state = detectProjectState(projectRoot);
    }
  } else {
    log(`既存の AKARI Video プロジェクトを検出しました: ${projectRoot}`);
  }

  const taskLabels = loadTaskLabels(assets.schemasSourceDir);
  log(describeIntake(state.intake, taskLabels));

  if (state.scaffolded && assets.doctorScript) {
    log('接続状態を確認します…');
    try {
      runDoctor(assets.doctorScript, projectRoot);
    } catch (error) {
      log(`接続確認でエラーが発生しました（続行します）: ${error instanceof Error ? error.message : String(error)}`);
    }
    log(describeVersionStatus(currentVersion, readCacheSync(resolveCachePath(env))));
  }

  // 新版通知（契約 §4-1）: キャッシュの読み比較のみ・ネットワークには一切触れない
  // （起動をブロックしない）。fetch は detached な子プロセスへ切り離し、
  // 結果は次回セッションで効く。
  const updateNotice = formatUpdateNotice((options.checkUpdate ?? checkForUpdateSync)({ currentVersion, env }));
  if (updateNotice) {
    log(updateNotice);
  }
  (options.refreshUpdate ?? triggerBackgroundRefresh)({ env });

  if (useOpencode) {
    log('opencode を起動します…');
    const opencodePath = resolveOpencode();
    if (!opencodePath) {
      log(opencodeMissingGuidance());
      return { exitCode: 1, scaffolded: state.scaffolded, opencodeLaunched: false };
    }

    const result = spawnOpencode(opencodePath, filteredArgs, projectRoot);
    const exitCode = typeof result.status === 'number' ? result.status : (result.error ? 1 : 0);
    return { exitCode, scaffolded: state.scaffolded, opencodeLaunched: true };
  } else {
    log('Claude Code を起動します…');
    const claudePath = resolveClaude();
    if (!claudePath) {
      log(claudeMissingGuidance());
      return { exitCode: 1, scaffolded: state.scaffolded, claudeLaunched: false };
    }

    const result = spawnClaude(claudePath, filteredArgs, projectRoot);
    const exitCode = typeof result.status === 'number' ? result.status : (result.error ? 1 : 0);
    return { exitCode, scaffolded: state.scaffolded, claudeLaunched: true };
  }
}

function defaultScaffold(projectRoot, assets) {
  const scaffoldOptions = assets.skillsSourceDir
    ? { skillsSourceDir: assets.skillsSourceDir, schemasSourceDir: assets.schemasSourceDir ?? undefined }
    : {};
  return createProject(projectRoot, assets.templateDir, scaffoldOptions);
}

function defaultRunDoctor(doctorScript, projectRoot) {
  if (!existsSync(doctorScript)) {
    return { status: 0 };
  }
  return spawnSync(process.execPath, [doctorScript, projectRoot], { stdio: 'inherit' });
}

function defaultSpawnClaude(claudePath, args, projectRoot) {
  return spawnSync(claudePath, args, { stdio: 'inherit', cwd: projectRoot });
}

function defaultSpawnOpencode(opencodePath, args, projectRoot) {
  return spawnSync(opencodePath, args, { stdio: 'inherit', cwd: projectRoot });
}

/**
 * `akari update`: 現在版・最新版・リリースノート URL を表示し、更新手順を**案内するだけ**
 * （自動実行はしない — 契約 §4-1）。`--dismiss` を渡すと、キャッシュに載っている最新版の
 * 通知を今後出さないよう記録する。ネットワークには一切触れない
 * （表示に使う情報はすべて既存キャッシュ由来 — 最新情報は `akari` 起動時のバックグラウンド
 * fetch で更新される）。
 */
export async function runUpdateCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const env = options.env ?? process.env;
  const currentVersion = options.currentVersion ?? readOwnVersion();
  const cachePath = resolveCachePath(env);
  const cache = readCacheSync(cachePath);
  const dismissRequested = args.includes('--dismiss');

  let dismissed = false;
  if (dismissRequested && typeof cache?.feed?.product === 'string') {
    recordDismissalSync({ version: cache.feed.product, env });
    dismissed = true;
  }

  const finalCache = dismissed ? readCacheSync(cachePath) : cache;
  for (const line of describeUpdateCommand({ currentVersion, cache: finalCache, dismissed })) {
    log(line);
  }
  return { exitCode: 0 };
}
