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

// スキーマは browser/akari-preferences.ts が所有。純関数側は文字列ミラー。
export const AKARI_QUALITY_TIER = 'akari.qualityTier';
export const AKARI_DEVELOPER_MODE = 'akari.developerMode';
export const AKARI_AGENT_TURN_END_NOTIFICATION = 'akari.notifications.agentTurnEnd';
export const AKARI_TRANSCRIBE_BACKEND = 'akari.transcribe.backend';
export const AKARI_TRANSCRIBE_COMPARE_SET = 'akari.transcribe.compareSet';
export const AKARI_TRANSCRIBE_AUTO_CUTS = 'akari.transcribe.autoCuts';
// テーマのスキーマは Theia、書き出しは akari-shell-strip/akari-export-preferences.ts が所有。
// 拡張間の依存を増やさず、設定ダイアログでは文字列ミラーを使う。
export const WORKBENCH_COLOR_THEME = 'workbench.colorTheme';
export const AKARI_EXPORT_QUALITY = 'akari.export.quality';
export const AKARI_EXPORT_ENCODER = 'akari.export.encoder';
export const AKARI_EXPORT_OUTPUT_DIRECTORY = 'akari.export.outputDirectory';

export const SECTION_PREFERENCE_KEYS: Record<SettingsSectionId, readonly string[]> = {
    start: [],
    export: [AKARI_EXPORT_QUALITY, AKARI_EXPORT_ENCODER, AKARI_EXPORT_OUTPUT_DIRECTORY],
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

/** Recompute from current geometry after every resize; clamping also makes short
 * end sections settle without repeatedly trying an unreachable scroll position. */
export function settingsSectionScrollTop(layout: {
    scrollTop: number; sectionTop: number; viewportTop: number; maxScrollTop: number;
}): number | undefined {
    const top = Math.max(0, Math.min(Math.max(0, layout.maxScrollTop),
        layout.scrollTop + layout.sectionTop - layout.viewportTop));
    return Math.abs(top - layout.scrollTop) < 1 ? undefined : top;
}
