import { pluralCountForDisplay } from '../common/plural-display-count';
import { deriveStoreLabBaseUrl } from 'akari-project/lib/common/asset-catalog-view';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { AkariLibraryStatus, AkariNewProjectService, AkariToolCheckResult, AkariToolId } from '../common/akari-new-project-protocol';
import { AkariFirstRunSetupDialog } from './akari-first-run-setup-dialog';
import { extractCliVersion } from 'akari-partner/lib/common/partner-cli-freshness';
import { AKARI_APP_ICON } from './settings/app-icon';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractDialog, ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { ApplicationShell, CommonCommands, WebSocketConnectionProvider, WidgetManager } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { PluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { OS } from '@theia/core/lib/common/os';
import { buildExportEncoderChoices, ExportEncoder } from 'akari-shell-strip/lib/common/export-encoder-choices';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { nls } from '@theia/core/lib/common/nls';
import { t, normalizeLanguage, formatDate } from '@akari-video/i18n';
import { StopReason } from '@theia/core/lib/common/frontend-application-state';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandContribution, CommandRegistry, CommandService, Disposable, MessageService } from '@theia/core/lib/common';
import { findSettingsSectionBody, mountSettingsSectionBody } from '../common/settings-section-body';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { KeymapsService } from '@theia/keymaps/lib/browser/keymaps-service';
import { KeyboardLayoutService } from '@theia/core/lib/browser/keyboard/keyboard-layout-service';
import { formatLibraryBytes, libraryMoveCopy } from '../common/library-storage';
import { PreferenceScope, PreferenceService, PreferenceSchemaService } from '@theia/core/lib/common/preferences';
import { StoreConnectionFlowController, StoreConnectionFlowState } from 'akari-project/lib/common/store-connection-flow';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { AKARI_BORDER, AKARI_SURFACE } from 'akari-project/lib/common/akari-surface-tokens';
import {
    AkariConnectionsService, ConnectionDoctor, ConnectionRow, ConnectionsList, GenerationKind, providerHasBalanceEndpoint,
    TRANSCRIBE_BACKENDS, TranscribeBackend
} from 'akari-shell-strip/lib/common/akari-connections-protocol';
import { generationOptions, generationSourceLabel } from '../common/generation-defaults-view';
import { storeReconnectRequired, STORE_RECONNECT_REQUIRED_MESSAGE } from '../common/store-entitlements-visibility';
import { dialogOutsideClick } from '../common/dialog-outside-click';
import { describeToolInstallOutcome, formatInstallProgressLabel, TOOL_INSTALL_NOTICE, TOOL_PROVIDERS } from '../common/tool-install-ui';
import { computeDownloadPercent, formatDownloadProgressLabel } from '../common/tool-install-progress';
import { deriveToolRowState, shouldShowToolNote, TOOL_UI, WHISPER_MODEL_SIZE_LABEL } from '../common/tool-guidance';
import { AKARI_VIDEO_LICENSE_URL, AKARI_VIDEO_NEW_ISSUE_URL, AKARI_VIDEO_REPO_URL } from '../common/repo-links';
import { AkariHomeCommands } from './akari-home-command-contribution';
import { AkariNarrationEnginesService, NarrationEngineRow, SettingsVoiceAvatar, SettingsVoiceProfile } from '../common/narration-engines-protocol';
import { falKeyAvailable, settingsVoiceEngineValue, voiceAvatarLabel, voiceSettingsActions } from '../common/voice-settings-model';
import { createGeminiConsentPrompt } from 'akari-annotations/lib/browser/voice-clone/gemini-consent-step';
import { geminiConsentCanNext, geminiConsentStatus,
    type GeminiConsentCheck } from 'akari-annotations/lib/common/voice-clone-model';
import { AkariAnnotationsService,
    type ImageRouteState } from 'akari-annotations/lib/common/akari-annotations-protocol';
import {
    AKARI_TRANSCRIBE_AUTO_CUTS, AKARI_TRANSCRIBE_BACKEND, AKARI_TRANSCRIBE_COMPARE_SET,
    AKARI_NARRATION_ENGINE, AKARI_NARRATION_VOICE, AKARI_NARRATION_IRODORI_URL,
    AKARI_QUALITY_TIER, AKARI_DEVELOPER_MODE, AKARI_VIBE_PREVIEW_ENABLED, AKARI_AGENT_TURN_END_NOTIFICATION, AKARI_CATALOG_ROOT,
    AKARI_TIMELINE_VISUAL_THUMBNAILS, AKARI_TIMELINE_TRACK_RIPPLE_DISPLAY, AKARI_PREVIEW_SCRUB_AUDIO,
    WORKBENCH_COLOR_THEME, AKARI_EXPORT_QUALITY, AKARI_EXPORT_OUTPUT_DIRECTORY, AKARI_EXPORT_FILENAME_PATTERN,
    AKARI_EXPORT_GPU_PREFERENCE_CONSENT, showTemporaryGpuPreferenceSetting,
    AKARI_EXPORT_ENCODER, AKARI_EXPORT_CODEC, AKARI_EXPORT_FPS, EXPORT_CODEC_CHOICES, EXPORT_FPS_CHOICES,
    SETTINGS_SECTIONS, SETTINGS_PILLARS, settingsPillarForSection, SettingsPillarId, SettingsSectionId, QUALITY_TIER_CHOICES, THEME_CHOICES, EXPORT_QUALITY_CHOICES,
    normalizeQualityTier, normalizeTheme, normalizeExportQuality, normalizeOutputDirectory,
    sectionForPreferenceKey, resolveSettingsSectionId, settingsSectionElementId, sectionsForPillar, activeSettingsSection,
    SETTINGS_SECTION_DESCRIPTIONS, SETTINGS_LAST_SECTION_KEY, initialSettingsSection, QUALITY_TIER_RESERVED_NOTE,
    normalizeExportEncoder, normalizeExportCodec, normalizeExportFps, isValidIrodoriUrl
} from '../common/settings-sections';
import { AKARI_APPEARANCE_THEME_MODE, AKARI_APPEARANCE_ZOOM, STATUS_BAR_KEYS, AKARI_PARTNER_REOPEN, AKARI_CHAT_EXPERIMENTAL_ENABLED, AKARI_PARTNER_PERMISSION_MODE, clampZoom, matchesSettingsSearch, formatShortReleaseDate } from '../common/settings-sections';
import { PARTNER_CLI_ICON_CLASSES, PARTNER_CATALOG } from 'akari-partner/lib/browser/partner-catalog';
import { normalizePartnerPermissionMode } from 'akari-partner/lib/common/partner-permissions';
import { partnerSettingsCliRows } from '../common/partner-settings-rows';
import { installPartnerTerminalStyle } from 'akari-partner/lib/browser/partner-terminal-style';
import { AkariSettingsMaintenanceService, PartnerDetail, PartnerFreshness, StorageSnapshot, StorageEntry, StorageCleanTarget } from '../common/settings-maintenance-protocol';
import { AkariAiModelsService, AKARI_AI_MODELS_SERVICE_PATH } from '../common/ai-models-protocol';
import { AiModelsView } from './ai-models/ai-models-view';
import { AkariChildLanguageService } from '../common/child-language-protocol';
import { parseUpdateCache, resolveUpdateDownloadUrl } from '../common/update-feed';
import {
    applyImmediateUpdaterFallback, applyShellUpdaterEvent, beginUserInitiatedUpdaterCheck,
    RELEASES_PAGE_URL, INITIAL_SHELL_UPDATER_UI_STATE, ShellUpdaterEvent, ShellUpdaterUiState, shouldOpenUpdaterBrowserFallback
} from '../common/shell-update-applier';
import { resolveSettingsUpdateView } from '../common/settings-update-view';
import { settingsIcon, SettingsIconName } from './settings/settings-icons';
import { ShortcutsSettingsView } from './settings/shortcuts-settings';
import {
    checkChips, choiceCards, dropdown, DropdownHandle, el, groupCard, segmentedControl, setPill, settingRow, settingsNote,
    statusPill, switchControl, textField
} from './settings/settings-ui';
import {
    PROVIDER_DISPLAY, PROVIDER_GROUP_LABELS, providerBillingUrl, providerGroup, providerInitial, providerLogo, ProviderGroup
} from 'akari-shell-strip/lib/browser/settings/provider-catalog';
import { makerBadge } from './settings/maker-badge';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const CONNECTION_MAKERS = require('../../../../../../packages/schemas/ai-makers.json');

const ENGINE_LABELS: Record<string, string> = {
    'speech-analyzer': t('surfaces.settings.speechanalyzerComputer.label'), 'whisper-cpp': t('surfaces.settings.whisperCppLocal.label'),
    'cloud:scribe': t('surfaces.settings.scribeCloud.label'), 'cloud:groq': t('surfaces.settings.groqCloud.label')
};
const ENGINE_DESCRIPTIONS: Record<string, string> = {
    'speech-analyzer': t('surfaces.settings.fastOffline.label'), 'whisper-cpp': t('surfaces.settings.offlineAccuracyOriented.label'),
    'cloud:scribe': t('surfaces.settings.elevenlabsKeyRequired.label'), 'cloud:groq': t('surfaces.settings.groqKeyRequired.label')
};
const ENGINE_SHORT_LABELS: Record<string, string> = {
    'speech-analyzer': 'SpeechAnalyzer', 'whisper-cpp': 'Whisper.cpp', 'cloud:scribe': 'Scribe', 'cloud:groq': 'Groq'
};
// narration-command.mjs の Gemini 30 声。既定の Leda を先頭にし、残りは名前順。
const GEMINI_NARRATION_VOICES = [
    'Leda', 'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe',
    'Callirrhoe', 'Charon', 'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux',
    'Iapetus', 'Kore', 'Laomedeia', 'Orus', 'Puck', 'Pulcherrima', 'Rasalgethi',
    'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix',
    'Zephyr', 'Zubenelgenubi'
] as const;
/** エンコーダのセグメントは短い名前で並べ、正式名は title（ホバー）に残す。 */
const ENCODER_SHORT_LABELS: Record<ExportEncoder, string> = {
    auto: t('surfaces.settings.automatic.label'), videotoolbox: 'GPU', nvenc: 'NVENC', qsv: 'QSV', amf: 'AMF', mf: 'Media Foundation', x264: 'CPU'
};
const TOOL_ICONS: Record<AkariToolId, SettingsIconName> = {
    ffmpeg: 'film', whisper: 'mic', 'yt-dlp': 'download', voicevox: 'user', voice: 'mic', blender: 'cube', 'speech-analyzer': 'spark', 'xcode-clt': 'terminal'
};
const STORAGE_COLORS: Record<string, string> = {
    cache: 'var(--theia-akariTheme-placedTextBlue)',
    models: 'var(--theia-akariTheme-placedTextViolet)',
    library: 'var(--theia-akariTheme-placedTextGreen)',
    exports: 'var(--theia-akariTheme-placedTextOrange)',
    history: 'var(--theia-akariTheme-placedTextCyan)'
};

export function storageColorFor(id: string): string {
    return Object.prototype.hasOwnProperty.call(STORAGE_COLORS, id) ? STORAGE_COLORS[id] : 'var(--akari-muted)';
}

export class AkariSettingsDialog extends AbstractDialog<void> {
    protected vibePreviewEnabled(): boolean {
        try { return window.localStorage.getItem(AKARI_VIBE_PREVIEW_ENABLED) === '1'; }
        catch { return false; }
    }
    protected readonly body = element('main');
    protected readonly sectionContents = element('aside');
    protected readonly contentsDetails = element('details');
    protected readonly contentsList = element('nav');
    protected readonly transcribe = element('section');
    protected readonly connections = element('section');
    protected readonly providerList = element('div');
    protected readonly subscriptionList = element('div');
    protected readonly imageAiRow = element('div');
    protected readonly storage = element('div');
    protected libraryStatus: AkariLibraryStatus | undefined;
    /** Akari アカウント節の中身（アカウント帯 + AKARI Store のグループ）。renderStore が描き直す。 */
    protected readonly storeRow = element('div');
    protected readonly sections = new Map<SettingsSectionId, HTMLElement>();
    protected activePillar = 'general';
    protected pendingSection?: SettingsSectionId;
    protected pendingScrollSmooth = false;
    protected pendingConnector?: string;
    protected scrollObserver?: IntersectionObserver;
    protected contentsResizeObserver?: ResizeObserver;
    protected connectorObserver?: MutationObserver;
    protected scrollLock?: { section: SettingsSectionId; until: number };
    protected scrollFrame = 0;
    protected aiModelsView?: AiModelsView;
    protected shortcutsView?: ShortcutsSettingsView;
    protected readonly storeController: StoreConnectionFlowController;
    protected storeState: StoreConnectionFlowState = { connection: { connected: false }, connectionLoading: true, phase: 'idle' };
    protected storeReconnect = false;
    protected storeStatusGeneration = 0;
    protected storeConnectPending = false;
    protected readonly notice = element('p');
    protected preferenceWrites: Promise<unknown> = Promise.resolve();
    protected readonly localPreferenceWrites = new Set<string>();
    protected readonly toolsView: SettingsToolsView;
    protected compareEnabled: boolean;
    protected compareDraft: string[];
    protected connectionSummary: { configured: number; total: number } | undefined;
    protected imageRouteStates: ImageRouteState[] = [];
    protected imageRoutesService?: AkariAnnotationsService;
    protected readonly searchInput = element('input');
    protected storageSnapshot: StorageSnapshot | undefined;
    protected diagnosticPath = '';
    protected diagnosticPathCustomized = false;
    protected credentialsPath = '';
    protected narrationState: { engines: NarrationEngineRow[]; voicevoxCaskAvailable: boolean } | undefined;
    protected voiceProfiles: SettingsVoiceProfile[] = [];
    protected voiceProfilesLoaded = false;
    protected voiceAvatars: SettingsVoiceAvatar[] = [];
    protected narrationRefreshGeneration = 0;
    protected narrationLoading = false;
    protected narrationBusy = '';
    protected narrationError = '';
    protected voicevoxPreviewSrc = '';
    protected partnerDetails: Record<string, PartnerDetail> | undefined;
    protected partnerFreshness: Record<string, PartnerFreshness> = {};
    /** CLI ごとのアップデート進行/結果の表示文（空なら通常表示）。 */
    protected partnerUpdateNote: Record<string, string> = {};
    protected partnerUpdating = new Set<string>();
    protected extensionVersions: Record<string, string> | undefined;
    protected aboutUpdaterUnsubscribe?: () => void;
    protected aboutUpdateRow?: HTMLElement;
    protected aboutUpdaterState: ShellUpdaterUiState = INITIAL_SHELL_UPDATER_UI_STATE;
    protected aboutLastEventKind?: ShellUpdaterEvent['kind'];
    protected aboutCurrentVersion?: string;
    protected aboutCheckedAt?: string;
    protected aboutDownloadUrl?: string;
    protected aboutUpdateGeneration = 0;
    protected aboutEventSequence = 0;

    constructor(
        protected readonly preferences: PreferenceService,
        protected readonly service: AkariConnectionsService,
        protected readonly storeService: AkariProjectService,
        protected readonly windows: WindowService,
        protected readonly commands: CommandService,
        protected readonly toolsService: AkariNewProjectService, protected readonly files: FileService, protected readonly env: EnvVariablesServer,
        protected readonly fileDialogs: FileDialogService, protected readonly maintenance: AkariSettingsMaintenanceService,
        protected readonly workspaceRoot: string | undefined, protected readonly widgetManager: WidgetManager,
        protected readonly shell: ApplicationShell, protected readonly pluginServer: PluginServer,
        protected readonly narrationService: AkariNarrationEnginesService,
        protected readonly keybindingRegistry: KeybindingRegistry, protected readonly commandRegistry: CommandRegistry,
        protected readonly keymapsService: KeymapsService, protected readonly keyboardLayout: KeyboardLayoutService,
        protected readonly aiModelsService: AkariAiModelsService,
        protected readonly childLanguage: AkariChildLanguageService, initialSection?: SettingsSectionId
    ) {
        super({ title: t('surfaces.settings.akariVideoSettings.title') });
        this.compareDraft = preferences.get<string[]>(AKARI_TRANSCRIBE_COMPARE_SET, []);
        this.compareEnabled = this.compareDraft.length > 0;
        this.storeController = new StoreConnectionFlowController(storeService, {
            openVerificationUrl: url => windows.openNewWindow(url, { external: true }),
            onChange: state => {
                if (this.isDisposed) { return; }
                this.storeState = state;
                this.renderStore();
                if (state.phase === 'error' || state.phase === 'expired') this.storeConnectPending = false;
                const intent = this.storeConnectPending && state.connection.connected && state.phase === 'idle' ? 'user' : 'automatic';
                if (intent === 'user') this.storeConnectPending = false;
                void this.refreshStoreEntitlements(intent);
            }
        });
        this.toDispose.push(this.storeController);
        this.toolsView = new SettingsToolsView({ title: t('surfaces.settings.tools.title'), onWorkspaceCreated: async () => undefined, onFinished: () => undefined },
            files, env, toolsService, commands, windows);
        this.toolsView.onToolsChanged = () => { if (!this.isDisposed) { this.renderSection('start'); } };
        this.toDispose.push(this.toolsView);
        this.buildDom();
        installPartnerTerminalStyle();
        let stored: string | null = null;
        try { stored = localStorage.getItem(SETTINGS_LAST_SECTION_KEY); } catch { /* 保存不可でも設定は使える。 */ }
        this.showSection(initialSettingsSection(initialSection, stored));
        for (const section of SETTINGS_SECTIONS) { this.renderSection(section.id); }
        this.toDispose.push(preferences.onPreferenceChanged(change => {
            if (this.localPreferenceWrites.delete(change.preferenceName)) { return; }
            const section = sectionForPreferenceKey(change.preferenceName);
            if (section) { this.renderSection(section); }
        }));
        void this.toolsView.refresh();
        void this.loadConnections();
        void this.storeController.refreshStatus();
        void this.loadStorage();
        void this.refreshLibraryStatus();
        void this.loadPartnerDetails();
        void this.maintenance.diagnosticDefaultPath().then(value => {
            if (!this.diagnosticPathCustomized && !this.diagnosticPath) { this.diagnosticPath = value; this.renderSection('help'); }
        });
    }

    setImageRoutesService(service: AkariAnnotationsService): void {
        this.imageRoutesService = service;
        void service.probeImageRoutes(['codex', 'antigravity', 'grok']).then(states => {
            if (!this.isDisposed) { this.imageRouteStates = states; this.renderSubscriptions(); }
        }).catch(() => {
            if (!this.isDisposed) {
                this.imageRouteStates = ['codex', 'antigravity', 'grok'].map(id => ({
                    id: id as ImageRouteState['id'], state: 'unknown' as const, detail: t('surfaces.settings.imageRoutesServiceConfirmStatus.label')
                }));
                this.renderSubscriptions();
            }
        });
    }

    selectConnector(id?: string): void {
        findSettingsSectionBody('connections')?.select?.(id);
        this.pendingConnector = id;
        this.showSection('connections');
        if (id) this.watchConnectorDetail(id);
    }
    get value(): void { return undefined; }
    focusSearch(): void { this.searchInput.focus(); }
    refreshPrivacy(): void { if (!this.isDisposed) { this.renderSection('privacy'); } }
    protected override handleEnter(_event: KeyboardEvent): boolean { return false; }

    override close(): void {
        this.stopAboutUpdaterEvents();
        this.scrollObserver?.disconnect();
        this.contentsResizeObserver?.disconnect();
        this.connectorObserver?.disconnect();
        cancelAnimationFrame(this.scrollFrame);
        for (const input of Array.from(this.node.querySelectorAll<HTMLInputElement>('input[type=password]'))) { input.value = ''; }
        super.close();
    }

    protected buildDom(): void {
        this.node.setAttribute('data-akari-settings-dialog', 'true');
        const block = this.contentNode.parentElement;
        if (block) {
            Object.assign(block.style, {
                width: 'min(1440px, calc(100vw - 48px))', maxWidth: '1440px', minWidth: '0',
                height: 'min(760px, calc(100vh - 48px))', maxHeight: 'calc(100vh - 48px)',
                borderRadius: '12px', overflow: 'hidden', border: AKARI_BORDER.edge, background: AKARI_SURFACE.raised
            });
        }
        this.contentNode.classList.add('akari-set-layout');
        Object.assign(this.contentNode.style, { display: 'grid', padding: '0', flex: '1', minHeight: '0', maxHeight: 'none', overflow: 'hidden' });
        this.controlPanel.style.display = 'none';
        const nav = element('nav');
        nav.className = 'akari-set-nav';
        nav.setAttribute('aria-label', t('surfaces.settings.domSettingItems.label'));
        this.searchInput.className = 'akari-set-search';
        this.searchInput.type = 'search';
        this.searchInput.placeholder = t('surfaces.settings.domFindSettings.placeholder');
        this.searchInput.setAttribute('aria-label', t('surfaces.settings.domSearchSettings.label'));
        this.searchInput.addEventListener('input', () => this.filterSections());
        const search = element('label'); search.className = 'akari-set-search-wrap';
        const keyHint = element('kbd', OS.type() === OS.Type.OSX ? '⌘F' : 'Ctrl+F');
        search.append(settingsIcon('search', 'sm'), this.searchInput, keyHint);
        nav.append(search);
        for (const pillar of SETTINGS_PILLARS) {
            nav.append(this.navigation(pillar.label, pillar.sections[0] as SettingsSectionId, pillar.icon));
            nav.lastElementChild?.setAttribute('data-settings-nav', pillar.id);
        }
        this.body.className = 'akari-set-scroll';
        this.notice.setAttribute('role', 'alert');
        this.notice.className = 'akari-set-notice';
        this.body.append(this.notice);
        this.sectionContents.className = 'akari-set-contents';
        this.contentsDetails.className = 'akari-set-contents-details';
        this.contentsDetails.open = true;
        const contentsTitle = element('summary', 'このページの項目');
        this.contentsList.className = 'akari-set-contents-list';
        this.contentsList.setAttribute('aria-label', 'このページの項目');
        this.contentsDetails.append(contentsTitle, this.contentsList);
        this.sectionContents.append(this.contentsDetails);
        for (const section of SETTINGS_SECTIONS) {
            const node = section.id === 'transcribe' ? this.transcribe
                : section.id === 'connections' ? this.connections : element('section');
            node.id = settingsSectionElementId(section.id);
            node.className = 'akari-set-page';
            node.setAttribute('data-akari-settings-section', section.id);
            node.hidden = true;
            node.setAttribute('aria-labelledby', `${node.id}-heading`);
            this.sections.set(section.id, node);
            this.body.append(node);
        }
        this.body.append(...SETTINGS_PILLARS.flatMap(pillar => pillar.sections).map(id => this.sections.get(id)!));
        this.storeRow.setAttribute('data-akari-store-settings', 'true');
        const connectBody = findSettingsSectionBody('connections');
        this.connections.append(...this.sectionHeading('connections'));
        const defaults = element('div');
        defaults.setAttribute('data-akari-generation-defaults', 'true');
        const diagnostics = element('details');
        const diagnosticsTitle = element('summary', '接続診断・残高とその他のサービス');
        diagnostics.append(diagnosticsTitle, this.providerList, this.imageAiRow);
        this.connections.append(defaults, diagnostics);
        if (connectBody) { this.toDispose.push(mountSettingsSectionBody(this.connections, connectBody)); }
        void this.renderGenerationDefaults(defaults);
        this.providerList.append(settingsNote('その他のサービスを読み込んでいます…'));
        this.renderStore();
        this.contentNode.append(nav, this.sectionContents, this.body);
        this.body.addEventListener('scroll', () => this.scheduleActiveSection(), { passive: true });
        this.toDispose.push(Disposable.create(() => {
            this.scrollObserver?.disconnect();
            this.contentsResizeObserver?.disconnect();
            this.connectorObserver?.disconnect();
            cancelAnimationFrame(this.scrollFrame);
        }));
        this.addEventListener(this.node, 'keydown', event => {
            if (event.metaKey && event.key.toLowerCase() === 'f') { event.preventDefault(); this.searchInput.focus(); }
        });
    }

