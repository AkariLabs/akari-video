import { buildQuickExportEncoderChoices } from './quick-export-cli';

export type ExportEncoder = 'auto' | 'videotoolbox' | 'nvenc' | 'qsv' | 'amf' | 'mf' | 'x264';
export type ExportPlatform = 'darwin' | 'win32' | 'linux';

// 既存の選択肢を正本として共有し、OS ごとの並び・表示名の二重管理を避ける。
export function buildExportEncoderChoices(platform: ExportPlatform): ReadonlyArray<{ label: string; value: ExportEncoder }> {
    return buildQuickExportEncoderChoices(platform);
}

export function exportEncoderValues(): readonly ExportEncoder[] {
    const platforms: readonly ExportPlatform[] = ['darwin', 'win32', 'linux'];
    return [...new Set(platforms.flatMap(platform => buildExportEncoderChoices(platform).map(choice => choice.value)))];
}
