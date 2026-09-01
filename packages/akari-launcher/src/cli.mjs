import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { resolveLauncherAssets } from './repo-assets.mjs';
import { detectProjectState } from './project-state.mjs';
import { findClaudeExecutable, findExecutable, findOpencodeExecutable } from './path-lookup.mjs';
import { loadTaskLabels } from './task-labels.mjs';
import { describeForceReinstall, describeInstalledVersions, describeIntake, claudeMissingGuidance, opencodeMissingGuidance, describeUpdateCacheFallback, describeUpdateCommand, describeVersionStatus, formatUpdateNotice } from './messages.mjs';
import { resolveEffectiveProjectRoot } from './first-run.mjs';
import { maybeShowAssetIntroNotice } from './sounds-setup.mjs';
import {
  checkForUpdateSync,
  compareVersions,
  isValidFeedShape,
  readCacheSync,
  readOwnVersion,
  recordDismissalSync,
  refreshUpdateFeed,
  resolveCachePath,
  resolveInstalledVersionInfo,
  triggerBackgroundRefresh
} from './update-check.mjs';
import { applySelfUpdate, isRunningFromAppDir, rollbackSelfUpdate } from './self-update.mjs';
import { runCaptureCommand } from './capture-command.mjs';
import { runMediaCommand } from './media-command.mjs';
import { resolveRuntimePaths } from './runtime-diagnostics.mjs';

/**
 * `akari` ランチャーの本体。3 入口契約（ターミナル `akari` / セッション内 `/akari` /
 * アプリ接続ボタン）のうち、ターミナル入口を実装する:
 *   作業場（creator-root）の初回動線（`first-run.mjs`）→ doctor（接続チェック）→
 *   未セットアップなら案内 + scaffold → 最後に `claude` を exec。
 *
 * すべての副作用（creator-root 解決・scaffold・doctor 実行・claude 起動・claude 探索）は
 * options 経由で差し替え可能にしてあり、node --test から実プロセスを起動せずに分岐を検証できる。
 */
