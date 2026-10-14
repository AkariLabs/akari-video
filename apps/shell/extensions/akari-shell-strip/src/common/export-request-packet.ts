import { t } from './shell-text';
/**
 * 「書き出し」ボタンの設定ダイアログが確定した値から、パートナーへ注入する
 * 依頼パケットを組み立てる純関数。task.md に一字一句固定の文言があるため、
 * akari-project の agent-context-packet.ts（【targetKind】主語（詳細）について:
 * 依頼文 という汎用形）とは別の専用テンプレートとして持つ（フィールド構造が
 * 合わないため流用しない）。
 */

export interface ExportResolutionPreset {
    id: string;
    label: string;
}

export const EXPORT_RESOLUTION_PRESETS: readonly ExportResolutionPreset[] = [
    { id: 'landscape-1080p', label: t('shell.export.request.value1080pLandscapeLabel') },
    { id: 'portrait-1080p', label: t('shell.export.request.value1080pPortraitLabel') },
    { id: 'square-1080p', label: t('shell.export.request.squareLabel') }
];

export const DEFAULT_EXPORT_OUTPUT_NAME = 'final.mp4';

export function defaultExportOutputNameForCodec(codec: 'h264' | 'hevc' | 'prores422' | 'png'): string {
    if (codec === 'prores422') return 'final.mov';
    if (codec === 'png') return 'final';
    return DEFAULT_EXPORT_OUTPUT_NAME;
}

export interface ExportRequestSettings {
    resolutionLabel: string;
    outputName: string;
    rerunLint: boolean;
}

export function composeExportRequestPacket(settings: ExportRequestSettings): string {
    const lintLabel = settings.rerunLint ? t('shell.export.request.yesLabel') : t('shell.export.request.noLabel');
    return t('shell.export.request.exportRequestExportEditJsonUsingRenderCutSkillMessage')
        + t('shell.export.request.settingsResolutionOutputNameRerunLintText', { value1: settings.resolutionLabel, value2: settings.outputName, value3: lintLabel })
        + `。`
        + t('shell.export.request.userConfirmedSettingsExportDialogExplicitApprovalGivenNoNeedMessage')
        + t('shell.export.request.keepWritingProgressAkariRenderJsonMessage');
}
