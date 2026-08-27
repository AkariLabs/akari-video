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
    if (status?.mismatch) {
      return formatVersionMismatch(status);
    }
    return null;
  }
  const current = status.mismatch
    ? `CLI v${status.cliVersion} / 本体 v${status.appVersion} → ${versionRelationLabel(status)}`
    : `現在 v${status.currentVersion}`;
  return `⬆ AKARI Video v${status.latestVersion}${channelSuffix(status.channel)}があります（${current}）→ 詳細: akari update`;
}

/** `akari doctor` 系出力に足す 1 行（現在版 + フィード取得状態）。 */
export function describeVersionStatus(versionOrInfo, cache) {
  if (typeof versionOrInfo === 'string') {
    if (!cache?.feed) {
      return `バージョン: v${versionOrInfo}（更新フィード: 未取得）`;
    }
    const fetchedAt = typeof cache.fetched_at === 'string' ? cache.fetched_at : '不明';
    return `バージョン: v${versionOrInfo}（更新フィード: 取得済み・${fetchedAt} 時点）`;
  }
  const info = normalizeVersionInfo(versionOrInfo);
  const installed = describeInstalledVersions(info).join(' / ');
  if (!cache?.feed) {
    return `${installed}（更新フィード: 未取得）`;
  }
  const fetchedAt = typeof cache.fetched_at === 'string' ? cache.fetched_at : '不明';
  return `${installed}（更新フィード: 取得済み・${fetchedAt} 時点）`;
}

export function describeInstalledVersions(versionOrInfo) {
  const info = normalizeVersionInfo(versionOrInfo);
  if (info.installRefNeedsRepair) {
    const installRefPath = info.installRefPath ?? '~/.akari/app/.akari-install-ref';
    return [
      `CLI バージョン: v${info.cliVersion}`,
      `本体版を判定できません（\`${installRefPath}\` が壊れています）。`,
      '修復するには `akari update --force` を実行してください。'
    ];
  }
  if (!info.appVersion) {
    return [
      `現在のバージョン: v${info.currentVersion}`,
      `CLI バージョン: v${info.cliVersion}`,
      `本体バージョン: 未記録（更新判定は CLI v${info.currentVersion} へフォールバック）`
    ];
  }
  const lines = [`CLI バージョン: v${info.cliVersion}`, `本体バージョン: v${info.appVersion}（更新判定の基準）`];
  if (info.mismatch) {
    lines.push(`版のずれ: CLI v${info.cliVersion} / 本体 v${info.appVersion} → ${versionRelationLabel(info)}`);
  }
  return lines;
}

export function describeForceReinstall(versionOrInfo, targetVersion) {
  const info = normalizeVersionInfo(versionOrInfo);
  return info.installRefNeedsRepair
    ? `--force: 版を判定できない本体 → v${targetVersion} を入れ直します。`
    : `--force: 本体 v${info.currentVersion} → v${targetVersion} を入れ直します。`;
}

function normalizeVersionInfo(value) {
  if (typeof value === 'string') {
    return { cliVersion: value, appVersion: null, currentVersion: value, mismatch: false };
  }
  return value;
}

function versionRelationLabel(info) {
  return compareVersions(info.appVersion, info.cliVersion) < 0 ? '本体が古い' : 'CLI が古い';
}

