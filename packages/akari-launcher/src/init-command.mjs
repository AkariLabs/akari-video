import path from 'node:path';

import { resolveLauncherAssets } from './repo-assets.mjs';
import { defaultLoadCreatorRootModule } from './first-run.mjs';
import {
  initFoundNotice,
  initCreatedNotice,
  initModuleMissingError,
  initFailedError
} from './messages.mjs';

/**
 * `akari init [path] [--channel <name>]` — 作業場（creator-root）の作成・確認だけを行う
 * 純粋な入口サブコマンド（タスク契約 launcher-init・内部リポ）。プロジェクト作成も
 * claude 起動も一切行わない。シェルの相棒（パートナーエージェント）が headless で
 * 安全に叩ける口として、plugin 配線（並列タスク B）がこのコマンドを呼ぶ前提で書かれている。
 *
 * `run()`（`first-run.mjs` 経由の初回動線）とは役割が違う: あちらは creator-root
 * モジュールが解決できないとき「最後に claude を exec」という不変条件を守るため現行動作へ
 * 静かにフォールバックするが、`init` にはフォールバック先そのものが無いため、
 * モジュール未解決はそのままエラー（exit 1）として扱う。
 *
 * 解決した creator-root の各関数（`resolveCreatorRoot` / `createCreatorRoot` /
 * `updateMachinePointer` / `defaultRootPath`）は options 経由で差し替え可能にしてあり、
 * node --test から実 creator-root モジュールを使わずに分岐を検証できる。
 */

function parseInitArgs(args) {
  let channelName;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--channel') {
      channelName = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      // 互換余地として受け取るが無視する（init は TTY プロンプトを持たないため無意味）。
      continue;
    }
    positional.push(arg);
  }
  return { targetPath: positional[0], channelName };
}

function errorMessageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runInitCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const logError = options.logError ?? ((line) => console.error(line));
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const assets = options.assets ?? resolveLauncherAssets();

  const { targetPath: explicitPath, channelName } = parseInitArgs(args);

  let creatorRootModule = null;
  try {
    creatorRootModule = await (options.loadCreatorRootModule ?? defaultLoadCreatorRootModule)(assets);
  } catch {
    creatorRootModule = null;
  }
  if (!creatorRootModule) {
    logError(initModuleMissingError());
    return { exitCode: 1 };
  }

  const resolveCreatorRootFn = options.resolveCreatorRoot ?? creatorRootModule.resolveCreatorRoot;
  const createCreatorRootFn = options.createCreatorRoot ?? creatorRootModule.createCreatorRoot;
  const updateMachinePointerFn = options.updateMachinePointer ?? creatorRootModule.updateMachinePointer;
  const defaultRootPathFn = options.defaultRootPath ?? creatorRootModule.defaultRootPath;

  let targetDir;

  if (explicitPath) {
    // `akari init <path>`: 指定パスに作成（既に有効な作業場なら createCreatorRoot が
    // no-op で既存 manifest を返す＝冪等）。resolveCreatorRoot は経由しない。
    targetDir = path.resolve(cwd, explicitPath);
  } else {
    // `akari init`（引数なし）: resolveCreatorRoot（env → cwd 祖先 → マシンポインタ）で
    // 既存の作業場が見つかれば ensure（何も作らない）。見つからなければ defaultRootPath に作成。
    let resolved;
    try {
      resolved = await resolveCreatorRootFn({ cwd, env, platform });
    } catch (error) {
      logError(initFailedError(errorMessageOf(error)));
      return { exitCode: 1 };
    }

    if (resolved?.error) {
      // 祖先/マシンポインタに壊れた作業場（未知 schema・壊れた JSON 等）が見つかった場合、
      // 新規に別の作業場を作りにいかず、既存ファイルに一切触れずエラーで終了する。
      logError(initFailedError(resolved.error.message));
      return { exitCode: 1 };
    }

    if (resolved?.manifest) {
      // ensure: 既存の作業場を確認しただけで何も作らない。
      try {
        await updateMachinePointerFn(resolved.rootDir, env, { platform });
      } catch (error) {
        logError(initFailedError(errorMessageOf(error)));
        return { exitCode: 1 };
      }
      log(resolved.rootDir);
      log(initFoundNotice(resolved.rootDir));
      return { exitCode: 0 };
    }

    targetDir = defaultRootPathFn(env, { platform });
  }

  let createResult;
  try {
    createResult = await createCreatorRootFn(targetDir, channelName ? { channelName } : {});
  } catch (error) {
    logError(initFailedError(errorMessageOf(error)));
    return { exitCode: 1 };
  }

  try {
    await updateMachinePointerFn(createResult.rootDir, env, { platform });
  } catch (error) {
    logError(initFailedError(errorMessageOf(error)));
    return { exitCode: 1 };
  }

  log(createResult.rootDir);
  log(createResult.created ? initCreatedNotice(createResult.rootDir) : initFoundNotice(createResult.rootDir));
  return { exitCode: 0 };
}
