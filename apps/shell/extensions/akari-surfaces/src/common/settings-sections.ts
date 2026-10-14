import { t } from '@akari-video/i18n';
import { buildExportEncoderChoices, ExportEncoder, ExportPlatform } from 'akari-shell-strip/lib/common/export-encoder-choices';

// 節の定義。左のナビは SETTINGS_PILLARS の六つにまとめる。
// icon は browser/settings/settings-icons.ts の線画 SVG の名前（絵文字・記号文字は使わない）。
export const SETTINGS_SECTIONS = [
    { id: 'account', label: t('surfaces.settings.akariAccount.label'), group: 'main', icon: 'user' },
    { id: 'start', label: t('surfaces.settings.getStarted.label'), group: 'main', icon: 'play' },
    { id: 'export', label: t('surfaces.settings.export.label'), group: 'main', icon: 'download' },
    { id: 'appearance', label: t('surfaces.settings.appearance.label'), group: 'main', icon: 'contrast' },
    { id: 'connections', label: t('surfaces.settings.connectionApiKey.label'), group: 'main', icon: 'key' },
    { id: 'ai-models', label: t('surfaces.settings.aiModel.label'), group: 'main', icon: 'spark' },
    { id: 'partner', label: t('surfaces.settings.sectionPartner.label'), group: 'main', icon: 'bot' },
    { id: 'transcribe', label: t('surfaces.settings.transcription.label'), group: 'main', icon: 'mic' },
    { id: 'listening', label: t('surfaces.settings.hearing.label'), group: 'main', icon: 'mic' },
    { id: 'narration', label: t('surfaces.settings.narration.label'), group: 'main', icon: 'mic' },
    { id: 'quality', label: t('surfaces.settings.previewQuality.label'), group: 'main', icon: 'gauge' },
    { id: 'notifications', label: t('surfaces.settings.notification.label'), group: 'main', icon: 'bell' },
    { id: 'tools', label: t('surfaces.settings.tools.label'), group: 'main', icon: 'wrench' },
    { id: 'shortcuts', label: t('surfaces.settings.shortcut.label'), group: 'main', icon: 'keyboard' },
    { id: 'storage', label: t('surfaces.settings.storage.label'), group: 'data', icon: 'disk' },
    { id: 'privacy', label: t('surfaces.settings.privacyPermissions.label'), group: 'data', icon: 'shield' },
    { id: 'statistics', label: t('surfaces.settings.statisticsUsage.label'), group: 'data', icon: 'chart', badge: t('surfaces.settings.navigationComingSoon.label') },
    { id: 'help', label: t('surfaces.settings.trouble.label'), group: 'support', icon: 'help' },
    { id: 'about', label: t('surfaces.settings.app.label'), group: 'support', icon: 'info' },
    { id: 'developer', label: t('surfaces.settings.developerMode.label'), group: 'developer', icon: 'code' }
] as const;

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];

export const SETTINGS_PILLARS = [
    { id: 'general', label: t('surfaces.settingsSections.ui.generalLabel'), icon: 'user', sections: ['account', 'start', 'developer', 'help', 'about'] },
    { id: 'partner', label: t('surfaces.settingsSections.ui.partnerLabel'), icon: 'bot', sections: ['partner'] },
    { id: 'connect', label: t('surfaces.settingsSections.ui.connectLabel'), icon: 'key', sections: ['connections', 'ai-models', 'narration', 'transcribe', 'listening', 'export'] },
    { id: 'workflow', label: t('surfaces.settingsSections.ui.workflowLimitsLabel'), icon: 'gauge', sections: ['quality', 'notifications', 'tools', 'statistics'] },
    { id: 'display', label: t('surfaces.settingsSections.ui.displayLabel'), icon: 'contrast', sections: ['appearance', 'shortcuts'] },
    { id: 'data', label: t('surfaces.settingsSections.ui.dataLocationsLabel'), icon: 'disk', sections: ['storage', 'privacy'] }
] as const;
export type SettingsPillarId = typeof SETTINGS_PILLARS[number]['id'];
export function settingsPillarForSection(section: SettingsSectionId): SettingsPillarId {
    return SETTINGS_PILLARS.find(pillar => (pillar.sections as readonly string[]).includes(section))?.id ?? 'general';
}
export function defaultSectionForPillar(pillar: SettingsPillarId): SettingsSectionId {
    return SETTINGS_PILLARS.find(item => item.id === pillar)!.sections[0] as SettingsSectionId;
}

