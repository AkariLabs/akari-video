import { compareVersions } from './update-check.mjs';

const AUTONOMY_LABELS = {
  'full-auto': 'すべておまかせ',
  checkpoint: '要所で確認（既定）',
  collaborative: '相談しながら'
};

/** channel が prerelease のときだけ付ける版名の注記（CLI・シェルで共通の規則）。 */
function channelSuffix(channel) {
  return channel === 'prerelease' ? '（プレリリース）' : '';
}

/**
 * `.akari/intake.json`（進め方フォーム）の状態を、利用者の言葉で 1 段落に要約する。
 */
export function describeIntake(intake, taskLabels) {
  if (!intake) {
    return '進め方フォーム（.akari/intake.json）がまだありません。';
  }
  if (intake.status !== 'submitted') {
    return '進め方はまだ未確定です（.akari/intake.json: draft）。intake フォーム、または対話で「やること・尺・おまかせ度」を確定してください。';
  }

  const tasks = Array.isArray(intake.tasks) ? intake.tasks : [];
  const taskText = tasks.length > 0
    ? tasks.map((id) => taskLabels?.[id] ?? id).join('、')
    : '（やること未選択）';
  const autonomyText = AUTONOMY_LABELS[intake.autonomy] ?? intake.autonomy ?? '未設定';
  const target = intake.target ?? {};
  const targetText = target.keep_length
    ? '尺は素材のまま'
    : typeof target.duration_s === 'number'
      ? `目標尺 ${target.duration_s} 秒`
      : '尺は未指定';

  return `進め方: ${taskText} / ${targetText} / 進め方は${autonomyText}。この内容で進めます。`;
}

export function claudeMissingGuidance() {
  return [
    'claude コマンドが見つかりませんでした。',
    'Claude Code をインストールしてください: https://claude.ai/install.sh',
    'インストール後、このフォルダーで再度 `akari` を実行してください。'
  ].join('\n');
}

export function opencodeMissingGuidance() {
  return [
    'opencode コマンドが見つかりませんでした。',
    'opencode をインストールしてください: npm install -g opencode-ai',
    'インストール後、このフォルダーで再度 `akari --opencode` を実行してください。'
  ].join('\n');
}

/**
 * `akari` 起動時、claude 起動直前に出す 1 行通知（契約 §4-1）。
 * `checkForUpdateSync` が返す状態から組み立てる。新版が無ければ null。
 */
export function formatUpdateNotice(status) {
  if (!status?.available) {
    return null;
  }
  return `⬆ AKARI Video v${status.latestVersion}${channelSuffix(status.channel)}があります（現在 v${status.currentVersion}）→ 詳細: akari update`;
}

/** `akari doctor` 系出力に足す 1 行（現在版 + フィード取得状態）。 */
export function describeVersionStatus(currentVersion, cache) {
  if (!cache?.feed) {
    return `バージョン: v${currentVersion}（更新フィード: 未取得）`;
  }
  const fetchedAt = typeof cache.fetched_at === 'string' ? cache.fetched_at : '不明';
  return `バージョン: v${currentVersion}（更新フィード: 取得済み・${fetchedAt} 時点）`;
}

/**
 * 初回動線（作業場・creator-root）関連の 1 行メッセージ群（契約
 * `docs/contract-2026-08-02-creator-root-v1.md` §5）。既存の流儀に従い日本語・1 行主義。
 */

/** (a) 既存プロジェクトが作業場の中にある場合に添える 1 行。 */
export function creatorRootFoundNotice(rootDir) {
  return `作業場: ${rootDir}`;
}

/** (b) 作業場の中だがプロジェクトではない cwd から新規プロジェクトを作るときの 1 行。 */
export function creatorRootNewProjectNotice(rootDir, projectDir) {
  return `作業場 ${rootDir} に新規プロジェクトを作成します: ${projectDir}`;
}

/** (c) 作業場を新規作成してプロジェクトを作るときの 1 行。 */
export function creatorRootCreatedNotice(rootDir, projectDir) {
  return `作業場を作成しました: ${rootDir}（新規プロジェクト: ${projectDir}）`;
}

/** (c) 作業場の作成でエラーが発生した場合の 1 行（このフォルダでの単体運用を続ける）。 */
export function creatorRootCreateFailedNotice(errorMessage) {
  return `作業場の作成でエラーが発生しました（このフォルダでの単体運用を続けます）: ${errorMessage}`;
}

/** (c) の TTY プロンプト文言。既定パスを 1 行で提示する。 */
export function creatorRootPromptText(defaultPath) {
  return `作業場を作って始めますか？ [Enter: ${defaultPath} / パスを入力 / n: このフォルダだけで試す] `;
}

