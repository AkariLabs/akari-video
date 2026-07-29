import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { createProject } from '../../project-scaffold/src/index.mjs';
import { resolveRepoAssets } from './repo-assets.mjs';
import { detectProjectState } from './project-state.mjs';
import {
  findClaudeExecutable,
  findCodexExecutable,
  findCursorAgentExecutable,
  findOpencodeExecutable,
} from './path-lookup.mjs';
import { buildHarnessArgv, harnessLaunchLabel, parseHarnessArgs } from './harnesses.mjs';
import { loadTaskLabels } from './task-labels.mjs';
import {
  describeIntake,
  claudeMissingGuidance,
  codexMissingGuidance,
  cursorMissingGuidance,
  opencodeMissingGuidance,
  describeUpdateCommand,
  describeVersionStatus,
  formatUpdateNotice,
} from './messages.mjs';
import {
  checkForUpdateSync,
  readCacheSync,
  readOwnVersion,
  recordDismissalSync,
  resolveCachePath,
  triggerBackgroundRefresh,
} from './update-check.mjs';

/**
 * `akari` ランチャーの本体。3 入口契約（ターミナル `akari` / セッション内 `/akari` /
 * アプリ接続ボタン）のうち、ターミナル入口を実装する:
 *   doctor（接続チェック）→ 未セットアップなら案内 + scaffold → 最後に AI エージェントを exec。
 *
 * すべての副作用（scaffold・doctor 実行・エージェント起動・実行ファイル探索）は options 経由で
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
  const resolveCursorAgent = options.resolveCursorAgent ?? (() => findCursorAgentExecutable());
  const resolveCodex = options.resolveCodex ?? (() => findCodexExecutable());
  const spawnClaude = options.spawnClaude ?? defaultSpawnClaude;
  const spawnOpencode = options.spawnOpencode ?? defaultSpawnOpencode;
  const spawnCursorAgent = options.spawnCursorAgent ?? defaultSpawnCursorAgent;
  const spawnCodex = options.spawnCodex ?? defaultSpawnCodex;
  const env = options.env ?? process.env;
  const currentVersion = options.currentVersion ?? readOwnVersion();

  const { harness, filteredArgs, autoConfirm } = parseHarnessArgs(args);

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

  const updateNotice = formatUpdateNotice((options.checkUpdate ?? checkForUpdateSync)({ currentVersion, env }));
  if (updateNotice) {
    log(updateNotice);
  }
  (options.refreshUpdate ?? triggerBackgroundRefresh)({ env });

  const launch = await launchHarness({
    harness,
    filteredArgs,
    autoConfirm,
    projectRoot,
    log,
    resolveClaude,
    resolveOpencode,
    resolveCursorAgent,
    resolveCodex,
    spawnClaude,
    spawnOpencode,
    spawnCursorAgent,
    spawnCodex,
  });

  return {
    exitCode: launch.exitCode,
    scaffolded: state.scaffolded,
    claudeLaunched: launch.harness === 'claude' && launch.launched,
    opencodeLaunched: launch.harness === 'opencode' && launch.launched,
    cursorLaunched: launch.harness === 'cursor' && launch.launched,
    codexLaunched: launch.harness === 'codex' && launch.launched,
    harness: launch.harness,
  };
}

async function launchHarness({
  harness,
  filteredArgs,
  autoConfirm,
  projectRoot,
  log,
  resolveClaude,
  resolveOpencode,
  resolveCursorAgent,
  resolveCodex,
  spawnClaude,
  spawnOpencode,
  spawnCursorAgent,
  spawnCodex,
}) {
  const argv = buildHarnessArgv(harness, autoConfirm, filteredArgs);

  if (harness === 'opencode') {
    return launchExecutable({
      harness,
      label: harnessLaunchLabel(harness),
      resolve: resolveOpencode,
      spawn: spawnOpencode,
      missingGuidance: opencodeMissingGuidance,
      argv,
      projectRoot,
      log,
    });
  }

  if (harness === 'cursor') {
    return launchExecutable({
      harness,
      label: harnessLaunchLabel(harness),
      resolve: resolveCursorAgent,
      spawn: spawnCursorAgent,
      missingGuidance: cursorMissingGuidance,
      argv,
      projectRoot,
      log,
    });
  }

  if (harness === 'codex') {
    return launchExecutable({
      harness,
      label: harnessLaunchLabel(harness),
      resolve: resolveCodex,
      spawn: spawnCodex,
      missingGuidance: codexMissingGuidance,
      argv,
      projectRoot,
      log,
    });
  }

  if (harness === 'claude') {
    return launchExecutable({
      harness,
      label: harnessLaunchLabel(harness),
      resolve: resolveClaude,
      spawn: spawnClaude,
      missingGuidance: claudeMissingGuidance,
      argv,
      projectRoot,
      log,
    });
  }

  const claudePath = resolveClaude();
  if (claudePath) {
    return launchExecutable({
      harness: 'claude',
      label: harnessLaunchLabel('claude'),
      resolve: () => claudePath,
      spawn: spawnClaude,
      missingGuidance: claudeMissingGuidance,
      argv: buildHarnessArgv('claude', autoConfirm, filteredArgs),
      projectRoot,
      log,
    });
  }

  log('Claude Code が見つかりません。opencode を起動します…');
  const opencodeLaunch = await launchExecutable({
    harness: 'opencode',
    label: harnessLaunchLabel('opencode'),
    resolve: resolveOpencode,
    spawn: spawnOpencode,
    missingGuidance: () => claudeMissingGuidance(),
    argv: buildHarnessArgv('opencode', autoConfirm, filteredArgs),
    projectRoot,
    log,
  });
  return opencodeLaunch;
}

function launchExecutable({
  harness,
  label,
  resolve,
  spawn,
  missingGuidance,
  argv,
  projectRoot,
  log,
}) {
  log(`${label} を起動します…`);
  const executablePath = resolve();
  if (!executablePath) {
    log(missingGuidance());
    return { exitCode: 1, launched: false, harness };
  }

  const result = spawn(executablePath, argv, projectRoot);
  const exitCode = typeof result.status === 'number' ? result.status : (result.error ? 1 : 0);
  return { exitCode, launched: true, harness };
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

function defaultSpawnCursorAgent(agentPath, args, projectRoot) {
  return spawnSync(agentPath, args, { stdio: 'inherit', cwd: projectRoot });
}

function defaultSpawnCodex(codexPath, args, projectRoot) {
  return spawnSync(codexPath, args, { stdio: 'inherit', cwd: projectRoot });
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
