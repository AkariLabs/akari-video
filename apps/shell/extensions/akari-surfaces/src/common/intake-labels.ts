import { t } from '@akari-video/i18n';
/**
 * 進め方フォーム（intake サーフェス）の表示ラベル定数。
 *
 * 表示語の正典は `packages/schemas/intake.schema.json` の
 * `x-akari-labels`（tasks）と `x-akari-autonomy-labels`（autonomy）。
 * このファイルは手動ミラーであり、表示語の変更時は両方を更新する。
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
    'transcribe-captions': t('surfaces.intake.transcriptionTextOverlay.label'),
    'silence-cut': t('surfaces.intake.unnecessaryNgCuts.label'),
    'bgm-sfx': t('surfaces.intake.bgmSoundEffects.label'),
    narration: t('surfaces.intake.narrationOwnVoiceReadyMadeVoice.label'),
    '3d-inserts': t('surfaces.intake.threeDimensionalInset.label')
};

/** モックの説明文（`<small>`）。schema には無い UI コピーなのでここが正。 */
export const INTAKE_TASK_DESCRIPTIONS: Readonly<Record<IntakeTaskId, string>> = {
    'transcribe-captions': t('surfaces.intake.automaticallyConvertSayCaptionsAdjustJapaneseCushions.label'),
    'silence-cut': t('surfaces.intake.detectsFillsSilenceRestatementsCutPositionAdjusted.label'),
    'bgm-sfx': t('surfaces.intake.chooseSongLibraryFitsMoodAutomaticallyLowers.label'),
    narration: t('surfaces.intake.generateAudioManuscriptAlsoCloneOwnVoice.label'),
    '3d-inserts': t('surfaces.intake.shotsFitImagesOntoSmartphonePcScreens.label')
};

/** 既定でチェック済みにする 2 件（モックの初期状態）。 */
export const INTAKE_TASK_DEFAULTS: readonly IntakeTaskId[] = ['transcribe-captions', 'silence-cut'];

export type IntakeDurationChoice = '15' | '30' | '60' | '180' | 'keep';

export const INTAKE_DURATION_LABELS: Readonly<Record<IntakeDurationChoice, string>> = {
    '15': t('surfaces.intake.fifteenSeconds.option'),
    '30': t('surfaces.intake.thirtySeconds.option'),
    '60': t('surfaces.intake.sixtySeconds.option'),
    '180': t('surfaces.intake.upMinutes.label'),
    keep: t('surfaces.intake.leaveWithoutCutting.label')
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
    'full-auto': t('surfaces.intake.fullauto.label'),
    checkpoint: t('surfaces.intake.suggestions.label'),
    collaborative: t('surfaces.intake.makeTogether.label')
};

export const INTAKE_AUTONOMY_DESCRIPTIONS: Readonly<Record<IntakeAutonomy, string>> = {
    'full-auto': t('surfaces.intake.followInstructionsExactlyExportWithoutReview.label'),
    checkpoint: t('surfaces.intake.includePromisingOptionsReviewRemoveNeedReview.label'),
    collaborative: t('surfaces.intake.checkKeyPointsPolicyAssetsImplementation.label')
};

export const INTAKE_AUTONOMY_ORDER: readonly IntakeAutonomy[] = ['full-auto', 'checkpoint', 'collaborative'];

export const INTAKE_DEFAULT_AUTONOMY: IntakeAutonomy = 'checkpoint';
