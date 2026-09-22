import { buildExportEncoderChoices, ExportEncoder, ExportPlatform } from 'akari-shell-strip/lib/common/export-encoder-choices';

// ナビの順（2026-09-22 設定ダイアログ刷新）。Akari アカウントを先頭に置き、テーマは開発者モードから外観へ移した。
// icon は browser/settings/settings-icons.ts の線画 SVG の名前（絵文字・記号文字は使わない）。
export const SETTINGS_SECTIONS = [
    { id: 'account', label: 'Akari アカウント', group: 'main', icon: 'user' },
    { id: 'start', label: 'はじめかた', group: 'main', icon: 'play' },
    { id: 'export', label: '書き出し', group: 'main', icon: 'download' },
    { id: 'appearance', label: '外観', group: 'main', icon: 'contrast' },
    { id: 'connections', label: '接続と API キー', group: 'main', icon: 'key' },
    { id: 'transcribe', label: '文字起こし', group: 'main', icon: 'mic' },
    { id: 'quality', label: 'プレビュー品質', group: 'main', icon: 'gauge' },
    { id: 'notifications', label: '通知', group: 'main', icon: 'bell' },
    { id: 'tools', label: '道具', group: 'main', icon: 'wrench' },
    { id: 'developer', label: '開発者モード', group: 'developer', icon: 'code' }
] as const;

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];

export const SETTINGS_SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
    account: 'AKARI Store の接続と、購入した素材の受け取りをここで管理します。',
    start: '初回セットアップで動画づくりの準備を進めます。',
    export: '書き出しの画質・形式・フレームレートと保存先の既定値を選びます。',
    appearance: 'アプリの色を選びます。',
    connections: '外部サービスの接続と API キーを管理します。生成の既定モデル（静止画・動画）もここで選びます。',
    transcribe: '文字起こしのモードとエンジンを選びます。',
    quality: 'プレビューの描き方を選びます。',
    notifications: 'AI パートナーの処理が終わったときの通知を設定します。',
    tools: '動画づくりに必要な道具の状態を確認し、セットアップします。',
    developer: '開発者向けの表示を設定します。'
};

/** プレビュー品質の節に小さく出す注記（値を読む機能がまだ無いことを隠さない）。 */
export const QUALITY_TIER_RESERVED_NOTE = '今はこの値を読む機能がありません（AI 生成の品質段階として予約）';

export const SETTINGS_LAST_SECTION_KEY = 'akari.settings.lastSection';

export function initialSettingsSection(explicit: unknown, stored: unknown): SettingsSectionId {
    return resolveSettingsSectionId(explicit) ?? resolveSettingsSectionId(stored) ?? SETTINGS_SECTIONS[0].id;
}

export function isSettingsSectionVisible(id: SettingsSectionId, selected: SettingsSectionId): boolean {
    return id === selected;
}

// スキーマは browser/akari-preferences.ts が所有。純関数側は文字列ミラー。
export const AKARI_QUALITY_TIER = 'akari.qualityTier';
export const AKARI_TIMELINE_VISUAL_THUMBNAILS = 'akari.timeline.visualThumbnails';
export const AKARI_DEVELOPER_MODE = 'akari.developerMode';
export const AKARI_AGENT_TURN_END_NOTIFICATION = 'akari.notifications.agentTurnEnd';
export const AKARI_TRANSCRIBE_MODE = 'akari.transcribe.mode';
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
// カタログのスキーマは akari-project/akari-project-frontend-module.ts が所有。設定キーは文字列ミラー。
export const AKARI_CATALOG_ROOT = 'akari.catalog.root';

