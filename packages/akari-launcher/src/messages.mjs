const AUTONOMY_LABELS = {
  'full-auto': 'すべておまかせ',
  checkpoint: '要所で確認（既定）',
  collaborative: '相談しながら'
};

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
