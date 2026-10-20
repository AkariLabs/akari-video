import { compareVersions } from './update-check.mjs';
import { cliText, cliValue } from './i18n.mjs';

const AUTONOMY_LABELS = {
  'full-auto': 'fullAuto',
  checkpoint: 'checkpoint',
  collaborative: 'collaborative'
};

/** channel が prerelease のときだけ付ける版名の注記（CLI・シェルで共通の規則）。 */
function channelSuffix(channel) {
  return channel === 'prerelease' ? cliText('cli.version.channel.prerelease') : '';
}

/**
 * `.akari/intake.json`（進め方フォーム）の状態を、利用者の言葉で 1 段落に要約する。
 */
export function describeIntake(intake, taskLabels) {
  if (!intake) {
    return cliText('cli.intake.status.missing');
  }
  if (intake.status !== 'submitted') {
    return cliText('cli.intake.status.draft');
  }

  const tasks = Array.isArray(intake.tasks) ? intake.tasks : [];
  const taskText = tasks.length > 0
    ? tasks.map((id) => cliValue('cli.intake.task.', taskLabels?.[id] ?? id)).join(cliText('cli.intake.list.separator'))
    : cliText('cli.intake.tasks.empty');
  const autonomyText = AUTONOMY_LABELS[intake.autonomy] ? cliText(`cli.intake.autonomy.${AUTONOMY_LABELS[intake.autonomy]}`) : intake.autonomy ?? cliText('cli.intake.autonomy.unset');
  const target = intake.target ?? {};
  const targetText = target.keep_length
    ? cliText('cli.intake.target.keepLength')
    : typeof target.duration_s === 'number'
      ? cliText('cli.intake.target.duration', { seconds: target.duration_s, n: target.duration_s })
      : cliText('cli.intake.target.unspecified');

  return cliText('cli.intake.status.submitted', { tasks: taskText, target: targetText, autonomy: autonomyText });
}

export function claudeMissingGuidance() {
  return [
    cliText('cli.agent.claude.missing'),
    cliText('cli.agent.claude.install'),
    cliText('cli.agent.claude.retry')
  ].join('\n');
}

export function opencodeMissingGuidance() {
  return [
    cliText('cli.agent.opencode.missing'),
    cliText('cli.agent.opencode.install'),
    cliText('cli.agent.opencode.retry')
  ].join('\n');
}

/** 入口で第 1 引数の打ち間違いを検出したときの案内。 */
export function firstArgumentTypoError(argument, suggestion) {
  const visibleArgument = argument.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  return cliText('cli.argument.first.typo', { argument: visibleArgument, suggestion });
}

/** 非対話の未作成フォルダーで、作成を明示する引数がないときの案内。 */
export function nonInteractiveUninitializedGuidance() {
  return cliText('cli.project.nonInteractive.uninitialized');
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
    ? cliText('cli.version.notice.mismatchCurrent', { cliVersion: status.cliVersion, appVersion: status.appVersion, relation: versionRelationLabel(status) })
    : cliText('cli.version.notice.current', { version: status.currentVersion });
  return cliText('cli.version.notice.available', { version: status.latestVersion, channel: channelSuffix(status.channel), current });
}

/** `akari doctor` 系出力に足す 1 行（現在版 + フィード取得状態）。 */
export function describeVersionStatus(versionOrInfo, cache, runtimeDiagnostics) {
  if (typeof versionOrInfo === 'string') {
    if (!cache?.feed) {
      return cliText('cli.version.feed.unfetched', { version: versionOrInfo });
    }
    const fetchedAt = typeof cache.fetched_at === 'string' ? cache.fetched_at : cliText('cli.version.feed.unknownTime');
    return cliText('cli.version.feed.fetched', { version: versionOrInfo, fetchedAt });
  }
  const info = normalizeVersionInfo(versionOrInfo);
  const installed = describeInstalledVersions(info, runtimeDiagnostics).join(' / ');
  if (!cache?.feed) {
    return cliText('cli.version.feed.statusUnfetched', { installed });
  }
  const fetchedAt = typeof cache.fetched_at === 'string' ? cache.fetched_at : cliText('cli.version.feed.unknownTime');
  return cliText('cli.version.feed.statusFetched', { installed, fetchedAt });
}

