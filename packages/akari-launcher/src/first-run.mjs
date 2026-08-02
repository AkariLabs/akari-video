import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

import { detectProjectState } from './project-state.mjs';
import {
  creatorRootFoundNotice,
  creatorRootNewProjectNotice,
  creatorRootCreatedNotice,
  creatorRootCreateFailedNotice,
  creatorRootPromptText
} from './messages.mjs';

/**
 * `akari` の初回動線（契約 `docs/contract-2026-08-02-creator-root-v1.md` §5・§6-1）。
 *
 * `packages/creator-root` が「作業場操作の単一実装」を提供する pure Node ESM モジュールで、
 * 本モジュールはそれを `repo-assets.mjs` の `scaffoldModulePath` と同型の流儀で動的 import し、
 * cwd から作業場を解決 → (a)/(b)/(c) の分岐に従ってプロジェクトの展開先ディレクトリを決める
 * 配線を担う。creator-root モジュールが解決できない場合（npm 配布で vendor 未同梱等）は、
 * 「最後に claude を exec」の不変条件を守るため現行動作へ静かにフォールバックする。
 */

// creator-root が未解決の場合の既定チャンネル名フォールバック
// （`packages/creator-root` の `DEFAULT_CHANNEL_NAME` と同値。値の重複は許容する —
// creator-root を静的 import できないため定数を直接参照できず、モジュールが解決できた
// ときは常に本物の export を優先して使う。ここに来るのはモジュール自体が読めない
// 極端なケースのみ）。
const DEFAULT_CHANNEL_NAME_FALLBACK = 'my-channel';

/**
 * creator-root モジュールを `assets.creatorRootModulePath` から動的 import する。
 * `cli.mjs` の `defaultScaffold` が `scaffoldModulePath` を扱うのと同型。
 * 見つからなければ null（呼び出し側は現行動作へフォールバックする）。
 */
export async function defaultLoadCreatorRootModule(assets) {
  if (!assets?.creatorRootModulePath) {
    return null;
  }
  return import(pathToFileURL(assets.creatorRootModulePath).href);
}

/** `node:readline/promises` を使った既定の TTY プロンプト実装。 */
export async function defaultPrompt(promptText) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(promptText);
  } finally {
    rl.close();
  }
}

/**
 * `manifest.channels[0]` を既定チャンネルとして使う。配列が欠如・空の手作り root.json にも
 * 備え、その場合は `fallback`（creator-root の `DEFAULT_CHANNEL_NAME`）へフォールバックする。
 */
function pickChannelName(manifest, fallback) {
  return Array.isArray(manifest?.channels) && manifest.channels.length > 0
    ? manifest.channels[0]
    : fallback;
}

