#!/usr/bin/env node
// SessionStart hook for opencode: カレントに .akari/ プロジェクトがあれば「続きから」体験として
// 進捗（intake 状態・直近イベント）+ 次の一手をコンテキストへ注入する。無ければ
// 何もしない。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FALLBACK_TASK_LABELS = {
  'transcribe-captions': '文字起こし・テロップ',
  'silence-cut': 'いらない間・NG のカット',
  'bgm-sfx': 'BGM・効果音',
  narration: 'ナレーション（自分の声 / 既製の声）',
  '3d-inserts': '3D・画面はめ込みの演出'
};

const AUTONOMY_LABELS = {
  'full-auto': 'すべておまかせ',
  checkpoint: '要所で確認（既定）',
  collaborative: '相談しながら'
};

async function main() {
  const stdin = await readStdin();
  let hookInput = {};
  try {
    hookInput = JSON.parse(stdin || '{}');
  } catch {
    hookInput = {};
  }

  const cwd = typeof hookInput.cwd === 'string' && hookInput.cwd
    ? hookInput.cwd
    : process.cwd();

  const akariDir = path.join(cwd, '.akari');
  if (!existsSync(akariDir)) {
    return;
  }

  const context = buildContext(cwd, akariDir);
  if (!context) return;

  // opencode のフック形式に合わせて出力
  process.stdout.write(JSON.stringify({
    hookEventName: 'SessionStart',
    additionalContext: context
  }));
}

function buildContext(cwd, akariDir) {
  const lines = ['AKARI Video プロジェクトの続きから。'];

  const intake = readJsonSafe(path.join(akariDir, 'intake.json'));
  lines.push(summarizeIntake(intake, cwd));

  const latestEvent = readLatestEvent(path.join(akariDir, 'events'));
  lines.push(latestEvent ? nudgeFor(latestEvent) : 'まだ記録された節目はありません。');

  return lines.join('\n');
}

function summarizeIntake(intake) {
  if (!intake) {
    return '進め方フォーム（.akari/intake.json）がまだありません。';
  }
  if (intake.status !== 'submitted') {
    return '進め方はまだ未確定です（.akari/intake.json: draft）。フォーム・対話で「やること・尺・おまかせ度」を確定してください。';
  }
  const labels = loadTaskLabels();
  const tasks = Array.isArray(intake.tasks) ? intake.tasks : [];
  const taskText = tasks.length > 0 ? tasks.map((id) => labels[id] ?? id).join('、') : '（やること未選択）';
  const autonomyText = AUTONOMY_LABELS[intake.autonomy] ?? intake.autonomy ?? '未設定';
  const target = intake.target ?? {};
  const targetText = target.keep_length
    ? '尺は素材のまま'
    : typeof target.duration_s === 'number'
      ? `目標尺 ${target.duration_s} 秒`
      : '尺は未指定';
  return `進め方: ${taskText} / ${targetText} / 進め方は${autonomyText}。checkpoint なら企画承認・書き出し前などの要所で人に確認する。`;
}

function loadTaskLabels() {
  try {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, '..', '..', '..');
    const schemaPath = path.join(repoRoot, 'packages', 'schemas', 'intake.schema.json');
    const schema = readJsonSafe(schemaPath);
    const labels = schema?.['x-akari-labels'];
    if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
      return labels;
    }
  } catch {
    // フォールバックへ。
  }
  return FALLBACK_TASK_LABELS;
}

function readLatestEvent(eventsDir) {
  if (!existsSync(eventsDir)) return null;
  let entries;
  try {
    entries = readdirSync(eventsDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  } catch {
    return null;
  }

  let latest = null;
  let latestTime = -Infinity;
  for (const entry of entries) {
    const parsed = readJsonSafe(path.join(eventsDir, entry.name));
    if (!parsed || typeof parsed.type !== 'string') continue;
    const timestamp = parsed.occurredAt ?? parsed.at;
    const time = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
    if (Number.isNaN(time)) continue;
    if (time > latestTime) {
      latestTime = time;
      latest = parsed;
    }
  }
  return latest;
}

function nudgeFor(event) {
  const subject = sanitize(event.asset ?? event.artifact ?? event.path);
  switch (event.type) {
    case 'video-added':
      return subject
        ? `${subject} が追加されました。analyze-footage スキルで分析を開始してください。`
        : '新しい素材が追加されました。analyze-footage スキルで分析を開始してください。';
    case 'report-generated':
      return subject
        ? `レポートを作成しました（${subject}）。内容を確認し、問題なければ承認してください。`
        : 'レポートを作成しました。内容を確認し、問題なければ承認してください。';
    case 'report-approved':
      return 'レポートが承認されました。edit-plan スキルで編集を進めてください。';
    case 'edit-completed':
      return '編集が完了しました。プレビューで仕上がりを確認し、必要ならテロップ等を overlay-authoring スキルで調整してください。';
    case 'export-completed':
      return subject
        ? `書き出しが完了しました（${subject}）。exports フォルダーで最終版を確認してください。`
        : '書き出しが完了しました。exports フォルダーで最終版を確認してください。';
    default:
      return subject
        ? `${subject} が更新されました。内容を確認し、次の一手を進めてください。`
        : `更新がありました（${event.type}）。内容を確認し、次の一手を進めてください。`;
  }
}

function sanitize(value) {
  const trimmed = typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim() : '';
  return trimmed || undefined;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

main()
  .catch(() => {
    // HOOK SAFETY: 何が起きてもセッションを壊さない。
  })
  .finally(() => {
    process.exitCode = 0;
  });