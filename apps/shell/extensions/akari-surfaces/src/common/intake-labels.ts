/**
 * 進め方フォーム（intake サーフェス）の表示ラベル定数。
 *
 * 単一の正典は `packages/schemas/intake.schema.json` の `x-akari-labels`
 * （安定 ID ↔ 日本語ラベル）。このファイルはその内容の手動ミラーであり、
 * 二重の「判定ロジック」ではなく単なる表示文字列の複製である
 * （`packages/schemas/**` は本タスクの編集境界外のため、ビルド時 import で
 * 参照する構成は採らなかった。ラベルが増減した場合はスキーマ側と
 * このファイルの両方を更新する必要がある — 既知の制約として report に記載）。
 */

export type IntakeTaskId =
    | 'transcribe-captions'
    | 'silence-cut'
    | 'bgm-sfx'
    | 'narration'
    | '3d-inserts';

/** フォーム表示順（正本モック `mock-2026-07-21-shell-home-chat-first.html` の順）。 */
export const INTAKE_TASK_IDS: readonly IntakeTaskId[] = [
    'transcribe-captions',
    'silence-cut',
    'bgm-sfx',
    'narration',
    '3d-inserts'
];

export const INTAKE_TASK_LABELS: Readonly<Record<IntakeTaskId, string>> = {
    'transcribe-captions': '文字起こし・テロップ',
    'silence-cut': 'いらない間・NG のカット',
    'bgm-sfx': 'BGM・効果音',
    narration: 'ナレーション（自分の声 / 既製の声）',
    '3d-inserts': '3D・画面はめ込みの演出'
};

/** モックの説明文（`<small>`）。schema には無い UI コピーなのでここが正。 */
export const INTAKE_TASK_DESCRIPTIONS: Readonly<Record<IntakeTaskId, string>> = {
    'transcribe-captions': '話した内容を自動で字幕に。日本語の座布団・改行も整える',
    'silence-cut': '無音・言い直しを検出して詰める。カット位置は後から直せる',
    'bgm-sfx': 'ライブラリから雰囲気に合う曲を。ナレーション中は自動で音量ダウン',
    narration: '原稿から音声を生成。自分の声のクローンも使える',
    '3d-inserts': 'スマホや PC の画面に映像をはめ込むショットなど'
};

/** 既定でチェック済みにする 2 件（モックの初期状態）。 */
export const INTAKE_TASK_DEFAULTS: readonly IntakeTaskId[] = ['transcribe-captions', 'silence-cut'];

export type IntakeDurationChoice = '15' | '30' | '60' | '180' | 'keep';

export const INTAKE_DURATION_LABELS: Readonly<Record<IntakeDurationChoice, string>> = {
    '15': '15 秒',
    '30': '30 秒',
    '60': '60 秒',
    '180': '3 分まで',
    keep: '切らずにそのまま'
};

export const INTAKE_DURATION_ORDER: readonly IntakeDurationChoice[] = ['15', '30', '60', '180', 'keep'];

export const INTAKE_DEFAULT_DURATION: IntakeDurationChoice = '30';

export function durationChoiceToTarget(choice: IntakeDurationChoice): { duration_s: number | null; keep_length: boolean } {
    if (choice === 'keep') {
        return { duration_s: null, keep_length: true };
    }
    return { duration_s: Number(choice), keep_length: false };
}

export type IntakeAutonomy = 'full-auto' | 'checkpoint' | 'collaborative';

export const INTAKE_AUTONOMY_LABELS: Readonly<Record<IntakeAutonomy, string>> = {
    'full-auto': '全部おまかせ',
    checkpoint: '要所で確認してほしい',
    collaborative: '一緒に細かく決めたい'
};

export const INTAKE_AUTONOMY_ORDER: readonly IntakeAutonomy[] = ['full-auto', 'checkpoint', 'collaborative'];

export const INTAKE_DEFAULT_AUTONOMY: IntakeAutonomy = 'checkpoint';
