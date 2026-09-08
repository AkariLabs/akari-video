import { buildExportEncoderChoices, ExportEncoder, ExportPlatform } from 'akari-shell-strip/lib/common/export-encoder-choices';

export const SETTINGS_SECTIONS = [
    { id: 'start', label: 'はじめかた', group: 'main' },
    { id: 'export', label: '書き出し', group: 'main' },
    { id: 'quality', label: 'プレビュー品質', group: 'main' },
    { id: 'transcribe', label: '文字起こし', group: 'main' },
    { id: 'connections', label: '接続と API キー', group: 'main' },
    { id: 'notifications', label: '通知', group: 'main' },
    { id: 'tools', label: '道具', group: 'main' },
    { id: 'developer', label: '開発者モード', group: 'developer' }
] as const;

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];

export const SETTINGS_SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
    start: '初回セットアップで動画づくりの準備を進めます。',
    export: '書き出しの画質・形式・フレームレートと保存先の既定値を選びます。',
    quality: '現在はこの値を読む機能がありません（AI 生成の品質段階として予約）',
    transcribe: '文字起こしのエンジンと比較・カット候補の作り方を選びます。',
    connections: '外部サービスの接続と API キーを管理します。',
    notifications: 'AI パートナーの処理が終わったときの通知を設定します。',
    tools: '動画づくりに必要な道具の状態を確認し、セットアップします。',
    developer: '開発者向けの表示とアプリのテーマを設定します。'
};

export const SETTINGS_LAST_SECTION_KEY = 'akari.settings.lastSection';

export function initialSettingsSection(explicit: unknown, stored: unknown): SettingsSectionId {
    return resolveSettingsSectionId(explicit) ?? resolveSettingsSectionId(stored) ?? SETTINGS_SECTIONS[0].id;
}

export function isSettingsSectionVisible(id: SettingsSectionId, selected: SettingsSectionId): boolean {
    return id === selected;
}

// スキーマは browser/akari-preferences.ts が所有。純関数側は文字列ミラー。
export const AKARI_QUALITY_TIER = 'akari.qualityTier';
export const AKARI_DEVELOPER_MODE = 'akari.developerMode';
export const AKARI_AGENT_TURN_END_NOTIFICATION = 'akari.notifications.agentTurnEnd';
export const AKARI_TRANSCRIBE_BACKEND = 'akari.transcribe.backend';
export const AKARI_TRANSCRIBE_COMPARE_SET = 'akari.transcribe.compareSet';
export const AKARI_TRANSCRIBE_AUTO_CUTS = 'akari.transcribe.autoCuts';
// テーマのスキーマは Theia、書き出しは akari-shell-strip/akari-export-preferences.ts が所有。
// 設定キーは文字列ミラー、OS ごとのエンコーダ選択肢は所有拡張から共有する。
export const WORKBENCH_COLOR_THEME = 'workbench.colorTheme';
export const AKARI_EXPORT_QUALITY = 'akari.export.quality';
export const AKARI_EXPORT_ENCODER = 'akari.export.encoder';
export const AKARI_EXPORT_CODEC = 'akari.export.codec';
export const AKARI_EXPORT_FPS = 'akari.export.fps';
export const AKARI_EXPORT_OUTPUT_DIRECTORY = 'akari.export.outputDirectory';

export const SECTION_PREFERENCE_KEYS: Record<SettingsSectionId, readonly string[]> = {
    start: [],
    export: [AKARI_EXPORT_QUALITY, AKARI_EXPORT_ENCODER, AKARI_EXPORT_CODEC, AKARI_EXPORT_FPS, AKARI_EXPORT_OUTPUT_DIRECTORY],
    quality: [AKARI_QUALITY_TIER],
    transcribe: [AKARI_TRANSCRIBE_BACKEND, AKARI_TRANSCRIBE_COMPARE_SET, AKARI_TRANSCRIBE_AUTO_CUTS],
    connections: [], // AKARI Store は PreferenceService ではなく接続サービスが所有する。
    notifications: [AKARI_AGENT_TURN_END_NOTIFICATION],
    tools: [],
    developer: [AKARI_DEVELOPER_MODE, WORKBENCH_COLOR_THEME]
};

export function sectionForPreferenceKey(key: string): SettingsSectionId | undefined {
    const section = SETTINGS_SECTIONS.find(item => SECTION_PREFERENCE_KEYS[item.id].includes(key));
    if (section) { return section.id; }
    if (key.startsWith('akari.transcribe.')) { return 'transcribe'; }
    if (key.startsWith('akari.export.')) { return 'export'; }
    return undefined;
}

export function resolveSettingsSectionId(argument: unknown): SettingsSectionId | undefined {
    const id = typeof argument === 'object' && argument !== null && 'section' in argument
        ? (argument as { section: unknown }).section : argument;
    return SETTINGS_SECTIONS.find(section => section.id === id)?.id;
}

export function settingsSectionElementId(id: SettingsSectionId): string {
    return `akari-settings-${id}`;
}

export const QUALITY_TIER_CHOICES = [
    { value: 'draft', label: 'Draft — 速い確認用' },
    { value: 'final', label: 'Final — 最終品質' }
] as const;
export const THEME_CHOICES = [{ value: 'dark', label: 'ダーク' }, { value: 'light', label: 'ライト' }] as const;
export const EXPORT_QUALITY_CHOICES = [
    { value: 'standard', label: '標準' }, { value: 'high', label: '高画質' },
    { value: 'light', label: '軽量' }, { value: 'master', label: 'マスター' }
] as const;
export const EXPORT_CODEC_CHOICES = [
    { value: 'h264', label: 'MP4 · H.264' }, { value: 'hevc', label: 'MP4 · H.265（HEVC）' },
    { value: 'prores422', label: 'MOV · ProRes 422 HQ' }, { value: 'png', label: '連番 PNG' }
] as const;
export const EXPORT_FPS_CHOICES = [
    { value: '', label: '編集データに従う（既定）' },
    { value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }
] as const;

export function normalizeExportCodec(value: unknown): typeof EXPORT_CODEC_CHOICES[number]['value'] {
    return EXPORT_CODEC_CHOICES.find(choice => choice.value === value)?.value ?? 'h264';
}
export function normalizeExportFps(value: unknown): 24 | 30 | 60 | undefined {
    return value === 24 || value === 30 || value === 60 ? value : undefined;
}
export function normalizeExportEncoder(value: unknown, platform: ExportPlatform): ExportEncoder {
    return buildExportEncoderChoices(platform).find(choice => choice.value === value)?.value ?? 'auto';
}

export function normalizeQualityTier(value: unknown): 'draft' | 'final' {
    return value === 'final' ? 'final' : 'draft';
}
export function normalizeTheme(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value : 'dark';
}
export function normalizeExportQuality(value: unknown): typeof EXPORT_QUALITY_CHOICES[number]['value'] {
    return EXPORT_QUALITY_CHOICES.find(choice => choice.value === value)?.value ?? 'standard';
}
export function normalizeOutputDirectory(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