    showSection(section: SettingsSectionId): void {
        if (section === 'listening' && !this.vibePreviewEnabled()) section = 'connections';
        const pillar = settingsPillarForSection(section);
        const navTarget = this.contentNode.querySelector<HTMLElement>(`[data-settings-nav="${pillar}"]`);
        const detailIds = sectionsForPillar(pillar, this.vibePreviewEnabled());
        const pillarChanged = pillar !== this.activePillar;
        this.activePillar = pillar;
        if (pillar !== 'general') this.stopAboutUpdaterEvents();
        this.contentsList.replaceChildren(...detailIds.map(id => {
            const item = SETTINGS_SECTIONS.find(sectionItem => sectionItem.id === id)!;
            const button = element('button', item.label);
            button.type = 'button';
            button.setAttribute('data-settings-contents', item.id);
            if (item.id === section) button.setAttribute('aria-current', 'page');
            button.addEventListener('click', () => { this.pendingScrollSmooth = true; this.showSection(item.id); });
            return button;
        }));
        if (navTarget?.hidden && this.searchInput.value) { this.searchInput.value = ''; this.filterSections(); }
        for (const [id, node] of this.sections) {
            node.hidden = !detailIds.includes(id);
            node.toggleAttribute('data-settings-first', id === detailIds[0]);
            node.toggleAttribute('data-settings-last', id === detailIds[detailIds.length - 1]);
        }
        if (pillarChanged) { this.body.scrollTo({ top: 0, behavior: 'instant' }); this.pendingScrollSmooth = false; }
        this.observeSections();
        try { localStorage.setItem(SETTINGS_LAST_SECTION_KEY, section); } catch { /* 保存不可でもページは切り替える。 */ }
        // 選択中は面の色（一段明るい面 + 太字 + アイコンだけアクセント色）で示す。縦バーは使わない（CSS 側）。
        for (const item of Array.from(this.contentNode.querySelectorAll<HTMLElement>('[data-settings-nav]'))) {
            if (item.getAttribute('data-settings-nav') === pillar) { item.setAttribute('aria-current', 'true'); }
            else { item.removeAttribute('aria-current'); }
        }
        this.highlightSearch(section);
        if (pillar === 'general' && pillarChanged && this.sections.get('about')?.childElementCount) { this.renderSection('about'); }
        if (pillar === 'connect' && (pillarChanged || !this.narrationState && !this.narrationLoading)) { void this.refreshNarrationState(); }
        this.pendingSection = section;
        this.scrollToPendingSection();
    }