/**
 * `akari update` の出力本文（複数行）。フィード未取得・最新・新版ありで案内が変わる。
 * `dismissed` は今回の実行で dismiss 記録を書いたかどうか（表示文言の切り替えのみに使う）。
 */
export function describeUpdateCommand({ currentVersion, cache, dismissed }) {
  const lines = [`現在のバージョン: v${currentVersion}`];
  const feed = cache?.feed;
  if (!feed) {
    lines.push('最新情報をまだ取得できていません（オフライン、または初回起動直後の可能性があります）。');
    lines.push('少し待ってから、もう一度 `akari` を実行すると次回チェックされます。');
    return lines;
  }

  lines.push(`最新バージョン: v${feed.product}${channelSuffix(feed.channel)}`);
  if (feed.notes_url) {
    lines.push(`リリースノート: ${feed.notes_url}`);
  }

  if (compareVersions(feed.product, currentVersion) <= 0) {
    lines.push('お使いのバージョンは最新です。');
    return lines;
  }

  const tarballUrl = feed.components?.cli?.tarball?.url;
  lines.push('更新するには、次のコマンドを実行してください（自動実行はしません）:');
  lines.push(tarballUrl ? `  npm i -g ${tarballUrl}` : '  npm i -g akari-video@latest');
  lines.push(
    dismissed
      ? `この版（v${feed.product}）の通知は今後表示しません。`
      : 'この版の通知を今後出さない場合は `akari update --dismiss` を実行してください。'
  );
  return lines;
}

/**
 * `akari init` の出力文言（タスク契約 launcher-init・内部リポ）。作業場
 * （creator-root）の作成・確認だけを行う入口コマンド専用。1 行主義の既存流儀に従う。
 */

/** 既存の作業場が見つかり、何も作らず確認しただけの場合の人間向け行。 */
export function initFoundNotice(rootDir) {
  return `既存の作業場を確認しました: ${rootDir}`;
}

/** 新規に作業場を作成した場合の人間向け行。 */
export function initCreatedNotice(rootDir) {
  return `作業場を作成しました: ${rootDir}`;
}

/** creator-root モジュールが解決できない場合のエラー（stderr 1 行。init にフォールバック先は無い）。 */
export function initModuleMissingError() {
  return '作業場モジュール（creator-root）が見つかりませんでした。';
}

/** 作業場の初期化に失敗した場合のエラー（root.json 破損・未知 schema・書き込み不能など。stderr 1 行）。 */
export function initFailedError(errorMessage) {
  return `作業場の初期化に失敗しました: ${errorMessage}`;
}

/**
 * 素材の取得方式案内 + 公式音源ライブラリ（AKARI Sounds）明示再入口（`akari sounds`）の
 * 文言群。1 行主義の既存流儀に従う。
 *
 * 2026-08-04 オーナー方針（正本: `planning/notes-2026-08-04-asset-reference-distribution.md`
 * §8）により、初回起動での AKARI Sounds 一括ダウンロード [Y/n] 質問（2026-08-03 裁定）は
 * 廃止した。素材は resolver がオンデマンド取得する設計に一本化されたため、質問文言
 * （`soundsPromptText` / `soundsDeclinedNotice`）はもう使わない。
 */

/** `akari` 起動時に生涯 1 回だけ出す素材案内（質問ではない・対話をブロックしない）。 */
export function assetIntroNotice() {
  return '素材（B-roll・背景・音源）は使うときに必要な分だけ自動で取得されます。`akari store connect` でアカウントを接続すると購入済み素材も同じ一覧に並びます。まとめて欲しい場合は `akari sounds` で音源を一括ダウンロードできます（この案内は次回以降表示しません）。';
}

/** ダウンロード成功後の完了 + 追加カタログ（外部補完）の案内。`akari sounds` の完了時に使う。 */
export function soundsCompleteNotice() {
  return '公式音源ライブラリの登録が完了しました。公式に無い系統（拍手・失敗音・和風打撃など）は追加カタログにあります — セッションで「追加の音源も入れて」と頼むと取得を代行します。';
}

/** ダウンロード失敗時の 1 行（起動は止めない・再入口を示す）。 */
export function soundsFailedNotice() {
  return '音源のダウンロードに失敗しました（続行します）。後から `akari sounds` で再試行できます。';
}

/** `akari sounds`: セットアップスクリプトが同梱されていない場合のエラー（stderr 1 行）。 */
export function soundsUnavailableError() {
  return '音源セットアップスクリプト（audio-library-setup）が見つかりませんでした。';
}