export function describeInstalledVersions(versionOrInfo, runtimeDiagnostics) {
  const info = normalizeVersionInfo(versionOrInfo);
  if (info.installRefNeedsRepair) {
    const installRefPath = info.installRefPath ?? '~/.akari/app/.akari-install-ref';
    return [
      cliText('cli.version.installed.cli', { version: info.cliVersion }),
      cliText('cli.version.installed.invalid', { path: installRefPath }),
      cliText('cli.version.installed.repair')
    ];
  }
  if (!info.appVersion) {
    if (info.installRefStatus === 'missing' && runtimeDiagnostics?.render_cut) {
      const renderCut = runtimeDiagnostics.render_cut;
      const availability = renderCut.origin === 'none'
        ? cliText('cli.version.export.unavailable')
        : cliText('cli.version.export.origin', { origin: humanRenderOrigin(renderCut.origin) });
      const lines = [
        cliText('cli.version.installed.current', { version: info.currentVersion }),
        cliText('cli.version.installed.cli', { version: info.cliVersion }),
        cliText('cli.version.installed.unmanaged', { availability }),
      ];
      if (renderCut.origin === 'none') {
        lines.push(cliText('cli.version.export.repair'));
      }
      return lines;
    }
    return [
      cliText('cli.version.installed.current', { version: info.currentVersion }),
      cliText('cli.version.installed.cli', { version: info.cliVersion }),
      cliText('cli.version.installed.unrecorded', { version: info.currentVersion })
    ];
  }
  const lines = [cliText('cli.version.installed.cli', { version: info.cliVersion }), cliText('cli.version.installed.app', { version: info.appVersion })];
  if (info.mismatch) {
    lines.push(cliText('cli.version.installed.mismatch', { cliVersion: info.cliVersion, appVersion: info.appVersion, relation: versionRelationLabel(info) }));
  }
  return lines;
}

function humanRenderOrigin(origin) {
  return origin === 'monorepo' ? cliText('cli.version.export.monorepo') : origin;
}

export function describeForceReinstall(versionOrInfo, targetVersion) {
  const info = normalizeVersionInfo(versionOrInfo);
  return info.installRefNeedsRepair
    ? cliText('cli.update.force.unknown', { targetVersion })
    : cliText('cli.update.force.known', { currentVersion: info.currentVersion, targetVersion });
}

function normalizeVersionInfo(value) {
  if (typeof value === 'string') {
    return { cliVersion: value, appVersion: null, currentVersion: value, mismatch: false };
  }
  return value;
}

function versionRelationLabel(info) {
  return compareVersions(info.appVersion, info.cliVersion) < 0 ? cliText('cli.version.relation.app') : cliText('cli.version.relation.cli');
}

function formatVersionMismatch(info) {
  const relation = versionRelationLabel(info);
  const guidance = compareVersions(info.appVersion, info.cliVersion) < 0
    ? cliText('cli.version.relation.updateApp')
    : cliText('cli.version.relation.updateCli');
  return cliText('cli.version.relation.mismatch', { cliVersion: info.cliVersion, appVersion: info.appVersion, relation, guidance });
}

/**
 * 初回動線（作業場・creator-root）関連の 1 行メッセージ群（契約
 * `docs/contract-2026-08-02-creator-root-v1.md` §5）。既存の流儀に従い日本語・1 行主義。
 */

/** (a) 既存プロジェクトが作業場の中にある場合に添える 1 行。 */
export function creatorRootFoundNotice(rootDir) {
  return cliText('cli.workspace.status.found', { root: rootDir });
}

/** (b) 作業場の中だがプロジェクトではない cwd から新規プロジェクトを作るときの 1 行。 */
export function creatorRootNewProjectNotice(rootDir, projectDir) {
  return cliText('cli.workspace.project.new', { root: rootDir, project: projectDir });
}

/** (c) 作業場を新規作成してプロジェクトを作るときの 1 行。 */
export function creatorRootCreatedNotice(rootDir, projectDir) {
  return cliText('cli.workspace.project.created', { root: rootDir, project: projectDir });
}

/** (c) 作業場の作成でエラーが発生した場合の 1 行（このフォルダでの単体運用を続ける）。 */
export function creatorRootCreateFailedNotice(errorMessage) {
  return cliText('cli.workspace.project.createFailed', { message: errorMessage });
}

/** (c) の TTY プロンプト文言。既定パスを 1 行で提示する。 */
export function creatorRootPromptText(defaultPath) {
  return cliText('cli.workspace.prompt.create', { path: defaultPath });
}

/**
 * `akari update` の出力本文（複数行）。フィード未取得・最新・新版ありで案内が変わる。
 * `dismissed` は今回の実行で dismiss 記録を書いたかどうか（表示文言の切り替えのみに使う）。
 */