export function sectionsForPillar(pillar: SettingsPillarId, vibePreviewEnabled: boolean): SettingsSectionId[] {
    return SETTINGS_PILLARS.find(item => item.id === pillar)!.sections
        .filter(id => vibePreviewEnabled || id !== 'listening') as SettingsSectionId[];
}

/** 見出しの上端から、ページ上端に最も近い節を選ぶ。末尾では最後の節を選ぶ。 */
export function activeSettingsSection(ids: readonly SettingsSectionId[], headingTops: readonly number[], atBottom: boolean): SettingsSectionId | undefined {
    if (!ids.length) return undefined;
    if (atBottom) return ids[ids.length - 1];
    let active = 0;
    for (let index = 0; index < ids.length; index++) {
        if (headingTops[index] <= 48) active = index;
        else break;
    }
    return ids[active];
}

export const SETTINGS_SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
    account: t('surfaces.settings.manageAkariAccountConnectionReceiptPurchasedAssets.message'),
    start: t('surfaces.settings.startFirstGuidePrepareToolsWorkspace.message'),
    export: t('surfaces.settings.selectExportQualityFormatFrameRateDefault.message'),
    appearance: t('surfaces.settings.colorLanguageSizeDisplayBarBelow.message'),
    partner: t('surfaces.settings.aiWorkCliOfficialExtensionPartnersExtensions.message'),
    storage: t('surfaces.settings.amountDiskAkariOpenRowSeeLocation.message'),
    privacy: t('surfaces.settings.macosPermissionsSendOutPartnersLaunchedTerminal.message'),
    statistics: t('surfaces.settings.muchConnectedServices.message'),
    help: t('surfaces.settings.toolThingsDontWorkProperlyReportingProblem.message'),
    about: t('surfaces.settings.versionsUpdates.message'),
    connections: t('surfaces.settings.manageConnectionsApiKeysExternalServicesAlso.message'),
    'ai-models': t('surfaces.settings.searchModelsChooseFavoriteUsualModelsCompare.message'),
    transcribe: t('surfaces.settings.selectTranscriptionEngine.message'),
    listening: t('surfaces.settings.settingsPersonSpeakingMicrophoneSelectTrialListening.message'),
    narration: t('surfaces.settings.installStartNarrationEnginesSetDefaultEngine.message'),
    quality: t('surfaces.settings.selectDrawPreview.message'),
    notifications: t('surfaces.settings.setUpNotificationsAiPartnerFinishedProcessing.message'),
    tools: t('surfaces.settings.checkConditionToolsNecessaryMakingVideosSet.message'),
    shortcuts: t('surfaces.settings.changePressingKeyDisableRestoreDefaultMenu.message'),
    developer: t('surfaces.settings.setDisplayDevelopers.message')
};

/** プレビュー品質の節に小さく出す注記（値を読む機能がまだ無いことを隠さない）。 */
export const QUALITY_TIER_RESERVED_NOTE = t('surfaces.settings.currentlyNoAbilityReadValueReservedQuality.label');

export const SETTINGS_LAST_SECTION_KEY = 'akari.settings.lastSection';

/** SETTINGS_SECTIONS の定義・順は変えず、表示するナビだけを絞る。 */
export function visibleSettingsSections(vibePreviewEnabled: boolean): readonly typeof SETTINGS_SECTIONS[number][] {
    return vibePreviewEnabled ? SETTINGS_SECTIONS : SETTINGS_SECTIONS.filter(section => section.id !== 'listening');
}

export function initialSettingsSection(explicit: unknown, stored: unknown): SettingsSectionId {
    return resolveSettingsSectionId(explicit) ?? resolveSettingsSectionId(stored) ?? SETTINGS_SECTIONS[0].id;
}

export function isSettingsSectionVisible(id: SettingsSectionId, selected: SettingsSectionId): boolean {
    return id === selected;
}