    protected scrollToPendingSection(): void {
        if (!this.body.isConnected || !this.pendingSection) return;
        const section = this.pendingSection;
        this.pendingSection = undefined;
        const smooth = this.pendingScrollSmooth;
        this.pendingScrollSmooth = false;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!this.body.isConnected || this.sections.get(section)?.hidden) return;
            const heading = document.getElementById(`${settingsSectionElementId(section)}-heading`);
            if (!heading) return;
            if (section === 'connections' && this.pendingConnector) {
                this.watchConnectorDetail(this.pendingConnector);
                return;
            }
            const offset = heading.getBoundingClientRect().top - this.body.getBoundingClientRect().top;
            const target = Math.max(0, this.body.scrollTop + offset - 24);
            this.scrollLock = smooth ? { section, until: Date.now() + 1500 } : undefined;
            this.setActiveSection(section);
            this.body.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'instant' });
            window.setTimeout(() => { if (!this.isDisposed) this.scheduleActiveSection(); }, 1550);
        }));
    }

    protected watchConnectorDetail(id: string): void {
        this.connectorObserver?.disconnect();
        const reveal = (): boolean => {
            const detail = Array.from(this.connections.querySelectorAll<HTMLElement>('[data-connect-detail]'))
                .find(node => node.dataset.connectDetail === id);
            if (!detail || !this.body.isConnected) return false;
            this.connectorObserver?.disconnect();
            this.pendingConnector = undefined;
            requestAnimationFrame(() => {
                const offset = detail.getBoundingClientRect().top - this.body.getBoundingClientRect().top;
                this.body.scrollTo({ top: this.body.scrollTop + offset - 24, behavior: 'instant' });
            });
            return true;
        };
        if (reveal()) return;
        this.connectorObserver = new MutationObserver(() => reveal());
        this.connectorObserver.observe(this.connections, { childList: true, subtree: true });
    }

    protected observeSections(): void {
        this.scrollObserver?.disconnect();
        if (!this.body.isConnected || typeof IntersectionObserver === 'undefined') return;
        this.scrollObserver = new IntersectionObserver(() => this.scheduleActiveSection(), { root: this.body, threshold: [0, .5, 1] });
        for (const id of sectionsForPillar(this.activePillar as SettingsPillarId, this.vibePreviewEnabled())) {
            this.scrollObserver.observe(this.sections.get(id)!);
        }
        this.scheduleActiveSection();
    }

    protected scheduleActiveSection(): void {
        cancelAnimationFrame(this.scrollFrame);
        this.scrollFrame = requestAnimationFrame(() => {
            const ids = sectionsForPillar(this.activePillar as SettingsPillarId, this.vibePreviewEnabled());
            if (this.scrollLock && Date.now() < this.scrollLock.until) {
                const heading = document.getElementById(`${settingsSectionElementId(this.scrollLock.section)}-heading`);
                if (heading && Math.abs(heading.getBoundingClientRect().top - this.body.getBoundingClientRect().top - 24) > 4) return;
            }
            this.scrollLock = undefined;
            const top = this.body.getBoundingClientRect().top;
            const headingTops = ids.map(id => this.sections.get(id)!.getBoundingClientRect().top - top);
            const atBottom = this.body.scrollTop + this.body.clientHeight >= this.body.scrollHeight - 3;
            const active = activeSettingsSection(ids, headingTops, atBottom);
            if (active) this.setActiveSection(active);
        });
    }

    protected setActiveSection(section: SettingsSectionId): void {
        for (const button of Array.from(this.contentsList.querySelectorAll<HTMLElement>('[data-settings-contents]'))) {
            if (button.dataset.settingsContents === section) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        }
    }

    protected filterSections(): void {
        const query = this.searchInput.value;
        let first: SettingsSectionId | undefined;
        let firstHit: SettingsSectionId | undefined;
        for (const pillar of SETTINGS_PILLARS) {
            const pages = SETTINGS_SECTIONS.filter(item => sectionsForPillar(pillar.id, this.vibePreviewEnabled()).includes(item.id));
            const rows = pages.flatMap(item => Array.from(this.sections.get(item.id)!.querySelectorAll<HTMLElement>(
                '.akari-set-row-label,.akari-set-row-desc,.akari-set-group-title,.akari-set-partner-name,.akari-set-partner-sub,.akari-set-storage-header,.akari-set-permission-row'
            )).map(row => row.textContent ?? ''));
            const match = matchesSettingsSearch(query, pillar.label, pages.map(item => SETTINGS_SECTION_DESCRIPTIONS[item.id]).join(' '), rows);
            const nav = this.contentNode.querySelector<HTMLElement>(`[data-settings-nav="${pillar.id}"]`);
            if (nav) nav.hidden = !match;
            if (match && !first) first = pages[0].id;
            if (match && !firstHit && query.trim()) {
                firstHit = pages.find(item => matchesSettingsSearch(query, item.label, SETTINGS_SECTION_DESCRIPTIONS[item.id],
                    Array.from(this.sections.get(item.id)!.querySelectorAll<HTMLElement>('.akari-set-row-label,.akari-set-row-desc,.akari-set-group-title'))
                        .map(row => row.textContent ?? '')))?.id;
            }
        }
        const visible = Array.from(this.contentNode.querySelectorAll<HTMLElement>('[data-settings-nav]')).find(item => item.getAttribute('aria-current') === 'true' && !item.hidden);
        if (query.trim() && firstHit) this.showSection(firstHit);
        else if (!visible && first) this.showSection(first);
        for (const item of SETTINGS_SECTIONS) this.highlightSearch(item.id);
    }

    protected highlightSearch(id: SettingsSectionId): void {
        const query = this.searchInput.value.trim().toLocaleLowerCase();
        for (const row of Array.from(this.sections.get(id)!.querySelectorAll<HTMLElement>(
            '.akari-set-row,.akari-set-partner-row,.akari-set-storage-row,.akari-set-permission-row'
        ))) {
            row.classList.toggle('akari-set-search-hit', !!query && (row.querySelector('.akari-set-row-text')?.textContent ?? row.textContent ?? '').toLocaleLowerCase().includes(query));
        }
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.observeSections();
        this.scrollToPendingSection();
        if (typeof ResizeObserver !== 'undefined') {
            let narrow: boolean | undefined;
            this.contentsResizeObserver = new ResizeObserver(() => {
                const next = this.contentNode.clientWidth < 850;
                if (next === narrow) return;
                narrow = next;
                this.contentNode.toggleAttribute('data-contents-narrow', next);
                this.contentsDetails.open = !next;
            });
            this.contentsResizeObserver.observe(this.contentNode);
        }
        // attach ごとの状態と、detach 時に解除されるリスナでドラッグ終端の誤閉鎖を防ぐ。
        let armed = false;
        this.addEventListener(this.node, 'mousedown', event => {
            armed = dialogOutsideClick(armed, 'mousedown', event.target, this.node, event.button).armed;
        });
        this.addEventListener(this.node, 'click', event => {
            const result = dialogOutsideClick(armed, 'click', event.target, this.node, event.button);
            armed = result.armed;
            if (result.close) { this.close(); }
        });
    }

    protected navigation(label: string, target: SettingsSectionId, icon: SettingsIconName, badge?: string): HTMLButtonElement {
        const button = element('button');
        button.type = 'button';
        button.className = 'akari-set-nav-item';
        const title = element('span', label); title.className = 'akari-set-nav-label';
        button.append(settingsIcon(icon), title);
        if (badge) { const note = element('span', badge); note.className = `akari-set-nav-badge${badge === t('surfaces.settings.navigationComingSoon.label') ? ' akari-set-nav-badge-soon' : ''}`; button.append(note); }
        button.addEventListener('click', () => this.showSection(target));
        button.setAttribute('data-settings-nav', target);
        return button;
    }

    protected sectionHeading(id: SettingsSectionId): HTMLElement[] {
        const heading = element('h2', SETTINGS_SECTIONS.find(item => item.id === id)!.label);
        heading.id = `${settingsSectionElementId(id)}-heading`;
        const lead = description(SETTINGS_SECTION_DESCRIPTIONS[id]);
        lead.className = 'akari-set-lead';
        lead.style.margin = '';
        return [heading, lead];
    }

    protected renderSection(id: SettingsSectionId): void {
        if (id === 'listening') {
            const section = this.sections.get(id)!;
            section.replaceChildren(...this.sectionHeading(id));
            const contribution = findSettingsSectionBody(id);
            if (contribution) { this.toDispose.push(mountSettingsSectionBody(section, contribution)); }
            return;
        }
        if (id === 'transcribe') { this.renderTranscribe(); return; }
        if (id === 'narration') { this.renderNarration(); return; }
        if (id === 'connections') { return; }
        if (id === 'ai-models' && this.aiModelsView) { return; }
        const section = this.sections.get(id)!;
        section.replaceChildren(...this.sectionHeading(id));
        if (id === 'ai-models') { this.aiModelsView = new AiModelsView(section, this.aiModelsService, this.workspaceRoot); return; }
        if (id === 'shortcuts') {
            this.shortcutsView?.dispose();
            this.shortcutsView = new ShortcutsSettingsView(section, this.keybindingRegistry, this.commandRegistry,
                this.keymapsService, this.keyboardLayout,
                () => this.preferences.get<'code' | 'keyCode'>('keyboard.dispatch', 'code'),
                this.files, this.env, this.maintenance, message => { this.notice.textContent = message; });
            return;
        }
        if (id === 'partner') { this.renderPartner(section); return; }
        if (id === 'storage') { this.renderStorageSection(section); return; }
        if (id === 'privacy') { this.renderPrivacy(section); return; }
        if (id === 'statistics') { this.renderStatistics(section); return; }
        if (id === 'help') { this.renderHelp(section); return; }
        if (id === 'about') { this.renderAbout(section); return; }
        if (id === 'account') {
            section.append(this.storeRow);
        } else if (id === 'tools') {
            section.append(this.toolsView.content);
            const directory = textField({ label: t('surfaces.settings.sectionCatalogAssetFolder.label'), placeholder: t('surfaces.settings.sectionSearchAutomatically.placeholder'), wide: true });
            directory.value = normalizeOutputDirectory(this.preferences.get(AKARI_CATALOG_ROOT));
            directory.addEventListener('change', () => this.savePreference(AKARI_CATALOG_ROOT, directory.value));
            const pick = action(t('surfaces.settings.sectionChoose.button'), async () => {
                try {
                    const destination = await this.fileDialogs.showOpenDialog({
                        title: t('surfaces.settings.sectionSelectCatalogAssetFolder.title'), canSelectFiles: false, canSelectFolders: true
                    });
                    if (!destination || this.isDisposed) { return; }
                    directory.value = destination.path.fsPath();
                    this.savePreference(AKARI_CATALOG_ROOT, directory.value);
                    await this.preferenceWrites;
                    if (!this.isDisposed) { this.renderSection('tools'); }
                } catch {
                    this.notice.textContent = t('surfaces.settings.sectionUnableSelectFolder.label');
                }
            }, { small: true, icon: 'folder' });
            const catalogRow = groupCard(t('surfaces.settings.sectionAssetFolder.label'), settingRow(t('surfaces.settings.sectionCatalogAssetFolder.label'), t('surfaces.settings.sectionAssetFolderCatalogTabReadsFieldBlank.label'), directory, pick));
            catalogRow.setAttribute('data-akari-catalog-root', 'true');
            section.append(catalogRow);
        } else if (id === 'start') {
            section.append(groupCard(undefined, settingRow(t('surfaces.settings.sectionFirstTimeGuide.label'),
                t('surfaces.settings.sectionWatchAkariVideoCreatingVideo.message'),
                action(t('surfaces.settings.sectionView.button'), () => {
                    this.close();
                    void this.commands.executeCommand(AkariHomeCommands.OPEN_FIRST_VIDEO_GUIDE.id);
                }, { variant: 'primary' }))));
            const open = action(t('surfaces.settings.sectionOpenPreparation.button'), () => {
                this.close();
                void this.commands.executeCommand(AkariHomeCommands.OPEN_FIRST_RUN_SETUP.id);
            });
            const hero = element('div');
            hero.className = 'akari-set-hero';
            const copy = element('div');
            const heroTitle = element('div', t('surfaces.settings.sectionPreparationStart.label'));
            heroTitle.className = 'akari-set-hero-title';
            copy.append(heroTitle, description(t('surfaces.settings.sectionGuideToolsWorkspaceAssetsAiPartnersOrder.label')));
            hero.append(copy, open);
            const card = groupCard(undefined, hero);
            const steps = this.startProgressSteps();
            if (steps) { card.append(steps); }
            section.append(card);
        } else if (id === 'quality') {
            const current = normalizeQualityTier(this.preferences.get(AKARI_QUALITY_TIER));
            section.append(
                groupCard(t('surfaces.settings.sectionQualityStage.label'),
                    choiceCards({ label: t('surfaces.settings.sectionPreviewQuality.label'), options: QUALITY_TIER_CHOICES, value: current, columns: 2,
                        onChange: value => this.savePreference(AKARI_QUALITY_TIER, value) }),
                    settingsNote(QUALITY_TIER_RESERVED_NOTE)),
                groupCard(t('surfaces.settings.sectionTimeline.label'), this.preferenceSwitch(AKARI_TIMELINE_VISUAL_THUMBNAILS, t('surfaces.settings.timelineHtmlThreeDimensionalThumbnail.label'), false,
                    t('surfaces.settings.sectionMoreAssetSlowerOpenOffColorName.label')),
                    settingRow(t('surfaces.settings.trackRippleDisplay.label'), t('surfaces.settings.sectionTagsSwitchBetweenCutShiftFixedOne.label'),
                        segmentedControl({ label: t('surfaces.settings.trackRippleDisplay.label'),
                            options: [{ value: 'tag', label: t('surfaces.settings.trackRippleTag.option') }, { value: 'switches', label: t('surfaces.settings.sectionSwitch.label') }],
                            value: this.preferences.get(AKARI_TIMELINE_TRACK_RIPPLE_DISPLAY) === 'switches' ? 'switches' : 'tag',
                            onChange: value => this.savePreference(AKARI_TIMELINE_TRACK_RIPPLE_DISPLAY, value) }))),
                groupCard('プレビュー', this.preferenceSwitch(AKARI_PREVIEW_SCRUB_AUDIO, 'シークしたときに音を鳴らす', false,
                    'つまみやタイムラインをドラッグしたとき・コマ送りしたときに、その位置の音を短く鳴らします。通常の再生の音は変わりません')));
        } else if (id === 'notifications') {
            section.append(groupCard(undefined, this.preferenceSwitch(AKARI_AGENT_TURN_END_NOTIFICATION, t('surfaces.settings.sectionAiCompletionNotification.label'), true,
                t('surfaces.settings.sectionReceiveNotificationProcessingSuchClaudeCodeCompleted.label'))));
        } else if (id === 'appearance') {
            const theme = this.preferences.get<string>(AKARI_APPEARANCE_THEME_MODE, normalizeTheme(this.preferences.get(WORKBENCH_COLOR_THEME)));
            const themes: { value: string; label: string; preview?: HTMLElement }[] = THEME_CHOICES.map(option => ({ ...option, preview: themePreview(option.value) }));
            if (!themes.some(option => option.value === theme)) { themes.push({ value: theme, label: theme }); }
            section.append(groupCard(t('surfaces.settings.sectionTheme.label'), choiceCards({ label: t('surfaces.settings.sectionTheme.label'), options: themes, value: theme, columns: 3,
                onChange: value => { this.savePreference(AKARI_APPEARANCE_THEME_MODE, value); this.applyTheme(value); } })));
            const languageChoice = window.localStorage.getItem('akari.ui.language') || 'auto';
            section.append(groupCard(t('surfaces.settings.sectionLanguage.label'), settingRow(t('surfaces.settings.sectionDisplayLanguage.label'), t('settings.appearance.language.hint'),
                segmentedControl({ label: t('surfaces.settings.sectionLanguage.label'), options: [
                    { value: 'auto', label: t('settings.appearance.language.auto') },
                    { value: 'ja', label: t('settings.appearance.language.ja') },
                    { value: 'en', label: t('settings.appearance.language.en') }
                ], value: languageChoice, onChange: async value => {
                    const locale = value === 'auto' ? normalizeLanguage(navigator.language) : value;
                    window.localStorage.setItem('akari.ui.language', value);
                    await this.childLanguage.setLanguage(value as 'auto' | 'ja' | 'en');
                    nls.setLocale(locale);
                    document.documentElement.lang = locale;
                    this.windows.setSafeToShutDown();
                    this.windows.reload();
                } }))));
            const zoom = clampZoom(Number(this.preferences.get(AKARI_APPEARANCE_ZOOM, 100)));
            const zoomLabel = element('span', `${zoom}%`);
            const changeZoom = (next: number): void => { const value = clampZoom(next); zoomLabel.textContent = `${value}%`; this.savePreference(AKARI_APPEARANCE_ZOOM, value); applyAkariZoom(value); };
            section.append(groupCard(t('surfaces.settings.sectionUiSize.label'), settingRow(t('surfaces.settings.sectionUiSize.label'), t('surfaces.settings.sectionZoomAlsoChange.message', { shortcut: OS.type() === OS.Type.OSX ? '⌘+ / ⌘−' : 'Ctrl++ / Ctrl+−' }),
                action('−', () => changeZoom(Number(zoomLabel.textContent?.replace('%', '')) - 10), { small: true }), zoomLabel,
                action('+', () => changeZoom(Number(zoomLabel.textContent?.replace('%', '')) + 10), { small: true }),
                action(t('surfaces.settings.sectionUndo.button'), () => changeZoom(100), { small: true }))));
            section.append(groupCard(t('surfaces.settings.sectionPutBottomBarBottomRight.label'),
                this.preferenceSwitch(STATUS_BAR_KEYS.cpu, 'CPU', true, t('surfaces.settings.sectionUsageRate.label')),
                this.preferenceSwitch(STATUS_BAR_KEYS.gpu, 'GPU', true, t('surfaces.settings.sectionUsageRate.label')),
                this.preferenceSwitch(STATUS_BAR_KEYS.memory, t('surfaces.settings.sectionMemory.label'), true, t('surfaces.settings.sectionUsageAmount.label')),
                this.preferenceSwitch(STATUS_BAR_KEYS.disk, t('surfaces.settings.sectionDiskSpace.label'), false, t('surfaces.settings.sectionFreeSpace.label')),
                this.preferenceSwitch(STATUS_BAR_KEYS.running, t('surfaces.settings.sectionRunningNumber.label'), true, t('surfaces.settings.sectionPartnerExportTranscription.label')),
                this.preferenceSwitch(STATUS_BAR_KEYS.accountBalance, t('surfaces.settings.sectionAccountBalance.label'), false, t('surfaces.settings.sectionServicesObtained.label')),
                settingRow(t('surfaces.settings.sectionUpdateInterval.label'), t('surfaces.settings.sectionIntervalRefreshResourceDisplay.label'), segmentedControl({ label: t('surfaces.settings.sectionUpdateInterval.label'),
                    options: [{ value: '1', label: t('surfaces.settings.sectionSecond.label') }, { value: '3', label: t('surfaces.settings.previewThreeSeconds.option') }, { value: '10', label: t('surfaces.settings.previewTenSeconds.option') }],
                    value: String(this.preferences.get(STATUS_BAR_KEYS.intervalSec, 3)), onChange: value => this.savePreference(STATUS_BAR_KEYS.intervalSec, Number(value)) }))));
        } else if (id === 'developer') {
            const vibeLabel = t('surfaces.settings.sectionShowAkariVibeDevelopment.label');
            let pendingVibeValue = this.preferences.get<boolean>(AKARI_VIBE_PREVIEW_ENABLED, false);
            const applyVibe = action(t('surfaces.settings.sectionReflectNow.button'), async () => {
                await this.preferenceWrites;
                if (this.preferences.get<boolean>(AKARI_VIBE_PREVIEW_ENABLED, false) !== pendingVibeValue) return;
                if (await this.windows.isSafeToShutDown(StopReason.Reload)) this.windows.reload();
            }, { small: true });
            const applyRow = element('div');
            applyRow.className = 'akari-set-row';
            applyRow.style.display = 'none';
            applyVibe.style.justifySelf = 'start';
            applyRow.append(applyVibe);
            const vibe = settingRow(vibeLabel,
                t('surfaces.settings.sectionSwitchingPressReflectNowSwitchSpot.label'),
                switchControl({ label: vibeLabel, checked: pendingVibeValue, onChange: checked => {
                    pendingVibeValue = checked;
                    try { window.localStorage.setItem(AKARI_VIBE_PREVIEW_ENABLED, checked ? '1' : '0'); } catch { /* 設定の保存は続ける。 */ }
                    this.savePreference(AKARI_VIBE_PREVIEW_ENABLED, checked);
                    void this.preferenceWrites.then(() => {
                        if (pendingVibeValue !== checked || this.preferences.get<boolean>(AKARI_VIBE_PREVIEW_ENABLED, false) === checked) return;
                        try { window.localStorage.setItem(AKARI_VIBE_PREVIEW_ENABLED,
                            this.preferences.get<boolean>(AKARI_VIBE_PREVIEW_ENABLED, false) ? '1' : '0'); } catch { /* 保存できない環境では設定だけを使う。 */ }
                        applyRow.style.display = 'none';
                    });
                    applyRow.style.display = '';
                } }));
            section.append(groupCard(undefined,
                this.preferenceSwitch(AKARI_DEVELOPER_MODE, 'Developer mode', false,
                    t('surfaces.settings.sectionOpenHtmlCodeFullSettingsAvailable.label')),
                vibe, applyRow));
        } else if (id === 'export') {
            const platform = OS.type() === OS.Type.OSX ? 'darwin' : OS.type() === OS.Type.Windows ? 'win32' : 'linux';
            const directory = textField({ label: t('surfaces.settings.sectionExportFolderUri.label'), placeholder: t('surfaces.settings.sectionProjectExports.placeholder'), wide: true });
            directory.value = normalizeOutputDirectory(this.preferences.get(AKARI_EXPORT_OUTPUT_DIRECTORY));
            directory.addEventListener('change', () => this.savePreference(AKARI_EXPORT_OUTPUT_DIRECTORY, directory.value));
            const pickDirectory = action(t('surfaces.settings.sectionChoose.button'), async () => {
                try {
                    const destination = await this.fileDialogs.showOpenDialog({
                        title: t('surfaces.settings.sectionChooseExportFolder.title'), canSelectFiles: false, canSelectFolders: true
                    });
                    if (!destination || this.isDisposed) { return; }
                    directory.value = destination.toString();
                    this.savePreference(AKARI_EXPORT_OUTPUT_DIRECTORY, directory.value);
                } catch {
                    this.notice.textContent = t('surfaces.settings.sectionUnableSelectFolder.label');
                }
            }, { small: true, icon: 'folder' });
            const encoders = buildExportEncoderChoices(platform).map(choice => ({
                value: choice.value, label: ENCODER_SHORT_LABELS[choice.value], title: choice.label
            }));
            section.append(
                groupCard(t('surfaces.settings.sectionImageQuality.label'), choiceCards({ label: t('surfaces.settings.sectionExportImageQuality.label'), options: EXPORT_QUALITY_CHOICES, columns: 4,
                    value: normalizeExportQuality(this.preferences.get(AKARI_EXPORT_QUALITY)),
                    onChange: value => this.savePreference(AKARI_EXPORT_QUALITY, value) })),
                groupCard(t('surfaces.settings.sectionFormat.label'),
                    settingRow(t('surfaces.settings.sectionFormatCodec.label'), t('surfaces.settings.recommendedMpFourH264Preset.option'), dropdown({ label: t('surfaces.settings.sectionFormatCodec.label'), options: EXPORT_CODEC_CHOICES,
                        value: normalizeExportCodec(this.preferences.get(AKARI_EXPORT_CODEC)),
                        onChange: value => this.savePreference(AKARI_EXPORT_CODEC, value) })),
                    settingRow(t('surfaces.settings.sectionEncoder.label'), t('surfaces.settings.sectionSpeedCompatibilityAutomaticTakesPrecedenceHardwareAvailable.label'), segmentedControl({ label: t('surfaces.settings.sectionEncoder.label'), options: encoders,
                        value: normalizeExportEncoder(this.preferences.get(AKARI_EXPORT_ENCODER), platform),
                        onChange: value => this.savePreference(AKARI_EXPORT_ENCODER, value) })),
                    settingRow(t('surfaces.settings.sectionFrameRate.label'), t('surfaces.settings.sectionDefaultFollowEditData.label'), segmentedControl({ label: t('surfaces.settings.sectionFrameRate.label'), options: EXPORT_FPS_CHOICES,
                        value: String(normalizeExportFps(this.preferences.get(AKARI_EXPORT_FPS)) ?? '') as typeof EXPORT_FPS_CHOICES[number]['value'],
                        onChange: value => this.savePreference(AKARI_EXPORT_FPS, normalizeExportFps(Number(value))) }))),
                groupCard(t('surfaces.settings.sectionSaveDestination.label'),
                    settingRow(t('surfaces.settings.sectionExportFolder.label'), t('surfaces.settings.sectionLeftBlankProjectsExports.label'), directory, pickDirectory),
                    settingRow(t('surfaces.settings.sectionDetailedSettings.label'), t('surfaces.settings.sectionOpenFullSettings.label'), action(t('surfaces.settings.sectionOpen.button'), () => {
                        this.close();
                        void this.commands.executeCommand(CommonCommands.OPEN_PREFERENCES.id);
                    }, { small: true }))),
                ...(showTemporaryGpuPreferenceSetting(platform) ? [groupCard(t('surfaces.settings.sectionWindowsGpuSettings.label'),
                    this.preferenceSwitch(AKARI_EXPORT_GPU_PREFERENCE_CONSENT, t('surfaces.settings.sectionTemporarilyHighPerformanceGpu.label'), false,
                        t('surfaces.settings.sectionAllocateHighPerformanceGpuAkariVideoDuring.message')))] : []),
                groupCard(t('surfaces.settings.sectionExport.label'),
                    this.preferenceSwitch('akari.export.openFolderAfter', t('surfaces.settings.sectionOpenFolderFinished.label'), false, t('surfaces.settings.sectionSelectExportedFileFinder.label')),
                    this.preferenceSwitch('akari.export.notifyAfter', t('surfaces.settings.sectionNotify.label'), true, t('surfaces.settings.sectionWindowBack.label')),
                    settingRow(t('surfaces.settings.sectionDecideFileName.label'), t('surfaces.settings.sectionNameExportedFile.label'), dropdown({ label: t('surfaces.settings.sectionDecideFileName.label'),
                        options: [{ value: 'project-date-time', label: t('surfaces.settings.sectionProjectNameDateTime.label') }, { value: 'project-name', label: t('surfaces.settings.sectionProjectName.label') }],
                        value: this.preferences.get<string>(AKARI_EXPORT_FILENAME_PATTERN, 'project-date-time'),
                        onChange: value => this.savePreference(AKARI_EXPORT_FILENAME_PATTERN, value) }))));
        }
    }

    protected applyTheme(mode: string): void {
        const selected = mode === 'system' ? ((window.akariNativeDark ?? matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light') : mode;
        this.savePreference(WORKBENCH_COLOR_THEME, selected);
    }

    protected renderPartner(section: HTMLElement): void {
        const rows = partnerSettingsCliRows().map(({ entry, name }) => {
            const id = entry.agent;
            const detail = this.partnerDetails?.[id];
            const fresh = this.partnerFreshness[id];
            const installedVersion = extractCliVersion(detail?.version);
            const updating = this.partnerUpdating.has(id);
            // 版が読めるときは「今 x · 最新 y」、読めないときは従来どおり検出文をそのまま出す。
            const sub = [installedVersion ? t('surfaces.settings.partnerNow.label', { version: installedVersion }) : detail?.detail || '—',
                fresh?.latestVersion ? t('surfaces.settings.partnerLatest.label', { version: fresh.latestVersion }) : '',
                fresh?.selfUpdating ? t('surfaces.settings.partnerSelfUpdating.label') : ''].filter(Boolean).join(' · ');
            const external = Boolean(detail?.installed && fresh?.updateAvailable && detail.managedByApp === false);
            // アップデートは AKARI が入れた実体にだけ出す（PATH 上の別管理コピーは入れ直しても使われない）。
            const canUpdate = Boolean(detail?.installed && fresh?.updateAvailable && detail.managedByApp !== false) || updating;
            const note = updating ? t('surfaces.settings.partnerUpdating.status') : this.partnerUpdateNote[id] || (external ? t('surfaces.settings.partnerExternalUpdate.message') : '');
            const row = this.partnerRow(id, name, detail?.installed === undefined ? t('surfaces.settings.partnerChecking.label') : detail.installed ? t('surfaces.settings.partnerInstalled.status') : t('surfaces.settings.partnerNotInstalled.status'),
                sub, detail?.installed === false ? t('surfaces.settings.partnerInsert.label') : t('surfaces.settings.partnerStart.label'), async () => {
                this.close();
                await this.commands.executeCommand('akari.partner.open');
                if (!detail?.installed) { return; }
                const widget = this.widgetManager.tryGetWidget('akari-partner-onboarding') as unknown as { begin(entry: typeof PARTNER_CATALOG[number]): Promise<void> } | undefined;
                if (widget) { await widget.begin(entry); }
            }, canUpdate ? [this.partnerUpdateButton(id, updating)] : []);
            if (note) {
                const noteElement = element('div', note); noteElement.className = 'akari-set-partner-sub';
                row.children[1]?.append(noteElement);
            }
            return row;
        });
        const extensions = [
            { id: 'anthropic.claude-code', agent: 'claude' as const, name: t('surfaces.settings.partnerClaudeCodeExtension.label') },
            { id: 'openai.chatgpt', agent: 'codex' as const, name: t('surfaces.settings.partnerCodexExtension.label') }
        ].map(entry => this.partnerRow(entry.agent, entry.name,
            this.extensionVersions ? entry.id in this.extensionVersions ? t('surfaces.settings.partnerPresent.status') : t('surfaces.settings.partnerIncluded.label') : t('surfaces.settings.partnerChecking.label'),
            `${entry.id}${this.extensionVersions?.[entry.id] ? ` · ${this.extensionVersions[entry.id]}` : ''}`, t('surfaces.settings.partnerOpen.label'), () => {
                this.close(); void this.commands.executeCommand('akari.partner.open');
            }));
        const cli = groupCard('CLI', ...rows);
        const cliHeading = cli.querySelector<HTMLElement>('.akari-set-group-title');
        if (cliHeading) { cliHeading.append(element('span', t('surfaces.settings.partnerLineUpRightRailLine.label'))); }
        const caution = element('div'); caution.className = 'akari-set-caution';
        caution.append(settingsIcon('info', 'sm'), element('span', t('surfaces.settings.partnerExtensionsDisconnectedExtensionHostRestartedRecommendCli.message')));
        section.append(cli, groupCard(t('surfaces.settings.partnerOfficialExpansion.label'),
            caution,
            ...extensions,
            settingRow(t('surfaces.settings.partnerFindOtherExtensions.label'), t('surfaces.settings.partnerOpenVsxDontKnow.label'), action(t('surfaces.settings.partnerOpen.button'), async () => {
                this.close();
                const widget = await this.widgetManager.getOrCreateWidget('vsx-extensions-view-container');
                if (!widget.isAttached) { await this.shell.addWidget(widget, { area: 'main' }); }
                await this.shell.activateWidget(widget.id);
            }, { small: true }))),
        groupCard(t('surfaces.settings.partnerBehavior.label'), this.preferenceSwitch(AKARI_PARTNER_REOPEN, t('surfaces.settings.partnerOnceStartedOpenPreviousPartner.label'), true,
            t('surfaces.settings.partnerOpeningProjectOpenPreviousPartnerProjectsWhose.label')),
        this.preferenceSwitch(AKARI_CHAT_EXPERIMENTAL_ENABLED, 'AKARI チャット（お試し）を表示する', false,
            '開発中の機能です。動作が不安定なことがあります'),
        settingRow(t('surfaces.settings.partnerPrivileges.label'), t('surfaces.settings.partnerToolsHaveAutomaticModeCopilotAntigravityCommand.description'),
            dropdown({ label: t('surfaces.settings.partnerPrivileges.label'), options: [
                { value: 'auto', label: t('surfaces.settings.partnerAutomaticRecommended.label') },
                { value: 'ask', label: t('surfaces.settings.partnerAskTimeDefaultTool.label') },
                { value: 'bypass', label: t('surfaces.settings.partnerAllAllowed.label') }
            ], value: normalizePartnerPermissionMode(this.preferences.inspect(AKARI_PARTNER_PERMISSION_MODE)?.globalValue),
            onChange: value => this.savePreference(AKARI_PARTNER_PERMISSION_MODE, value) }))));
    }

    protected partnerRow(id: keyof typeof PARTNER_CLI_ICON_CLASSES, name: string, state: string, sub: string,
        buttonLabel: string, onClick: () => void | Promise<void>, extraButtons: HTMLElement[] = []): HTMLElement {
        const row = element('div'); row.className = 'akari-set-partner-row';
        const tile = element('span'); tile.className = 'akari-set-partner-tile';
        const icon = element('span'); icon.className = `akari-set-partner-icon ${PARTNER_CLI_ICON_CLASSES[id]}`; tile.append(icon);
        const text = element('div');
        const top = element('div'); top.className = 'akari-set-partner-name';
        const badge = element('span', state); badge.className = 'akari-set-partner-chip';
        top.append(element('b', name), badge);
        const subtitle = element('div', sub); subtitle.className = 'akari-set-partner-sub';
        text.append(top, subtitle);
        const actions = element('div'); actions.className = 'akari-set-partner-actions';
        actions.append(...extraButtons, action(buttonLabel, onClick, { small: true }));
        row.append(tile, text, actions);
        return row;
    }

    protected partnerUpdateButton(id: string, updating: boolean): HTMLElement {
        const button = action(updating ? t('surfaces.settings.partnerUpdating.status') : t('surfaces.settings.partnerUpdate.button'),
            () => { void this.updatePartnerCli(id); }, { small: true, variant: 'primary' });
        button.disabled = updating;
        return button;
    }

    /** 押下 = 同意。導入と同じ経路で強制的に入れ直し、終わったら再検出して結果を表示する。 */
    protected async updatePartnerCli(id: string): Promise<void> {
        if (this.partnerUpdating.has(id)) { return; }
        this.partnerUpdating.add(id); this.partnerUpdateNote[id] = '';
        this.renderSection('partner');
        try {
            const result = await this.maintenance.updatePartner(id);
            this.partnerUpdateNote[id] = result.ok
                ? t('surfaces.settings.partnerUpdated.message', { version: result.version ?? '' })
                : t('surfaces.settings.partnerUpdateFailed.message', { reason: result.message ?? '' });
        } catch (error) {
            this.partnerUpdateNote[id] = t('surfaces.settings.partnerUpdateFailed.message', { reason: error instanceof Error ? error.message : String(error) });
        }
        this.partnerUpdating.delete(id);
        if (this.isDisposed) { return; }
        await this.loadPartnerDetails();
    }

    protected async loadPartnerDetails(): Promise<void> {
        const [cli, plugins] = await Promise.allSettled([this.maintenance.partnerDetails(), this.pluginServer.getInstalledPlugins()]);
        if (cli.status === 'fulfilled') { this.partnerDetails = cli.value; }
        if (plugins.status === 'fulfilled') {
            this.extensionVersions = {};
            for (const item of plugins.value) {
                const value = String(item); const at = value.lastIndexOf('@');
                if (at > 0) { this.extensionVersions[value.slice(0, at).toLowerCase()] = value.slice(at + 1); }
            }
        }
        if (!this.isDisposed) { this.renderSection('partner'); }
        // 最新版の問い合わせはネットワーク待ちがあるので、検出の表示を先に出してから重ねる（失敗は黙って無視）。
        if (cli.status === 'fulfilled') {
            try { this.partnerFreshness = await this.maintenance.partnerFreshness(cli.value); } catch { /* 最新版不明のまま */ }
            if (!this.isDisposed) { this.renderSection('partner'); }
        }
    }

    protected async loadStorage(): Promise<void> {
        try { this.storageSnapshot = await this.maintenance.measure(this.workspaceRoot); }
        catch { this.storageSnapshot = { entries: [], freeBytes: 0 }; this.notice.textContent = t('surfaces.settings.storageCheckStorage.label'); }
        if (!this.isDisposed) { this.renderSection('storage'); }
    }

    protected renderStorageSection(section: HTMLElement): void {
        if (!this.storageSnapshot) {
            section.append(settingsNote(t('surfaces.settings.storageSectionChecking.label')));
        } else {
            const { entries, freeBytes } = this.storageSnapshot;
            const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
            const summary = element('div'); summary.className = 'akari-set-storage-total';
            summary.append(element('b', formatBytes(total)), element('span', t('surfaces.settings.storageSectionAkariOverallFreeSpaceComputer.message', { size: freeBytes ? formatBytes(freeBytes) : t('surfaces.settings.storageSectionCouldntFindOut.label') })));
            const usage = element('div'); usage.className = 'akari-set-storage-usage';
            const legend = element('div'); legend.className = 'akari-set-storage-legend';
            entries.forEach(entry => {
                const color = storageColorFor(entry.id);
                const part = element('i'); part.style.width = `${total ? entry.bytes / total * 100 : 20}%`; part.style.background = color;
                usage.append(part);
                const item = element('span', `${entry.label} ${formatBytes(entry.bytes)}`);
                item.style.setProperty('--akari-storage-color', color); legend.append(item);
            });
            section.append(groupCard(undefined, summary, usage, legend));
            const rows = entries.map(entry => this.storageDetailRow(entry));
            const breakdown = groupCard(t('surfaces.settings.storageSectionBreakdown.label'), ...rows);
            breakdown.querySelector('.akari-set-group-title')?.append(element('span', t('surfaces.settings.storageSectionPressRowOpen.label')));
            section.append(breakdown);
        }
        section.append(this.renderLibraryStorageCard());
    }

    protected renderLibraryStorageCard(): HTMLElement {
        const status = this.libraryStatus;
        const usage = status?.usage;
        const open = action(t('surfaces.settings.libraryStorageCardOpenFinder.button'), () => {
            if (status?.root) { void this.maintenance.openPath(status.root); }
        }, { small: true, icon: 'folder' });
        open.disabled = !status?.root;
        const change = action(t('surfaces.settings.libraryStorageCardChangeLocation.button'), () => void this.commands.executeCommand('akari.library.changeLocation'), { small: true });
        const clean = action(t('surfaces.settings.libraryStorageCardGetRidThingsReplaced.button'), () => void this.clearLabLibrary(), { small: true });
        clean.disabled = !usage?.cleanup.length;
        const card = groupCard(t('surfaces.settings.libraryStorageCardAssetStorage.label'),
            settingRow(t('surfaces.settings.libraryStorageCardCurrentLocation.label'), status?.root ?? t('surfaces.settings.libraryStorageCardConfirming.label'), open, change),
            settingRow(t('surfaces.settings.libraryStorageCardTotal.label'), usage ? formatLibraryBytes(usage.totalBytes) : t('surfaces.settings.libraryStorageCardConfirming.label')),
            settingRow(t('surfaces.settings.libraryStorageCardLab.label'), usage ? t('surfaces.settings.libraryStorageCardPieces.message', { size: formatLibraryBytes(usage.bySource.lab.bytes), labCount: usage.bySource.lab.count, n: usage.bySource.lab.count }) : t('surfaces.settings.libraryStorageCardConfirming.label')),
            settingRow(t('surfaces.settings.libraryStorageCardAssetSite.label'), usage ? t('surfaces.settings.libraryStorageCardPieces.message', { size: formatLibraryBytes(usage.bySource.site.bytes), labCount: usage.bySource.site.count, n: usage.bySource.site.count }) : t('surfaces.settings.libraryStorageCardConfirming.label')),
            settingRow(t('surfaces.settings.libraryStorageCardOwn.label'), usage ? t('surfaces.settings.libraryStorageCardPieces.message', { size: formatLibraryBytes(usage.bySource.own.bytes), labCount: usage.bySource.own.count, n: usage.bySource.own.count }) : t('surfaces.settings.libraryStorageCardConfirming.label')),
            settingRow(t('surfaces.settings.libraryStorageCardSomethingReplaced.label'), t('surfaces.settings.libraryStorageCardCheckListAssetsReceivedLabMoveThem.label'), clean));
        card.setAttribute('data-akari-library-usage', 'true');
        const moveCopy = status ? libraryMoveCopy(status.state, status.previous, status.cloud) : {};
        if (moveCopy.retained) { card.append(settingsNote(moveCopy.retained)); }
        if (status?.state === 'pending') {
            card.append(settingRow(t('surfaces.settings.libraryStorageCardCheckMove.label'), moveCopy.sync,
                action(t('surfaces.settings.libraryStorageCardAction.button'), () => void this.acceptSyncedLibrary(), { small: true }),
                action(t('surfaces.settings.libraryStorageCardChooseAnotherLocation.button'), () => void this.commands.executeCommand('akari.library.changeLocation'), { small: true }),
                action(t('surfaces.settings.libraryStorageCardMoveLater.button'), () => void this.declineSyncedLibrary(), { small: true })));
        }
        return card;
    }

    protected storageDetailRow(entry: StorageEntry): HTMLElement {
        const row = element('div'); row.className = 'akari-set-storage-row'; row.setAttribute('data-storage-row', entry.id);
        const header = element('button'); header.type = 'button'; header.className = 'akari-set-storage-header';
        header.setAttribute('aria-expanded', 'false');
        const badge = element('span', entry.safeToDelete); badge.className = entry.id === 'cache' ? 'akari-set-storage-safe' : 'akari-set-storage-keep';
        header.append(settingsIcon('chevr', 'sm'), element('b', entry.label), badge, element('span', formatBytes(entry.bytes)));
        const detail = element('div'); detail.className = 'akari-set-storage-detail'; detail.hidden = true;
        const why = element('div'); why.className = 'akari-set-storage-why'; why.append(settingsIcon('shield', 'sm'), element('span', entry.detail));
        const table = element('table');
        for (const child of entry.children) {
            const tr = element('tr');
            for (const value of [child.label, child.path, formatBytes(child.bytes)]) { tr.append(element('td', value)); }
            table.append(tr);
        }
        const actions = element('div'); actions.className = 'akari-set-storage-actions';
        if (entry.id === 'cache' || entry.id === 'models' || entry.id === 'history') {
            const target: StorageCleanTarget = entry.id === 'history' ? 'old-history' : entry.id;
            actions.append(action(entry.id === 'cache' ? t('surfaces.settings.storageDetailRowClean.label') : entry.id === 'models' ? t('surfaces.settings.storageDetailRowErase.label') : t('surfaces.settings.storageDetailRowDeleteOldThings.label'),
                () => this.showStorageConfirmation(target, entry), { small: true }));
        }
        if (entry.id === 'cache' || entry.id === 'library') {
            actions.append(action(t('surfaces.settings.storageDetailRowViewFinder.button'), () => void this.maintenance.revealPath(entry.path), { small: true }));
        }
        if (entry.id === 'exports') { actions.append(action(t('surfaces.settings.storageDetailRowList.button'), () => void this.maintenance.openPath(entry.path), { small: true })); }
        detail.append(why, table, actions);
        header.addEventListener('click', () => { const open = header.getAttribute('aria-expanded') !== 'true';
            header.setAttribute('aria-expanded', String(open)); detail.hidden = !open; row.classList.toggle('akari-set-storage-open', open); });
        row.append(header, detail); return row;
    }

    protected showStorageConfirmation(target: StorageCleanTarget, entry: StorageEntry): void {
        const overlay = element('div'); overlay.className = 'akari-set-storage-confirm'; overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', t('surfaces.settings.storageConfirmationConfirmDeleted.message', { entryLabel: entry.label }));
        const box = element('div'); box.className = 'akari-set-storage-confirm-box';
        box.append(element('h4', target === 'cache' ? t('surfaces.settings.cleanStorage.confirm', { name: entry.label, size: formatBytes(entry.bytes) }) : t('surfaces.settings.deleteStorage.confirm', { name: entry.label, size: formatBytes(entry.bytes) })));
        const yes = element('ul');
        yes.append(...entry.paths.map(location => element('li', t('surfaces.settings.storageConfirmationDelete.message', { name: target === 'old-history' ? t('surfaces.settings.storageConfirmationHistoryOlderDays.label') : entry.label, location: location }))),
            element('li', target === 'cache' ? t('surfaces.settings.storageConfirmationAutomaticallyRecreateNeeded.label') : target === 'models' ? t('surfaces.settings.storageConfirmationNeedRedownloadNextTime.label') : t('surfaces.settings.storageConfirmationDeleteHistoryOlderDays.label')));
        const no = element('ul'); no.className = 'akari-set-storage-confirm-no';
        no.append(element('li', t('surfaces.settings.storageConfirmationThingsWontEraseProjectsAssetsExportsRecent.label')));
        const buttons = element('div'); buttons.className = 'akari-set-storage-confirm-actions';
        buttons.append(action(t('surfaces.settings.storageConfirmationStop.button'), () => overlay.remove(), { small: true }),
            action(target === 'cache' ? t('surfaces.settings.storageConfirmationClean.label') : t('surfaces.settings.storageDelete.button'), async () => {
                try { await this.maintenance.cleanStorage(target, this.workspaceRoot); overlay.remove(); await this.loadStorage(); }
                catch { this.notice.textContent = t('surfaces.settings.storageConfirmationDeleted.label', { entryLabel: entry.label }); overlay.remove(); }
            }, { small: true, variant: 'primary' }));
        box.append(yes, no, buttons); overlay.append(box); this.body.append(overlay);
    }

    protected renderPrivacy(section: HTMLElement): void {
        const microphone = window.akariPermissions?.microphone;
        const permissionLabel = (value: string | undefined): string => value === 'granted' ? t('surfaces.settings.permissionLabelPermitted.label')
            : value === 'denied' || value === 'restricted' ? t('surfaces.settings.permissionLabelRefusal.label') : value === 'not-determined' ? t('surfaces.settings.permissionLabelSet.label') : t('surfaces.settings.permissionLabelCheckSystemSettings.label');
        const notification = typeof Notification !== 'undefined' ? Notification.permission : undefined;
        const permissions: { icon: SettingsIconName; name: string; description: string; state: string; url: string }[] = [
            { icon: 'mic', name: t('surfaces.settings.privacyMicrophone.label'), description: this.vibePreviewEnabled() ? t('surfaces.settings.privacyEditVoiceAkariVibeRecordAnnotations.label') : t('surfaces.settings.privacyRecordingAnnotations.label'), state: permissionLabel(microphone), url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone' },
            { icon: 'folder', name: t('surfaces.settings.privacyDocumentsDesktopDownloads.label'), description: t('surfaces.settings.privacyOpenProjectAssetPlaced.description'), state: t('surfaces.settings.privacyCheckSystemSettings.status'), url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders' },
            { icon: 'bell', name: t('surfaces.settings.privacyNotification.label'), description: t('surfaces.settings.privacyExportAiWorkFinished.description'), state: permissionLabel(notification), url: 'x-apple.systempreferences:com.apple.preference.notifications' },
            { icon: 'terminal', name: t('surfaces.settings.privacyFullDiskAccess.label'), description: t('surfaces.settings.privacyUsuallyUnnecessaryExternalDrivesRequire.description'), state: t('surfaces.settings.privacyCheckSystemSettings.status'), url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles' }
        ];
        const rows = permissions.map(item => {
            const row = element('div'); row.className = 'akari-set-permission-row';
            const tile = element('span'); tile.className = 'akari-set-partner-tile'; tile.append(settingsIcon(item.icon, 'sm'));
            const copy = element('div'); copy.append(element('b', item.name), element('span', item.description));
            const state = element('span', item.state); state.className = `akari-set-permission-state${item.state === t('surfaces.settings.permissionLabelPermitted.label') ? ' akari-set-permission-state-ok' : ''}`;
            row.append(tile, copy, state, action(t('surfaces.settings.privacySystemSettings.button'), () => this.windows.openNewWindow(item.url, { external: true }), { small: true }));
            return row;
        });
        section.append(groupCard(t('surfaces.settings.privacyMacosPermissions.label'), ...rows),
        groupCard(t('surfaces.settings.privacyDataSentExternally.label'), settingRow(t('surfaces.settings.privacyUsageDataSharing.label'), t('surfaces.settings.privacyAkariVideoSendingUsageInformation.label'), statusPill(t('surfaces.settings.privacySending.label'))),
            ...(this.vibePreviewEnabled() ? [settingRow(t('surfaces.settings.privacyListeningMic.label'), t('surfaces.settings.privacyTrialListeningMemosTranscribedPcSetJev.description'))] : []),
            settingRow(t('surfaces.settings.privacyApiKeys.label'), t('surfaces.settings.privacySaveKeyComputerSentAkarisServer.message', { path: this.credentialsPath || (OS.type() === OS.Type.Windows ? '%USERPROFILE%\\.akari\\credentials.env' : '~/.akari/credentials.env') }), action(t('surfaces.settings.privacyOpenLocation.button'), () => {
                if (this.credentialsPath) { void this.maintenance.openPath(this.credentialsPath.replace(/[\\/][^\\/]+$/, '')); }
            }, { small: true }))));
    }

    protected renderStatistics(section: HTMLElement): void {
        const wrap = element('div'); wrap.className = 'akari-set-soon';
        const blurred = element('div'); blurred.className = 'akari-set-soon-blur'; blurred.setAttribute('aria-hidden', 'true');
        const kpi = element('div'); kpi.className = 'akari-set-stats-kpi';
        for (const [label, value] of [[t('surfaces.settings.statisticsAmountSpent.label'), '$23.10'], [t('surfaces.settings.statisticsToken.label'), '4.2 M'], [t('surfaces.settings.statisticsGeneratedVideo.label'), t('surfaces.settings.sampleVideoCount.label')]]) {
            const tile = element('div'); tile.append(element('span', label), element('b', value)); kpi.append(tile);
        }
        const chart = element('div'); chart.className = 'akari-set-stats-chart';
        [20, 35, 28, 60, 44, 12, 8, 52, 70, 33, 41, 25, 18, 64].forEach((height, index) => {
            const bar = element('i'); bar.style.height = `${height}%`; if (index % 5 === 3) { bar.className = 'akari-set-stats-chart-hi'; } chart.append(bar);
        });
        blurred.append(groupCard(t('surfaces.settings.statisticsDays.label'), kpi, chart));
        const services = [['OpenRouter · Akari Vibe', '$11.40', 62], [t('surfaces.settings.statisticsFalImageVideoGeneration.label'), '$9.20', 48],
            [t('surfaces.settings.statisticsElevenlabsNarration.label'), '$2.50', 14]] as const;
        blurred.append(groupCard(t('surfaces.settings.statisticsService.label'), ...services.map(([name, amount, percent]) => {
            const row = element('div'); row.className = 'akari-set-stats-service';
            const logo = element('span'); logo.className = 'akari-set-stats-service-logo';
            const bar = element('span'); bar.className = 'akari-set-stats-service-bar';
            const fill = element('i'); fill.style.width = `${percent}%`; bar.append(fill);
            row.append(logo, element('span', name), bar, element('span', amount)); return row;
        })));
        const veil = element('div'); veil.className = 'akari-set-soon-veil';
        const copy = element('div'); copy.append(element('b', 'Coming soon'), element('span', t('surfaces.settings.statisticsUsageAmountAmountService.label'))); veil.append(copy);
        wrap.append(blurred, veil); section.append(wrap);
    }

    protected renderHelp(section: HTMLElement): void {
        const checklist = element('div'); checklist.className = 'akari-set-diagnostic-list';
        for (const label of [t('surfaces.settings.helpAppOsVersions.label'), t('surfaces.settings.helpRecentLogsHours.label'), t('surfaces.settings.helpToolStatusFfmpegEtc.label'), t('surfaces.settings.helpScreenArrangement.label'), t('surfaces.settings.helpProjectEditJson.label')]) {
            const item = element('span'); item.append(settingsIcon('check', 'sm'), element('span', label)); checklist.append(item);
        }
        const excluded = element('span', t('surfaces.settings.helpEnterApiKeyPersonalPass.label')); excluded.className = 'akari-set-diagnostic-excluded'; checklist.append(excluded);
        section.append(groupCard(t('surfaces.settings.helpExportDiagnosticInformation.label'), checklist,
            settingRow(t('surfaces.settings.helpSaveDestination.label'), homeShortened(this.diagnosticPath || t('surfaces.settings.helpChecking.label')), action(t('surfaces.settings.helpChangeLocation.button'), async () => {
                const destination = await this.fileDialogs.showSaveDialog({ title: t('surfaces.settings.helpSaveDiagnosticInformation.title'), inputValue: this.diagnosticPath });
                if (destination) { this.diagnosticPath = destination.path.fsPath(); this.diagnosticPathCustomized = true; this.renderSection('help'); }
            }, { small: true })),
            settingRow(t('surfaces.settings.helpCombineZip.label'), t('surfaces.settings.helpOnceOpenFinderSelectedOpenCheckContents.label'), action(t('surfaces.settings.helpExport.button'), async () => {
                const left = document.querySelector<HTMLElement>('#theia-left-content-panel')?.getBoundingClientRect().width || 0;
                const right = document.querySelector<HTMLElement>('#theia-right-content-panel')?.getBoundingClientRect().width || 0;
                try { const location = await this.maintenance.exportDiagnostics(this.diagnosticPathCustomized ? this.diagnosticPath : undefined,
                    { width: window.innerWidth, height: window.innerHeight, leftPanelWidth: left, rightPanelWidth: right },
                    this.workspaceRoot, this.credentialsPath);
                    this.diagnosticPath = location; this.renderSection('help');
                    await this.maintenance.revealPath(location); this.notice.textContent = t('surfaces.settings.diagnosticsExported.status'); }
                catch { this.notice.textContent = t('surfaces.settings.diagnosticsExportFailed.error'); }
            }, { small: true }))),
        groupCard(t('surfaces.settings.helpOthers.label'),
            settingRow(t('surfaces.settings.helpReportBug.label'), t('surfaces.settings.helpOpenGithubIssue.label'), action(t('surfaces.settings.helpOpen.button'), () => this.windows.openNewWindow(AKARI_VIDEO_NEW_ISSUE_URL, { external: true }), { small: true })),
            settingRow(t('surfaces.settings.helpOpenLogFolder.label'), '~/Library/Logs/AKARI Video', action(t('surfaces.settings.helpOpen.button'), () => void this.maintenance.openPath('~/Library/Logs/AKARI Video'), { small: true })),
            settingRow(t('surfaces.settings.helpReturnInitialScreenLayout.label'), t('surfaces.settings.helpDefaultPanelPositionRightRailArrangement.label'), action(t('surfaces.settings.helpPutBack.button'), () => void this.commands.executeCommand('reset.layout'), { small: true }))));
    }

    protected renderAbout(section: HTMLElement): void {
        this.stopAboutUpdaterEvents();
        this.aboutUpdateRow = undefined;
        this.aboutUpdaterState = INITIAL_SHELL_UPDATER_UI_STATE;
        this.aboutLastEventKind = undefined;
        this.aboutCurrentVersion = undefined;
        this.aboutCheckedAt = undefined;
        this.aboutDownloadUrl = undefined;
        const generation = this.aboutUpdateGeneration;
        const eventSequence = this.aboutEventSequence;
        if (!section.hidden) {
            this.aboutUpdaterUnsubscribe = window.electronAkariUpdater?.onEvent(event => {
                if (this.isDisposed || section.hidden || generation !== this.aboutUpdateGeneration) { return; }
                this.aboutEventSequence += 1;
                this.applyAboutUpdaterEvent(event);
            });
        }
        section.append(groupCard('AKARI Video', settingsNote(t('surfaces.settings.aboutCheckingVersionBuildInformation.label'))));
        void Promise.all([this.maintenance.appInfo(), window.electronAkariUpdater?.getLastEvent(), this.maintenance.getUpdateSettings().catch(() => undefined),
            window.electronAkariUpdater?.getCapabilities().catch(() => ({ updateUiEnabled: false })), this.resolveAboutUpdateDownloadUrl()]).then(([info, update, updateSettings, capabilities, downloadUrl]) => {
            if (this.isDisposed || !section.isConnected || generation !== this.aboutUpdateGeneration) { return; }
            this.aboutCurrentVersion = info.version;
            this.aboutCheckedAt ??= info.lastChecked;
            this.aboutDownloadUrl = downloadUrl ?? RELEASES_PAGE_URL;
            if (update && eventSequence === this.aboutEventSequence) { this.applyAboutUpdaterEvent(update, true); }
            section.replaceChildren(...this.sectionHeading('about'));
            const icon = element('img'); icon.src = info.icon || AKARI_APP_ICON; icon.alt = 'AKARI Video'; icon.width = 64; icon.height = 64;
            icon.onerror = () => { const logo = element('strong', 'AKARI'); logo.style.width = '64px'; icon.replaceWith(logo); };
            const hero = element('div'); hero.className = 'akari-set-about-hero';
            const identity = element('div'); identity.append(element('h3', 'AKARI Video'),
                element('p', t('surfaces.settings.aboutVBuild.message', { infoVersion: info.version, buildDate: info.buildDate, os: info.os })));
            hero.append(icon, identity);
            const updateRow = capabilities && !capabilities.updateUiEnabled
                ? settingsNote(t('surfaces.settings.aboutSinceDevelopmentVersionUpdatesCannotConfirmed.label'))
                : this.createAboutUpdateRow();
            this.aboutUpdateRow = capabilities && !capabilities.updateUiEnabled ? undefined : updateRow;
            const networkExplanation = el('div');
            networkExplanation.setAttribute('data-akari-network-explanation', 'true');
            networkExplanation.append(
                settingsNote(t('surfaces.settings.aboutAkariVideoDoesSendUsageInformation.message')),
                settingsNote(t('surfaces.settings.aboutAutomaticallyCheckListNewEditionsAssetsDont.message')),
                settingsNote(t('surfaces.settings.aboutSendApiKeyCompanyAiFunction.message')),
                settingRow(t('surfaces.settings.aboutPrivacyPolicy.label'), 'https://akari.video/privacy',
                    action(t('surfaces.settings.aboutOpen.button'), () => this.windows.openNewWindow('https://akari.video/privacy', { external: true }), { small: true }))
            );
            const main = groupCard(undefined, hero,
                updateRow,
                settingRow(t('surfaces.settings.aboutEditionReceive.label'), t('surfaces.settings.aboutDefaultStableVersionWantTryOutNew.label'), segmentedControl({ label: t('surfaces.settings.aboutEditionReceive.label'), options: [{ value: 'stable', label: t('surfaces.settings.aboutStableVersion.label') }, { value: 'prerelease', label: t('surfaces.settings.aboutPreReleaseToo.label') }],
                    value: updateSettings?.channel ?? this.preferences.get('akari.update.channel', 'stable'), onChange: value => {
                        this.savePreference('akari.update.channel', value);
                        void this.maintenance.setUpdateSettings({ channel: value });
                    } })),
                settingRow(t('surfaces.settings.aboutAutomaticConfirmationUpdatesAssets.label'), t('surfaces.settings.aboutAutomaticallyCheckNewEditionsListAssetsPurchased.label'), switchControl({ label: t('surfaces.settings.aboutAutomaticConfirmationUpdatesAssets.label'),
                    checked: updateSettings?.autoCheck ?? this.preferences.get<boolean>('akari.update.autoCheck', true), onChange: checked => {
                        this.savePreference('akari.update.autoCheck', checked);
                        void this.maintenance.setUpdateSettings({ autoCheck: checked });
                    } })),
                networkExplanation);
            section.append(main);
            if (info.recentChanges) {
                const release = element('div'); release.className = 'akari-set-about-release';
                release.append(element('b', `v${info.recentChanges.version}`), element('span', formatShortReleaseDate(info.recentChanges.date)));
                if (info.recentChanges.notesUrl) { release.append(action(t('surfaces.settings.aboutSeeChanges.button'), () => this.windows.openNewWindow(info.recentChanges!.notesUrl!, { external: true }), { small: true })); }
                section.append(groupCard(t('surfaces.settings.aboutRecentChanges.label'), release));
            }
            section.append(groupCard(undefined, settingRow(t('surfaces.settings.aboutLink.label'), t('surfaces.settings.aboutAkariVideoGithubOpenSourceLicense.label'),
                ...[[t('surfaces.settings.aboutOfficialWebsite.label'), 'https://akari.video'], ['GitHub', AKARI_VIDEO_REPO_URL], [t('surfaces.settings.aboutLicense.label'), AKARI_VIDEO_LICENSE_URL]].map(([label, url]) =>
                    action(label, () => this.windows.openNewWindow(url, { external: true }), { small: true })))));
        }).catch(() => { this.notice.textContent = t('surfaces.settings.aboutAppInformationLoadFailed.error'); });
    }

    protected stopAboutUpdaterEvents(): void {
        this.aboutUpdateGeneration += 1;
        this.aboutUpdaterUnsubscribe?.();
        this.aboutUpdaterUnsubscribe = undefined;
    }

    protected applyAboutUpdaterEvent(event: ShellUpdaterEvent, replay = false): void {
        const openFallback = !replay && shouldOpenUpdaterBrowserFallback(this.aboutUpdaterState, event) && this.aboutDownloadUrl;
        this.aboutUpdaterState = applyShellUpdaterEvent(this.aboutUpdaterState, event);
        this.aboutLastEventKind = event.kind;
        if (!replay && (event.kind === 'update-not-available' || event.kind === 'update-available' || event.kind === 'update-downloaded')) {
            this.aboutCheckedAt = new Date().toISOString();
        }
        this.refreshAboutUpdateRow();
        if (openFallback) { this.windows.openNewWindow(openFallback, { external: true }); }
    }

    protected refreshAboutUpdateRow(): void {
        if (!this.aboutUpdateRow || this.isDisposed || this.sections.get('about')?.hidden) { return; }
        const next = this.createAboutUpdateRow();
        this.aboutUpdateRow.replaceWith(next);
        this.aboutUpdateRow = next;
    }

    protected createAboutUpdateRow(): HTMLElement {
        const view = resolveSettingsUpdateView({
            state: this.aboutUpdaterState,
            lastEventKind: this.aboutLastEventKind,
            currentVersion: this.aboutCurrentVersion ?? '',
            lastChecked: this.aboutCheckedAt ? formatDate(new Date(this.aboutCheckedAt)) : t('surfaces.settings.aboutUpdateRowConfirmedYet.label'),
            downloadUrl: this.aboutDownloadUrl
        });
        const button = action(view.button.label, () => {
            if (view.button.kind === 'restart') {
                void window.electronAkariUpdater?.restartAndInstall();
                return;
            }
            this.aboutUpdaterState = beginUserInitiatedUpdaterCheck(this.aboutUpdaterState);
            this.aboutLastEventKind = 'checking-for-update';
            this.refreshAboutUpdateRow();
            const api = window.electronAkariUpdater;
            if (!api) {
                this.aboutUpdaterState = applyImmediateUpdaterFallback(this.aboutUpdaterState, t('surfaces.settings.aboutUpdateRowAppUpdateFeatureAvailable.label'));
                this.refreshAboutUpdateRow();
                if (this.aboutDownloadUrl) { this.windows.openNewWindow(this.aboutDownloadUrl, { external: true }); }
                return;
            }
            const generation = this.aboutUpdateGeneration;
            void api.checkForUpdatesNow({ userInitiated: true }).catch(() => {
                if (this.isDisposed || this.sections.get('about')?.hidden || generation !== this.aboutUpdateGeneration) { return; }
                this.applyAboutUpdaterEvent({ kind: 'error', reason: t('surfaces.settings.aboutUpdateRowUnableStartUpdateProcess.label') });
            });
        }, { small: true, variant: view.button.primary ? 'primary' : 'ghost', icon: view.button.kind === 'check' ? 'refresh' : undefined });
        button.disabled = view.button.disabled;
        const controls = [button];
        if (view.browserFallback && this.aboutDownloadUrl) {
            controls.push(action(t('surfaces.settings.aboutUpdateRowGetBrowser.button'), () => this.windows.openNewWindow(this.aboutDownloadUrl!, { external: true }), { small: true }));
        }
        return settingRow(view.label, view.detail, ...controls);
    }

    protected async resolveAboutUpdateDownloadUrl(): Promise<string | undefined> {
        try {
            const home = await this.env.getValue('AKARI_HOME');
            const base = home?.value ? URI.fromFilePath(home.value) : new URI(await this.env.getHomeDirUri()).resolve('.akari');
            const cache = parseUpdateCache((await this.files.readFile(base.resolve('update-check.json'))).value.toString());
            const platform = OS.type() === OS.Type.OSX ? 'mac' : OS.type() === OS.Type.Windows ? 'win' : undefined;
            return resolveUpdateDownloadUrl(cache?.feed, platform);
        } catch { return undefined; }
    }

    async refreshLibraryStatus(): Promise<void> {
        try {
            this.libraryStatus = await this.toolsService.libraryStatus();
            if (!this.isDisposed) { this.renderSection('storage'); }
        } catch { this.notice.textContent = t('surfaces.settings.refreshLibraryStatusUnableConfirmAmountAsset.label'); }
    }

    showLibraryMoveProgress(progress: { bytes: number; totalBytes: number } | undefined): void {
        this.notice.textContent = progress?.totalBytes
            ? t('surfaces.settings.libraryMoveProgressMovingAsset.message', { movedSize: formatLibraryBytes(progress.bytes), totalSize: formatLibraryBytes(progress.totalBytes) })
            : t('surfaces.settings.libraryMoveProgressMovingAssetsWaitImportingIndexingFinish.message');
    }
    clearLibraryMoveProgress(): void { this.notice.textContent = ''; }

    protected async acceptSyncedLibrary(): Promise<void> {
        this.showLibraryMoveProgress(undefined);
        try { await this.toolsService.moveLibrary(); await this.refreshLibraryStatus(); this.notice.textContent = t('surfaces.settings.acceptSyncedLibraryAssetHasMoved.label'); }
        catch { this.notice.textContent = t('surfaces.settings.acceptSyncedLibraryAssetMoved.label'); }
    }

    protected async declineSyncedLibrary(): Promise<void> {
        try { await this.toolsService.declineLibraryMove(); await this.refreshLibraryStatus(); }
        catch { this.notice.textContent = t('surfaces.settings.declineSyncedLibraryFailedSaveSelection.label'); }
    }

    protected async clearLabLibrary(): Promise<void> {
        const targets = this.libraryStatus?.usage.cleanup ?? [];
        if (!targets.length) { return; }
        const list = element('div');
        list.append(element('p', t('surfaces.settings.clearLabLibraryMoveItemsReceivedLabTotalTrash.message', { count: targets.length, n: targets.length, size: formatLibraryBytes(this.libraryStatus!.usage.cleanupBytes) })));
        const names = element('ul');
        Object.assign(names.style, { maxHeight: '260px', overflow: 'auto', paddingLeft: '22px' });
        for (const item of targets) { names.append(element('li', `${item.title}（${formatLibraryBytes(item.bytes)}）`)); }
        list.append(names);
        const confirmed = await new ConfirmDialog({
            title: t('surfaces.settings.clearLabLibraryClearAwayAssetsSalvaged.title'), msg: list, ok: t('surfaces.settings.clearLabLibraryMoveTrash.label'), cancel: t('surfaces.settings.clearLabLibraryStop.label')
        }).open();
        if (!confirmed) { return; }
        try {
            const directories = await this.toolsService.labCleanupTargets(targets.map(item => item.libraryDir));
            let count = 0;
            for (const directory of directories) {
                if (await this.toolsService.isLibraryMoving()) { throw new Error('moving'); }
                await this.files.delete(URI.fromFilePath(directory), { recursive: true, useTrash: true });
                count++;
            }
            this.notice.textContent = t('surfaces.settings.clearLabLibraryMovedItemsTrash.label', { count: count, n: count });
            await this.refreshLibraryStatus();
        } catch { this.notice.textContent = t('surfaces.settings.clearLabLibraryCleanUpAssets.label'); }
    }

    /** はじめかたの進み具合。道具・接続の状態が読めたものだけ出す（読めないうちは枠ごと出さない）。 */
    protected startProgressSteps(): HTMLElement | undefined {
        const tools = this.toolsView?.checkedTools?.filter(tool => !tool.unsupported);
        const steps: { name: string; detail: string; done: boolean }[] = [];
        if (tools && tools.length > 0) {
            const ready = tools.filter(tool => tool.available).length;
            steps.push({ name: t('surfaces.settings.startProgressStepsTools.label'), detail: t('surfaces.settings.startProgressStepsDetail.label', { ready: ready, count: tools.length }), done: ready === tools.length });
        }
        if (this.connectionSummary && this.connectionSummary.total > 0) {
            const { configured, total } = this.connectionSummary;
            steps.push({ name: t('surfaces.settings.startProgressStepsConnection.label'), detail: t('surfaces.settings.startProgressStepsApiKey.label', { configured: configured, total: total }), done: configured > 0 });
        }
        if (steps.length === 0) { return undefined; }
        const wrap = element('div');
        wrap.className = 'akari-set-steps';
        wrap.setAttribute('data-akari-start-steps', 'true');
        for (const step of steps) {
            const node = element('div');
            node.className = 'akari-set-step';
            node.setAttribute('data-done', String(step.done));
            const name = element('div');
            name.className = 'akari-set-step-name';
            name.append(settingsIcon(step.done ? 'check' : 'circle'), element('span', step.name));
            const detail = element('span', step.detail);
            detail.className = 'akari-set-step-desc';
            node.append(name, detail);
            wrap.append(node);
        }
        return wrap;
    }

    /** オン / オフの設定 1 行（スイッチ）。 */
    protected preferenceSwitch(key: string, label: string, fallback: boolean, detail: string): HTMLElement {
        return settingRow(label, detail, switchControl({
            label, checked: this.preferences.get<boolean>(key, fallback),
            onChange: checked => this.savePreference(key, checked)
        }));
    }

    protected renderTranscribe(): void {
        const backend = this.preferences.get<TranscribeBackend>(AKARI_TRANSCRIBE_BACKEND, 'auto');
        const compareSet = this.preferences.get<string[]>(AKARI_TRANSCRIBE_COMPARE_SET, []);
        if (compareSet.length > 0) { this.compareDraft = compareSet; this.compareEnabled = true; }
        this.transcribe.replaceChildren(...this.sectionHeading('transcribe'));
        const engines = TRANSCRIBE_BACKENDS.map(id => ({ value: id, label: ENGINE_LABELS[id], description: ENGINE_DESCRIPTIONS[id] }));
        let fixedEngine: typeof TRANSCRIBE_BACKENDS[number] = backend === 'auto' ? 'speech-analyzer' : backend;
        const engine: DropdownHandle = dropdown({ label: t('surfaces.settings.transcribeTranscriptionEngine.label'), options: engines, value: fixedEngine, disabled: backend === 'auto',
            onChange: value => { fixedEngine = value; this.savePreference(AKARI_TRANSCRIBE_BACKEND, value); } });
        const policy = segmentedControl({ label: t('surfaces.settings.transcribeEngine.label'), value: backend === 'auto' ? 'auto' : 'fixed',
            options: [{ value: 'auto', label: t('surfaces.settings.transcribeAutomatic.label') }, { value: 'fixed', label: t('surfaces.settings.transcribeChosenEngine.label') }],
            onChange: value => {
                engine.akariSetDisabled?.(value === 'auto');
                this.savePreference(AKARI_TRANSCRIBE_BACKEND, value === 'auto' ? 'auto' : fixedEngine);
            } });
        this.transcribe.append(groupCard(t('surfaces.settings.transcribeEngineType.label'),
            settingRow(t('surfaces.settings.transcribeEngine.label'), t('surfaces.settings.transcribeAutomaticUsesSpeechanalyzerFirstWhisperCloudServices.label'), policy),
            settingRow(t('surfaces.settings.transcribeChosenEngine.label'), t('surfaces.settings.transcribeSelectedEngine.label'), engine)));
        const chips = checkChips({ label: t('surfaces.settings.transcribeEngineCompare.label'), checked: this.compareDraft,
            options: TRANSCRIBE_BACKENDS.map(id => ({ value: id, label: ENGINE_SHORT_LABELS[id] })),
            onToggle: (id, checked) => {
                this.compareDraft = TRANSCRIBE_BACKENDS.filter(candidate => candidate === id ? checked : this.compareDraft.includes(candidate));
                this.savePreference(AKARI_TRANSCRIBE_COMPARE_SET, [...this.compareDraft]);
            } });
        chips.hidden = !this.compareEnabled;
        const compare = switchControl({ label: t('surfaces.settings.transcribeComparingAlwaysGroup.label'), checked: this.compareEnabled, onChange: checked => {
            this.compareEnabled = checked;
            chips.hidden = !checked;
            this.savePreference(AKARI_TRANSCRIBE_COMPARE_SET, this.compareEnabled ? [...this.compareDraft] : []);
        } });
        const cuts = switchControl({ label: t('surfaces.settings.transcribeAutomaticallyCreateCutCandidates.label'), checked: this.preferences.get<boolean>(AKARI_TRANSCRIBE_AUTO_CUTS, true),
            onChange: checked => this.savePreference(AKARI_TRANSCRIBE_AUTO_CUTS, checked) });
        this.transcribe.append(groupCard(t('surfaces.settings.transcribeComparisonCutCandidates.label'),
            settingRow(t('surfaces.settings.transcribeComparingAlwaysGroup.label'), t('surfaces.settings.transcribeComparisonsMultipleChoiceTimeMarkEngineCompare.label'), compare), chips,
            settingRow(t('surfaces.settings.transcribeAutomaticallyCreateCutCandidates.label'), t('surfaces.settings.transcribeFillerRestatementSilenceCreateDontPutTimeline.label'), cuts)));
    }

    protected renderNarration(): void {
        const section = this.sections.get('narration')!;
        section.replaceChildren(...this.sectionHeading('narration'));
        const voicevox = this.narrationState?.engines.find(row => row.id === 'voicevox');
        const gemini = this.narrationState?.engines.find(row => row.id === 'gemini-tts');
        const irodoriState = this.narrationState?.engines.find(row => row.id === 'irodori');
        const voicevoxDetail = voicevox?.availability.detail;
        const voicevoxRunning = voicevoxDetail?.running === true;
        const voicevoxFound = voicevoxDetail?.app_found === true;
        const voicevoxPill = this.narrationLoading ? t('surfaces.settings.narrationConfirming.label') : voicevoxRunning
            ? t('surfaces.settings.narrationStarting.message', { version: voicevoxDetail?.version ?? t('surfaces.settings.narrationUnableCheckVersion.label') }) : voicevoxFound ? t('surfaces.settings.narrationStopped.label') : t('surfaces.settings.narrationIncluded.label');
        const engineCard = (id: string, label: string, state: string, description: string): { card: HTMLElement; actions: HTMLElement } => {
            const card = element('div');
            card.setAttribute('data-akari-narration-engine', id);
            Object.assign(card.style, { padding: '14px 16px', borderBottom: '1px solid var(--theia-border-color, #404040)' });
            const heading = element('div');
            Object.assign(heading.style, { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' });
            heading.append(element('strong', label), statusPill(state, (id === 'voicevox' && voicevoxRunning) || state === t('surfaces.settings.engineCardFalKey.status') || state === t('surfaces.settings.engineCardTrialConnected.status') ? 'ok' : 'neutral'));
            const detail = element('div', description);
            detail.style.opacity = '0.8';
            const actions = element('div');
            Object.assign(actions.style, { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '9px' });
            card.append(heading, detail, actions);
            return { card, actions };
        };
        const vv = engineCard('voicevox', 'VOICEVOX', voicevoxPill,
            t('surfaces.settings.narrationComputerFreeRequiresVoiceCreditVoicevoxCharacter.label'));
        if (!this.narrationLoading && !voicevoxFound && !voicevoxRunning) {
            if (this.narrationState?.voicevoxCaskAvailable) {
                const install = action(this.narrationBusy === 'install' ? t('surfaces.settings.narrationAdding.label') : t('surfaces.settings.narrationPut.label'), () => void this.installVoicevox(), { small: true });
                install.disabled = Boolean(this.narrationBusy);
                install.setAttribute('data-akari-narration-action', 'install');
                vv.actions.append(install);
            }
            const official = action(t('surfaces.settings.narrationOpenOfficialWebsite.button'), () => this.windows.openNewWindow('https://voicevox.hiroshiba.jp/', { external: true }), { small: true });
            official.setAttribute('data-akari-narration-action', 'official');
            vv.actions.append(official);
        } else if (!this.narrationLoading && voicevoxRunning) {
            const preview = action(this.narrationBusy === 'preview' ? t('surfaces.settings.narrationCreating.label') : t('surfaces.settings.narrationTryVoice.label'), () => void this.previewVoicevox(), { small: true });
            preview.disabled = Boolean(this.narrationBusy);
            preview.setAttribute('data-akari-narration-action', 'preview');
            const stop = action(t('surfaces.settings.narrationStop.button'), () => void this.operateVoicevox('stop'), { small: true });
            stop.disabled = Boolean(this.narrationBusy) || !voicevoxDetail?.managed;
            stop.title = voicevoxDetail?.managed ? '' : t('surfaces.settings.narrationQuitVoicevoxApp.label');
            stop.setAttribute('data-akari-narration-action', 'stop');
            vv.actions.append(preview, stop);
        } else if (!this.narrationLoading && voicevoxFound) {
            const start = action(this.narrationBusy === 'start' ? t('surfaces.settings.narrationStartingUp.label') : t('surfaces.settings.narrationStart.label'), () => void this.operateVoicevox('start'), { small: true });
            start.disabled = Boolean(this.narrationBusy);
            start.setAttribute('data-akari-narration-action', 'start');
            vv.actions.append(start);
        }
        if (this.voicevoxPreviewSrc && voicevoxRunning) {
            const audio = element('audio');
            audio.controls = true;
            audio.src = this.voicevoxPreviewSrc;
            audio.setAttribute('data-akari-narration-preview', 'true');
            vv.card.append(audio);
        }
        if (this.narrationBusy === 'install') {
            const progress = element('div');
            progress.className = 'akari-set-progress';
            progress.append(element('i'));
            vv.card.append(progress, settingsNote(t('surfaces.settings.narrationIntroducing.label')));
        }
        const geminiCard = engineCard('gemini-tts', 'Gemini 2.5 Flash TTS', this.narrationLoading ? t('surfaces.settings.narrationConfirming.label') :
            gemini?.availability.state === 'available' ? t('surfaces.settings.engineCardFalKey.status') : t('surfaces.settings.narrationFalKeyMissing.label'),
            t('surfaces.settings.narrationCloudFalAiUsageTentativeCharacters.label'));
        const connectionsButton = action(t('surfaces.settings.narrationConnectionsApiKeys.button'), () => this.showSection('connections'), { small: true });
        connectionsButton.setAttribute('data-akari-narration-action', 'connections');
        geminiCard.actions.append(connectionsButton);
        const irodori = engineCard('irodori', t('surfaces.settings.narrationAyaComputer.label'), this.narrationLoading ? t('surfaces.settings.narrationConfirming.label') :
            irodoriState?.availability.state === 'available' ? t('surfaces.settings.engineCardTrialConnected.status') : t('surfaces.settings.narrationCantConnect.label'),
            t('surfaces.settings.narrationIrodoriTtsMitConnectingSeparatelyStartedServer.description'));
        const experimentalPill = statusPill(t('surfaces.settings.narrationTrial.label'), 'neutral');
        experimentalPill.setAttribute('data-akari-experimental', 'true');
        irodori.card.querySelector('strong')?.after(experimentalPill);
        const irodoriUrl = element('input'); irodoriUrl.type = 'text';
        irodoriUrl.value = this.preferences.get(AKARI_NARRATION_IRODORI_URL) ?? 'http://127.0.0.1:8088';
        irodoriUrl.setAttribute('aria-label', t('surfaces.settings.narrationAyasConnectionUrl.label')); irodoriUrl.setAttribute('data-akari-irodori-url', 'true');
        const invalidUrlNote = settingsNote(t('surfaces.settings.narrationEnterHttpHttpsUrl.message'));
        invalidUrlNote.hidden = true; invalidUrlNote.setAttribute('data-akari-irodori-url-error', 'true');
        const saveUrl = action(t('surfaces.settings.narrationSave.button'), () => {
            const value = irodoriUrl.value.trim();
            if (!isValidIrodoriUrl(value)) { invalidUrlNote.hidden = false; return; }
            invalidUrlNote.hidden = true;
            this.savePreference(AKARI_NARRATION_IRODORI_URL, value);
            void this.preferenceWrites.then(() => this.refreshNarrationState());
        }, { small: true });
        saveUrl.setAttribute('data-akari-narration-action', 'save-irodori-url');
        irodori.card.append(settingRow(t('surfaces.settings.narrationConnectionDestinationUrl.label'), t('surfaces.settings.narrationIrodoriServerSamePcAnotherPc.label'), irodoriUrl, saveUrl));
        irodori.card.append(invalidUrlNote);
        const checkIrodori = action(t('surfaces.settings.narrationCheckConnection.button'), () => void this.refreshNarrationState(), { small: true });
        checkIrodori.setAttribute('data-akari-narration-action', 'check-irodori');
        irodori.actions.append(checkIrodori);
        const setup = element('details'); const summary = element('summary', t('surfaces.settings.narrationSetUpServer.label')); setup.append(summary);
        const commandLine = (command: string): HTMLElement => {
            const pre = element('pre'); pre.append(element('code', command)); return pre;
        };
        const setupSteps = (platform: string, backends: readonly { label: string; command: string }[]): void => {
            setup.append(element('h4', platform), commandLine('git clone https://github.com/Aratako/Irodori-TTS-Server.git'),
                commandLine('cd Irodori-TTS-Server'));
            for (const backend of backends) setup.append(element('p', backend.label), commandLine(backend.command));
            setup.append(commandLine('cp .env.example .env'),
                commandLine('uv run --no-sync python -m irodori_openai_tts --host 0.0.0.0 --port 8088'));
        };
        setupSteps('Windows（PowerShell）', [
            { label: 'NVIDIA GPU', command: 'uv sync --extra cu128' },
            { label: t('surfaces.settings.narrationCpu.label'), command: 'uv sync --extra cpu' }
        ]);
        setupSteps('Linux', [
            { label: 'NVIDIA GPU', command: 'uv sync --extra cu128' },
            { label: 'AMD GPU（ROCm）', command: 'uv sync --extra rocm' },
            { label: t('surfaces.settings.narrationCpu.label'), command: 'uv sync --extra cpu' }
        ]);
        setup.append(element('h4', 'macOS（Apple Silicon）'),
            commandLine('git clone https://github.com/Aratako/Irodori-TTS-Server.git'),
            commandLine('cd Irodori-TTS-Server'), commandLine('uv sync --extra cpu'),
            commandLine('cp .env.example .env'),
            commandLine('IRODORI_MODEL_DEVICE=mps IRODORI_CODEC_DEVICE=mps uv run --no-sync python -m irodori_openai_tts --host 0.0.0.0 --port 8088'),
            element('p', t('surfaces.settings.narrationInitialModelApproximatelyGbSecondTimeOnwards.message')));
        setup.append(element('p', t('surfaces.settings.narrationAnotherPcEnterHttpAkarisConnectionDestination.description')));
        irodori.card.append(setup);
        const officialIrodori = action(t('surfaces.settings.narrationOpenOfficialRepository.button'), () => this.windows.openNewWindow('https://github.com/Aratako/Irodori-TTS-Server', { external: true }), { small: true });
        officialIrodori.setAttribute('data-akari-narration-action', 'irodori-official'); irodori.actions.append(officialIrodori);
        section.append(groupCard(t('surfaces.settings.narrationEngine.label'), vv.card, geminiCard.card, irodori.card));
        const voicesSection = groupCard(t('surfaces.settings.narrationOwnVoice.label'));
        const createVoice = action(t('surfaces.settings.narrationCreateOwnVoice.button'), () => void this.commands.executeCommand('akari.voice.create').then(() => this.refreshNarrationState()), { small: true });
        createVoice.setAttribute('data-akari-voice-action', 'create');
        voicesSection.append(settingRow(t('surfaces.settings.narrationOwnVoice.label'), t('surfaces.settings.narrationSaveRecordingOriginal.label'), createVoice));
        if (!this.voiceProfilesLoaded) voicesSection.append(settingsNote(this.narrationError ? t('surfaces.settings.narrationFailedRetrieveListVoices.message') : t('surfaces.settings.narrationLoading.label')));
        const profiles = this.voiceProfiles.filter(profile => !profile.legacy || !this.voiceProfiles.some(other => other.id === profile.id && !other.legacy));
        for (const profile of profiles) {
            const buttons = element('div'); Object.assign(buttons.style, { display: 'flex', gap: '6px', flexWrap: 'wrap' });
            const choices = voiceSettingsActions(profile, irodoriState?.availability.state === 'available',
                falKeyAvailable(this.narrationState?.engines.find(engine => engine.id === 'fal-qwen3')),
                this.narrationState?.engines.some(engine => engine.id === 'gemini-3.8-flash-tts' && engine.availability.state !== 'unconfigured'));
            const addButton = (label: string, id: string, callback: () => void): void => {
                const button = action(label, callback, { small: true }); button.setAttribute('data-akari-voice-action', id); buttons.append(button);
            };
            if (choices.migrate) addButton(t('surfaces.settings.narrationMoveNewLocation.label'), 'migrate', () => void this.voiceAction(async () => {
                if (!await this.confirmVoiceAction(t('surfaces.settings.narrationMoveNewLocation.label'), t('surfaces.settings.narrationCopyOldLocationRemains.label'), t('surfaces.settings.narrationTransfer.label'))) return;
                await this.narrationService.voiceMigrateLegacy(profile.id);
            }));
            if (choices.rename) {
                const name = element('input'); name.value = profile.label; name.setAttribute('aria-label', t('surfaces.settings.narrationName.message', { profileLabel: profile.label })); buttons.append(name);
                addButton(t('surfaces.settings.narrationChangeName.label'), 'rename', () => void this.voiceAction(() => this.narrationService.voiceRename(profile.id, name.value)));
            }
            const copy = (engine: 'irodori' | 'fal-qwen3'): void => void this.voiceAction(async () => {
                let approved = false;
                if (engine === 'fal-qwen3') {
                    approved = await new ConfirmDialog({ title: t('surfaces.settings.copyExpenseApproval.title'), msg: t('surfaces.settings.copySendRecordingCloudFalMakeTranscriptEstimate.message'),
                        ok: t('surfaces.settings.copyApproveCost.label'), cancel: t('surfaces.settings.copyCancel.label') }).open();
                    if (!approved) return;
                }
                await this.narrationService.voiceCopy({ profile: profile.id, engine, approved,
                    irodoriUrl: engine === 'irodori' ? this.preferences.get(AKARI_NARRATION_IRODORI_URL) : undefined });
            });
            if (choices.addIrodori) addButton(t('surfaces.settings.narrationAddCopyAyaComputer.label'), 'copy-irodori', () => copy('irodori'));
            if (choices.addFal) addButton(t('surfaces.settings.narrationAddCopyCloudFal.label'), 'copy-fal', () => copy('fal-qwen3'));
            const copyGemini = (): void => void this.voiceAction(async () => {
                const consentAudioPath = await this.geminiConsentDialog();
                if (!consentAudioPath) return;
                try {
                    const approved = await new ConfirmDialog({ title: t('surfaces.settings.copyGeminiExpenseApproval.title'),
                        msg: t('surfaces.settings.copyGeminiCreateVoiceSendingOriginalConsentRecordingPerson.message'),
                        ok: t('surfaces.settings.copyGeminiApproveCost.label'), cancel: t('surfaces.settings.copyGeminiCancel.label') }).open();
                    if (!approved) return;
                    await this.narrationService.voiceCopy({ profile: profile.id, engine: 'gemini-3.8-flash-tts', consentAudioPath, approved: true });
                } finally { await this.narrationService.voiceDiscardGeminiConsent(consentAudioPath); }
            });
            if (choices.addGemini) addButton(t('surfaces.settings.narrationAddCopyGoogleGemini.label'), 'copy-gemini', copyGemini);
            if (choices.remakeIrodori) addButton(t('surfaces.settings.narrationRebuildAyaComputer.label'), 'remake-irodori', () => copy('irodori'));
            if (choices.remakeFal) addButton(t('surfaces.settings.narrationRecreateCloudFal.label'), 'remake-fal', () => copy('fal-qwen3'));
            if (choices.remakeGemini) addButton(t('surfaces.settings.narrationRemakeGoogleGemini.label'), 'remake-gemini', copyGemini);
            if (choices.remove) addButton(t('surfaces.settings.narrationErase.label'), 'delete', () => void this.voiceAction(async () => {
                if (!await this.confirmVoiceAction(t('surfaces.settings.narrationDeleteOwnVoice.button'), t('surfaces.settings.narrationDeleteRecordingHandAyasRegistrationVoicesCreated.label'), t('surfaces.settings.narrationErase.label'))) return;
                await this.narrationService.voiceDelete(profile.id, this.preferences.get(AKARI_NARRATION_IRODORI_URL));
            }));
            const row = settingRow(profile.label, undefined, buttons);
            row.setAttribute('data-akari-voice-profile', profile.id);
            Object.assign(row.style, { gridTemplateColumns: 'minmax(0, 1fr)', gap: '8px' });
            const control = row.querySelector<HTMLElement>('.akari-set-row-control');
            if (control) control.style.justifyContent = 'flex-start';
            const detail = element('div', t('surfaces.settings.narrationSeconds.message', { avatar: voiceAvatarLabel(profile.avatar, this.voiceAvatars), date: profile.created_at?.slice(0, 10) ?? t('surfaces.settings.narrationDateUnknown.label'), duration: profile.duration_s?.toFixed(1) ?? '—', n: pluralCountForDisplay(profile.duration_s?.toFixed(1) ?? '—') }));
            detail.className = 'akari-set-row-desc';
            const pills = element('div'); Object.assign(pills.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' });
            for (const engine of profile.engines) {
                pills.append(statusPill(engine === 'irodori' ? t('surfaces.settings.narrationAyaComputer.label') : t('surfaces.settings.narrationCloudFal.label'), 'neutral'));
                if (profile.copies?.[engine]?.stale) pills.append(statusPill(t('surfaces.settings.narrationOld.label'), 'warn'));
            }
            if (profile.legacy) pills.append(statusPill(t('surfaces.settings.narrationOldPlace.label'), 'warn'));
            row.querySelector('.akari-set-row-text')?.append(detail, pills);
            voicesSection.append(row);
        }
        section.append(voicesSection);
        if (this.narrationError) section.append(settingsNote(this.narrationError));
        const engine = this.preferences.get(AKARI_NARRATION_ENGINE);
        const voiceValue = this.preferences.get(AKARI_NARRATION_VOICE);
        const voices = typeof voiceValue === 'object' && voiceValue !== null && !Array.isArray(voiceValue)
            ? voiceValue as Record<string, unknown> : {};
        const geminiVoice = typeof voices['gemini-tts'] === 'string' && GEMINI_NARRATION_VOICES.some(id => id === voices['gemini-tts'])
            ? voices['gemini-tts'] : 'Leda';
        const voicevoxSpeaker = typeof voices.voicevox === 'string' && voices.voicevox ? voices.voicevox : t('surfaces.settings.narrationSelected.label');
        const defaultEngineSelect = element('select');
        defaultEngineSelect.setAttribute('aria-label', t('surfaces.settings.narrationDefaultEngine.label'));
        defaultEngineSelect.dataset.akariNarrationDefaultEngine = 'true';
        const chevron = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="m2 4 4 4 4-4" fill="none" stroke="#a0a0a0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
        Object.assign(defaultEngineSelect.style, { appearance: 'none', WebkitAppearance: 'none', boxSizing: 'border-box',
            minWidth: '220px', maxWidth: '320px', minHeight: '34px', padding: '7px 32px 7px 12px', borderRadius: '8px',
            backgroundColor: 'var(--akari-bg)', border: '1px solid var(--akari-line)', color: 'var(--akari-ink)',
            fontSize: '13px', cursor: 'pointer', backgroundImage: `url("data:image/svg+xml,${chevron}")`,
            backgroundPosition: 'right 12px center', backgroundRepeat: 'no-repeat', backgroundSize: '12px 12px' });
        defaultEngineSelect.addEventListener('focus', () => { defaultEngineSelect.style.borderColor = 'var(--akari-accent-light)'; });
        defaultEngineSelect.addEventListener('blur', () => { defaultEngineSelect.style.borderColor = 'var(--akari-line)'; });
        const addGroup = (label: string, rows: Array<[string, string]>): void => {
            const group = element('optgroup'); group.label = label;
            for (const [id, title] of rows) {
                const state = this.narrationState?.engines.find(row => row.id === id);
                const option = element('option', t('surfaces.settings.addGroupElement.message', { name: title, keyWarning: state?.availability.state === 'unconfigured' && label === t('surfaces.settings.addGroupCloud.label') ? t('surfaces.settings.addGroupNoKey.label') : '' }));
                option.value = id; group.append(option);
            }
            defaultEngineSelect.append(group);
        };
        addGroup(t('surfaces.settings.narrationComputer.label'), [['voicevox', 'VOICEVOX'], ['irodori', t('surfaces.settings.narrationAyaTrial.label')]]);
        addGroup(t('surfaces.settings.addGroupCloud.label'), [['gemini-3.8-flash-tts', 'Gemini 3.8 Flash TTS'],
            ['gemini-3.1-flash-tts', 'Gemini 3.1 Flash TTS'], ['gemini-tts', 'Gemini 2.5 Flash TTS'],
            ['elevenlabs-v3', 'ElevenLabs v3'], ['fish-s2.1-pro', 'Fish Audio S2.1-Pro'],
            ['minimax-2.6-hd', 'MiniMax 2.6 HD'], ['chatterbox', t('surfaces.settings.narrationChatterboxMultilingual.label')]]);
        addGroup(t('surfaces.settings.narrationOwnVoice.label'), profiles.filter(profile => typeof profile.consent === 'string' ? profile.consent.trim() : profile.consent?.self_voice)
            .map(profile => [`voice:${profile.id}`, t('surfaces.settings.narrationVoice.message', { profileLabel: profile.label })]));
        if (!this.voiceProfilesLoaded && typeof engine === 'string' && engine.startsWith('voice:')
            && !profiles.some(profile => `voice:${profile.id}` === engine)) {
            const option = element('option', t('surfaces.settings.narrationVoiceLoading.label')); option.value = engine;
            defaultEngineSelect.lastElementChild?.append(option);
        }
        defaultEngineSelect.value = settingsVoiceEngineValue(engine, profiles, this.voiceProfilesLoaded);
        defaultEngineSelect.addEventListener('change', () => this.savePreference(AKARI_NARRATION_ENGINE, defaultEngineSelect.value));
        section.append(groupCard(t('surfaces.settings.narrationDefaultValue.label'),
            settingRow(t('surfaces.settings.narrationDefaultEngine.label'), t('surfaces.settings.narrationEngineSelectedNarrationDialogOpens.label'),
                defaultEngineSelect),
            settingRow(t('surfaces.settings.narrationGeminiDefaultVoice.label'), t('surfaces.settings.narrationVoicesGeminiFlashTts.label'),
                dropdown({ label: t('surfaces.settings.narrationGeminiDefaultVoice.label'), options: GEMINI_NARRATION_VOICES.map(id => ({ value: id, label: id })),
                    value: geminiVoice, onChange: value => {
                        const current = this.preferences.get(AKARI_NARRATION_VOICE);
                        const saved = typeof current === 'object' && current !== null && !Array.isArray(current)
                            ? current as Record<string, unknown> : {};
                        this.savePreference(AKARI_NARRATION_VOICE, { ...saved, 'gemini-tts': value });
                    } })),
            settingRow(t('surfaces.settings.narrationVoicevoxDefaultVoice.label'), t('surfaces.settings.narrationChoosingVoiceNarrationDialogSaves.label'),
                element('span', voicevoxSpeaker))));
        const note = settingsNote(t('surfaces.settings.narrationGeminiFalKeyRequirement.message'));
        note.append(' ', inlineLink(t('surfaces.settings.narrationOpenConnectionApiKey.label'), () => this.showSection('connections')));
        section.append(note);
    }

    protected async refreshNarrationState(): Promise<void> {
        const generation = ++this.narrationRefreshGeneration;
        this.narrationLoading = true;
        this.renderNarration();
        try { const [state, profiles, avatars] = await Promise.all([
            this.narrationService.narrationEngines(this.preferences.get<string>(AKARI_NARRATION_IRODORI_URL, 'http://127.0.0.1:8088')),
            this.narrationService.voiceProfiles(), this.narrationService.voiceAvatars()]);
            if (generation === this.narrationRefreshGeneration) {
                this.narrationState = state; this.voiceProfiles = profiles.profiles; this.voiceProfilesLoaded = true;
                this.voiceAvatars = avatars.avatars; this.narrationError = '';
            } }
        catch (error) { if (generation === this.narrationRefreshGeneration)
            this.narrationError = error instanceof Error ? error.message : t('surfaces.settings.refreshNarrationStateGetStatus.message'); }
        finally { if (generation === this.narrationRefreshGeneration) {
            this.narrationLoading = false; if (!this.isDisposed) this.renderNarration();
        } }
    }
    protected async voiceAction(callback: () => Promise<void>): Promise<void> {
        try { await callback(); await this.refreshNarrationState(); }
        catch (error) { this.narrationError = String(error); this.renderNarration(); }
    }
    protected geminiConsentDialog(): Promise<string | undefined> {
        return new Promise(resolve => {
            const overlay = element('div'); overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', t('surfaces.settings.geminiConsentDialogVerbalConsentGoogle.label'));
            overlay.setAttribute('data-akari-gemini-consent', 'true');
            Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '1000', background: '#0009',
                display: 'flex', alignItems: 'center', justifyContent: 'center' });
            const panel = element('div'); Object.assign(panel.style, { background: '#242832', border: '1px solid #777',
                borderRadius: '10px', padding: '20px', width: 'min(560px, calc(100vw - 32px))', display: 'flex', flexDirection: 'column', gap: '12px' });
            const phrase = createGeminiConsentPrompt();
            const note = element('p', t('surfaces.settings.geminiConsentDialogReadConsentTextAloudRecordVerificationRuns.message'));
            const input = element('input') as HTMLInputElement; input.type = 'file'; input.accept = '.wav,.m4a,.mp3,.webm'; input.setAttribute('aria-label', t('surfaces.settings.geminiConsentDialogConsentRecordingFile.label'));
            let blob: Blob | undefined; let recorder: MediaRecorder | undefined; let stream: MediaStream | undefined;
            let checkedPath: string | undefined; let consentCheck: GeminiConsentCheck | undefined;
            const resetCheck = (): void => {
                if (checkedPath) void this.narrationService.voiceDiscardGeminiConsent(checkedPath);
                checkedPath = undefined; consentCheck = undefined;
            };
            input.onchange = () => { blob = input.files?.[0]; resetCheck(); note.textContent = blob ? t('surfaces.settings.geminiConsentDialogRecordingSavedReview.message') : t('surfaces.settings.geminiConsentDialogChooseRecording.message'); };
            const record = action(t('surfaces.settings.geminiConsentDialogRecord.button'), () => void (async () => {
                if (recorder?.state === 'recording') { recorder.stop(); record.textContent = t('surfaces.settings.geminiConsentDialogRecord.label'); return; }
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const chunks: Blob[] = []; recorder = new MediaRecorder(stream);
                    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
                    recorder.onstop = () => { blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }); resetCheck();
                        stream?.getTracks().forEach(track => track.stop()); note.textContent = t('surfaces.settings.geminiConsentDialogRecordingSavedReview.label'); };
                    recorder.start(); record.textContent = t('surfaces.settings.geminiConsentDialogStop.label');
                } catch { note.textContent = t('surfaces.settings.geminiConsentDialogAccessMicrophoneChooseRecordingFile.label'); }
            })(), { small: true });
            const finish = (path?: string): void => { recorder?.state === 'recording' && recorder.stop(); stream?.getTracks().forEach(track => track.stop());
                overlay.remove(); resolve(path); };
            const cancel = action(t('surfaces.settings.geminiConsentDialogCancel.button'), () => { resetCheck(); finish(); }, { small: true });
            const next = action(t('surfaces.settings.geminiConsentDialogCheckComputer.button'), () => void (async () => {
                if (checkedPath && geminiConsentCanNext(true, consentCheck)) { finish(checkedPath); return; }
                if (!blob) { note.textContent = t('surfaces.settings.geminiConsentDialogConsentRecordingRequired.label'); return; }
                next.disabled = true;
                try {
                    const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
                    for (const byte of bytes) binary += String.fromCharCode(byte);
                    const result = await this.narrationService.voiceCheckGeminiConsent(btoa(binary));
                    consentCheck = { pass: true, checks: { script: { ok: true, score: result.score } } };
                    if (!geminiConsentCanNext(true, consentCheck)) throw new Error(geminiConsentStatus(consentCheck));
                    checkedPath = result.path; note.textContent = geminiConsentStatus(consentCheck);
                    next.textContent = t('surfaces.settings.geminiConsentDialogNext.label');
                } catch (error) { note.textContent = String(error); } finally { next.disabled = false; }
            })(), { small: true });
            next.setAttribute('data-gemini-consent-next', 'true');
            const buttons = element('div'); buttons.append(cancel, next);
            panel.append(element('strong', t('surfaces.settings.geminiConsentDialogVerbalConsentGoogle.label')), phrase, record, input, note, buttons);
            overlay.append(panel); this.node.append(overlay);
        });
    }
    protected confirmVoiceAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
        return new Promise(resolve => {
            const overlay = element('div'); overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', title);
            overlay.setAttribute('data-akari-voice-confirmation', 'true');
            Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '1000', background: '#0009',
                display: 'flex', alignItems: 'center', justifyContent: 'center' });
            const panel = element('div'); Object.assign(panel.style, { background: '#242832', border: '1px solid #777',
                borderRadius: '10px', padding: '20px', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '12px' });
            panel.append(element('strong', title), element('p', message));
            const buttons = element('div'); Object.assign(buttons.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
            const finish = (accepted: boolean): void => { overlay.remove(); resolve(accepted); };
            const cancel = action(t('surfaces.settings.confirmVoiceActionCancel.button'), () => finish(false), { small: true });
            const accept = action(confirmLabel, () => finish(true), { small: true });
            accept.setAttribute('data-akari-voice-confirm', 'true');
            buttons.append(cancel, accept); panel.append(buttons); overlay.append(panel); this.node.append(overlay);
            accept.focus();
        });
    }

    protected async operateVoicevox(operation: 'start' | 'stop'): Promise<void> {
        this.narrationBusy = operation;
        this.renderNarration();
        let actionError = '';
        try {
            if (operation === 'start') await this.narrationService.startNarrationEngine('voicevox');
            else { await this.narrationService.stopNarrationEngine('voicevox'); this.voicevoxPreviewSrc = ''; }
        } catch (error) { actionError = error instanceof Error ? error.message : t('surfaces.settings.operateVoicevoxOperationFailed.message'); }
        finally {
            this.narrationBusy = '';
            await this.refreshNarrationState();
            if (actionError && !this.isDisposed) { this.narrationError = actionError; this.renderNarration(); }
        }
    }

    protected async previewVoicevox(): Promise<void> {
        this.narrationBusy = 'preview'; this.renderNarration();
        let actionError = '';
        try { this.voicevoxPreviewSrc = await this.narrationService.previewVoicevox(); }
        catch (error) { actionError = error instanceof Error ? error.message : t('surfaces.settings.previewVoicevoxCreatePreviewAudio.message'); }
        finally {
            this.narrationBusy = '';
            await this.refreshNarrationState();
            if (actionError && !this.isDisposed) { this.narrationError = actionError; this.renderNarration(); }
            const audio = this.sections.get('narration')?.querySelector<HTMLAudioElement>('[data-akari-narration-preview]');
            if (audio) void audio.play().catch(() => { /* ユーザー操作が必要なら controls を使う */ });
        }
    }

    protected async installVoicevox(): Promise<void> {
        this.narrationBusy = 'install'; this.renderNarration();
        let actionError = '';
        try {
            const result = await this.toolsService.installTool('voicevox');
            actionError = result.outcome === 'failed' ? result.message : '';
        } catch (error) { actionError = error instanceof Error ? error.message : t('surfaces.settings.installVoicevoxInstalled.message'); }
        finally {
            this.narrationBusy = '';
            await this.refreshNarrationState();
            if (actionError && !this.isDisposed) { this.narrationError = actionError; this.renderNarration(); }
        }
    }

    protected savePreference(key: string, value: unknown): void {
        this.localPreferenceWrites.add(key);
        this.preferenceWrites = this.preferenceWrites.then(() => this.preferences.set(key, value, PreferenceScope.User)).then(() => {
            setTimeout(() => this.localPreferenceWrites.delete(key), 500);
        }).catch(() => {
            this.localPreferenceWrites.delete(key);
            this.notice.textContent = t('surfaces.settings.savePreferenceFailedSaveSettings.label');
            if (!this.isDisposed) {
                const section = sectionForPreferenceKey(key);
                if (section) { this.renderSection(section); }
            }
        });
    }

    protected async loadConnections(): Promise<void> {
        try {
            const list = await this.service.listConnections();
            if (this.isDisposed) { return; }
            this.renderSubscriptions();
            this.renderProviders(list.providers);
            await this.renderImageAi();
            this.renderStorage(list.credentials);
            this.credentialsPath = list.credentials.path;
            this.renderSection('privacy');
        } catch {
            this.providerList.replaceChildren(settingsNote(t('surfaces.settings.connectionsFailedLoadConnectionList.message')), action(t('surfaces.settings.connectionsReload.button'), () => void this.loadConnections(), { small: true }));
        }
    }

    protected async renderImageAi(): Promise<void> {
        const state = await this.service.imageAiSettings();
        if (this.isDisposed) return;
        const status = settingsNote(state.configured
            ? t('surfaces.settings.imageAiFalKeyRegistered.message', { keySuffix: state.maskedTail ? t('surfaces.settings.imageAiEnding.label', { maskedTail: state.maskedTail }) : '' })
            : t('surfaces.settings.imageAiFalSettingKey.label'));
        status.setAttribute('data-akari-image-ai-status', state.configured ? 'configured' : 'unconfigured');
        const result = settingsNote(''); result.setAttribute('role', 'status');
        const check = action('接続を確かめる', () => {
            check.disabled = true; result.textContent = '接続を確かめています…';
            void this.service.checkImageAiConnection().then(doctor => { result.textContent = doctor.detail; })
                .catch(() => { result.textContent = t('surfaces.settings.imageAiConnectionCheckFailed.error'); })
                .finally(() => { check.disabled = false; });
        }, { small: true });
        const card = element('div');
        card.append(status);
        if (state.narrationKeyAvailable) {
            const reuse = action(state.useNarrationKey ? t('surfaces.settings.imageAiSharedKeyInUse.status') : t('surfaces.settings.imageAiUseSharedKey.option'), () => {
                reuse.disabled = true;
                void this.service.useNarrationImageAiKey(true).then(() => this.renderImageAi())
                    .catch(() => { result.textContent = t('surfaces.settings.imageAiSwitchKeys.label'); reuse.disabled = false; });
            }, { small: true });
            reuse.disabled = state.useNarrationKey;
            card.append(settingRow(t('surfaces.settings.imageAiFalKeyNarration.label'), t('surfaces.settings.imageAiShareRegisteredKeys.message'), reuse));
        }
        card.append(settingRow(t('surfaces.settings.imageAiConnection.label'), t('surfaces.settings.imageAiMakeLightReadingInquiryService.message'), check), result);
        this.imageAiRow.replaceChildren(card);
    }

    /** グループ見出し（生成 AI / 文字起こし）ごとのカードに並べる。並びは formatConnections の順を保つ。 */
    protected renderProviders(providers: ConnectionRow[]): void {
        const groups = new Map<ProviderGroup, ConnectionRow[]>();
        for (const row of providers) {
            const group = providerGroup(row.id);
            groups.set(group, [...groups.get(group) ?? [], row]);
        }
        const order: ProviderGroup[] = ['generate', 'transcribe'];
        this.providerList.replaceChildren(...order.filter(group => groups.has(group)).map(group => {
            const card = groupCard(PROVIDER_GROUP_LABELS[group], ...groups.get(group)!.map(row => this.providerRow(row)));
            card.setAttribute('data-akari-provider-group', group);
            return card;
        }));
        this.updateConnectionSummary(providers);
    }

    protected renderSubscriptions(): void {
        const entries = [
            { id: 'codex', label: 'ChatGPT（Codex）', maker: 'openai', guide: t('surfaces.settings.subscriptionsRunCodexLoginTerminal.label') },
            { id: 'antigravity', label: 'Antigravity', maker: 'google', guide: t('surfaces.settings.subscriptionsStartAgyTerminalSign.label') },
            { id: 'grok', label: 'Grok', maker: 'xai', guide: t('surfaces.settings.subscriptionsRunGrokLoginTerminal.label') }
        ] as const;
        const rows = entries.map(entry => {
            const state = this.imageRouteStates.find(row => row.id === entry.id);
            const row = element('div'); row.className = 'akari-set-prov';
            row.setAttribute('data-akari-subscription', entry.id);
            const logo = element('div'); logo.className = 'akari-set-logo';
            logo.appendChild(makerBadge(CONNECTION_MAKERS, entry.maker, false));
            const detail = element('div');
            detail.style.minWidth = '0';
            const name = element('div'); name.className = 'akari-set-prov-name';
            name.append(element('span', entry.label));
            const status = state?.state === 'ready' ? t('surfaces.settings.subscriptions.label') : state?.state === 'signed-out' ? t('surfaces.settings.subscriptionsSignRequired.label')
                : state?.state === 'missing' ? t('surfaces.settings.subscriptionsIncluded.label') : state?.state === 'unknown' ? t('surfaces.settings.subscriptionsCouldntConfirm.label') : t('surfaces.settings.subscriptionsChecking.label');
            name.append(statusPill(status, state?.state === 'ready' ? 'ok' : 'neutral'));
            detail.append(name, element('div', state?.state === 'ready' ? t('surfaces.settings.subscriptionsSignedStillImage.label') : entry.guide));
            row.append(logo, detail);
            return row;
        });
        this.subscriptionList.replaceChildren(groupCard(t('surfaces.settings.subscriptionsNoAdditionalFeesCurrentSubscription.label'), ...rows));
    }

    protected updateConnectionSummary(providers: ConnectionRow[]): void {
        this.connectionSummary = { configured: providers.filter(row => row.configured).length, total: providers.length };
        this.renderSection('start');
    }

    protected async refreshStoreEntitlements(intent: 'automatic' | 'user' = 'automatic'): Promise<void> {
        const generation = ++this.storeStatusGeneration;
        if (!this.storeState.connection.connected || this.storeState.phase !== 'idle') {
            this.storeReconnect = false;
            this.renderStore();
            return;
        }
        try {
            const view = await this.storeService.getAssetCatalogView(undefined, intent);
            if (this.isDisposed || generation !== this.storeStatusGeneration) { return; }
            this.storeReconnect = storeReconnectRequired(true, view.entitlementsStatus);
            this.renderStore();
        } catch { /* Keep the saved-credential status if the catalog is unavailable. */ }
    }

    /**
     * Akari アカウント節の中身: アカウント帯（接続状態・接続 / 解除）+ AKARI Store のグループ（状態・Store を開く）。
     * 将来のプラン（サブスク）の席はこの下に足す — 今は「準備中」の枠を出さない（2026-09-22 裁定）。
     * このメソッドは element / description / action と deriveStoreLabBaseUrl だけで組む
     * （akari-project/test/service-urls.test.mjs がメソッド単体を取り出して Store の URL を検査する）。
     */
    protected renderStore(): void {
        const state = this.storeState;
        const busy = state.phase === 'starting' || state.phase === 'pending';
        const connected = state.connection.connected && !this.storeReconnect;
        const who = state.connection.email ?? state.connection.identifier ?? '';
        const statusText = state.connectionLoading ? t('surfaces.settings.storeCheckingConnection.label')
            : state.phase === 'starting' ? t('surfaces.settings.storeStartingConnection.label')
                : state.phase === 'pending' ? t('surfaces.settings.storeApproveBrowserCode.message', { code: state.userCode ?? '' })
                    : this.storeReconnect ? STORE_RECONNECT_REQUIRED_MESSAGE
                        : state.connection.connected ? t('surfaces.settings.storeConnecting.message', { who: who }) : t('surfaces.settings.storeDisconnected.status');
        const url = `${deriveStoreLabBaseUrl(state.connection.url)}/`;

        const band = element('div');
        band.className = 'akari-set-group';
        band.setAttribute('data-akari-account-band', 'true');
        band.setAttribute('data-akari-settings-group', t('surfaces.settings.storeAccount.label'));
        const bandInner = element('div');
        bandInner.className = 'akari-set-account';
        const avatar = element('div');
        avatar.className = 'akari-set-avatar akari-set-avatar-user';
        avatar.setAttribute('aria-hidden', 'true');
        const identity = element('div');
        const name = element('div', connected ? (who || t('surfaces.settings.storeConnectingAkariAccount.label')) : t('surfaces.settings.storeAccountDisconnected.status'));
        name.className = 'akari-set-account-name';
        const lead = description(connected ? t('surfaces.settings.storePurchasedAssetsAkariVideo.message')
            : t('surfaces.settings.storeOnceConnectedAssetsPurchasedAkariVideoLab.message'));
        lead.className = 'akari-set-account-desc';
        identity.append(name, lead);
        const controls = element('div');
        controls.className = 'akari-set-store-controls';
        if (busy) {
            controls.append(action(t('surfaces.settings.storeCancel.button'), () => { this.storeConnectPending = false; this.storeController.cancel(); }, { small: true }));
        } else {
            if (!state.connection.connected || this.storeReconnect) {
                const connect = action(this.storeReconnect ? t('surfaces.settings.storeReconnect.label') : t('surfaces.settings.storeConnect.label'), () => {
                    this.storeConnectPending = true;
                    void this.storeController.start();
                }, { variant: 'primary' });
                connect.disabled = state.connectionLoading;
                controls.append(connect);
            }
            if (state.connection.connected) {
                const disconnect = action(t('surfaces.settings.storeDisconnect.button'), () => {
                    disconnect.disabled = true;
                    void this.storeController.disconnect().catch(() => {
                        this.notice.textContent = t('surfaces.settings.storeFailedDisconnectAkariAccount.label');
                        if (!this.isDisposed) { this.renderStore(); }
                    });
                }, { small: true });
                disconnect.disabled = state.connectionLoading;
                controls.append(disconnect);
            }
        }
        bandInner.append(avatar, identity, controls);
        band.append(bandInner);

        const store = element('div');
        store.className = 'akari-set-group';
        store.setAttribute('data-akari-store-group', 'true');
        store.setAttribute('data-akari-settings-group', 'AKARI Video Lab');
        const storeTitle = element('div', 'AKARI Video Lab');
        storeTitle.className = 'akari-set-group-title';
        const statusRow = element('div');
        statusRow.className = 'akari-set-row';
        const statusCopy = element('div');
        const statusLabel = element('div', t('surfaces.settings.storeConnection.label'));
        statusLabel.className = 'akari-set-row-label';
        const statusDetail = description(t('surfaces.settings.storeSearchPurchaseAssetsProductionPacksVideosOnce.message'));
        statusDetail.className = 'akari-set-row-desc';
        statusCopy.append(statusLabel, statusDetail);
        const status = element('span', statusText);
        status.className = `akari-set-pill ${connected ? 'akari-set-pill-ok' : this.storeReconnect ? 'akari-set-pill-warn' : 'akari-set-pill-neutral'}`;
        status.setAttribute('role', 'status');
        status.setAttribute('data-akari-store-status', connected ? 'connected' : this.storeReconnect ? 'reconnect' : busy ? 'pending' : 'disconnected');
        statusRow.append(statusCopy, status);
        const openRow = element('div');
        openRow.className = 'akari-set-row';
        const openCopy = element('div');
        const openLabel = element('div', t('surfaces.settings.storeOpenAkariVideoLab.label'));
        openLabel.className = 'akari-set-row-label';
        const openUrl = description(url.replace(/^https?:\/\//, '').replace(/\/$/, ''));
        openUrl.className = 'akari-set-row-desc';
        openCopy.append(openLabel, openUrl);
        openRow.setAttribute('data-akari-store-open', url);
        openRow.append(openCopy, action(t('surfaces.settings.storeOpen.button'), () => this.windows.openNewWindow(url, { external: true }), { small: true, iconAfter: 'ext' }));
        store.append(storeTitle, statusRow, openRow);
        if (state.error) {
            const error = description(state.error);
            error.className = 'akari-set-store-error';
            error.setAttribute('role', 'alert');
            store.append(error);
        }
        this.storeRow.replaceChildren(band, store);
    }

    protected renderStorage(credentials: ConnectionsList['credentials']): void {
        const detail = !credentials.exists ? t('surfaces.settings.storageCreatedRegisteredPlainTextPermissionReadCli.message', { credentialsPath: credentials.path })
            : credentials.secure_permissions ? t('surfaces.settings.storagePlainTextPermissionReadCliSkillsAlso.message', { credentialsPath: credentials.path })
                : t('surfaces.settings.storageCurrentFilePermissionsCorrectedNextRegistrationDeletion.message', { credentialsPath: credentials.path });
        this.storage.replaceChildren(groupCard(t('surfaces.settings.storageKeyStorageLocation.label'), settingRow(t('surfaces.settings.storageLocation.label'), t('surfaces.settings.storageSaveKeyComputer.message', { credentialsPath: credentials.path, detail: detail }), segmentedControl<'file' | 'encrypted'>({
            label: t('surfaces.settings.storageKeyStorageLocation.label'), value: 'file', onChange: () => undefined,
            options: [{ value: 'file', label: t('surfaces.settings.storageFile.label') }, { value: 'encrypted', label: t('surfaces.settings.storageEncryption.label'), disabled: true, title: t('surfaces.settings.storagePreparingEncryptSaveComputersLoginKey.title') }]
        }))), settingsNote(t('surfaces.settings.storageRegistrationLastDigitsDisplayedKeySentReports.message')));
    }

    protected providerRow(row: ConnectionRow): HTMLElement {
        const card = element('div');
        card.className = 'akari-set-prov';
        card.setAttribute('data-akari-provider', row.id);
        const logo = element('div');
        logo.className = 'akari-set-logo';
        const logoSource = providerLogo(row.id);
        if (logoSource) {
            const image = element('img');
            image.src = logoSource;
            image.alt = '';
            image.setAttribute('data-akari-provider-logo', row.id);
            logo.append(image);
        } else {
            logo.textContent = providerInitial(row.label);
            logo.setAttribute('data-akari-provider-logo-placeholder', row.id);
        }
        const main = element('div');
        main.style.minWidth = '0';
        const heading = element('div');
        heading.className = 'akari-set-prov-name';
        const status = statusPill('', 'neutral');
        status.setAttribute('role', 'status');
        heading.append(element('span', row.label), status);
        if (row.source === 'legacy') {
            const badge = element('span', t('surfaces.settings.providerRowReadingOldLocation.label'));
            badge.className = 'akari-set-pill akari-set-pill-warn';
            badge.setAttribute('data-credential-source', 'legacy');
            heading.append(badge);
        }
        if (row.id === 'fal') { heading.append(statusPill(t('surfaces.settings.providerRowRecommended.label'), 'accent')); }
        const display = PROVIDER_DISPLAY[row.id];
        const copy = element('div', display?.description ?? row.description);
        copy.className = 'akari-set-prov-desc';
        if (display?.highlight) { copy.append(element('em', display.highlight)); }
        const detail = element('div');
        detail.className = 'akari-set-prov-status';
        main.append(heading, copy, detail);
        const balance = providerHasBalanceEndpoint(row.id) ? this.balanceRow(row) : undefined;
        if (balance) { main.append(balance.node); }
        const controls = element('div');
        controls.className = 'akari-set-keyin';
        const actions = element('div');
        actions.className = 'akari-set-prov-actions';
        actions.append(controls);
        const links = element('div');
        links.className = 'akari-set-keyin';
        const billing = providerBillingUrl(row.id);
        if (billing) { links.append(action(t('surfaces.settings.providerRowManagementScreen.button'), () => this.windows.openNewWindow(billing, { external: true }), { small: true, iconAfter: 'ext' })); }
        if (row.setup_url?.startsWith('https://')) {
            const setupUrl = row.setup_url;
            links.append(action(t('surfaces.settings.providerRowGetKey.button'), () => this.windows.openNewWindow(setupUrl, { external: true }), { small: true, iconAfter: 'ext' }));
        }
        if (links.childElementCount > 0) { actions.append(links); }
        const paintStatus = (): void => {
            const [text, tone] = doctorPill(row);
            setPill(status, text, tone);
            status.setAttribute('data-connection-status', row.doctor.status);
            detail.textContent = row.configured ? doctorLabel(row.doctor) : '';
            balance?.setConfigured(row.configured);
        };
        const run = async (operation: () => Promise<void>): Promise<void> => {
            for (const control of Array.from(controls.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button'))) { control.disabled = true; }
            setPill(status, t('surfaces.settings.runConfirming.label'), 'neutral');
            try {
                await operation();
                renderControls();
                const list = await this.service.listConnections();
                if (!this.isDisposed) {
                    this.renderStorage(list.credentials);
                    this.renderProviders(list.providers);
                }
            } catch { detail.textContent = t('surfaces.settings.runCompleteActionCheckInputSaveLocation.message'); }
            finally {
                for (const control of Array.from(controls.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button'))) { control.disabled = false; }
            }
        };
        const renderControls = (): void => {
            controls.replaceChildren();
            paintStatus();
            if (row.configured) {
                const tail = element('code', `••••${row.masked_tail ?? ''}`);
                tail.className = 'akari-set-key-tail';
                controls.append(tail, action(t('surfaces.settings.controlsConfirmation.button'), () => void run(async () => {
                    row.doctor = (await this.service.checkConnection(row.id)).doctor;
                }), { small: true }), action(t('surfaces.settings.controlsDelete.button'), () => void run(async () => {
                    await this.service.deleteCredential(row.id);
                    row.configured = false; row.masked_tail = null;
                    row.doctor = { status: 'unconfigured', detail: t('surfaces.settings.controlsRegistered.label'), last_checked: null };
                }), { small: true }));
                if (row.source === 'legacy') {
                    controls.append(action(t('surfaces.settings.controlsMoveNewLocation.button'), () => void run(async () => {
                        await this.service.migrateCredential(row.id);
                    }), { small: true }));
                }
            } else {
                const input = textField({ label: t('surfaces.settings.controlsApiKey.label', { rowLabel: row.label }), type: 'password', placeholder: t('surfaces.settings.controlsPasteApiKey.placeholder') });
                input.autocomplete = 'off';
                const save = action(t('surfaces.settings.controlsSave.button'), () => void run(async () => {
                    // Send once, then immediately clear the DOM, including on failed requests.
                    let request: ReturnType<AkariConnectionsService['setCredential']>;
                    try { request = this.service.setCredential(row.id, input.value); }
                    finally { input.value = ''; }
                    const result = await request;
                    row.configured = result.ok; row.masked_tail = result.masked_tail; row.doctor = result.doctor;
                }), { small: true });
                controls.append(input, save);
            }
        };
        const managedInConnect = ['fal', 'elevenlabs', 'runway', 'higgsfield', 'fish-audio'].includes(row.id);
        if (managedInConnect) {
            paintStatus();
            controls.append(settingsNote('鍵は上のサービスカードで管理します。'));
        } else renderControls();
        card.append(logo, main, actions);
        if (row.id === 'fal' && !managedInConnect) {
            const defaults = element('div');
            defaults.className = 'akari-set-defaults';
            defaults.setAttribute('data-akari-generation-defaults', 'true');
            main.append(defaults);
            void this.renderGenerationDefaults(defaults);
        }
        return card;
    }

    /** 「残高を見る」: 押したときだけ node 側へ問い合わせる（自動では取りにいかない）。キーはレンダラーへ来ない。 */
    protected balanceRow(row: ConnectionRow): { node: HTMLElement; setConfigured(configured: boolean): void } {
        const node = element('div');
        node.className = 'akari-set-bal';
        node.setAttribute('data-akari-balance', row.id);
        const value = element('span', '—');
        value.className = 'akari-set-bal-value';
        value.setAttribute('data-state', 'idle');
        value.setAttribute('role', 'status');
        const time = element('span');
        time.className = 'akari-set-bal-time';
        const accountLink = row.id === 'openrouter'
            ? action(t('surfaces.settings.balanceRowCheckAccountBalanceManagementScreen.button'), () => this.windows.openNewWindow('https://openrouter.ai/settings/credits', { external: true }), { small: true, iconAfter: 'ext' })
            : undefined;
        if (accountLink) { accountLink.style.display = 'none'; }
        const button = action(t('surfaces.settings.balanceRowViewBalance.button'), async () => {
            button.disabled = true;
            value.className = 'akari-set-bal-value';
            value.setAttribute('data-state', 'loading');
            value.textContent = t('surfaces.settings.balanceRowConfirming.label');
            time.textContent = '';
            if (accountLink) { accountLink.style.display = 'none'; }
            try {
                const result = await this.service.readBalance(row.id);
                if (this.isDisposed) { return; }
                if (result.ok) {
                    value.textContent = result.display ?? '';
                    value.setAttribute('data-state', 'ok');
                    time.textContent = t('surfaces.settings.balanceRowNow.label');
                    time.title = formatDate(new Date(result.checked_at));
                    if (accountLink) { accountLink.style.display = result.account_url ? '' : 'none'; }
                } else {
                    value.textContent = result.error ?? t('surfaces.settings.balanceRowUnableInquireBalance.error');
                    value.className = 'akari-set-bal-error';
                    value.setAttribute('data-state', 'error');
                }
            } catch {
                value.textContent = t('surfaces.settings.balanceRowUnableInquireBalance.label');
                value.className = 'akari-set-bal-error';
                value.setAttribute('data-state', 'error');
            } finally {
                button.disabled = !row.configured;
            }
        }, { small: true, icon: 'refresh' });
        button.setAttribute('data-akari-balance-button', row.id);
        node.append(button, value, ...(accountLink ? [accountLink] : []), time);
        return {
            node,
            setConfigured: configured => {
                button.disabled = !configured;
                if (!configured) {
                    value.className = 'akari-set-bal-value';
                    value.setAttribute('data-state', 'idle');
                    value.textContent = t('surfaces.settings.balanceRowDisconnected.status');
                    time.textContent = '';
                    if (accountLink) { accountLink.style.display = 'none'; }
                } else if (value.getAttribute('data-state') === 'idle') {
                    value.textContent = '—';
                }
            }
        };
    }

    private async renderGenerationDefaults(container: HTMLElement): Promise<void> {
        container.replaceChildren(settingsNote(t('surfaces.settings.generationDefaultsLoadingDefaultModelGeneration.label')));
        try {
            const [defaults, catalog] = await Promise.all([
                this.service.readGenerationDefaults(), this.service.readGenerationCatalog()
            ]);
            if (this.isDisposed) { return; }
            const controls: DropdownHandle[] = [];
            const rowFor = (field: 'still' | 'video', kind: GenerationKind, label: string): HTMLElement => {
                const options = generationOptions(catalog.models, kind, defaults.effective[field]).map(item => {
                    const [family, id, ...rest] = item.label.split(' · ');
                    return item.missing ? { value: item.value, label: item.value,
                        description: item.value === 'fal:gpt-image-2.5-flare' ? t('surfaces.settings.rowForCannotSelectedScreen.label') : t('surfaces.settings.rowForCatalog.label') }
                        : { value: item.value, label: family, description: [id, ...rest].filter(Boolean).join(' · ') || undefined };
                });
                const control = dropdown({ label: t('surfaces.settings.rowForDefaultModel.label', { label: label }), options, value: defaults.effective[field] ?? '',
                    onChange: async value => {
                        for (const item of controls) { item.akariSetDisabled?.(true); }
                        try {
                            await this.service.setGenerationDefaults({ [field]: value });
                            if (!this.isDisposed) { await this.renderGenerationDefaults(container); }
                        } catch {
                            this.notice.textContent = t('surfaces.settings.rowForDefaultModelGenerationSaved.label');
                            if (!this.isDisposed) { await this.renderGenerationDefaults(container); }
                        } finally {
                            for (const item of controls) { item.akariSetDisabled?.(false); }
                        }
                    } });
                control.setAttribute('data-akari-generation-default', field);
                controls.push(control);
                const source = element('span', generationSourceLabel(defaults.source[field]));
                source.className = 'akari-set-source';
                source.setAttribute('data-akari-generation-source', defaults.source[field]);
                source.setAttribute('data-akari-generation-source-for', field);
                return settingRow(t('surfaces.settings.rowForDefaultModel.message', { label: label }), undefined, control, source);
            };
            container.replaceChildren(
                rowFor('still', 'image', t('surfaces.settings.generationDefaultsStillImage.label')), rowFor('video', 'video', t('surfaces.settings.generationDefaultsVideo.label')),
                settingsNote(t('surfaces.settings.generationDefaultsModelFirstChoiceCreatingStillImagesVideos.description'))
            );
            for (const note of Array.from(container.querySelectorAll<HTMLElement>('.akari-set-note'))) { note.style.margin = '8px 0 0'; }
        } catch {
            if (this.isDisposed) { return; }
            container.replaceChildren(settingsNote(t('surfaces.settings.generationModelCatalogLoadFailed.error')),
                action(t('surfaces.settings.generationDefaultsReload.button'), () => void this.renderGenerationDefaults(container), { small: true }));
        }
    }

    override dispose(): void {
        this.stopAboutUpdaterEvents();
        this.shortcutsView?.dispose();
        super.dispose();
    }
}

/** Embed the read-only first-run dialog's tool state; inherit its selection, install results
 * and progress polling so the two screens cannot drift, but draw the rows in the settings
 * card language (icon · name · purpose · status pill or button). Never openSetup:
 * settings must not write the onboarding marker or create a workspace. */
class SettingsToolsView extends AkariFirstRunSetupDialog {
    onToolsChanged: (() => void) | undefined;
    get content(): HTMLElement { return this.body; }
    get checkedTools(): AkariToolCheckResult[] | undefined { return this.toolCheck?.tools; }
    refresh(): Promise<void> { return this.recheckTools(); }

    protected override buildDom(): void {
        this.body.append(this.errorNotice, this.panel);
    }

    protected override renderState(): void {
        if (this.isDisposed) { return; }
        this.selectedToolIds.delete('speech-analyzer');
        for (const tool of this.toolCheck?.tools ?? []) {
            if (tool.unsupported) { this.selectedToolIds.delete(tool.id); }
        }
        this.errorNotice.textContent = this.setupError ?? '';
        this.errorNotice.className = 'akari-set-notice';
        this.errorNotice.style.margin = '0 0 12px';
        this.panel.replaceChildren();
        this.renderToolsStep();
        this.onToolsChanged?.();
    }

    protected override renderToolsStep(): void {
        this.panel.setAttribute('data-akari-setup-tools', 'true');
        const tools = this.toolCheck?.tools ?? [];
        const order = ['required', 'advanced', 'recommended'];
        const rows = [...tools].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier)).map(tool => this.createToolRow(tool));
        const recheck = action(this.checkingTools ? t('surfaces.settings.toolsStepConfirming.label') : t('surfaces.settings.toolsStepCheckAgain.label'), () => void this.recheckTools(), { small: true, icon: 'refresh' });
        recheck.setAttribute('data-akari-tool-recheck', 'true');
        recheck.disabled = this.checkingTools || this.installingTools;
        const card = groupCard(t('surfaces.settings.toolsStepTools.label'), ...rows);
        const installNotice = settingsNote(t('surfaces.settings.toolsStepAdministratorConfirmationDisplayedBlenderEtc.message', { installNotice: TOOL_INSTALL_NOTICE }));
        card.prepend(installNotice);
        if (!this.toolCheck && this.checkingTools) {
            const status = settingsNote(t('surfaces.settings.toolsStepCheckingTools.label'));
            status.setAttribute('role', 'status');
            status.style.margin = '10px 16px 14px';
            card.append(status);
        }
        if (this.installProgress) {
            const progress = settingsNote(formatInstallProgressLabel(TOOL_UI[this.installProgress.id].name, this.installProgress.index, this.installProgress.total));
            progress.setAttribute('role', 'status');
            progress.setAttribute('data-akari-tool-install-overall-progress', 'true');
            progress.style.margin = '10px 16px 14px';
            card.append(progress);
        }
        card.append(settingRow(t('surfaces.settings.toolsStepCheckStatusAgain.label'), t('surfaces.settings.toolsStepPressInstallingInstallingAnotherMethod.label'), recheck));
        this.panel.append(card);
    }

    protected override createToolRow(tool: AkariToolCheckResult): HTMLElement {
        const info = TOOL_UI[tool.id];
        const rowState = deriveToolRowState(tool);
        const row = element('div');
        row.className = 'akari-set-tool';
        row.setAttribute('data-akari-tool-id', tool.id);
        row.setAttribute('data-akari-tool-available', String(tool.available));
        const icon = element('div');
        icon.className = 'akari-set-tool-icon';
        icon.append(settingsIcon(TOOL_ICONS[tool.id] ?? 'wrench'));
        const body = element('div');
        body.style.minWidth = '0';
        const name = element('b', info.name);
        name.className = 'akari-set-tool-name';
        const purpose = element('span', info.purpose);
        purpose.className = 'akari-set-tool-desc';
        body.append(name, purpose);
        const providerCopy = t('surfaces.settings.toolProviderTerms.label', { provider: TOOL_PROVIDERS[tool.id].provider, terms: '\u0000' });
        const [providerBefore, providerAfter] = providerCopy.split('\u0000');
        const providerLine = element('span', providerBefore);
        providerLine.className = 'akari-set-tool-extra';
        const terms = document.createElement('a');
        terms.href = TOOL_PROVIDERS[tool.id].termsUrl;
        terms.textContent = t('surfaces.settings.toolRowTermsLicense.label');
        terms.addEventListener('click', event => {
            event.preventDefault();
            this.openExternalToolUrl(terms.href);
        });
        providerLine.append(terms, document.createTextNode(providerAfter));
        body.append(providerLine);
        const extra = (text: string, tone?: 'error'): void => {
            const line = element('span', text);
            line.className = 'akari-set-tool-extra';
            if (tone) { line.setAttribute('data-tone', tone); }
            body.append(line);
        };
        // 版の欄に実行ログ（パス入り）が返る道具がある（whisper-cli）。パスを含むものは版として出さない。
        if (tool.version && !/[\\/]/.test(tool.version)) { extra(tool.version); }
        if (tool.id === 'whisper' && tool.model) {
            const voiceInk = tool.model.path ? /[\\/]com\.prakashjoshipax\.VoiceInk[\\/]/.test(tool.model.path) : false;
            const line = tool.model.path
                ? voiceInk ? t('surfaces.settings.voiceInkModelPath.label', { path: homeShortened(tool.model.path) }) : t('surfaces.settings.modelPath.label', { path: homeShortened(tool.model.path) })
                : t('surfaces.settings.toolRowRecognitionModel.message', { modelSize: WHISPER_MODEL_SIZE_LABEL, status: tool.model.available ? t('surfaces.settings.toolRowObtained.label') : t('surfaces.settings.toolRowAcquired.label') });
            extra(line);
            body.lastElementChild?.setAttribute('data-akari-tool-model-state', String(tool.model.available));
        }
        if (tool.needs?.length) { extra(tool.needs.join(' · ')); }
        if (shouldShowToolNote(tool)) { extra(info.note ?? ''); }
        const installResult = this.toolInstallResults.get(tool.id);
        if (installResult && !tool.available) {
            extra(describeToolInstallOutcome(installResult, info.name), installResult.outcome === 'failed' ? 'error' : undefined);
            body.lastElementChild?.setAttribute('data-akari-tool-install-result', installResult.outcome);
        }
        if (this.installingTools && this.installProgress?.id === tool.id) {
            const progress = this.currentToolProgress?.toolId === tool.id ? this.currentToolProgress : undefined;
            const percent = progress?.kind === 'download' ? computeDownloadPercent(progress.downloadedBytes ?? 0, progress.totalBytes) : undefined;
            const track = element('div');
            track.className = 'akari-set-progress';
            track.setAttribute('data-akari-tool-progress-bar', 'true');
            const fill = element('i');
            fill.style.width = `${percent ?? 35}%`;
            track.append(fill);
            body.append(track);
            extra(progress?.kind === 'download' ? formatDownloadProgressLabel(progress.downloadedBytes ?? 0, progress.totalBytes) : progress?.phase ?? t('surfaces.settings.toolRowPreparing.label'));
        }
        let trailing: HTMLElement;
        if (!tool.unsupported && !tool.available && !info.osProvided) {
            const install = action(this.installingTools && this.installProgress?.id === tool.id ? t('surfaces.settings.toolRowInstalling.label') : t('surfaces.settings.toolRowPrepare.label'), () => {
                this.selectedToolIds = new Set([tool.id]);
                void this.installSelectedTools();
            }, { small: true });
            install.disabled = this.installingTools;
            install.setAttribute('data-akari-tool-install', tool.id);
            install.title = `${rowState.label} · ${info.sizeLabel}`;
            trailing = install;
        } else {
            trailing = statusPill(rowState.label, tool.available && !tool.unsupported ? 'ok' : 'neutral');
            trailing.setAttribute('data-akari-tool-availability-label', 'true');
        }
        row.append(icon, body, trailing);
        return row;
    }

    override dispose(): void {
        this.stopProgressPolling();
        super.dispose();
    }
}

@injectable()
export class AkariSettingsCommandContribution implements CommandContribution {
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(AkariChildLanguageService) protected readonly childLanguage!: AkariChildLanguageService;
    @inject(PreferenceSchemaService) protected readonly preferenceSchemas!: PreferenceSchemaService;
    @inject(AkariConnectionsService) protected readonly connections!: AkariConnectionsService;
    @inject(AkariAnnotationsService) protected readonly imageRoutes!: AkariAnnotationsService;
    @inject(AkariNarrationEnginesService) protected readonly narrationEngines!: AkariNarrationEnginesService;
    @inject(AkariProjectService) protected readonly store!: AkariProjectService;
    @inject(WindowService) protected readonly windows!: WindowService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(CommandRegistry) protected readonly commandRegistry!: CommandRegistry;
    @inject(KeybindingRegistry) protected readonly keybindingRegistry!: KeybindingRegistry;
    @inject(KeymapsService) protected readonly keymapsService!: KeymapsService;
    @inject(KeyboardLayoutService) protected readonly keyboardLayout!: KeyboardLayoutService;
    @inject(AkariNewProjectService) protected readonly tools!: AkariNewProjectService;
    @inject(FileService) protected readonly files!: FileService;
    @inject(FileDialogService) protected readonly fileDialogs!: FileDialogService;
    @inject(EnvVariablesServer) protected readonly env!: EnvVariablesServer;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(WebSocketConnectionProvider) protected readonly connectionsProvider!: WebSocketConnectionProvider;
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(PluginServer) protected readonly pluginServer!: PluginServer;
    @inject(AkariSettingsMaintenanceService) protected readonly maintenance!: AkariSettingsMaintenanceService;
    protected dialog: AkariSettingsDialog | undefined;
    protected requestedSection: SettingsSectionId | undefined;
    protected requestedConnectorId: string | undefined;
    protected opened: Promise<unknown> | undefined;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand({ id: 'akari.update.isAutoCheckEnabled' }, {
            execute: async () => (await this.maintenance.getUpdateSettings()).autoCheck === true
        });
        // パートナー起動時の受け身の更新通知用。自動確認 OFF・失敗・最新版不明は undefined（通知しない）。
        commands.registerCommand({ id: 'akari.partner.cliUpdateStatus' }, {
            execute: async (agent: unknown): Promise<{ installedVersion: string; latestVersion: string } | undefined> => {
                try {
                    if (typeof agent !== 'string' || (await this.maintenance.getUpdateSettings()).autoCheck !== true) { return undefined; }
                    const details = await this.maintenance.partnerDetails();
                    const detail = details[agent];
                    const fresh = (await this.maintenance.partnerFreshness({ [agent]: detail }))[agent];
                    const installedVersion = extractCliVersion(detail?.version);
                    return detail?.managedByApp !== false && fresh?.updateAvailable && fresh.latestVersion && installedVersion
                        ? { installedVersion, latestVersion: fresh.latestVersion } : undefined;
                } catch { return undefined; }
            }
        });
        commands.registerCommand({ id: 'akari.library.isMoving' }, { execute: () => this.tools.isLibraryMoving() });
        commands.registerCommand({ id: 'akari.library.changeLocation', label: t('surfaces.settings.registerCommandsChangeLocationAssets.label') }, {
            execute: async () => {
                const selected = await this.fileDialogs.showOpenDialog({
                    title: t('surfaces.settings.registerCommandsChooseLocationAssets.title'), canSelectFiles: false, canSelectFolders: true
                });
                if (!selected) { return; }
                this.messages.info(t('surfaces.settings.registerCommandsMovingAsset.label'));
                this.dialog?.showLibraryMoveProgress(undefined);
                const poll = window.setInterval(() => {
                    void this.tools.libraryMoveProgress().then(value => this.dialog?.showLibraryMoveProgress(value));
                }, 400);
                try {
                    const result = await this.tools.moveLibrary(selected.path.fsPath());
                    this.messages.info(result.state === 'pending'
                        ? t('surfaces.settings.registerCommandsDestinationCheckAssetSettingsMoving.message')
                        : t('surfaces.settings.registerCommandsAssetLocationChanged.message'));
                    await this.dialog?.refreshLibraryStatus();
                } catch (error) {
                    this.messages.error(error instanceof Error ? error.message : t('surfaces.settings.registerCommandsAssetMoved.message'));
                    throw error;
                } finally {
                    window.clearInterval(poll);
                    this.dialog?.clearLibraryMoveProgress();
                }
            }
        });
        window.addEventListener('akari-permissions', event => {
            window.akariPermissions = (event as CustomEvent<{ microphone: string }>).detail;
            this.dialog?.refreshPrivacy();
        });
        window.addEventListener('keydown', event => {
            if (this.dialog && event.metaKey && event.key.toLowerCase() === 'f') {
                event.preventDefault(); event.stopImmediatePropagation(); this.dialog.focusSearch();
            }
        }, true);
        this.preferenceSchemas.addSchema({ properties: {
            [AKARI_APPEARANCE_THEME_MODE]: { type: 'string', enum: ['dark', 'light', 'system'], default: 'dark' },
            [AKARI_APPEARANCE_ZOOM]: { type: 'number', minimum: 60, maximum: 200, default: 100 },
            [STATUS_BAR_KEYS.cpu]: { type: 'boolean', default: true },
            [STATUS_BAR_KEYS.gpu]: { type: 'boolean', default: true },
            [STATUS_BAR_KEYS.memory]: { type: 'boolean', default: true },
            [STATUS_BAR_KEYS.disk]: { type: 'boolean', default: false },
            [STATUS_BAR_KEYS.running]: { type: 'boolean', default: true },
            [STATUS_BAR_KEYS.intervalSec]: { type: 'number', enum: [1, 3, 10], default: 3 },
            [STATUS_BAR_KEYS.accountBalance]: { type: 'boolean', default: false },
            [AKARI_PARTNER_REOPEN]: { type: 'boolean', default: true },
            [AKARI_CHAT_EXPERIMENTAL_ENABLED]: { type: 'boolean', default: false,
                description: '開発中の機能です。動作が不安定なことがあります' },
            [AKARI_PARTNER_PERMISSION_MODE]: { type: 'string', enum: ['auto', 'ask', 'bypass'], default: 'auto', scope: PreferenceScope.User },
            'akari.export.openFolderAfter': { type: 'boolean', default: false },
            'akari.export.notifyAfter': { type: 'boolean', default: true },
            [AKARI_EXPORT_FILENAME_PATTERN]: { type: 'string', enum: ['project-date-time', 'project-name'], default: 'project-date-time' },
            'akari.update.channel': { type: 'string', enum: ['stable', 'prerelease'], default: 'stable' },
            'akari.update.autoCheck': { type: 'boolean', default: true }
        } });
        const applyZoom = (): void => applyAkariZoom(clampZoom(Number(this.preferences.get(AKARI_APPEARANCE_ZOOM, 100))));
        const applySystemTheme = (): void => {
            if (this.preferences.get<string>(AKARI_APPEARANCE_THEME_MODE, 'dark') === 'system') {
                const selected = (window.akariNativeDark ?? matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
                void this.preferences.set(WORKBENCH_COLOR_THEME, selected, PreferenceScope.User).then(() => {
                    window.electronTheiaCore?.setTheme('system');
                });
            }
        };
        void this.preferences.ready.then(() => { applyZoom(); applySystemTheme(); });
        this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName === AKARI_APPEARANCE_ZOOM) { applyZoom(); }
            if (change.preferenceName === AKARI_APPEARANCE_THEME_MODE) { applySystemTheme(); }
            if (change.preferenceName === WORKBENCH_COLOR_THEME && this.preferences.get<string>(AKARI_APPEARANCE_THEME_MODE, 'dark') === 'system') {
                setTimeout(() => window.electronTheiaCore?.setTheme('system'), 0);
            }
        });
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySystemTheme);
        window.addEventListener('akari-native-theme', event => {
            window.akariNativeDark = !!(event as CustomEvent<{ dark: boolean }>).detail?.dark;
            applySystemTheme();
        });
        window.addEventListener('keydown', event => {
            if (!event.metaKey || event.altKey || event.ctrlKey) { return; }
            const target = event.target as HTMLElement | null;
            if (target?.closest('.xterm, .terminal-widget, .theia-terminal')) { return; }
            if (event.key !== '+' && event.key !== '=' && event.key !== ';' && event.key !== '-') { return; }
            event.preventDefault();
            const current = clampZoom(Number(document.documentElement.dataset.akariZoom || this.preferences.get(AKARI_APPEARANCE_ZOOM, 100)));
            const value = clampZoom(current + (event.key === '-' ? -10 : 10));
            applyAkariZoom(value);
            void this.preferences.set(AKARI_APPEARANCE_ZOOM, value, PreferenceScope.User);
        }, true);
        // Reuse the existing RPC proxies. Opening a second channel for the same path hangs
        // in Theia; other extensions couple here only through path strings and JSON.
        commands.registerCommand({ id: 'akari.settings.readStatus' }, {
            execute: (path: string) => {
                if (path === '/services/akari-surfaces-new-project') { return this.tools.checkTools(); }
                if (path === '/services/akari-surfaces-connections') { return this.connections.listConnections(); }
                throw new Error('Unknown status service');
            }
        });
        commands.registerCommand({ id: 'akari.tools.install' }, {
            execute: (id: unknown) => {
                if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(TOOL_ICONS, id)) {
                    throw new Error(t('surfaces.settings.unknownTool.error'));
                }
                return this.tools.installTool(id as AkariToolId);
            }
        });
        commands.registerCommand({ id: 'akari.settings.open', label: t('surfaces.settings.registerCommandsAkariVideoSettings.label') }, {
            execute: (arg?: unknown) => {
                const section = resolveSettingsSectionId(arg);
                const connectorId = typeof arg === 'object' && arg !== null && (('connectorId' in arg && typeof arg.connectorId === 'string') ||
                        ('provider' in arg && typeof arg.provider === 'string'))
                    ? ('connectorId' in arg ? arg.connectorId : arg.provider) as string : undefined;
                if (section) {
                    this.requestedSection = section;
                    this.requestedConnectorId = connectorId;
                    if (section === 'connections') this.dialog?.selectConnector(connectorId);
                    else this.dialog?.showSection(section);
                }
                if (!this.opened) {
                    this.opened = this.openSettings().finally(() => { this.opened = undefined; });
                }
                return this.opened;
            }
        });
    }

    protected async openSettings(): Promise<void> {
        await this.preferences.ready;
        const root = this.workspaceService.tryGetRoots()[0]?.resource.path.fsPath();
        const aiModels = this.connectionsProvider.createProxy<AkariAiModelsService>(AKARI_AI_MODELS_SERVICE_PATH);
        const dialog = new AkariSettingsDialog(this.preferences, this.connections, this.store, this.windows, this.commands, this.tools, this.files, this.env, this.fileDialogs, this.maintenance, root, this.widgetManager, this.shell, this.pluginServer, this.narrationEngines, this.keybindingRegistry, this.commandRegistry, this.keymapsService, this.keyboardLayout, aiModels, this.childLanguage, this.requestedSection);
        dialog.setImageRoutesService(this.imageRoutes);
        if (this.requestedSection === 'connections') dialog.selectConnector(this.requestedConnectorId);
        this.dialog = dialog;
        try { await dialog.open(); }
        finally {
            this.dialog = undefined;
            this.requestedSection = undefined;
            this.requestedConnectorId = undefined;
            dialog.dispose();
        }
    }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (text !== undefined) { node.textContent = text; }
    return node;
}
function action(
    label: string, click: () => void,
    options: { variant?: 'primary' | 'ghost'; small?: boolean; icon?: SettingsIconName; iconAfter?: SettingsIconName } = {}
): HTMLButtonElement {
    const button = element('button');
    button.type = 'button';
    button.className = `akari-set-btn akari-set-btn-${options.variant ?? 'ghost'}${options.small ? ' akari-set-btn-sm' : ''}`;
    if (options.icon) { button.append(settingsIcon(options.icon, 'sm')); }
    button.append(element('span', label));
    if (options.iconAfter) { button.append(settingsIcon(options.iconAfter, 'sm')); }
    button.addEventListener('click', click);
    return button;
}
function description(text: string): HTMLElement {
    const node = element('p', text);
    node.className = 'akari-set-row-desc';
    node.style.margin = '0';
    return node;
}
/** 文中の小さなリンク風ボタン。 */
function inlineLink(label: string, click: () => void): HTMLButtonElement {
    const button = action(label, click, { small: true });
    button.style.marginLeft = '4px';
    return button;
}
/** ホームディレクトリの接頭辞を ~ に縮める（画面とスクリーンショットに利用者名を出さない）。 */
function homeShortened(path: string): string {
    return path.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
}
function formatBytes(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    const unit = bytes < 1024 ** 2 ? 'KB' : bytes < 1024 ** 3 ? 'MB' : 'GB';
    const scale = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3;
    return `${(bytes / scale).toFixed(1)} ${unit}`;
}
function applyAkariZoom(value: number): void {
    document.documentElement.dataset.akariZoom = String(value);
    if (window.electronTheiaCore?.setZoomLevel) {
        window.electronTheiaCore.setZoomLevel(Math.log(value / 100) / Math.log(1.2));
    } else {
        document.documentElement.style.setProperty('zoom', `${value}%`);
    }
}
/** テーマの見本（そのテーマのパレットで描いた小さな画面）。 */
function themePreview(theme: string): HTMLElement {
    const preview = el('div', 'akari-set-theme-preview');
    preview.setAttribute('data-theme', theme);
    preview.setAttribute('aria-hidden', 'true');
    preview.append(el('i'), el('i', 'm'), el('i'));
    return preview;
}
/** 状態のピルは柱で使う三つの状態へ揃え、診断の詳細は下の行へ置く。 */
function doctorPill(row: ConnectionRow): [string, 'ok' | 'neutral' | 'warn'] {
    if (!row.configured || row.doctor.status === 'unconfigured') { return [t('surfaces.settings.doctorDisconnected.status'), 'neutral']; }
    if (row.doctor.status === 'unauthorized') { return [t('surfaces.settings.doctorUnreachable.status'), 'warn']; }
    return [t('surfaces.settings.doctorConnected.status'), 'ok'];
}
function doctorLabel(doctor: ConnectionDoctor): string {
    if (doctor.status === 'unconfigured') { return t('surfaces.settings.doctorLabelRegistered.label'); }
    if (doctor.status === 'ok') { return t('surfaces.settings.doctorLabelConnected.message', { date: doctor.last_checked ? formatDate(new Date(doctor.last_checked), { kind: 'time', options: { hour: '2-digit', minute: '2-digit' } }) : '' }); }
    if (!doctor.last_checked) { return t('surfaces.settings.doctorLabelRegisteredUnconfirmed.label'); }
    return t('surfaces.settings.doctorLabelCantConnect.message', { doctorDetail: doctor.detail });
}