export function describeUpdateCommand({ currentVersion, versionInfo, cache, dismissed, usingCachedFeed = false, runtimeDiagnostics, npmAvailable = true }) {
  const info = versionInfo ?? normalizeVersionInfo(currentVersion);
  const lines = versionInfo ? describeInstalledVersions(info, runtimeDiagnostics) : [cliText('cli.version.installed.current', { version: currentVersion })];
  const feed = cache?.feed;
  if (!feed) {
    lines.push(cliText('cli.update.feed.unavailable'));
    lines.push(cliText('cli.update.feed.retry'));
    return lines;
  }

  if (usingCachedFeed) {
    lines.push(describeUpdateCacheFallback(cache));
  }

  lines.push(cliText('cli.update.feed.latest', { version: feed.product, channel: channelSuffix(feed.channel) }));
  if (feed.notes_url) {
    lines.push(cliText('cli.update.feed.notes', { url: feed.notes_url }));
  }

  if (info.installRefNeedsRepair) {
    lines.push(cliText('cli.update.feed.versionUnknown'));
    return lines;
  }

  if (compareVersions(feed.product, info.currentVersion) <= 0) {
    lines.push(cliText('cli.update.feed.upToDate'));
    return lines;
  }

  const tarballUrl = feed.components?.cli?.tarball?.url;
  if (npmAvailable) {
    lines.push(cliText('cli.update.command.manual'));
    lines.push(tarballUrl ? `  npm i -g ${tarballUrl}` : '  npm i -g akari-video@latest');
  } else {
    lines.push(cliText('cli.update.command.npmMissing'));
  }
  lines.push(
    dismissed
      ? cliText('cli.update.notice.dismissed', { version: feed.product })
      : cliText('cli.update.notice.dismissGuide')
  );
  return lines;
}

/** 明示 update の再取得失敗時に、参照するキャッシュの取得時刻を示す 1 行。 */
export function describeUpdateCacheFallback(cache) {
  const fetchedAt = typeof cache?.fetched_at === 'string' ? cache.fetched_at : cliText('cli.update.feed.unknownTime');
  return cliText('cli.update.feed.cacheFallback', { fetchedAt });
}

/**
 * `akari init` の出力文言（タスク契約 launcher-init・内部リポ）。作業場
 * （creator-root）の作成・確認だけを行う入口コマンド専用。1 行主義の既存流儀に従う。
 */

/** 既存の作業場が見つかり、何も作らず確認しただけの場合の人間向け行。 */
export function initFoundNotice(rootDir) {
  return cliText('cli.init.workspace.found', { root: rootDir });
}

/** 新規に作業場を作成した場合の人間向け行。 */
export function initCreatedNotice(rootDir) {
  return cliText('cli.init.workspace.created', { root: rootDir });
}

/** creator-root モジュールが解決できない場合のエラー（stderr 1 行。init にフォールバック先は無い）。 */
export function initModuleMissingError() {
  return cliText('cli.init.error.moduleMissing');
}

/** 作業場の初期化に失敗した場合のエラー（root.json 破損・未知 schema・書き込み不能など。stderr 1 行）。 */
export function initFailedError(errorMessage) {
  return cliText('cli.init.error.failed', { message: errorMessage });
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
  return cliText('cli.assets.notice.intro');
}

/** ダウンロード成功後の完了 + 追加カタログ（外部補完）の案内。`akari sounds` の完了時に使う。 */
export function soundsCompleteNotice() {
  return cliText('cli.sounds.status.complete');
}

/** ダウンロード失敗時の 1 行（起動は止めない・再入口を示す）。 */
export function soundsFailedNotice() {
  return cliText('cli.sounds.error.downloadFailed');
}

/** `akari sounds`: セットアップスクリプトが同梱されていない場合のエラー（stderr 1 行）。 */
export function soundsUnavailableError() {
  return cliText('cli.sounds.error.scriptMissing');
}

/** `akari assets`: 素材 resolver（asset-resolver）が同梱されていない場合のエラー（stderr 1 行）。 */
export function assetsResolverUnavailableError() {
  return cliText('cli.assets.error.resolverMissing');
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
    cliText('cli.help.header.title'),
    '',
    cliText('cli.help.header.usage'),
    '',
    cliText('cli.help.commands.heading'),
    ...['launch', 'preview', 'store', 'sounds', 'doctor', 'speakers', 'toolsVoice', 'update', 'status', 'migrate', 'migrateLook', 'generate', 'storyboard', 'project', 'playbook', 'recipe', 'clean'].map((name) => cliText(`cli.help.commands.${name}`)),
    '',
    cliText('cli.help.developer.heading'),
    ...['opencode', 'claude', 'yes', 'version', 'new', 'init', 'other', 'help'].map((name) => cliText(`cli.help.developer.${name}`)),
    '',
    cliText('cli.help.preview.notice')
  ];
}
