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