export async function run(args, options = {}) {
  const retiredBrowserCommand = 'chrome';
  if (args[0] === retiredBrowserCommand) {
    const error = options.error ?? ((line) => console.error(line));
    error(`akari ${retiredBrowserCommand} は廃止されました（Chrome は不要になりました）`);
    return { exitCode: 1 };
  }
  if (args[0] === 'capture') return runCaptureCommand(args.slice(1), options);
  if (args[0] === 'media') return runMediaCommand(args.slice(1), options);

  const log = options.log ?? ((line) => console.log(line));
  const assets = options.assets ?? resolveLauncherAssets();
  const scaffold = options.scaffold ?? defaultScaffold;
  const runDoctor = options.runDoctor ?? defaultRunDoctor;
  const resolveClaude = options.resolveClaude ?? (() => findClaudeExecutable());
  const resolveOpencode = options.resolveOpencode ?? (() => findOpencodeExecutable());
  const spawnClaude = options.spawnClaude ?? defaultSpawnClaude;
  const spawnOpencode = options.spawnOpencode ?? defaultSpawnOpencode;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const versionInfo = resolveCommandVersionInfo(options, env);
  const currentVersion = versionInfo.currentVersion;
  const now = options.now ?? new Date();

  // --opencode / --claude / --claudecode / --yes / --here フラグを解析
  const useOpencode = args.includes('--opencode');
  const autoConfirm = args.includes('--yes') || args.includes('-y');
  const hereOnly = args.includes('--here');
  const filteredArgs = args.filter(arg =>
    arg !== '--opencode' && arg !== '--claude' && arg !== '--claudecode'
    && arg !== '--yes' && arg !== '-y' && arg !== '--here'
  );

  let projectRoot = options.projectRoot ?? process.cwd();

  // 作業場（creator-root）の初回動線（契約 §5・§6-1）。`--here` はお試しモード強制
  // （現行動作）のため丸ごとスキップする（契約 §9・非 TTY と同じ現行動作互換の扱い）。
  if (!hereOnly) {
    projectRoot = await resolveEffectiveProjectRoot({ projectRoot, env, platform, now, log, assets, autoConfirm, options });
  }

  let state = detectProjectState(projectRoot);

  if (!state.scaffolded) {
    log(`このフォルダーは AKARI Video プロジェクトとしてまだセットアップされていません: ${projectRoot}`);
    if (!assets.templateDir || !assets.scaffoldModulePath) {
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
    const runtimeDiagnostics = options.runtimeDiagnostics ?? resolveRuntimePaths({ ...options, env, platform });
    log(describeVersionStatus(versionInfo, readCacheSync(resolveCachePath(env)), runtimeDiagnostics));
  }

  // 新版通知（契約 §4-1）: キャッシュの読み比較のみ・ネットワークには一切触れない
  // （起動をブロックしない）。fetch は detached な子プロセスへ切り離し、
  // 結果は次回セッションで効く。
  const updateNotice = formatUpdateNotice((options.checkUpdate ?? checkForUpdateSync)({ currentVersion, versionInfo, env }));
  if (updateNotice) {
    log(updateNotice);
  }
  (options.refreshUpdate ?? triggerBackgroundRefresh)({ env });

  // 素材の取得方式案内（2026-08-04〜。旧: AKARI Sounds 初回一括 DL の [Y/n] 質問は廃止 —
  // 設計正本 planning/notes-2026-08-04-asset-reference-distribution.md §8）。質問はしない・
  // 対話をブロックしない。生涯 1 回だけ表示し、どんな失敗でも claude 起動までは止めない
  // （「最後に claude を exec」は不変条件）。
  try {
    await (options.showAssetIntro ?? maybeShowAssetIntroNotice)({ env, log });
  } catch (error) {
    log(`素材案内の表示でエラーが発生しました（続行します）: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (useOpencode) {
    log('opencode を起動します…');
    const opencodePath = resolveOpencode();
    if (!opencodePath) {
      log(opencodeMissingGuidance());
      return { exitCode: 1, scaffolded: state.scaffolded, opencodeLaunched: false };
    }

    const opencodeArgs = autoConfirm ? ['--auto', ...filteredArgs] : filteredArgs;
    const result = spawnOpencode(opencodePath, opencodeArgs, projectRoot);
    const exitCode = typeof result.status === 'number' ? result.status : (result.error ? 1 : 0);
    return { exitCode, scaffolded: state.scaffolded, opencodeLaunched: true };
  } else {
    const claudePath = resolveClaude();
    if (claudePath) {
      log('Claude Code を起動します…');
      const claudeArgs = autoConfirm ? ['--permission-mode', 'acceptEdits', ...filteredArgs] : filteredArgs;
      const result = spawnClaude(claudePath, claudeArgs, projectRoot);
      const exitCode = typeof result.status === 'number' ? result.status : (result.error ? 1 : 0);
      return { exitCode, scaffolded: state.scaffolded, claudeLaunched: true };
    }

    log('Claude Code が見つかりません。opencode を起動します…');
    const opencodePath = resolveOpencode();
    if (!opencodePath) {
      log(claudeMissingGuidance());
      return { exitCode: 1, scaffolded: state.scaffolded, opencodeLaunched: false };
    }

    const opencodeArgs = autoConfirm ? ['--auto', ...filteredArgs] : filteredArgs;
    const result = spawnOpencode(opencodePath, opencodeArgs, projectRoot);
    const exitCode = typeof result.status === 'number' ? result.status : (result.error ? 1 : 0);
    return { exitCode, scaffolded: state.scaffolded, opencodeLaunched: true };
  }
}

async function defaultScaffold(projectRoot, assets) {
  // scaffold 実装はパッケージ外（モノレポ workspace）と vendor 同梱（npm 配布時）の
  // 両方があり得るため、静的 import ではなく assets で解決したパスを動的 import する。
  const { createProject } = await import(pathToFileURL(assets.scaffoldModulePath).href);
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
 * `akari update`: 新版があり、かつ自己更新の対象（app 経由実行 + フィードに
 * `components.app` がある）なら DL → sha256 検証 → 適用まで実行する（契約 §11。
 * `app/.akari-install-ref` がある管理インストールは、npm 側 CLI から実行した場合も対象。
 * 「update は明示操作」なので U2 の沈黙原則は適用せず、失敗は必ず表示する）。
 * 対象外（npm グローバル / git checkout・旧フィード）のときは従来どおり
 * **案内するだけ**（自動実行はしない — 契約 §4-1）に縮退する。`--dismiss` は
 * 自己更新を試みず、キャッシュに載っている最新版の通知を今後出さないよう記録するだけ
 * （既存挙動を維持）。`--force` は同じ版の本体も再導入し、`--rollback` は直前 1 世代
 * （`~/.akari/app-previous/`）へ戻す。
 * `--dismiss` / `--rollback` 以外の明示 update は、キャッシュ TTL に関係なく
 * フィードの同期取得を 1 回試す。取得失敗時だけ既存キャッシュへフォールバックする。
 */
export async function runUpdateCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const env = options.env ?? process.env;
  const versionInfo = resolveCommandVersionInfo(options, env);
  const currentVersion = versionInfo.currentVersion;
  const cachePath = resolveCachePath(env);
  let cache = readCacheSync(cachePath);
  const dismissRequested = args.includes('--dismiss');
  const rollbackRequested = args.includes('--rollback');
  const forceRequested = args.includes('--force');
  const runtimeDiagnostics = options.runtimeDiagnostics ?? resolveRuntimePaths({ ...options, env });
  const pathEnv = Object.hasOwn(env, 'PATH') ? (env.PATH ?? '') : (process.env.PATH ?? '');
  const npmAvailable = options.npmAvailable
    ?? !!(options.findExecutable ?? findExecutable)('npm', pathEnv, options.platform ?? process.platform, env.PATHEXT);
  const describeOptions = { runtimeDiagnostics, npmAvailable };
  let usingCachedFeed = false;

  if (rollbackRequested) {
    return (options.rollbackSelfUpdate ?? rollbackSelfUpdate)({ env, log });
  }

  if (dismissRequested) {
    let dismissed = false;
    if (typeof cache?.feed?.product === 'string') {
      recordDismissalSync({ version: cache.feed.product, env });
      dismissed = true;
    }
    const finalCache = dismissed ? readCacheSync(cachePath) : cache;
    for (const line of describeUpdateCommand({ currentVersion, versionInfo, cache: finalCache, dismissed, ...describeOptions })) {
      log(line);
    }
    return { exitCode: 0 };
  }

  const refreshed = await (options.refreshUpdateFeed ?? refreshUpdateFeed)({ env, fetchImpl: options.fetchImpl });
  if (isValidFeedShape(refreshed?.feed)) {
    cache = refreshed;
  } else {
    cache = readCacheSync(cachePath) ?? cache;
    usingCachedFeed = isValidFeedShape(cache?.feed);
  }

  const feed = cache?.feed;
  const updateAvailable = isValidFeedShape(feed) && compareVersions(feed.product, currentVersion) > 0;
  const reinstallRequested = forceRequested && isValidFeedShape(feed) && compareVersions(feed.product, currentVersion) >= 0;
  const hasManagedApp = versionInfo.managedApp === true;
  const selfUpdateEligible = (updateAvailable || reinstallRequested)
    && !!feed.components?.app?.url
    && !!feed.components?.app?.sha256
    && (hasManagedApp || (options.isRunningFromAppDir ?? isRunningFromAppDir)({ env, launcherRoot: options.launcherRoot }));

  if (!selfUpdateEligible) {
    for (const line of describeUpdateCommand({ currentVersion, versionInfo, cache, dismissed: false, usingCachedFeed, ...describeOptions })) {
      log(line);
    }
    if (forceRequested
        && versionInfo.installRefStatus === 'missing'
        && runtimeDiagnostics.render_cut.origin !== 'monorepo') {
      log('この CLI からは install.sh 経路の本体を入れ直せません。');
      log('導入するには `curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash` を実行してください（デスクトップ版だけで使う場合は不要です）。');
    }
    return { exitCode: 0 };
  }

  if (usingCachedFeed) {
    log(describeUpdateCacheFallback(cache));
  }
  for (const line of describeInstalledVersions(versionInfo, runtimeDiagnostics)) {
    log(line);
  }
  log(`最新バージョン: v${feed.product}`);
  if (forceRequested) {
    log(describeForceReinstall(versionInfo, feed.product));
  }

  return (options.applySelfUpdate ?? applySelfUpdate)({
    env,
    feed,
    log,
    fetchImpl: options.fetchImpl,
    runNpmInstall: options.runNpmInstall
  });
}

function resolveCommandVersionInfo(options, env) {
  if (options.versionInfo) return options.versionInfo;
  // 既存テスト/埋め込み利用の currentVersion 注入は CLI 版注入としても扱う。
  const cliVersion = options.cliVersion ?? options.currentVersion ?? readOwnVersion();
  if (options.currentVersion !== undefined) {
    const appVersion = options.appVersion ?? null;
    return {
      cliVersion,
      appVersion,
      currentVersion: options.currentVersion,
      source: appVersion ? 'install-ref' : 'cli-fallback',
      mismatch: appVersion !== null && compareVersions(cliVersion, appVersion) !== 0
    };
  }
  return resolveInstalledVersionInfo({ env, cliVersion });
}
