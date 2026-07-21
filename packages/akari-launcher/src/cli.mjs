import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { createProject } from '../../project-scaffold/src/index.mjs';
import { resolveRepoAssets } from './repo-assets.mjs';
import { detectProjectState } from './project-state.mjs';
import { findClaudeExecutable } from './path-lookup.mjs';
import { loadTaskLabels } from './task-labels.mjs';
import { describeIntake, claudeMissingGuidance } from './messages.mjs';

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
  const spawnClaude = options.spawnClaude ?? defaultSpawnClaude;

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
  }

  log('Claude Code を起動します…');
  const claudePath = resolveClaude();
  if (!claudePath) {
    log(claudeMissingGuidance());
    return { exitCode: 1, scaffolded: state.scaffolded, claudeLaunched: false };
  }

  const result = spawnClaude(claudePath, args, projectRoot);
  const exitCode = typeof result.status === 'number' ? result.status : (result.error ? 1 : 0);
  return { exitCode, scaffolded: state.scaffolded, claudeLaunched: true };
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