function formatDateSlug(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `videosDir` 配下に日付ベースの一意なプロジェクトディレクトリパスを決める
 * （`YYYY-MM-DD-video`、衝突時 `-2`, `-3`… 契約 §5 (b)/(c)）。ディレクトリはまだ作らない
 * （作成は既存の scaffold 経路に委ねる — 「孤児プロジェクトを作らない」を、新しい作成経路を
 * 増やさず既存の唯一の scaffold 実装を再利用することで自然に満たす設計）。
 */
export function resolveUniqueProjectDir(videosDir, date) {
  const baseName = `${formatDateSlug(date)}-video`;
  let candidate = path.join(videosDir, baseName);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = path.join(videosDir, `${baseName}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

/**
 * 現在の `projectRoot` から、実際にプロジェクトを展開すべき先のディレクトリを決めて返す。
 * 何もすることがなければ（既存プロジェクト内 / creator-root モジュール未解決 / お試しモード
 * 選択時）`projectRoot` をそのまま返す。ここではディレクトリの作成もプロジェクトの scaffold
 * も行わない。呼び出し側（`cli.mjs` の `run()`）が返り値を新しい `projectRoot` として、
 * 既存の scaffold 経路にそのまま渡す。
 */
export async function resolveEffectiveProjectRoot({
  projectRoot,
  env,
  platform,
  now,
  log,
  assets,
  autoConfirm,
  options = {}
}) {
  let creatorRootModule = null;
  try {
    creatorRootModule = await (options.loadCreatorRootModule ?? defaultLoadCreatorRootModule)(assets);
  } catch {
    // creator-root モジュールの読み込みに失敗 → 現行動作へフォールバック（不変条件）
    creatorRootModule = null;
  }

  const resolveCreatorRootFn = options.resolveCreatorRoot ?? creatorRootModule?.resolveCreatorRoot;
  const createCreatorRootFn = options.createCreatorRoot ?? creatorRootModule?.createCreatorRoot;
  const updateMachinePointerFn = options.updateMachinePointer ?? creatorRootModule?.updateMachinePointer;
  const defaultRootPathFn = options.defaultRootPath ?? creatorRootModule?.defaultRootPath;
  const defaultChannelName = options.defaultChannelName ?? creatorRootModule?.DEFAULT_CHANNEL_NAME ?? DEFAULT_CHANNEL_NAME_FALLBACK;

  if (!resolveCreatorRootFn) {
    return projectRoot;
  }

  const localState = detectProjectState(projectRoot);

  let resolved = null;
  try {
    resolved = await resolveCreatorRootFn({ cwd: projectRoot, env, platform });
  } catch {
    resolved = null;
  }

  if (localState.scaffolded) {
    // (a) 既存プロジェクト内 → 現行動作のまま。作業場内なら log に 1 行添える。
    if (resolved && resolved.manifest) {
      log(creatorRootFoundNotice(resolved.rootDir));
    }
    return projectRoot;
  }

  if (resolved && resolved.error) {
    // 祖先/マシンポインタに壊れた作業場（未知 schema・壊れた JSON 等）が見つかった場合、
    // 新規に別の作業場を作りにいかず安全側（お試しモード = 現行動作）に倒す。
    return projectRoot;
  }

  if (resolved && resolved.manifest) {
    // (b) 作業場の中だがプロジェクトではない → 既定チャンネルの videos/ へ新規プロジェクト
    const channel = pickChannelName(resolved.manifest, defaultChannelName);
    const videosDir = path.join(resolved.rootDir, 'channels', channel, 'videos');
    const newProjectDir = resolveUniqueProjectDir(videosDir, now);

    if (updateMachinePointerFn) {
      try {
        await updateMachinePointerFn(resolved.rootDir, env, { platform });
      } catch {
        // ポインタ更新の失敗でプロジェクト作成・claude 起動までは止めない
      }
    }

    log(creatorRootNewProjectNotice(resolved.rootDir, newProjectDir));
    return newProjectDir;
  }

  // (c) どちらでもない
  if (!createCreatorRootFn || !defaultRootPathFn) {
    return projectRoot;
  }

  const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY);

  let chosenRootPath = null;
  if (autoConfirm) {
    // --yes: 既定パスに自動作成
    chosenRootPath = defaultRootPathFn(env, { platform });
  } else if (isTTY) {
    const promptFn = options.prompt ?? defaultPrompt;
    const defaultPath = defaultRootPathFn(env, { platform });
    const answerRaw = await promptFn(creatorRootPromptText(defaultPath));
    const answer = typeof answerRaw === 'string' ? answerRaw.trim() : '';
    if (answer.length === 0) {
      chosenRootPath = defaultPath;
    } else if (answer.toLowerCase() === 'n') {
      chosenRootPath = null;
    } else {
      chosenRootPath = path.resolve(projectRoot, answer);
    }
  } else {
    // 非 TTY: 現行動作（自動化互換・契約 §9）
    chosenRootPath = null;
  }

  if (!chosenRootPath) {
    return projectRoot;
  }

  let createResult;
  try {
    createResult = await createCreatorRootFn(chosenRootPath);
  } catch (error) {
    log(creatorRootCreateFailedNotice(error instanceof Error ? error.message : String(error)));
    return projectRoot;
  }

  if (updateMachinePointerFn) {
    try {
      await updateMachinePointerFn(createResult.rootDir, env, { platform });
    } catch {
      // ポインタ更新の失敗でプロジェクト作成・claude 起動までは止めない
    }
  }

  const channel = pickChannelName(createResult.manifest, defaultChannelName);
  const videosDir = path.join(createResult.rootDir, 'channels', channel, 'videos');
  const newProjectDir = resolveUniqueProjectDir(videosDir, now);
  log(creatorRootCreatedNotice(createResult.rootDir, newProjectDir));
  return newProjectDir;
}