function formatVersionMismatch(info) {
  const relation = versionRelationLabel(info);
  const guidance = relation === '本体が古い'
    ? '`akari update` で本体を更新してください。'
    : '`npm i -g akari-video@latest` で CLI を更新してください。';
  return `⚠ CLI v${info.cliVersion} / 本体 v${info.appVersion} → ${relation}。${guidance}`;
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
export function describeUpdateCommand({ currentVersion, versionInfo, cache, dismissed, usingCachedFeed = false }) {
  const info = versionInfo ?? normalizeVersionInfo(currentVersion);
  const lines = versionInfo ? describeInstalledVersions(info) : [`現在のバージョン: v${currentVersion}`];
  const feed = cache?.feed;
  if (!feed) {
    lines.push('最新情報をまだ取得できていません（オフライン、または初回起動直後の可能性があります）。');
    lines.push('少し待ってから、もう一度 `akari` を実行すると次回チェックされます。');
    return lines;
  }

  if (usingCachedFeed) {
    lines.push(describeUpdateCacheFallback(cache));
  }

  lines.push(`最新バージョン: v${feed.product}${channelSuffix(feed.channel)}`);
  if (feed.notes_url) {
    lines.push(`リリースノート: ${feed.notes_url}`);
  }

  if (info.installRefNeedsRepair) {
    lines.push('本体版を判定できないため、更新判定を行いません。');
    return lines;
  }

  if (compareVersions(feed.product, info.currentVersion) <= 0) {
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

/** 明示 update の再取得失敗時に、参照するキャッシュの取得時刻を示す 1 行。 */
export function describeUpdateCacheFallback(cache) {
  const fetchedAt = typeof cache?.fetched_at === 'string' ? cache.fetched_at : '取得時刻不明';
  return `更新フィードを取得できなかったため、${fetchedAt} 時点のキャッシュを表示します。`;
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
 * 素材の取得方式案内 + 無料スターターパック（`akari store connect`）+ 公式音源ライブラリ
 * （AKARI Sounds）明示再入口（`akari sounds`）の文言群。1 行主義の既存流儀に従う。
 *
 * 2026-08-04 オーナー方針（正本: `planning/notes-2026-08-04-asset-reference-distribution.md`
 * §8）により、初回起動での AKARI Sounds 一括ダウンロード [Y/n] 質問（2026-08-03 裁定）は
 * 廃止した。素材は resolver がオンデマンド取得する設計に一本化されたため、質問文言
 * （`soundsPromptText` / `soundsDeclinedNotice`）はもう使わない。
 *
 * 2026-08-11 オーナー裁定（正本: 内部リポ `planning/notes-2026-08-11-onboarding-firstrun.md`
 * §3 R2）により、無料スターターパックの案内を同じ 1 回だけの通知に統合した（別画面を増やさない
 * ＝「1 画面 1 問まで」の精神）。件数は明記しない（実際のパック内容は入れ替わりうるため
 * 実数依存の表現にしない）。表示条件は `sounds-setup.mjs` の `maybeShowAssetIntroNotice` が
 * 持つ — 既にアカウント連携済みなら、この文言ごと表示をスキップする（連携ずみの人には
 * 「連携すると使える」という案内自体が的外れなため）。
 */

/** `akari` 起動時に生涯 1 回だけ出す素材案内（質問ではない・対話をブロックしない）。 */
export function assetIntroNotice() {
  return '素材（B-roll・背景・音源）は使うときに必要な分だけ自動で取得されます。無料の素材パックもあります — `akari store connect` でアカウント連携すると使えるようになります。まとめて音源だけ欲しい場合は `akari sounds` で一括ダウンロードできます（この案内は次回以降表示しません）。';
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

/** `akari assets`: 素材 resolver（asset-resolver）が同梱されていない場合のエラー（stderr 1 行）。 */
export function assetsResolverUnavailableError() {
  return '素材 resolver（asset-resolver）が見つかりませんでした。`akari assets` は使えません。';
}

/**
 * `akari --help` / `akari -h`（Node CLI 版。npm 配布 `akari-video` パッケージの `akari`
 * コマンド）の出力（タスク契約 `2026-08-11-onboarding-o3-firstrun-plain` §4）。
 * `akari.sh` の `-h|--help` 出力と同じ「作る → プレビュー → 連携/素材 → 更新」の初心者目線の
 * 並びに揃え、開発者向けのフラグ・サブコマンドは末尾に降格する。プレビューサーバーは
 * シェル版（`akari.sh --preview`）専用の機能で npm 版の `akari` 単体には同梱されないため、
 * 案内が行き止まりにならないようその旨を明示する。
 */
export function describeCliHelp() {
  return [
    'AKARI Video — AI が主体で動画を編集するツール',
    '',
    '使い方: akari [command] [options...]',
    '',
    'よく使うコマンド:',
    '  (引数なし)              プロジェクトを開いて AI エージェントを起動（未作成なら自動作成）',
    '  store connect          アカウント連携（無料の素材パックと購入済み素材が使えるようになる）',
    '  sounds                 公式音源ライブラリを一括ダウンロード（無料）',
    '  chrome install         動画書き出しに使う Chrome をダウンロードして導入する',
    '  update [--force]       更新を確認する（--force で本体を入れ直す）',
    '  status                 接続状態を確認する',
    '  migrate [dir]          古い edit.json を退避バックアップ付きで v2 へ変換',
    '',
    '開発者向け:',
    '  --opencode              Claude Code の代わりに opencode を起動する',
    '  --claude, --claudecode  Claude Code を明示的に起動する',
    '  -y, --yes               自動承認（確認をスキップ）',
    '  --version, -v            インストール済みのバージョンを表示',
    '  new <dir>                雛形からプロジェクトを新規作成',
    '  init                     保存フォルダ（作業場）だけを作成・確認',
    '  narration / assets / internal / capability   各機能の詳細は `akari <command> --help`',
    '  -h, --help               このヘルプを表示',
    '',
    'プレビューサーバー（ブラウザで確認する画面）はシェル版のみ対応です: akari.sh --preview'
  ];
}