// スキーマは browser/akari-preferences.ts が所有。純関数側は文字列ミラー。
export const AKARI_QUALITY_TIER = 'akari.qualityTier';
export const AKARI_PREVIEW_SCRUB_AUDIO = 'akari.preview.scrubAudio';
export const AKARI_TIMELINE_VISUAL_THUMBNAILS = 'akari.timeline.visualThumbnails';
export const AKARI_TIMELINE_TRACK_RIPPLE_DISPLAY = 'akari.timeline.trackRippleDisplay';
export const AKARI_DEVELOPER_MODE = 'akari.developerMode';
export const AKARI_VIBE_PREVIEW_ENABLED = 'akari.vibePreview.enabled';
export const AKARI_AGENT_TURN_END_NOTIFICATION = 'akari.notifications.agentTurnEnd';
export const AKARI_TRANSCRIBE_BACKEND = 'akari.transcribe.backend';
export const AKARI_TRANSCRIBE_COMPARE_SET = 'akari.transcribe.compareSet';
export const AKARI_TRANSCRIBE_AUTO_CUTS = 'akari.transcribe.autoCuts';
export const AKARI_NARRATION_ENGINE = 'akari.narration.engine';
export const AKARI_NARRATION_VOICE = 'akari.narration.voice';
export const AKARI_NARRATION_IRODORI_URL = 'akari.narration.irodoriUrl';
export function isValidIrodoriUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
            && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
}
// テーマのスキーマは Theia、書き出しは akari-shell-strip/akari-export-preferences.ts が所有。
// 設定キーは文字列ミラー、OS ごとのエンコーダ選択肢は所有拡張から共有する。
export const WORKBENCH_COLOR_THEME = 'workbench.colorTheme';
export const AKARI_EXPORT_QUALITY = 'akari.export.quality';
export const AKARI_EXPORT_ENCODER = 'akari.export.encoder';
export const AKARI_EXPORT_CODEC = 'akari.export.codec';
export const AKARI_EXPORT_FPS = 'akari.export.fps';
export const AKARI_EXPORT_OUTPUT_DIRECTORY = 'akari.export.outputDirectory';
export const AKARI_EXPORT_GPU_PREFERENCE_CONSENT = 'akari.export.temporaryGpuPreference';
export function showTemporaryGpuPreferenceSetting(platform: string): boolean {
    return platform === 'win32';
}
export const AKARI_EXPORT_FILENAME_PATTERN = 'akari.export.fileNamePattern';
// カタログのスキーマは akari-project/akari-project-frontend-module.ts が所有。設定キーは文字列ミラー。
export const AKARI_CATALOG_ROOT = 'akari.catalog.root';
export const AKARI_APPEARANCE_THEME_MODE = 'akari.appearance.themeMode';
export const AKARI_APPEARANCE_ZOOM = 'akari.appearance.zoom';
export const STATUS_BAR_KEYS = {
    cpu: 'akari.statusBar.cpu', gpu: 'akari.statusBar.gpu', memory: 'akari.statusBar.memory',
    disk: 'akari.statusBar.disk', running: 'akari.statusBar.running',
    intervalSec: 'akari.statusBar.intervalSec', accountBalance: 'akari.statusBar.accountBalance'
} as const;
export const AKARI_PARTNER_REOPEN = 'akari.partner.reopenLast';
export const AKARI_CHAT_EXPERIMENTAL_ENABLED = 'akari.chat.experimental.enabled';
export const AKARI_PARTNER_PERMISSION_MODE = 'akari.partner.permissionMode';