export const SECTION_PREFERENCE_KEYS: Record<SettingsSectionId, readonly string[]> = {
    account: [], // AKARI Store は PreferenceService ではなく Store の接続フローが所有する。
    start: [],
    export: [AKARI_EXPORT_QUALITY, AKARI_EXPORT_ENCODER, AKARI_EXPORT_CODEC, AKARI_EXPORT_FPS, AKARI_EXPORT_OUTPUT_DIRECTORY],
    appearance: [WORKBENCH_COLOR_THEME],
    connections: [], // API キーは PreferenceService ではなく接続サービスが所有する。
    transcribe: [AKARI_TRANSCRIBE_MODE, AKARI_TRANSCRIBE_BACKEND, AKARI_TRANSCRIBE_COMPARE_SET, AKARI_TRANSCRIBE_AUTO_CUTS],
    quality: [AKARI_QUALITY_TIER, AKARI_TIMELINE_VISUAL_THUMBNAILS],
    notifications: [AKARI_AGENT_TURN_END_NOTIFICATION],
    tools: [AKARI_CATALOG_ROOT],
    developer: [AKARI_DEVELOPER_MODE]
};

export function sectionForPreferenceKey(key: string): SettingsSectionId | undefined {
    const section = SETTINGS_SECTIONS.find(item => SECTION_PREFERENCE_KEYS[item.id].includes(key));
    if (section) { return section.id; }
    if (key.startsWith('akari.transcribe.')) { return 'transcribe'; }
    if (key.startsWith('akari.export.')) { return 'export'; }
    return undefined;
}

/**
 * `akari.settings.open` の引数（`'export'` / `{ section: 'export' }`）を節 id へ解決する。
 * テーマは開発者モードから外観へ移したので、旧 id `developer` でテーマを指して来た場合
 * （`{ section: 'developer', preference: 'workbench.colorTheme' }`）は外観へ寄せる。
 */
export function resolveSettingsSectionId(argument: unknown): SettingsSectionId | undefined {
    const record = typeof argument === 'object' && argument !== null ? argument as { section?: unknown; preference?: unknown } : undefined;
    const id = record && 'section' in record ? record.section : argument;
    const section = SETTINGS_SECTIONS.find(item => item.id === id)?.id;
    if (section === 'developer' && typeof record?.preference === 'string') {
        return sectionForPreferenceKey(record.preference) ?? section;
    }
    return section;
}

export function settingsSectionElementId(id: SettingsSectionId): string {
    return `akari-settings-${id}`;
}

// 選択肢の並びは画面の並び（カード・セグメントの左から）。description は選択カード・ドロップダウンの一言。
export const QUALITY_TIER_CHOICES = [
    { value: 'draft', label: 'Draft', description: '速い確認用', icon: 'bolt' },
    { value: 'final', label: 'Final', description: '最終品質', icon: 'gem' }
] as const;
// 「システムに合わせる」は出さない: Theia 1.73 は OS の配色への追従（window.autoDetectColorScheme）を
// 実装しておらず、起動前の既定を決めるだけなので、選んでも切り替わらない選択肢になる。
export const THEME_CHOICES = [{ value: 'dark', label: 'ダーク' }, { value: 'light', label: 'ライト' }] as const;
export const EXPORT_QUALITY_CHOICES = [
    { value: 'light', label: '軽量', description: '共有・確認向け' },
    { value: 'standard', label: '標準', description: 'ふだんの投稿' },
    { value: 'high', label: '高画質', description: '大きい画面向け' },
    { value: 'master', label: 'マスター', description: '再編集・保管用' }
] as const;
export const EXPORT_CODEC_CHOICES = [
    { value: 'h264', label: 'MP4 · H.264', description: 'どこでも再生できる' },
    { value: 'hevc', label: 'MP4 · H.265（HEVC）', description: '同じ画質で軽い' },
    { value: 'prores422', label: 'MOV · ProRes 422 HQ', description: '編集ソフトへ渡す' },
    { value: 'png', label: '連番 PNG', description: '1 コマずつ画像で' }
] as const;
export const EXPORT_FPS_CHOICES = [
    { value: '', label: '編集データ' },
    { value: '24', label: '24' }, { value: '30', label: '30' }, { value: '60', label: '60' }
] as const;
export const TRANSCRIBE_MODE_CHOICES = [
    { value: 'simple', label: '簡単', description: 'おまかせで 1 回。ふだんはこれ', icon: 'spark' },
    { value: 'advanced', label: 'アドバンス', description: 'エンジンの比較・カット候補の自動作成', icon: 'sliders' }
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
