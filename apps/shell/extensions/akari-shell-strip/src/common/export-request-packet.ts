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
    { id: 'landscape-1080p', label: '1080p 横' },
    { id: 'portrait-1080p', label: '1080p 縦' },
    { id: 'square-1080p', label: '正方形' }
];

export const DEFAULT_EXPORT_OUTPUT_NAME = 'final.mp4';

export interface ExportRequestSettings {
    resolutionLabel: string;
    outputName: string;
    rerunLint: boolean;
}

export function composeExportRequestPacket(settings: ExportRequestSettings): string {
    const lintLabel = settings.rerunLint ? 'する' : 'しない';
    return `【書き出し依頼】edit.json を render-cut スキルで書き出してください。`
        + `設定: 解像度 ${settings.resolutionLabel}・出力名 ${settings.outputName}・lint 再実行 ${lintLabel}。`
        + `ユーザーは書き出しダイアログで設定を確定済み（明示承認済み・チャット再確認不要）。`
        + `進捗を .akari/render.json に随時書き込みながら進めてください`;
}
