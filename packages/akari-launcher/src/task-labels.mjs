import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cliText, cliLanguage } from './i18n.mjs';

// packages/schemas/intake.schema.json の x-akari-labels（安定 ID ↔ 日本語ラベル）が
// 唯一の出典（オーナー裁定 2026-07-21 §8-3）。読めない場合だけ、この最小フォールバックを使う。
const TASK_LABEL_KEYS = {
  'transcribe-captions': 'transcribeCaptions',
  'silence-cut': 'silenceCut',
  'bgm-sfx': 'bgmSfx',
  narration: 'narration',
  '3d-inserts': 'inserts3d',
};

function localizedLabels(labels) {
  if (cliLanguage() === 'ja') return labels;
  return Object.fromEntries(Object.keys(labels).map((id) => [id, TASK_LABEL_KEYS[id]
    ? cliText(`cli.intake.task.${TASK_LABEL_KEYS[id]}`) : id]));
}

export function loadTaskLabels(schemasSourceDir) {
  if (schemasSourceDir) {
    const schemaPath = path.join(schemasSourceDir, 'intake.schema.json');
    if (existsSync(schemaPath)) {
      try {
        const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
        const labels = schema?.['x-akari-labels'];
        if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
          return localizedLabels(labels);
        }
      } catch {
        // 破損している場合はフォールバックへ。
      }
    }
  }
  return Object.fromEntries(Object.entries(TASK_LABEL_KEYS).map(([id, key]) => [id, cliText(`cli.intake.task.${key}`)]));
}