export const SECTION_PREFERENCE_KEYS: Record<SettingsSectionId, readonly string[]> = {
    account: [], // AKARI Store は PreferenceService ではなく Store の接続フローが所有する。
    start: [],
    export: [AKARI_EXPORT_QUALITY, AKARI_EXPORT_ENCODER, AKARI_EXPORT_CODEC, AKARI_EXPORT_FPS, AKARI_EXPORT_OUTPUT_DIRECTORY,
        AKARI_EXPORT_GPU_PREFERENCE_CONSENT,
        'akari.export.openFolderAfter', 'akari.export.notifyAfter', AKARI_EXPORT_FILENAME_PATTERN],
    appearance: [WORKBENCH_COLOR_THEME, AKARI_APPEARANCE_THEME_MODE, AKARI_APPEARANCE_ZOOM, ...Object.values(STATUS_BAR_KEYS)],
    connections: [], // API キーは PreferenceService ではなく接続サービスが所有する。
    'ai-models': [],
    partner: [AKARI_PARTNER_REOPEN, AKARI_CHAT_EXPERIMENTAL_ENABLED, AKARI_PARTNER_PERMISSION_MODE],
    transcribe: [AKARI_TRANSCRIBE_BACKEND, AKARI_TRANSCRIBE_COMPARE_SET, AKARI_TRANSCRIBE_AUTO_CUTS],
    listening: ['akari.listening.engine', 'akari.vibe.mode'],
    narration: [AKARI_NARRATION_ENGINE, AKARI_NARRATION_VOICE, AKARI_NARRATION_IRODORI_URL],
    quality: [AKARI_QUALITY_TIER, AKARI_TIMELINE_VISUAL_THUMBNAILS, AKARI_TIMELINE_TRACK_RIPPLE_DISPLAY, AKARI_PREVIEW_SCRUB_AUDIO],
    notifications: [AKARI_AGENT_TURN_END_NOTIFICATION],
    tools: [AKARI_CATALOG_ROOT],
    shortcuts: [],
    storage: [], privacy: [], statistics: [], help: [], about: [],
    developer: [AKARI_DEVELOPER_MODE, AKARI_VIBE_PREVIEW_ENABLED]
};

export function sectionForPreferenceKey(key: string): SettingsSectionId | undefined {
    const section = SETTINGS_SECTIONS.find(item => SECTION_PREFERENCE_KEYS[item.id].includes(key));
    if (section) { return section.id; }
    if (key.startsWith('akari.transcribe.')) { return 'transcribe'; }
    if (key.startsWith('akari.listening.')) { return 'listening'; }
    if (key.startsWith('akari.narration.')) { return 'narration'; }
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
    const section = SETTINGS_SECTIONS.find(item => item.id === id)?.id ??
        SETTINGS_PILLARS.find(item => item.id === id)?.sections[0] as SettingsSectionId | undefined;
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
    { value: 'draft', label: 'Draft', description: t('surfaces.settings.quickConfirmation.description'), icon: 'bolt' },
    { value: 'final', label: 'Final', description: t('surfaces.settings.finalQuality.description'), icon: 'gem' }
] as const;
export const THEME_CHOICES = [{ value: 'dark', label: t('surfaces.settings.dark.label') }, { value: 'light', label: t('surfaces.settings.light.label') }, { value: 'system', label: t('surfaces.settings.fitSystem.label') }] as const;
export function clampZoom(value: number): number { return Math.min(200, Math.max(60, Math.round(value / 10) * 10)); }
export function matchesSettingsSearch(query: string, label: string, description: string, rows: readonly string[]): boolean {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || [label, description, ...rows].some(value => value.toLocaleLowerCase().includes(needle));
}
/** フィードの公開日を、そのフィードで記された暦日のまま短く表示する。 */
export function formatShortReleaseDate(value: unknown): string {
    if (typeof value !== 'string') { return ''; }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) { return ''; }
    const month = Number(match[2]); const day = Number(match[3]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${month}/${day}` : '';
}
export const EXPORT_QUALITY_CHOICES = [
    { value: 'light', label: t('surfaces.settings.lightweight.label'), description: t('surfaces.settings.sharingConfirmation.description') },
    { value: 'standard', label: t('surfaces.settings.standard.label'), description: t('surfaces.settings.usualPosts.description') },
    { value: 'high', label: t('surfaces.settings.highQuality.label'), description: t('surfaces.settings.largeScreens.description') },
    { value: 'master', label: t('surfaces.settings.master.label'), description: t('surfaces.settings.reEditingStoring.description') }
] as const;
export const EXPORT_CODEC_CHOICES = [
    { value: 'h264', label: 'MP4 · H.264', description: t('surfaces.settings.playedAnywhere.description') },
    { value: 'hevc', label: 'MP4 · H.265（HEVC）', description: t('surfaces.settings.sameImageQualityLighterWeight.description') },
    { value: 'prores422', label: 'MOV · ProRes 422 HQ', description: t('surfaces.settings.passEditingSoftware.description') },
    { value: 'png', label: t('surfaces.settings.serialNumberPng.label'), description: t('surfaces.settings.oneImageTime.description') }
] as const;
export const EXPORT_FPS_CHOICES = [
    { value: '', label: t('surfaces.settings.editData.label') },
    { value: '24', label: '24' }, { value: '30', label: '30' }, { value: '60', label: '60' }
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
