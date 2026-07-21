import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// packages/schemas/intake.schema.json の x-akari-labels（安定 ID ↔ 日本語ラベル）が
// 唯一の出典（オーナー裁定 2026-07-21 §8-3）。読めない場合だけ、この最小フォールバックを使う。
const FALLBACK_LABELS = {
  'transcribe-captions': '文字起こし・テロップ',
  'silence-cut': 'いらない間・NG のカット',
  'bgm-sfx': 'BGM・効果音',
  narration: 'ナレーション（自分の声 / 既製の声）',
  '3d-inserts': '3D・画面はめ込みの演出'
};

export function loadTaskLabels(schemasSourceDir) {
  if (schemasSourceDir) {
    const schemaPath = path.join(schemasSourceDir, 'intake.schema.json');
    if (existsSync(schemaPath)) {
      try {
        const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
        const labels = schema?.['x-akari-labels'];
        if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
          return labels;
        }
      } catch {
        // 破損している場合はフォールバックへ。
      }
    }
  }
  return FALLBACK_LABELS;
}
