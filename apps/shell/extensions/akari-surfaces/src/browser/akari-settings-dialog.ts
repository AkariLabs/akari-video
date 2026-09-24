import { deriveStoreLabBaseUrl } from 'akari-project/lib/common/asset-catalog-view';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { AkariLibraryStatus, AkariNewProjectService, AkariToolCheckResult, AkariToolId } from '../common/akari-new-project-protocol';
import { AkariFirstRunSetupDialog } from './akari-first-run-setup-dialog';
import { AKARI_APP_ICON } from './settings/app-icon';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractDialog, ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { ApplicationShell, CommonCommands, WebSocketConnectionProvider, WidgetManager } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { PluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { OS } from '@theia/core/lib/common/os';
import { buildExportEncoderChoices, ExportEncoder } from 'akari-shell-strip/lib/common/export-encoder-choices';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandContribution, CommandRegistry, CommandService, MessageService } from '@theia/core/lib/common';
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
} from '../common/akari-connections-protocol';
import { generationOptions, generationSourceLabel } from '../common/generation-defaults-view';
import { storeReconnectRequired, STORE_RECONNECT_REQUIRED_MESSAGE } from '../common/store-entitlements-visibility';
import { dialogOutsideClick } from '../common/dialog-outside-click';
import { describeToolInstallOutcome, formatInstallProgressLabel } from '../common/tool-install-ui';
import { computeDownloadPercent, formatDownloadProgressLabel } from '../common/tool-install-progress';
import { deriveToolRowState, shouldShowToolNote, TOOL_UI, WHISPER_MODEL_SIZE_LABEL } from '../common/tool-guidance';
import { AkariHomeCommands } from './akari-home-command-contribution';
import { AkariNarrationEnginesService, NarrationEngineRow, SettingsVoiceAvatar, SettingsVoiceProfile } from '../common/narration-engines-protocol';
import { falKeyAvailable, settingsVoiceEngineValue, voiceAvatarLabel, voiceSettingsActions } from '../common/voice-settings-model';
import { createGeminiConsentPrompt } from 'akari-annotations/lib/browser/voice-clone/gemini-consent-step';
import { geminiConsentCanNext, geminiConsentStatus,
    type GeminiConsentCheck } from 'akari-annotations/lib/common/voice-clone-model';
import {
    AKARI_TRANSCRIBE_MODE, AKARI_TRANSCRIBE_AUTO_CUTS, AKARI_TRANSCRIBE_BACKEND, AKARI_TRANSCRIBE_COMPARE_SET,
    AKARI_NARRATION_ENGINE, AKARI_NARRATION_VOICE, AKARI_NARRATION_IRODORI_URL,
    AKARI_QUALITY_TIER, AKARI_DEVELOPER_MODE, AKARI_AGENT_TURN_END_NOTIFICATION, AKARI_CATALOG_ROOT,
    AKARI_TIMELINE_VISUAL_THUMBNAILS,
    WORKBENCH_COLOR_THEME, AKARI_EXPORT_QUALITY, AKARI_EXPORT_OUTPUT_DIRECTORY, AKARI_EXPORT_FILENAME_PATTERN,
    AKARI_EXPORT_ENCODER, AKARI_EXPORT_CODEC, AKARI_EXPORT_FPS, EXPORT_CODEC_CHOICES, EXPORT_FPS_CHOICES,
    SETTINGS_SECTIONS, SettingsSectionId, QUALITY_TIER_CHOICES, THEME_CHOICES, EXPORT_QUALITY_CHOICES, TRANSCRIBE_MODE_CHOICES,
    normalizeQualityTier, normalizeTheme, normalizeExportQuality, normalizeOutputDirectory,
    sectionForPreferenceKey, resolveSettingsSectionId, settingsSectionElementId, isSettingsSectionVisible,
    SETTINGS_SECTION_DESCRIPTIONS, SETTINGS_LAST_SECTION_KEY, initialSettingsSection, QUALITY_TIER_RESERVED_NOTE,
    normalizeExportEncoder, normalizeExportCodec, normalizeExportFps, isValidIrodoriUrl
} from '../common/settings-sections';
import { AKARI_APPEARANCE_THEME_MODE, AKARI_APPEARANCE_ZOOM, STATUS_BAR_KEYS, AKARI_PARTNER_REOPEN, clampZoom, matchesSettingsSearch, formatShortReleaseDate } from '../common/settings-sections';
import { PARTNER_CLI_ICON_CLASSES, PARTNER_CATALOG } from 'akari-partner/lib/browser/partner-catalog';
import { installPartnerTerminalStyle } from 'akari-partner/lib/browser/partner-terminal-style';
import { AkariSettingsMaintenanceService, AKARI_SETTINGS_MAINTENANCE_PATH, PartnerDetail, StorageSnapshot, StorageEntry, StorageCleanTarget } from '../common/settings-maintenance-protocol';
import { compareVersions } from '../common/update-feed';
import { settingsIcon, SettingsIconName } from './settings/settings-icons';
import { ShortcutsSettingsView } from './settings/shortcuts-settings';
import {
    checkChips, choiceCards, dropdown, DropdownHandle, el, groupCard, segmentedControl, setPill, settingRow, settingsNote,
    statusPill, switchControl, textField
} from './settings/settings-ui';
import {
    PROVIDER_DISPLAY, PROVIDER_GROUP_LABELS, providerBillingUrl, providerGroup, providerInitial, providerLogo, ProviderGroup
} from './settings/provider-catalog';

const ENGINE_LABELS: Record<string, string> = {
    'speech-analyzer': 'SpeechAnalyzer（この Mac）', 'whisper-cpp': 'Whisper.cpp（ローカル）',
    'cloud:scribe': 'Scribe（クラウド）', 'cloud:groq': 'Groq（クラウド）'
};
const ENGINE_DESCRIPTIONS: Record<string, string> = {
    'speech-analyzer': '速い・オフライン', 'whisper-cpp': 'オフライン・精度重視',
    'cloud:scribe': 'ElevenLabs のキーが要る', 'cloud:groq': 'Groq のキーが要る'
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
    auto: '自動', videotoolbox: 'GPU', nvenc: 'NVENC', qsv: 'QSV', amf: 'AMF', mf: 'Media Foundation', x264: 'CPU'
};
const TOOL_ICONS: Record<AkariToolId, SettingsIconName> = {
    ffmpeg: 'film', whisper: 'mic', 'yt-dlp': 'download', voicevox: 'user', blender: 'cube', 'speech-analyzer': 'spark', 'xcode-clt': 'terminal'
};
const STORAGE_COLORS = ['#9a9a9a', '#7a7a7a', '#5c5c5c', '#454545', '#333333'] as const;

export class AkariSettingsDialog extends AbstractDialog<void> {
    protected readonly body = element('main');
    protected readonly transcribe = element('section');
    protected readonly connections = element('section');
    protected readonly providerList = element('div');
    protected readonly storage = element('div');
    protected libraryStatus: AkariLibraryStatus | undefined;
    /** Akari アカウント節の中身（アカウント帯 + AKARI Store のグループ）。renderStore が描き直す。 */
    protected readonly storeRow = element('div');
    protected readonly sections = new Map<SettingsSectionId, HTMLElement>();
    protected shortcutsView?: ShortcutsSettingsView;
    protected readonly storeController: StoreConnectionFlowController;
    protected storeState: StoreConnectionFlowState = { connection: { connected: false }, connectionLoading: true, phase: 'idle' };
    protected storeReconnect = false;
    protected storeStatusGeneration = 0;
    protected readonly notice = element('p');
    protected preferenceWrites: Promise<unknown> = Promise.resolve();
    protected readonly localPreferenceWrites = new Set<string>();
    protected readonly toolsView: SettingsToolsView;
    protected compareEnabled: boolean;
    protected compareDraft: string[];
    protected connectionSummary: { configured: number; total: number } | undefined;
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
    protected extensionVersions: Record<string, string> | undefined;

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
        initialSection?: SettingsSectionId
    ) {
        super({ title: 'AKARI Video の設定' });
        this.compareDraft = preferences.get<string[]>(AKARI_TRANSCRIBE_COMPARE_SET, []);
        this.compareEnabled = this.compareDraft.length > 0;
        this.storeController = new StoreConnectionFlowController(storeService, {
            openVerificationUrl: url => windows.openNewWindow(url, { external: true }),
            onChange: state => {
                if (this.isDisposed) { return; }
                this.storeState = state;
                this.renderStore();
                void this.refreshStoreEntitlements();
            }
        });
        this.toDispose.push(this.storeController);
        this.toolsView = new SettingsToolsView({ title: '道具', onWorkspaceCreated: async () => undefined, onFinished: () => undefined },
            files, env, toolsService, commands);
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

    get value(): void { return undefined; }
    focusSearch(): void { this.searchInput.focus(); }
    refreshPrivacy(): void { if (!this.isDisposed) { this.renderSection('privacy'); } }
    protected override handleEnter(_event: KeyboardEvent): boolean { return false; }

    override close(): void {
        for (const input of Array.from(this.node.querySelectorAll<HTMLInputElement>('input[type=password]'))) { input.value = ''; }
        super.close();
    }

    protected buildDom(): void {
        this.node.setAttribute('data-akari-settings-dialog', 'true');
        const block = this.contentNode.parentElement;
        if (block) {
            Object.assign(block.style, {
                width: 'min(1040px, calc(100vw - 48px))', maxWidth: '1040px', minWidth: '0',
                height: 'min(760px, calc(100vh - 48px))', maxHeight: 'calc(100vh - 48px)',
                borderRadius: '12px', overflow: 'hidden', border: AKARI_BORDER.edge, background: AKARI_SURFACE.raised
            });
        }
        Object.assign(this.contentNode.style, { display: 'flex', flexDirection: 'row', padding: '0', flex: '1', minHeight: '0', maxHeight: 'none', overflow: 'hidden' });
        this.controlPanel.style.display = 'none';
        const nav = element('nav');
        nav.className = 'akari-set-nav';
        nav.setAttribute('aria-label', '設定の項目');
        this.searchInput.className = 'akari-set-search';
        this.searchInput.type = 'search';
        this.searchInput.placeholder = '設定を探す';
        this.searchInput.setAttribute('aria-label', '設定を検索');
        this.searchInput.addEventListener('input', () => this.filterSections());
        const search = element('label'); search.className = 'akari-set-search-wrap';
        const keyHint = element('kbd', '⌘F');
        search.append(settingsIcon('search', 'sm'), this.searchInput, keyHint);
        nav.append(search);
        let previousGroup: string = 'main';
        for (const section of SETTINGS_SECTIONS) {
            if (section.group !== previousGroup) {
                const group = element('h3', section.group === 'data' ? 'データとプライバシー' : section.group === 'support' ? 'サポート' : '開発者');
                group.className = 'akari-set-nav-group';
                group.setAttribute('data-settings-nav-group', section.group);
                nav.append(group);
            }
            previousGroup = section.group;
            nav.append(this.navigation(section.label, section.id, section.icon, 'badge' in section ? section.badge : undefined));
        }
        Object.assign(this.body.style, { display: 'flex', flexDirection: 'column', flex: '1', minWidth: '0', minHeight: '0', position: 'relative' });
        this.notice.setAttribute('role', 'alert');
        this.notice.className = 'akari-set-notice';
        this.body.append(this.notice);
        for (const section of SETTINGS_SECTIONS) {
            const node = section.id === 'transcribe' ? this.transcribe
                : section.id === 'connections' ? this.connections : element('section');
            node.id = settingsSectionElementId(section.id);
            node.className = 'akari-set-page';
            node.setAttribute('data-akari-settings-section', section.id);
            node.hidden = true;
            node.setAttribute('aria-labelledby', `${node.id}-heading`);
            Object.assign(node.style, { flex: '1', minHeight: '0', overflowY: 'auto' });
            this.sections.set(section.id, node);
            this.body.append(node);
        }
        this.storeRow.setAttribute('data-akari-store-settings', 'true');
        // AKARI Store は「Akari アカウント」節へ移した（2026-09-22）。接続と API キーの末尾には置かない。
        const storeMoved = settingsNote('読み上げに使う API キーもここで登録できます。AKARI Store の接続は「Akari アカウント」へ移りました。');
        storeMoved.append(' ', inlineLink('Akari アカウントを開く', () => this.showSection('account')));
        this.connections.append(...this.sectionHeading('connections'), storeMoved, this.providerList, this.storage);
        this.providerList.append(settingsNote('接続を読み込んでいます…'));
        this.renderStore();
        this.contentNode.append(nav, this.body);
        this.addEventListener(this.node, 'keydown', event => {
            if (event.metaKey && event.key.toLowerCase() === 'f') { event.preventDefault(); this.searchInput.focus(); }
        });
    }

    showSection(section: SettingsSectionId): void {
        const navTarget = this.contentNode.querySelector<HTMLElement>(`[data-settings-nav="${section}"]`);
        if (navTarget?.hidden && this.searchInput.value) { this.searchInput.value = ''; this.filterSections(); }
        for (const [id, node] of this.sections) {
            node.hidden = !isSettingsSectionVisible(id, section);
            if (!node.hidden) { node.scrollTop = 0; }
        }
        try { localStorage.setItem(SETTINGS_LAST_SECTION_KEY, section); } catch { /* 保存不可でもページは切り替える。 */ }
        // 選択中は面の色（一段明るい面 + 太字 + アイコンだけアクセント色）で示す。縦バーは使わない（CSS 側）。
        for (const item of Array.from(this.contentNode.querySelectorAll<HTMLElement>('[data-settings-nav]'))) {
            if (item.getAttribute('data-settings-nav') === section) { item.setAttribute('aria-current', 'true'); }
            else { item.removeAttribute('aria-current'); }
        }
        this.highlightSearch(section);
        if (section === 'narration') { void this.refreshNarrationState(); }
    }

    protected filterSections(): void {
        const query = this.searchInput.value;
        let first: SettingsSectionId | undefined;
        for (const item of SETTINGS_SECTIONS) {
            const node = this.sections.get(item.id)!;
            const rows = Array.from(node.querySelectorAll<HTMLElement>(
                '.akari-set-row-label,.akari-set-row-desc,.akari-set-group-title,.akari-set-partner-name,.akari-set-partner-sub,.akari-set-storage-header,.akari-set-permission-row'
            )).map(row => row.textContent ?? '');
            const match = matchesSettingsSearch(query, item.label, SETTINGS_SECTION_DESCRIPTIONS[item.id], rows);
            const nav = this.contentNode.querySelector<HTMLElement>(`[data-settings-nav="${item.id}"]`);
            if (nav) { nav.hidden = !match; }
            if (match && !first) { first = item.id; }
        }
        const visible = Array.from(this.contentNode.querySelectorAll<HTMLElement>('[data-settings-nav]')).find(item => item.getAttribute('aria-current') === 'true' && !item.hidden);
        if (!visible && first) { this.showSection(first); }
        for (const item of SETTINGS_SECTIONS) { this.highlightSearch(item.id); }
        for (const group of Array.from(this.contentNode.querySelectorAll<HTMLElement>('[data-settings-nav-group]'))) {
            const name = group.getAttribute('data-settings-nav-group');
            group.hidden = !SETTINGS_SECTIONS.some(item => item.group === name && !this.contentNode.querySelector<HTMLElement>(`[data-settings-nav="${item.id}"]`)?.hidden);
        }
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
        if (badge) { const note = element('span', badge); note.className = `akari-set-nav-badge${badge === '準備中' ? ' akari-set-nav-badge-soon' : ''}`; button.append(note); }
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
        if (id === 'transcribe') { this.renderTranscribe(); return; }
        if (id === 'narration') { this.renderNarration(); return; }
        if (id === 'connections') { return; }
        const section = this.sections.get(id)!;
        section.replaceChildren(...this.sectionHeading(id));
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
            const directory = textField({ label: 'カタログの素材フォルダ', placeholder: '（自動で探す）', wide: true });
            directory.value = normalizeOutputDirectory(this.preferences.get(AKARI_CATALOG_ROOT));
            directory.addEventListener('change', () => this.savePreference(AKARI_CATALOG_ROOT, directory.value));
            const pick = action('選ぶ', async () => {
                try {
                    const destination = await this.fileDialogs.showOpenDialog({
                        title: 'カタログの素材フォルダを選ぶ', canSelectFiles: false, canSelectFolders: true
                    });
                    if (!destination || this.isDisposed) { return; }
                    directory.value = destination.path.fsPath();
                    this.savePreference(AKARI_CATALOG_ROOT, directory.value);
                    await this.preferenceWrites;
                    if (!this.isDisposed) { this.renderSection('tools'); }
                } catch {
                    this.notice.textContent = 'フォルダを選べませんでした。';
                }
            }, { small: true, icon: 'folder' });
            const catalogRow = groupCard('素材フォルダ', settingRow('カタログの素材フォルダ', 'カタログタブが読む素材フォルダ。空欄なら自動で探します', directory, pick));
            catalogRow.setAttribute('data-akari-catalog-root', 'true');
            section.append(catalogRow);
        } else if (id === 'start') {
            const open = action('セットアップを開く', () => {
                this.close();
                void this.commands.executeCommand(AkariHomeCommands.OPEN_FIRST_RUN_SETUP.id);
            }, { variant: 'primary' });
            const hero = element('div');
            hero.className = 'akari-set-hero';
            const copy = element('div');
            const heroTitle = element('div', '初回セットアップ');
            heroTitle.className = 'akari-set-hero-title';
            copy.append(heroTitle, description('道具・作業場・素材・AI パートナーを順番に案内します。いつでもやり直せます'));
            hero.append(copy, open);
            const card = groupCard(undefined, hero);
            const steps = this.startProgressSteps();
            if (steps) { card.append(steps); }
            section.append(card);
        } else if (id === 'quality') {
            const current = normalizeQualityTier(this.preferences.get(AKARI_QUALITY_TIER));
            section.append(
                groupCard('品質段階',
                    choiceCards({ label: 'プレビュー品質', options: QUALITY_TIER_CHOICES, value: current, columns: 2,
                        onChange: value => this.savePreference(AKARI_QUALITY_TIER, value) }),
                    settingsNote(QUALITY_TIER_RESERVED_NOTE)),
                groupCard('タイムライン', this.preferenceSwitch(AKARI_TIMELINE_VISUAL_THUMBNAILS, 'HTML / 3D 素材の絵を出す', false,
                    '素材が多いと開くのが遅くなります。オフなら種別の色と名前だけ')));
        } else if (id === 'notifications') {
            section.append(groupCard(undefined, this.preferenceSwitch(AKARI_AGENT_TURN_END_NOTIFICATION, 'AI 完了通知', true,
                'Claude Code などの処理が終わったとき、通知でお知らせします（ウィンドウが背面のときだけ）')));
        } else if (id === 'appearance') {
            const theme = this.preferences.get<string>(AKARI_APPEARANCE_THEME_MODE, normalizeTheme(this.preferences.get(WORKBENCH_COLOR_THEME)));
            const themes: { value: string; label: string; preview?: HTMLElement }[] = THEME_CHOICES.map(option => ({ ...option, preview: themePreview(option.value) }));
            if (!themes.some(option => option.value === theme)) { themes.push({ value: theme, label: theme }); }
            section.append(groupCard('テーマ', choiceCards({ label: 'テーマ', options: themes, value: theme, columns: 3,
                onChange: value => { this.savePreference(AKARI_APPEARANCE_THEME_MODE, value); this.applyTheme(value); } })));
            section.append(groupCard('言語', settingRow('表示する言語', 'ほかの言語は準備中です',
                segmentedControl({ label: '言語', options: [{ value: 'ja', label: '日本語' }, { value: 'en', label: 'English（準備中）', disabled: true }], value: 'ja', onChange: () => undefined }))));
            const zoom = clampZoom(Number(this.preferences.get(AKARI_APPEARANCE_ZOOM, 100)));
            const zoomLabel = element('span', `${zoom}%`);
            const changeZoom = (next: number): void => { const value = clampZoom(next); zoomLabel.textContent = `${value}%`; this.savePreference(AKARI_APPEARANCE_ZOOM, value); applyAkariZoom(value); };
            section.append(groupCard('UI の大きさ', settingRow('UI の大きさ', 'ズーム 60〜200%。⌘+ / ⌘− でも変更できます',
                action('−', () => changeZoom(Number(zoomLabel.textContent?.replace('%', '')) - 10), { small: true }), zoomLabel,
                action('+', () => changeZoom(Number(zoomLabel.textContent?.replace('%', '')) + 10), { small: true }),
                action('元に戻す', () => changeZoom(100), { small: true }))));
            section.append(groupCard('下のバー（右下）に出すもの',
                this.preferenceSwitch(STATUS_BAR_KEYS.cpu, 'CPU', true, '使用率'),
                this.preferenceSwitch(STATUS_BAR_KEYS.gpu, 'GPU', true, '使用率'),
                this.preferenceSwitch(STATUS_BAR_KEYS.memory, 'メモリ', true, '使用量'),
                this.preferenceSwitch(STATUS_BAR_KEYS.disk, 'ディスクの空き', false, '空き容量'),
                this.preferenceSwitch(STATUS_BAR_KEYS.running, '実行中の数', true, 'パートナー・書き出し・文字起こし'),
                this.preferenceSwitch(STATUS_BAR_KEYS.accountBalance, 'アカウント残高', false, '取得できるサービスのみ'),
                settingRow('更新の間隔', 'リソース表示を更新する間隔', segmentedControl({ label: '更新の間隔',
                    options: [{ value: '1', label: '1 秒' }, { value: '3', label: '3 秒' }, { value: '10', label: '10 秒' }],
                    value: String(this.preferences.get(STATUS_BAR_KEYS.intervalSec, 3)), onChange: value => this.savePreference(STATUS_BAR_KEYS.intervalSec, Number(value)) }))));
        } else if (id === 'developer') {
            section.append(groupCard(undefined, this.preferenceSwitch(AKARI_DEVELOPER_MODE, 'Developer mode', false,
                'HTML をコードとして開き、フル設定を使えるようにします')));
        } else if (id === 'export') {
            const platform = OS.type() === OS.Type.OSX ? 'darwin' : OS.type() === OS.Type.Windows ? 'win32' : 'linux';
            const directory = textField({ label: '書き出し先フォルダの URI', placeholder: '（プロジェクトの exports/）', wide: true });
            directory.value = normalizeOutputDirectory(this.preferences.get(AKARI_EXPORT_OUTPUT_DIRECTORY));
            directory.addEventListener('change', () => this.savePreference(AKARI_EXPORT_OUTPUT_DIRECTORY, directory.value));
            const pickDirectory = action('選ぶ', async () => {
                try {
                    const destination = await this.fileDialogs.showOpenDialog({
                        title: '書き出し先フォルダを選ぶ', canSelectFiles: false, canSelectFolders: true
                    });
                    if (!destination || this.isDisposed) { return; }
                    directory.value = destination.toString();
                    this.savePreference(AKARI_EXPORT_OUTPUT_DIRECTORY, directory.value);
                } catch {
                    this.notice.textContent = 'フォルダを選べませんでした。';
                }
            }, { small: true, icon: 'folder' });
            const encoders = buildExportEncoderChoices(platform).map(choice => ({
                value: choice.value, label: ENCODER_SHORT_LABELS[choice.value], title: choice.label
            }));
            section.append(
                groupCard('画質', choiceCards({ label: '書き出し画質', options: EXPORT_QUALITY_CHOICES, columns: 4,
                    value: normalizeExportQuality(this.preferences.get(AKARI_EXPORT_QUALITY)),
                    onChange: value => this.savePreference(AKARI_EXPORT_QUALITY, value) })),
                groupCard('形式',
                    settingRow('形式 / コーデック', '迷ったら MP4 · H.264', dropdown({ label: '形式 / コーデック', options: EXPORT_CODEC_CHOICES,
                        value: normalizeExportCodec(this.preferences.get(AKARI_EXPORT_CODEC)),
                        onChange: value => this.savePreference(AKARI_EXPORT_CODEC, value) })),
                    settingRow('エンコーダ', '速さと互換性。自動はハードウェアが使えれば優先します', segmentedControl({ label: 'エンコーダ', options: encoders,
                        value: normalizeExportEncoder(this.preferences.get(AKARI_EXPORT_ENCODER), platform),
                        onChange: value => this.savePreference(AKARI_EXPORT_ENCODER, value) })),
                    settingRow('フレームレート', '編集データに従うのが既定', segmentedControl({ label: 'フレームレート', options: EXPORT_FPS_CHOICES,
                        value: String(normalizeExportFps(this.preferences.get(AKARI_EXPORT_FPS)) ?? '') as typeof EXPORT_FPS_CHOICES[number]['value'],
                        onChange: value => this.savePreference(AKARI_EXPORT_FPS, normalizeExportFps(Number(value))) }))),
                groupCard('保存先',
                    settingRow('書き出し先フォルダ', '空欄ではプロジェクトの exports/ を使います', directory, pickDirectory),
                    settingRow('くわしい設定', 'フル設定を開きます', action('開く', () => {
                        this.close();
                        void this.commands.executeCommand(CommonCommands.OPEN_PREFERENCES.id);
                    }, { small: true }))),
                groupCard('書き出しのあと',
                    this.preferenceSwitch('akari.export.openFolderAfter', '終わったらフォルダを開く', false, 'Finder で書き出したファイルを選んだ状態に'),
                    this.preferenceSwitch('akari.export.notifyAfter', '終わったら知らせる', true, 'ウィンドウが背面のときだけ'),
                    settingRow('ファイル名の決め方', '書き出したファイルの名前', dropdown({ label: 'ファイル名の決め方',
                        options: [{ value: 'project-date-time', label: 'プロジェクト名_日付_時刻' }, { value: 'project-name', label: 'プロジェクト名' }],
                        value: this.preferences.get<string>(AKARI_EXPORT_FILENAME_PATTERN, 'project-date-time'),
                        onChange: value => this.savePreference(AKARI_EXPORT_FILENAME_PATTERN, value) }))));
        }
    }

    protected applyTheme(mode: string): void {
        const selected = mode === 'system' ? ((window.akariNativeDark ?? matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light') : mode;
        this.savePreference(WORKBENCH_COLOR_THEME, selected);
    }

    protected renderPartner(section: HTMLElement): void {
        const ids = ['claude', 'codex', 'opencode', 'commandcode', 'copilot', 'cursor', 'antigravity', 'grok'] as const;
        const names: Record<typeof ids[number], string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode',
            commandcode: 'Command Code', copilot: 'Copilot', cursor: 'Cursor', antigravity: 'Antigravity', grok: 'Grok' };
        const rows = ids.map(id => {
            const detail = this.partnerDetails?.[id];
            return this.partnerRow(id, names[id], detail?.installed === undefined ? '調べています' : detail.installed ? 'インストール済み' : '未インストール',
                detail?.detail || '—', detail?.installed === false ? '入れ方' : '起動', async () => {
                this.close();
                await this.commands.executeCommand('akari.partner.open');
                if (!detail?.installed) { return; }
                const widget = this.widgetManager.tryGetWidget('akari-partner-onboarding') as unknown as { begin(entry: typeof PARTNER_CATALOG[number]): Promise<void> } | undefined;
                const entry = PARTNER_CATALOG.find(candidate => candidate.agent === id && candidate.form === 'cli');
                if (widget && entry) { await widget.begin(entry); }
            });
        });
        const extensions = [
            { id: 'anthropic.claude-code', agent: 'claude' as const, name: 'Claude Code 拡張' },
            { id: 'openai.chatgpt', agent: 'codex' as const, name: 'Codex 拡張' }
        ].map(entry => this.partnerRow(entry.agent, entry.name,
            this.extensionVersions ? entry.id in this.extensionVersions ? '入っている' : '入っていない' : '調べています',
            `${entry.id}${this.extensionVersions?.[entry.id] ? ` · ${this.extensionVersions[entry.id]}` : ''}`, '開く', () => {
                this.close(); void this.commands.executeCommand('akari.partner.open');
            }));
        const cli = groupCard('CLI', ...rows);
        const cliHeading = cli.querySelector<HTMLElement>('.akari-set-group-title');
        if (cliHeading) { cliHeading.append(element('span', '右のレールの線の上に並ぶ')); }
        const caution = element('div'); caution.className = 'akari-set-caution';
        caution.append(settingsIcon('info', 'sm'), element('span', '拡張は、拡張ホストが再起動すると会話が切れます。長い作業には CLI をおすすめします。'));
        section.append(cli, groupCard('公式拡張',
            caution,
            ...extensions,
            settingRow('ほかの拡張を探す', 'Open VSX から（くわしい人向け）', action('開く', async () => {
                this.close();
                const widget = await this.widgetManager.getOrCreateWidget('vsx-extensions-view-container');
                if (!widget.isAttached) { await this.shell.addWidget(widget, { area: 'main' }); }
                await this.shell.activateWidget(widget.id);
            }, { small: true }))),
        groupCard('ふるまい', this.preferenceSwitch(AKARI_PARTNER_REOPEN, '起動したら前回のパートナーを開く', true, '右のレールの線の上に並べる')));
    }

    protected partnerRow(id: keyof typeof PARTNER_CLI_ICON_CLASSES, name: string, state: string, sub: string,
        buttonLabel: string, onClick: () => void | Promise<void>): HTMLElement {
        const row = element('div'); row.className = 'akari-set-partner-row';
        const tile = element('span'); tile.className = 'akari-set-partner-tile';
        const icon = element('span'); icon.className = `akari-set-partner-icon ${PARTNER_CLI_ICON_CLASSES[id]}`; tile.append(icon);
        const text = element('div');
        const top = element('div'); top.className = 'akari-set-partner-name';
        const badge = element('span', state); badge.className = 'akari-set-partner-chip';
        top.append(element('b', name), badge);
        const subtitle = element('div', sub); subtitle.className = 'akari-set-partner-sub';
        text.append(top, subtitle);
        row.append(tile, text, action(buttonLabel, onClick, { small: true }));
        return row;
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
    }

    protected async loadStorage(): Promise<void> {
        try { this.storageSnapshot = await this.maintenance.measure(this.workspaceRoot); }
        catch { this.storageSnapshot = { entries: [], freeBytes: 0 }; this.notice.textContent = 'ストレージを調べられませんでした。'; }
        if (!this.isDisposed) { this.renderSection('storage'); }
    }

    protected renderStorageSection(section: HTMLElement): void {
        if (!this.storageSnapshot) {
            section.append(settingsNote('調べています…'));
        } else {
            const { entries, freeBytes } = this.storageSnapshot;
            const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
            const summary = element('div'); summary.className = 'akari-set-storage-total';
            summary.append(element('b', formatBytes(total)), element('span', `AKARI 全体 · Mac の空き ${freeBytes ? formatBytes(freeBytes) : '調べられませんでした'}`));
            const usage = element('div'); usage.className = 'akari-set-storage-usage';
            const legend = element('div'); legend.className = 'akari-set-storage-legend';
            entries.forEach((entry, index) => {
                const part = element('i'); part.style.width = `${total ? entry.bytes / total * 100 : 20}%`; part.style.background = STORAGE_COLORS[index];
                usage.append(part);
                const item = element('span', `${entry.label} ${formatBytes(entry.bytes)}`);
                item.style.setProperty('--akari-storage-color', STORAGE_COLORS[index]); legend.append(item);
            });
            section.append(groupCard(undefined, summary, usage, legend));
            const rows = entries.map(entry => this.storageDetailRow(entry));
            const breakdown = groupCard('内訳', ...rows);
            breakdown.querySelector('.akari-set-group-title')?.append(element('span', '行を押すと開く'));
            section.append(breakdown);
        }
        section.append(this.renderLibraryStorageCard());
    }

    protected renderLibraryStorageCard(): HTMLElement {
        const status = this.libraryStatus;
        const usage = status?.usage;
        const open = action('Finder で開く', () => {
            if (status?.root) { void this.maintenance.openPath(status.root); }
        }, { small: true, icon: 'folder' });
        open.disabled = !status?.root;
        const change = action('場所を変える…', () => void this.commands.executeCommand('akari.library.changeLocation'), { small: true });
        const clean = action('取り直せるものを片づける', () => void this.clearLabLibrary(), { small: true });
        clean.disabled = !usage?.cleanup.length;
        const card = groupCard('素材の置き場',
            settingRow('現在の場所', status?.root ?? '確認中…', open, change),
            settingRow('合計', usage ? formatLibraryBytes(usage.totalBytes) : '確認中…'),
            settingRow('Lab から', usage ? `${formatLibraryBytes(usage.bySource.lab.bytes)}（${usage.bySource.lab.count} 個）` : '確認中…'),
            settingRow('素材サイトから', usage ? `${formatLibraryBytes(usage.bySource.site.bytes)}（${usage.bySource.site.count} 個）` : '確認中…'),
            settingRow('自分の', usage ? `${formatLibraryBytes(usage.bySource.own.bytes)}（${usage.bySource.own.count} 個）` : '確認中…'),
            settingRow('取り直せるもの', 'Lab から受け取った素材だけを一覧で確認してからゴミ箱へ移します', clean));
        card.setAttribute('data-akari-library-usage', 'true');
        const moveCopy = status ? libraryMoveCopy(status.state, status.previous, status.cloud) : {};
        if (moveCopy.retained) { card.append(settingsNote(moveCopy.retained)); }
        if (status?.state === 'pending') {
            card.append(settingRow('移動する前に確認', moveCopy.sync,
                action('このまま使う', () => void this.acceptSyncedLibrary(), { small: true }),
                action('別の場所を選ぶ', () => void this.commands.executeCommand('akari.library.changeLocation'), { small: true }),
                action('今は移さない', () => void this.declineSyncedLibrary(), { small: true })));
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
            actions.append(action(entry.id === 'cache' ? '掃除する…' : entry.id === 'models' ? '消す…' : '古いものを消す…',
                () => this.showStorageConfirmation(target, entry), { small: true }));
        }
        if (entry.id === 'cache' || entry.id === 'library') {
            actions.append(action('Finder で表示', () => void this.maintenance.revealPath(entry.path), { small: true }));
        }
        if (entry.id === 'exports') { actions.append(action('一覧', () => void this.maintenance.openPath(entry.path), { small: true })); }
        detail.append(why, table, actions);
        header.addEventListener('click', () => { const open = header.getAttribute('aria-expanded') !== 'true';
            header.setAttribute('aria-expanded', String(open)); detail.hidden = !open; row.classList.toggle('akari-set-storage-open', open); });
        row.append(header, detail); return row;
    }

    protected showStorageConfirmation(target: StorageCleanTarget, entry: StorageEntry): void {
        const overlay = element('div'); overlay.className = 'akari-set-storage-confirm'; overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', `${entry.label}を消す確認`);
        const box = element('div'); box.className = 'akari-set-storage-confirm-box';
        box.append(element('h4', `${entry.label} ${formatBytes(entry.bytes)} を${target === 'cache' ? '掃除' : '削除'}しますか？`));
        const yes = element('ul');
        yes.append(...entry.paths.map(location => element('li', `消すもの: ${target === 'old-history' ? '30 日より古い履歴' : entry.label}（${location}）`)),
            element('li', target === 'cache' ? '必要になったら自動で作り直します' : target === 'models' ? '次に使うとき再ダウンロードが必要です' : '30 日より古い履歴だけを削除します'));
        const no = element('ul'); no.className = 'akari-set-storage-confirm-no';
        no.append(element('li', '消さないもの: プロジェクト・素材・書き出し・最近の編集履歴'));
        const buttons = element('div'); buttons.className = 'akari-set-storage-confirm-actions';
        buttons.append(action('やめる', () => overlay.remove(), { small: true }),
            action(target === 'cache' ? '掃除する' : '削除する', async () => {
                try { await this.maintenance.cleanStorage(target, this.workspaceRoot); overlay.remove(); await this.loadStorage(); }
                catch { this.notice.textContent = `${entry.label}を削除できませんでした。`; overlay.remove(); }
            }, { small: true, variant: 'primary' }));
        box.append(yes, no, buttons); overlay.append(box); this.body.append(overlay);
    }

    protected renderPrivacy(section: HTMLElement): void {
        const microphone = window.akariPermissions?.microphone;
        const permissionLabel = (value: string | undefined): string => value === 'granted' ? '許可済み'
            : value === 'denied' || value === 'restricted' ? '拒否' : value === 'not-determined' ? '未設定' : 'システム設定で確認';
        const notification = typeof Notification !== 'undefined' ? Notification.permission : undefined;
        const permissions: { icon: SettingsIconName; name: string; description: string; state: string; url: string }[] = [
            { icon: 'mic', name: 'マイク', description: '声で編集（Akari Vibe）・注釈の録音', state: permissionLabel(microphone), url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone' },
            { icon: 'folder', name: '書類・デスクトップ・ダウンロード', description: 'そこに置いたプロジェクトや素材を開く', state: 'システム設定で確認', url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders' },
            { icon: 'bell', name: '通知', description: '書き出し・AI の作業が終わったとき', state: permissionLabel(notification), url: 'x-apple.systempreferences:com.apple.preference.notifications' },
            { icon: 'terminal', name: 'フルディスクアクセス', description: 'ふつうは不要。外付けドライブの一部で要ることがある', state: 'システム設定で確認', url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles' }
        ];
        const rows = permissions.map(item => {
            const row = element('div'); row.className = 'akari-set-permission-row';
            const tile = element('span'); tile.className = 'akari-set-partner-tile'; tile.append(settingsIcon(item.icon, 'sm'));
            const copy = element('div'); copy.append(element('b', item.name), element('span', item.description));
            const state = element('span', item.state); state.className = `akari-set-permission-state${item.state === '許可済み' ? ' akari-set-permission-state-ok' : ''}`;
            row.append(tile, copy, state, action('システム設定', () => this.windows.openNewWindow(item.url, { external: true }), { small: true }));
            return row;
        });
        section.append(groupCard('macOS のアクセス許可', ...rows),
        groupCard('外へ送るもの', settingRow('利用状況の送信', 'AKARI Video は利用状況を送っていません', statusPill('送っていない')),
            settingRow('API キー', `鍵は ${this.credentialsPath || (OS.type() === OS.Type.Windows ? '%USERPROFILE%\\.akari\\credentials.env' : '~/.akari/credentials.env')} に保存します（この PC だけ・600）。AKARI のサーバーには送りません`, action('場所を開く', () => {
                if (this.credentialsPath) { void this.maintenance.openPath(this.credentialsPath.replace(/[\\/][^\\/]+$/, '')); }
            }, { small: true }))));
    }

    protected renderStatistics(section: HTMLElement): void {
        const wrap = element('div'); wrap.className = 'akari-set-soon';
        const blurred = element('div'); blurred.className = 'akari-set-soon-blur'; blurred.setAttribute('aria-hidden', 'true');
        const kpi = element('div'); kpi.className = 'akari-set-stats-kpi';
        for (const [label, value] of [['使った金額', '$23.10'], ['トークン', '4.2 M'], ['生成した動画', '37 本']]) {
            const tile = element('div'); tile.append(element('span', label), element('b', value)); kpi.append(tile);
        }
        const chart = element('div'); chart.className = 'akari-set-stats-chart';
        [20, 35, 28, 60, 44, 12, 8, 52, 70, 33, 41, 25, 18, 64].forEach((height, index) => {
            const bar = element('i'); bar.style.height = `${height}%`; if (index % 5 === 3) { bar.className = 'akari-set-stats-chart-hi'; } chart.append(bar);
        });
        blurred.append(groupCard('この 30 日', kpi, chart));
        const services = [['OpenRouter · Akari Vibe', '$11.40', 62], ['fal · 画像・動画の生成', '$9.20', 48],
            ['ElevenLabs · ナレーション', '$2.50', 14]] as const;
        blurred.append(groupCard('サービスごと', ...services.map(([name, amount, percent]) => {
            const row = element('div'); row.className = 'akari-set-stats-service';
            const logo = element('span'); logo.className = 'akari-set-stats-service-logo';
            const bar = element('span'); bar.className = 'akari-set-stats-service-bar';
            const fill = element('i'); fill.style.width = `${percent}%`; bar.append(fill);
            row.append(logo, element('span', name), bar, element('span', amount)); return row;
        })));
        const veil = element('div'); veil.className = 'akari-set-soon-veil';
        const copy = element('div'); copy.append(element('b', 'Coming soon'), element('span', 'サービスごとの使用量と金額')); veil.append(copy);
        wrap.append(blurred, veil); section.append(wrap);
    }

    protected renderHelp(section: HTMLElement): void {
        const checklist = element('div'); checklist.className = 'akari-set-diagnostic-list';
        for (const label of ['アプリと OS のバージョン', '直近のログ（24 時間）', '道具の状態（ffmpeg など）', '画面の配置', 'プロジェクトの edit.json']) {
            const item = element('span'); item.append(settingsIcon('check', 'sm'), element('span', label)); checklist.append(item);
        }
        const excluded = element('span', 'API キー・個人のパスは入れない'); excluded.className = 'akari-set-diagnostic-excluded'; checklist.append(excluded);
        section.append(groupCard('診断情報を書き出す', checklist,
            settingRow('保存先', homeShortened(this.diagnosticPath || '調べています…'), action('場所を変える', async () => {
                const destination = await this.fileDialogs.showSaveDialog({ title: '診断情報の保存先', inputValue: this.diagnosticPath });
                if (destination) { this.diagnosticPath = destination.path.fsPath(); this.diagnosticPathCustomized = true; this.renderSection('help'); }
            }, { small: true })),
            settingRow('zip にまとめる', 'できたら Finder で選んだ状態で開きます。中身は開いて確かめられます', action('書き出す', async () => {
                const left = document.querySelector<HTMLElement>('#theia-left-content-panel')?.getBoundingClientRect().width || 0;
                const right = document.querySelector<HTMLElement>('#theia-right-content-panel')?.getBoundingClientRect().width || 0;
                try { const location = await this.maintenance.exportDiagnostics(this.diagnosticPathCustomized ? this.diagnosticPath : undefined,
                    { width: window.innerWidth, height: window.innerHeight, leftPanelWidth: left, rightPanelWidth: right },
                    this.workspaceRoot, this.credentialsPath);
                    this.diagnosticPath = location; this.renderSection('help');
                    await this.maintenance.revealPath(location); this.notice.textContent = '診断情報を書き出しました。'; }
                catch { this.notice.textContent = '診断情報を書き出せませんでした。'; }
            }, { small: true }))),
        groupCard('そのほか',
            settingRow('不具合を報告する', 'GitHub の issue を開く', action('開く', () => this.windows.openNewWindow('https://github.com/akari-video/akari-video/issues/new', { external: true }), { small: true })),
            settingRow('ログのフォルダを開く', '~/Library/Logs/AKARI Video', action('開く', () => void this.maintenance.openPath('~/Library/Logs/AKARI Video'), { small: true })),
            settingRow('画面の配置を最初に戻す', 'パネルの位置・右のレールの並びを既定に', action('戻す', () => void this.commands.executeCommand('reset.layout'), { small: true }))));
    }

    protected renderAbout(section: HTMLElement): void {
        section.append(groupCard('AKARI Video', settingsNote('バージョンとビルド情報を調べています…')));
        void Promise.all([this.maintenance.appInfo(), window.electronAkariUpdater?.getLastEvent(), this.maintenance.getUpdateSettings().catch(() => undefined)]).then(([info, update, updateSettings]) => {
            if (this.isDisposed || !section.isConnected) { return; }
            section.replaceChildren(...this.sectionHeading('about'));
            const icon = element('img'); icon.src = info.icon || AKARI_APP_ICON; icon.alt = 'AKARI Video'; icon.width = 64; icon.height = 64;
            icon.onerror = () => { const logo = element('strong', 'AKARI'); logo.style.width = '64px'; icon.replaceWith(logo); };
            const hero = element('div'); hero.className = 'akari-set-about-hero';
            const identity = element('div'); identity.append(element('h3', 'AKARI Video'),
                element('p', `v${info.version} · ${info.buildDate} ビルド · ${info.os}`));
            hero.append(icon, identity);
            const status = update?.kind === 'update-not-available' || (info.recentChanges && compareVersions(info.version, info.recentChanges.version) >= 0) ? '最新です'
                : update?.kind === 'update-available' || update?.kind === 'update-downloaded' ? '更新があります' : 'アップデートを確認できます';
            const checked = info.lastChecked ? new Date(info.lastChecked).toLocaleString('ja-JP') : 'まだ確認していません';
            const main = groupCard(undefined, hero,
                settingRow(status, `最後に確かめた: ${checked}`, action('アップデートを確認', () => void window.electronAkariUpdater?.checkForUpdatesNow(), { small: true, icon: 'refresh' })),
                settingRow('受け取る版', 'プレリリースは新しい機能が早く届くかわりに不安定なことがある', segmentedControl({ label: '受け取る版', options: [{ value: 'stable', label: '安定版' }, { value: 'prerelease', label: 'プレリリースも' }],
                    value: updateSettings?.channel ?? this.preferences.get('akari.update.channel', 'prerelease'), onChange: value => {
                        this.savePreference('akari.update.channel', value);
                        void this.maintenance.setUpdateSettings({ channel: value });
                    } })),
                settingRow('自動で確認する', '起動したときに右下の通知でお知らせ', switchControl({ label: '自動で確認する',
                    checked: updateSettings?.autoCheck ?? this.preferences.get<boolean>('akari.update.autoCheck', true), onChange: checked => {
                        this.savePreference('akari.update.autoCheck', checked);
                        void this.maintenance.setUpdateSettings({ autoCheck: checked });
                    } })));
            section.append(main);
            if (info.recentChanges) {
                const release = element('div'); release.className = 'akari-set-about-release';
                release.append(element('b', `v${info.recentChanges.version}`), element('span', formatShortReleaseDate(info.recentChanges.date)));
                if (info.recentChanges.notesUrl) { release.append(action('変更を見る', () => this.windows.openNewWindow(info.recentChanges!.notesUrl!, { external: true }), { small: true })); }
                section.append(groupCard('最近の変更', release));
            }
            section.append(groupCard(undefined, settingRow('リンク', 'akari.video · GitHub · オープンソースのライセンス',
                ...[['公式サイト', 'https://akari.video'], ['GitHub', 'https://github.com/akari-video/akari-video'], ['ライセンス', 'https://github.com/akari-video/akari-video/blob/main/LICENSE']].map(([label, url]) =>
                    action(label, () => this.windows.openNewWindow(url, { external: true }), { small: true })))));
        }).catch(() => { this.notice.textContent = 'アプリ情報を読み込めませんでした。'; });
    }

    async refreshLibraryStatus(): Promise<void> {
        try {
            this.libraryStatus = await this.toolsService.libraryStatus();
            if (!this.isDisposed) { this.renderSection('storage'); }
        } catch { this.notice.textContent = '素材の使用量を確認できませんでした。'; }
    }

    showLibraryMoveProgress(progress: { bytes: number; totalBytes: number } | undefined): void {
        this.notice.textContent = progress?.totalBytes
            ? `素材を移動しています… ${formatLibraryBytes(progress.bytes)} / ${formatLibraryBytes(progress.totalBytes)}`
            : '素材を移動しています… 終わるまで取り込みと取得をお待ちください。';
    }
    clearLibraryMoveProgress(): void { this.notice.textContent = ''; }

    protected async acceptSyncedLibrary(): Promise<void> {
        this.showLibraryMoveProgress(undefined);
        try { await this.toolsService.moveLibrary(); await this.refreshLibraryStatus(); this.notice.textContent = '素材を移動しました。'; }
        catch { this.notice.textContent = '素材を移動できませんでした。'; }
    }

    protected async declineSyncedLibrary(): Promise<void> {
        try { await this.toolsService.declineLibraryMove(); await this.refreshLibraryStatus(); }
        catch { this.notice.textContent = '選択を保存できませんでした。'; }
    }

    protected async clearLabLibrary(): Promise<void> {
        const targets = this.libraryStatus?.usage.cleanup ?? [];
        if (!targets.length) { return; }
        const list = element('div');
        list.append(element('p', `Lab から受け取った ${targets.length} 個、合計 ${formatLibraryBytes(this.libraryStatus!.usage.cleanupBytes)} をゴミ箱へ移します。`));
        const names = element('ul');
        Object.assign(names.style, { maxHeight: '260px', overflow: 'auto', paddingLeft: '22px' });
        for (const item of targets) { names.append(element('li', `${item.title}（${formatLibraryBytes(item.bytes)}）`)); }
        list.append(names);
        const confirmed = await new ConfirmDialog({
            title: '取り直せる素材を片づける', msg: list, ok: 'ゴミ箱へ移す', cancel: 'やめる'
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
            this.notice.textContent = `${count} 個をゴミ箱へ移しました。`;
            await this.refreshLibraryStatus();
        } catch { this.notice.textContent = '素材を片づけられませんでした。'; }
    }

    /** はじめかたの進み具合。道具・接続の状態が読めたものだけ出す（読めないうちは枠ごと出さない）。 */
    protected startProgressSteps(): HTMLElement | undefined {
        const tools = this.toolsView?.checkedTools?.filter(tool => !tool.unsupported);
        const steps: { name: string; detail: string; done: boolean }[] = [];
        if (tools && tools.length > 0) {
            const ready = tools.filter(tool => tool.available).length;
            steps.push({ name: '道具', detail: `${ready} / ${tools.length} が使える`, done: ready === tools.length });
        }
        if (this.connectionSummary && this.connectionSummary.total > 0) {
            const { configured, total } = this.connectionSummary;
            steps.push({ name: '接続', detail: `API キー ${configured} / ${total}`, done: configured > 0 });
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
        const mode = this.preferences.get(AKARI_TRANSCRIBE_MODE) === 'advanced' ? 'advanced' : 'simple';
        const backend = this.preferences.get<TranscribeBackend>(AKARI_TRANSCRIBE_BACKEND, 'auto');
        const compareSet = this.preferences.get<string[]>(AKARI_TRANSCRIBE_COMPARE_SET, []);
        if (compareSet.length > 0) { this.compareDraft = compareSet; this.compareEnabled = true; }
        this.transcribe.replaceChildren(...this.sectionHeading('transcribe'));
        this.transcribe.append(groupCard('モード', choiceCards({ label: '文字起こしのモード', options: TRANSCRIBE_MODE_CHOICES, value: mode, columns: 2,
            onChange: value => this.savePreference(AKARI_TRANSCRIBE_MODE, value) })));
        const engines = TRANSCRIBE_BACKENDS.map(id => ({ value: id, label: ENGINE_LABELS[id], description: ENGINE_DESCRIPTIONS[id] }));
        let fixedEngine: typeof TRANSCRIBE_BACKENDS[number] = backend === 'auto' ? 'speech-analyzer' : backend;
        const engine: DropdownHandle = dropdown({ label: '文字起こしのエンジン', options: engines, value: fixedEngine, disabled: backend === 'auto',
            onChange: value => { fixedEngine = value; this.savePreference(AKARI_TRANSCRIBE_BACKEND, value); } });
        const policy = segmentedControl({ label: '使うエンジン', value: backend === 'auto' ? 'auto' : 'fixed',
            options: [{ value: 'auto', label: 'おまかせ' }, { value: 'fixed', label: '決めたエンジン' }],
            onChange: value => {
                engine.akariSetDisabled?.(value === 'auto');
                this.savePreference(AKARI_TRANSCRIBE_BACKEND, value === 'auto' ? 'auto' : fixedEngine);
            } });
        this.transcribe.append(groupCard('エンジン',
            settingRow('使うエンジン', 'おまかせは SpeechAnalyzer、次に Whisper の順。クラウドは自分で選んだときだけ使います', policy),
            settingRow('決めたエンジン', '「決めたエンジン」のときだけ使います', engine)));
        if (mode === 'simple') {
            this.transcribe.append(settingsNote('比較・カット候補の自動作成: アドバンスで使います'));
            return;
        }
        const chips = checkChips({ label: '比べるエンジン', checked: this.compareDraft,
            options: TRANSCRIBE_BACKENDS.map(id => ({ value: id, label: ENGINE_SHORT_LABELS[id] })),
            onToggle: (id, checked) => {
                this.compareDraft = TRANSCRIBE_BACKENDS.filter(candidate => candidate === id ? checked : this.compareDraft.includes(candidate));
                this.savePreference(AKARI_TRANSCRIBE_COMPARE_SET, [...this.compareDraft]);
            } });
        chips.hidden = !this.compareEnabled;
        const compare = switchControl({ label: '比べるときは、いつもこの組', checked: this.compareEnabled, onChange: checked => {
            this.compareEnabled = checked;
            chips.hidden = !checked;
            this.savePreference(AKARI_TRANSCRIBE_COMPARE_SET, this.compareEnabled ? [...this.compareDraft] : []);
        } });
        const cuts = switchControl({ label: 'カット候補を自動で作る', checked: this.preferences.get<boolean>(AKARI_TRANSCRIBE_AUTO_CUTS, true),
            onChange: checked => this.savePreference(AKARI_TRANSCRIBE_AUTO_CUTS, checked) });
        this.transcribe.append(groupCard('アドバンス',
            settingRow('比べるときは、いつもこの組', '比較は選択式（毎回ではない）。比べるエンジンに印を付けます', compare), chips,
            settingRow('カット候補を自動で作る', 'フィラー・言い直し・無音。作るだけでタイムラインには入れません', cuts)));
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
        const voicevoxPill = this.narrationLoading ? '確認中…' : voicevoxRunning
            ? `起動中 · ${voicevoxDetail?.version ?? '版を確認できません'}` : voicevoxFound ? '止まっています' : '入っていません';
        const engineCard = (id: string, label: string, state: string, description: string): { card: HTMLElement; actions: HTMLElement } => {
            const card = element('div');
            card.setAttribute('data-akari-narration-engine', id);
            Object.assign(card.style, { padding: '14px 16px', borderBottom: '1px solid var(--theia-border-color, #404040)' });
            const heading = element('div');
            Object.assign(heading.style, { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' });
            heading.append(element('strong', label), statusPill(state, state.startsWith('起動中') || state === 'fal の鍵あり' || state === 'お試し · 接続済み' ? 'ok' : 'neutral'));
            const detail = element('div', description);
            detail.style.opacity = '0.8';
            const actions = element('div');
            Object.assign(actions.style, { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '9px' });
            card.append(heading, detail, actions);
            return { card, actions };
        };
        const vv = engineCard('voicevox', 'VOICEVOX', voicevoxPill,
            'この Mac · 無料 · 使う声のクレジット（VOICEVOX:キャラ名）が必要');
        if (!this.narrationLoading && !voicevoxFound && !voicevoxRunning) {
            if (this.narrationState?.voicevoxCaskAvailable) {
                const install = action(this.narrationBusy === 'install' ? '入れています…' : '入れる', () => void this.installVoicevox(), { small: true });
                install.disabled = Boolean(this.narrationBusy);
                install.setAttribute('data-akari-narration-action', 'install');
                vv.actions.append(install);
            }
            const official = action('公式サイトを開く', () => this.windows.openNewWindow('https://voicevox.hiroshiba.jp/', { external: true }), { small: true });
            official.setAttribute('data-akari-narration-action', 'official');
            vv.actions.append(official);
        } else if (!this.narrationLoading && voicevoxRunning) {
            const preview = action(this.narrationBusy === 'preview' ? '作成中…' : '声を試す', () => void this.previewVoicevox(), { small: true });
            preview.disabled = Boolean(this.narrationBusy);
            preview.setAttribute('data-akari-narration-action', 'preview');
            const stop = action('止める', () => void this.operateVoicevox('stop'), { small: true });
            stop.disabled = Boolean(this.narrationBusy) || !voicevoxDetail?.managed;
            stop.title = voicevoxDetail?.managed ? '' : 'VOICEVOX アプリから終了してください';
            stop.setAttribute('data-akari-narration-action', 'stop');
            vv.actions.append(preview, stop);
        } else if (!this.narrationLoading && voicevoxFound) {
            const start = action(this.narrationBusy === 'start' ? '起動中…' : '起動する', () => void this.operateVoicevox('start'), { small: true });
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
            vv.card.append(progress, settingsNote('導入しています…'));
        }
        const geminiCard = engineCard('gemini-tts', 'Gemini 2.5 Flash TTS', this.narrationLoading ? '確認中…' :
            gemini?.availability.state === 'available' ? 'fal の鍵あり' : 'fal の鍵がありません',
            'クラウド · fal.ai 経由 · 従量（暫定 $0.05 / 1000 字）');
        const connectionsButton = action('接続と API キーへ', () => this.showSection('connections'), { small: true });
        connectionsButton.setAttribute('data-akari-narration-action', 'connections');
        geminiCard.actions.append(connectionsButton);
        const irodori = engineCard('irodori', '彩（自分の PC）', this.narrationLoading ? '確認中…' :
            irodoriState?.availability.state === 'available' ? 'お試し · 接続済み' : 'つながりません',
            'Irodori-TTS（MIT）を別に起動したサーバーにつないで使います。Mac の MPS でも使えます（M1 で 2 回目以降、1 文 15 秒前後）。');
        const experimentalPill = statusPill('お試し', 'neutral');
        experimentalPill.setAttribute('data-akari-experimental', 'true');
        irodori.card.querySelector('strong')?.after(experimentalPill);
        const irodoriUrl = element('input'); irodoriUrl.type = 'text';
        irodoriUrl.value = this.preferences.get(AKARI_NARRATION_IRODORI_URL) ?? 'http://127.0.0.1:8088';
        irodoriUrl.setAttribute('aria-label', '彩の接続先 URL'); irodoriUrl.setAttribute('data-akari-irodori-url', 'true');
        const invalidUrlNote = settingsNote('接続先は http または https の URL を入力してください。');
        invalidUrlNote.hidden = true; invalidUrlNote.setAttribute('data-akari-irodori-url-error', 'true');
        const saveUrl = action('保存', () => {
            const value = irodoriUrl.value.trim();
            if (!isValidIrodoriUrl(value)) { invalidUrlNote.hidden = false; return; }
            invalidUrlNote.hidden = true;
            this.savePreference(AKARI_NARRATION_IRODORI_URL, value);
            void this.preferenceWrites.then(() => this.refreshNarrationState());
        }, { small: true });
        saveUrl.setAttribute('data-akari-narration-action', 'save-irodori-url');
        irodori.card.append(settingRow('接続先 URL', '同じ PC または別の PC の Irodori サーバー', irodoriUrl, saveUrl));
        irodori.card.append(invalidUrlNote);
        const checkIrodori = action('接続を確かめる', () => void this.refreshNarrationState(), { small: true });
        checkIrodori.setAttribute('data-akari-narration-action', 'check-irodori');
        irodori.actions.append(checkIrodori);
        const setup = element('details'); const summary = element('summary', 'サーバーの立て方'); setup.append(summary);
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
            { label: 'CPU のみ', command: 'uv sync --extra cpu' }
        ]);
        setupSteps('Linux', [
            { label: 'NVIDIA GPU', command: 'uv sync --extra cu128' },
            { label: 'AMD GPU（ROCm）', command: 'uv sync --extra rocm' },
            { label: 'CPU のみ', command: 'uv sync --extra cpu' }
        ]);
        setup.append(element('h4', 'macOS（Apple Silicon）'),
            commandLine('git clone https://github.com/Aratako/Irodori-TTS-Server.git'),
            commandLine('cd Irodori-TTS-Server'), commandLine('uv sync --extra cpu'),
            commandLine('cp .env.example .env'),
            commandLine('IRODORI_MODEL_DEVICE=mps IRODORI_CODEC_DEVICE=mps uv run --no-sync python -m irodori_openai_tts --host 0.0.0.0 --port 8088'),
            element('p', '初回はモデル約 3.3 GB。2 回目以降は 1 文 15 秒前後（M1 実測 2026-09-24）。'));
        setup.append(element('p', '別の PC から使うときは、AKARI の接続先に http://<その PC の IP>:8088 を入れ、ファイアウォールで 8088 を開けてください。'));
        irodori.card.append(setup);
        const officialIrodori = action('公式リポジトリを開く', () => this.windows.openNewWindow('https://github.com/Aratako/Irodori-TTS-Server', { external: true }), { small: true });
        officialIrodori.setAttribute('data-akari-narration-action', 'irodori-official'); irodori.actions.append(officialIrodori);
        section.append(groupCard('エンジン', vv.card, geminiCard.card, irodori.card));
        const voicesSection = groupCard('自分の声');
        const createVoice = action('自分の声をつくる…', () => void this.commands.executeCommand('akari.voice.create').then(() => this.refreshNarrationState()), { small: true });
        createVoice.setAttribute('data-akari-voice-action', 'create');
        voicesSection.append(settingRow('自分の声', '録音を正本として保存します', createVoice));
        if (!this.voiceProfilesLoaded) voicesSection.append(settingsNote(this.narrationError ? '声の一覧を取得できませんでした。' : '読み込み中…'));
        const profiles = this.voiceProfiles.filter(profile => !profile.legacy || !this.voiceProfiles.some(other => other.id === profile.id && !other.legacy));
        for (const profile of profiles) {
            const buttons = element('div'); Object.assign(buttons.style, { display: 'flex', gap: '6px', flexWrap: 'wrap' });
            const choices = voiceSettingsActions(profile, irodoriState?.availability.state === 'available',
                falKeyAvailable(this.narrationState?.engines.find(engine => engine.id === 'fal-qwen3')),
                this.narrationState?.engines.some(engine => engine.id === 'gemini-3.8-flash-tts' && engine.availability.state !== 'unconfigured'));
            const addButton = (label: string, id: string, callback: () => void): void => {
                const button = action(label, callback, { small: true }); button.setAttribute('data-akari-voice-action', id); buttons.append(button);
            };
            if (choices.migrate) addButton('新しい場所へ移す', 'migrate', () => void this.voiceAction(async () => {
                if (!await this.confirmVoiceAction('新しい場所へ移す', 'コピーします。旧い場所は残ります', '移す')) return;
                await this.narrationService.voiceMigrateLegacy(profile.id);
            }));
            if (choices.rename) {
                const name = element('input'); name.value = profile.label; name.setAttribute('aria-label', `${profile.label} の名前`); buttons.append(name);
                addButton('名前を変える', 'rename', () => void this.voiceAction(() => this.narrationService.voiceRename(profile.id, name.value)));
            }
            const copy = (engine: 'irodori' | 'fal-qwen3'): void => void this.voiceAction(async () => {
                let approved = false;
                if (engine === 'fal-qwen3') {
                    approved = await new ConfirmDialog({ title: '費用承認', msg: 'クラウド（fal）に録音を送って写しを作ります。見積 約 $0.01。続けますか？',
                        ok: '費用承認する', cancel: 'キャンセル' }).open();
                    if (!approved) return;
                }
                await this.narrationService.voiceCopy({ profile: profile.id, engine, approved,
                    irodoriUrl: engine === 'irodori' ? this.preferences.get(AKARI_NARRATION_IRODORI_URL) : undefined });
            });
            if (choices.addIrodori) addButton('写しを足す… 彩（自分の PC）', 'copy-irodori', () => copy('irodori'));
            if (choices.addFal) addButton('写しを足す… クラウド（fal）', 'copy-fal', () => copy('fal-qwen3'));
            const copyGemini = (): void => void this.voiceAction(async () => {
                const consentAudioPath = await this.geminiConsentDialog();
                if (!consentAudioPath) return;
                try {
                    const approved = await new ConfirmDialog({ title: '費用承認',
                        msg: 'Google に正本と本人の同意録音を送って声をつくります。声づくりの料金は見積不可です。続けますか？',
                        ok: '費用承認する', cancel: 'キャンセル' }).open();
                    if (!approved) return;
                    await this.narrationService.voiceCopy({ profile: profile.id, engine: 'gemini-3.8-flash-tts', consentAudioPath, approved: true });
                } finally { await this.narrationService.voiceDiscardGeminiConsent(consentAudioPath); }
            });
            if (choices.addGemini) addButton('写しを足す… Google Gemini 3.8', 'copy-gemini', copyGemini);
            if (choices.remakeIrodori) addButton('作り直す · 彩（自分の PC）', 'remake-irodori', () => copy('irodori'));
            if (choices.remakeFal) addButton('作り直す · クラウド（fal）', 'remake-fal', () => copy('fal-qwen3'));
            if (choices.remakeGemini) addButton('作り直す · Google Gemini 3.8', 'remake-gemini', copyGemini);
            if (choices.remove) addButton('消す', 'delete', () => void this.voiceAction(async () => {
                if (!await this.confirmVoiceAction('自分の声を消す', '手元の録音と彩の登録を消します。クラウドで作った声は fal / Google 側に残ります', '消す')) return;
                await this.narrationService.voiceDelete(profile.id, this.preferences.get(AKARI_NARRATION_IRODORI_URL));
            }));
            const row = settingRow(profile.label, undefined, buttons);
            row.setAttribute('data-akari-voice-profile', profile.id);
            Object.assign(row.style, { gridTemplateColumns: 'minmax(0, 1fr)', gap: '8px' });
            const control = row.querySelector<HTMLElement>('.akari-set-row-control');
            if (control) control.style.justifyContent = 'flex-start';
            const detail = element('div', `${voiceAvatarLabel(profile.avatar, this.voiceAvatars)} · ${profile.created_at?.slice(0, 10) ?? '日付不明'} · ${profile.duration_s?.toFixed(1) ?? '—'} 秒`);
            detail.className = 'akari-set-row-desc';
            const pills = element('div'); Object.assign(pills.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' });
            for (const engine of profile.engines) {
                pills.append(statusPill(engine === 'irodori' ? '彩（自分の PC）' : 'クラウド（fal）', 'neutral'));
                if (profile.copies?.[engine]?.stale) pills.append(statusPill('古い', 'warn'));
            }
            if (profile.legacy) pills.append(statusPill('旧い場所', 'warn'));
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
        const voicevoxSpeaker = typeof voices.voicevox === 'string' && voices.voicevox ? voices.voicevox : '未選択';
        const defaultEngineSelect = element('select');
        defaultEngineSelect.setAttribute('aria-label', '既定のエンジン');
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
                const option = element('option', `${title}${state?.availability.state === 'unconfigured' && label === 'クラウド' ? '（鍵なし）' : ''}`);
                option.value = id; group.append(option);
            }
            defaultEngineSelect.append(group);
        };
        addGroup('この Mac', [['voicevox', 'VOICEVOX'], ['irodori', '彩（お試し）']]);
        addGroup('クラウド', [['gemini-3.8-flash-tts', 'Gemini 3.8 Flash TTS'],
            ['gemini-3.1-flash-tts', 'Gemini 3.1 Flash TTS'], ['gemini-tts', 'Gemini 2.5 Flash TTS'],
            ['elevenlabs-v3', 'ElevenLabs v3'], ['fish-s2.1-pro', 'Fish Audio S2.1-Pro'],
            ['minimax-2.6-hd', 'MiniMax 2.6 HD'], ['chatterbox', 'Chatterbox 多言語']]);
        addGroup('自分の声', profiles.filter(profile => typeof profile.consent === 'string' ? profile.consent.trim() : profile.consent?.self_voice)
            .map(profile => [`voice:${profile.id}`, `自分の声（${profile.label}）`]));
        if (!this.voiceProfilesLoaded && typeof engine === 'string' && engine.startsWith('voice:')
            && !profiles.some(profile => `voice:${profile.id}` === engine)) {
            const option = element('option', '自分の声（読み込み中…）'); option.value = engine;
            defaultEngineSelect.lastElementChild?.append(option);
        }
        defaultEngineSelect.value = settingsVoiceEngineValue(engine, profiles, this.voiceProfilesLoaded);
        defaultEngineSelect.addEventListener('change', () => this.savePreference(AKARI_NARRATION_ENGINE, defaultEngineSelect.value));
        section.append(groupCard('既定値',
            settingRow('既定のエンジン', '読み上げのポップアップを開いたときに選ぶエンジン',
                defaultEngineSelect),
            settingRow('Gemini の既定の声', 'Gemini 2.5 Flash TTS で使う声',
                dropdown({ label: 'Gemini の既定の声', options: GEMINI_NARRATION_VOICES.map(id => ({ value: id, label: id })),
                    value: geminiVoice, onChange: value => {
                        const current = this.preferences.get(AKARI_NARRATION_VOICE);
                        const saved = typeof current === 'object' && current !== null && !Array.isArray(current)
                            ? current as Record<string, unknown> : {};
                        this.savePreference(AKARI_NARRATION_VOICE, { ...saved, 'gemini-tts': value });
                    } })),
            settingRow('VOICEVOX の既定の声', '読み上げのポップアップで声を選ぶと保存されます',
                element('span', voicevoxSpeaker))));
        const note = settingsNote('Gemini を使うには「接続と API キー」で fal の鍵を登録します。');
        note.append(' ', inlineLink('接続と API キーを開く', () => this.showSection('connections')));
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
            this.narrationError = error instanceof Error ? error.message : '状態を取得できませんでした。'; }
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
            const overlay = element('div'); overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'Google への口頭同意');
            overlay.setAttribute('data-akari-gemini-consent', 'true');
            Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '1000', background: '#0009',
                display: 'flex', alignItems: 'center', justifyContent: 'center' });
            const panel = element('div'); Object.assign(panel.style, { background: '#242832', border: '1px solid #777',
                borderRadius: '10px', padding: '20px', width: 'min(560px, calc(100vw - 32px))', display: 'flex', flexDirection: 'column', gap: '12px' });
            const phrase = createGeminiConsentPrompt();
            const note = element('p', '本人の声で読んで録音してください。照合はこの PC で行います。');
            const input = element('input') as HTMLInputElement; input.type = 'file'; input.accept = '.wav,.m4a,.mp3,.webm'; input.setAttribute('aria-label', '同意録音ファイル');
            let blob: Blob | undefined; let recorder: MediaRecorder | undefined; let stream: MediaStream | undefined;
            let checkedPath: string | undefined; let consentCheck: GeminiConsentCheck | undefined;
            const resetCheck = (): void => {
                if (checkedPath) void this.narrationService.voiceDiscardGeminiConsent(checkedPath);
                checkedPath = undefined; consentCheck = undefined;
            };
            input.onchange = () => { blob = input.files?.[0]; resetCheck(); note.textContent = blob ? '録音を選びました。照合してください。' : '録音を選んでください。'; };
            const record = action('録音する', () => void (async () => {
                if (recorder?.state === 'recording') { recorder.stop(); record.textContent = '録音する'; return; }
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const chunks: Blob[] = []; recorder = new MediaRecorder(stream);
                    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
                    recorder.onstop = () => { blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }); resetCheck();
                        stream?.getTracks().forEach(track => track.stop()); note.textContent = '録音しました。照合してください。'; };
                    recorder.start(); record.textContent = '止める';
                } catch { note.textContent = 'マイクを使えません。録音ファイルを選んでください。'; }
            })(), { small: true });
            const finish = (path?: string): void => { recorder?.state === 'recording' && recorder.stop(); stream?.getTracks().forEach(track => track.stop());
                overlay.remove(); resolve(path); };
            const cancel = action('キャンセル', () => { resetCheck(); finish(); }, { small: true });
            const next = action('この PC で照合', () => void (async () => {
                if (checkedPath && geminiConsentCanNext(true, consentCheck)) { finish(checkedPath); return; }
                if (!blob) { note.textContent = '同意録音が必要です。'; return; }
                next.disabled = true;
                try {
                    const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
                    for (const byte of bytes) binary += String.fromCharCode(byte);
                    const result = await this.narrationService.voiceCheckGeminiConsent(btoa(binary));
                    consentCheck = { pass: true, checks: { script: { ok: true, score: result.score } } };
                    if (!geminiConsentCanNext(true, consentCheck)) throw new Error(geminiConsentStatus(consentCheck));
                    checkedPath = result.path; note.textContent = geminiConsentStatus(consentCheck);
                    next.textContent = '次へ';
                } catch (error) { note.textContent = String(error); } finally { next.disabled = false; }
            })(), { small: true });
            next.setAttribute('data-gemini-consent-next', 'true');
            const buttons = element('div'); buttons.append(cancel, next);
            panel.append(element('strong', 'Google への口頭同意'), phrase, record, input, note, buttons);
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
            const cancel = action('キャンセル', () => finish(false), { small: true });
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
        } catch (error) { actionError = error instanceof Error ? error.message : '操作に失敗しました。'; }
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
        catch (error) { actionError = error instanceof Error ? error.message : '試聴音声を作れませんでした。'; }
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
        } catch (error) { actionError = error instanceof Error ? error.message : '導入できませんでした。'; }
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
            this.notice.textContent = '設定を保存できませんでした。';
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
            this.renderProviders(list.providers);
            this.renderStorage(list.credentials);
            this.credentialsPath = list.credentials.path;
            this.renderSection('privacy');
        } catch {
            this.providerList.replaceChildren(settingsNote('接続一覧を読み込めませんでした。'), action('再読み込み', () => void this.loadConnections(), { small: true }));
        }
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

    protected updateConnectionSummary(providers: ConnectionRow[]): void {
        this.connectionSummary = { configured: providers.filter(row => row.configured).length, total: providers.length };
        this.renderSection('start');
    }

    protected async refreshStoreEntitlements(): Promise<void> {
        const generation = ++this.storeStatusGeneration;
        if (!this.storeState.connection.connected || this.storeState.phase !== 'idle') {
            this.storeReconnect = false;
            this.renderStore();
            return;
        }
        try {
            const view = await this.storeService.getAssetCatalogView(undefined);
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
        const statusText = state.connectionLoading ? '接続を確認しています…'
            : state.phase === 'starting' ? '接続を開始しています…'
                : state.phase === 'pending' ? `ブラウザで承認してください · 確認コード: ${state.userCode ?? ''}`
                    : this.storeReconnect ? STORE_RECONNECT_REQUIRED_MESSAGE
                        : state.connection.connected ? `接続中 · ${who}` : '未接続';
        const url = `${deriveStoreLabBaseUrl(state.connection.url)}/`;

        const band = element('div');
        band.className = 'akari-set-group';
        band.setAttribute('data-akari-account-band', 'true');
        band.setAttribute('data-akari-settings-group', 'アカウント');
        const bandInner = element('div');
        bandInner.className = 'akari-set-account';
        const avatar = element('div');
        avatar.className = 'akari-set-avatar akari-set-avatar-user';
        avatar.setAttribute('aria-hidden', 'true');
        const identity = element('div');
        const name = element('div', connected ? (who || 'AKARI Store に接続中') : 'AKARI Store に接続していません');
        name.className = 'akari-set-account-name';
        const lead = description(connected ? '購入済みの素材を AKARI Video で使えます。'
            : '接続すると、Store で買った素材をライブラリへ入れられます。');
        lead.className = 'akari-set-account-desc';
        identity.append(name, lead);
        const controls = element('div');
        controls.className = 'akari-set-store-controls';
        if (busy) {
            controls.append(action('キャンセル', () => this.storeController.cancel(), { small: true }));
        } else {
            if (!state.connection.connected || this.storeReconnect) {
                const connect = action(this.storeReconnect ? '再接続する' : '接続する', () => void this.storeController.start(), { variant: 'primary' });
                connect.disabled = state.connectionLoading;
                controls.append(connect);
            }
            if (state.connection.connected) {
                const disconnect = action('切断する', () => {
                    disconnect.disabled = true;
                    void this.storeController.disconnect().catch(() => {
                        this.notice.textContent = 'AKARI Store から切断できませんでした。';
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
        store.setAttribute('data-akari-settings-group', 'AKARI STORE');
        const storeTitle = element('div', 'AKARI STORE');
        storeTitle.className = 'akari-set-group-title';
        const statusRow = element('div');
        statusRow.className = 'akari-set-row';
        const statusCopy = element('div');
        const statusLabel = element('div', '接続');
        statusLabel.className = 'akari-set-row-label';
        const statusDetail = description('動画に使える素材や演出パックを探して購入できます。接続すると、購入済みの素材を AKARI Video で使えます。');
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
        const openLabel = element('div', 'Store を開く');
        openLabel.className = 'akari-set-row-label';
        const openUrl = description(url.replace(/^https?:\/\//, '').replace(/\/$/, ''));
        openUrl.className = 'akari-set-row-desc';
        openCopy.append(openLabel, openUrl);
        openRow.setAttribute('data-akari-store-open', url);
        openRow.append(openCopy, action('ストアを開く', () => this.windows.openNewWindow(url, { external: true }), { small: true, iconAfter: 'ext' }));
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
        const detail = !credentials.exists ? `${credentials.path} · 登録すると作成します。平文・自分だけ読める権限（600）。CLI やスキルもこのファイルを読みます。`
            : credentials.secure_permissions ? `${credentials.path} · 平文・自分だけ読める権限（600）。CLI やスキルもこのファイルを読みます。`
                : `${credentials.path} · 現在のファイル権限は 600 ではありません。次の登録・削除時に修正します。`;
        this.storage.replaceChildren(groupCard('キーの保存先', settingRow('保存場所', `鍵は ${credentials.path} に保存します（この PC だけ・600）。${detail}`, segmentedControl<'file' | 'encrypted'>({
            label: 'キーの保存先', value: 'file', onChange: () => undefined,
            options: [{ value: 'file', label: 'このファイル' }, { value: 'encrypted', label: '暗号化', disabled: true, title: '暗号化して保存（この Mac のログイン鍵で）は準備中です' }]
        }))), settingsNote('登録後は末尾 4 桁だけを表示します。鍵はレポート・差分・チャットへ出しません。'));
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
            const badge = element('span', '旧い場所から読んでいます');
            badge.className = 'akari-set-pill akari-set-pill-warn';
            badge.setAttribute('data-credential-source', 'legacy');
            heading.append(badge);
        }
        if (row.id === 'fal') { heading.append(statusPill('おすすめ', 'accent')); }
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
        if (billing) { links.append(action('管理画面', () => this.windows.openNewWindow(billing, { external: true }), { small: true, iconAfter: 'ext' })); }
        if (row.setup_url?.startsWith('https://')) {
            const setupUrl = row.setup_url;
            links.append(action('キーを取得', () => this.windows.openNewWindow(setupUrl, { external: true }), { small: true, iconAfter: 'ext' }));
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
            setPill(status, '確認中…', 'neutral');
            try {
                await operation();
                renderControls();
                const list = await this.service.listConnections();
                if (!this.isDisposed) {
                    this.renderStorage(list.credentials);
                    this.renderProviders(list.providers);
                }
            } catch { detail.textContent = '操作できませんでした。入力と保存先を確認してください。'; }
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
                controls.append(tail, action('確認', () => void run(async () => {
                    row.doctor = (await this.service.checkConnection(row.id)).doctor;
                }), { small: true }), action('削除', () => void run(async () => {
                    await this.service.deleteCredential(row.id);
                    row.configured = false; row.masked_tail = null;
                    row.doctor = { status: 'unconfigured', detail: '未登録', last_checked: null };
                }), { small: true }));
                if (row.source === 'legacy') {
                    controls.append(action('新しい場所へ移す', () => void run(async () => {
                        await this.service.migrateCredential(row.id);
                    }), { small: true }));
                }
            } else {
                const input = textField({ label: `${row.label} の API キー`, type: 'password', placeholder: 'API キーを貼る' });
                input.autocomplete = 'off';
                const save = action('保存', () => void run(async () => {
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
        renderControls();
        card.append(logo, main, actions);
        if (row.id === 'fal') {
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
            ? action('口座の残高は管理画面で確認', () => this.windows.openNewWindow('https://openrouter.ai/settings/credits', { external: true }), { small: true, iconAfter: 'ext' })
            : undefined;
        if (accountLink) { accountLink.style.display = 'none'; }
        const button = action('残高を見る', async () => {
            button.disabled = true;
            value.className = 'akari-set-bal-value';
            value.setAttribute('data-state', 'loading');
            value.textContent = '確認中…';
            time.textContent = '';
            if (accountLink) { accountLink.style.display = 'none'; }
            try {
                const result = await this.service.readBalance(row.id);
                if (this.isDisposed) { return; }
                if (result.ok) {
                    value.textContent = result.display ?? '';
                    value.setAttribute('data-state', 'ok');
                    time.textContent = 'たった今';
                    time.title = new Date(result.checked_at).toLocaleString('ja-JP');
                    if (accountLink) { accountLink.style.display = result.account_url ? '' : 'none'; }
                } else {
                    value.textContent = result.error ?? '残高を問い合わせられませんでした。';
                    value.className = 'akari-set-bal-error';
                    value.setAttribute('data-state', 'error');
                }
            } catch {
                value.textContent = '残高を問い合わせられませんでした。';
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
                    value.textContent = '未接続';
                    time.textContent = '';
                    if (accountLink) { accountLink.style.display = 'none'; }
                } else if (value.getAttribute('data-state') === 'idle') {
                    value.textContent = '—';
                }
            }
        };
    }

    private async renderGenerationDefaults(container: HTMLElement): Promise<void> {
        container.replaceChildren(settingsNote('生成の既定モデルを読み込んでいます…'));
        try {
            const [defaults, catalog] = await Promise.all([
                this.service.readGenerationDefaults(), this.service.readGenerationCatalog()
            ]);
            if (this.isDisposed) { return; }
            const controls: DropdownHandle[] = [];
            const rowFor = (field: 'still' | 'video', kind: GenerationKind, label: string): HTMLElement => {
                const options = generationOptions(catalog.models, kind, defaults.effective[field]).map(item => {
                    const [family, id, ...rest] = item.label.split(' · ');
                    return item.missing ? { value: item.value, label: item.value, description: 'カタログにありません' }
                        : { value: item.value, label: id ? `${family} · ${id}` : item.label, description: rest.join(' · ') || undefined };
                });
                const control = dropdown({ label: `${label}の既定モデル`, options, value: defaults.effective[field] ?? '',
                    onChange: async value => {
                        for (const item of controls) { item.akariSetDisabled?.(true); }
                        try {
                            await this.service.setGenerationDefaults({ [field]: value });
                            if (!this.isDisposed) { await this.renderGenerationDefaults(container); }
                        } catch {
                            this.notice.textContent = '生成の既定モデルを保存できませんでした。';
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
                return settingRow(`既定モデル: ${label}`, undefined, control, source);
            };
            container.replaceChildren(
                rowFor('still', 'image', '静止画'), rowFor('video', 'video', '動画'),
                settingsNote('「静止画を作る」「動画にする」で最初に選ばれるモデル。作業場の .akari/connections.json に保存します。鍵が未登録でも選べます')
            );
            for (const note of Array.from(container.querySelectorAll<HTMLElement>('.akari-set-note'))) { note.style.margin = '8px 0 0'; }
        } catch {
            if (this.isDisposed) { return; }
            container.replaceChildren(settingsNote('生成モデルのカタログを読み込めませんでした。'),
                action('再読み込み', () => void this.renderGenerationDefaults(container), { small: true }));
        }
    }

    override dispose(): void {
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
        const recheck = action(this.checkingTools ? '確認中…' : '確認し直す', () => void this.recheckTools(), { small: true, icon: 'refresh' });
        recheck.setAttribute('data-akari-tool-recheck', 'true');
        recheck.disabled = this.checkingTools || this.installingTools;
        const card = groupCard('道具', ...rows);
        if (!this.toolCheck && this.checkingTools) {
            const status = settingsNote('道具を確認しています…');
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
        card.append(settingRow('状態を確認し直す', 'インストールしたあとや、別の方法で入れたあとに押します', recheck));
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
                ? `モデル: ${voiceInk ? 'VoiceInk のモデルを使います · ' : ''}${homeShortened(tool.model.path)}`
                : `認識モデル · ${WHISPER_MODEL_SIZE_LABEL} · ${tool.model.available ? '取得済み' : '未取得'}`;
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
            extra(progress?.kind === 'download' ? formatDownloadProgressLabel(progress.downloadedBytes ?? 0, progress.totalBytes) : progress?.phase ?? '準備しています…');
        }
        let trailing: HTMLElement;
        if (!tool.unsupported && !tool.available && !info.osProvided) {
            const install = action(this.installingTools && this.installProgress?.id === tool.id ? 'インストール中…' : '準備する', () => {
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
    @inject(PreferenceSchemaService) protected readonly preferenceSchemas!: PreferenceSchemaService;
    @inject(AkariConnectionsService) protected readonly connections!: AkariConnectionsService;
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
    protected maintenance?: AkariSettingsMaintenanceService;
    protected dialog: AkariSettingsDialog | undefined;
    protected requestedSection: SettingsSectionId | undefined;
    protected opened: Promise<unknown> | undefined;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand({ id: 'akari.library.isMoving' }, { execute: () => this.tools.isLibraryMoving() });
        commands.registerCommand({ id: 'akari.library.changeLocation', label: '素材の置き場を変える…' }, {
            execute: async () => {
                const selected = await this.fileDialogs.showOpenDialog({
                    title: '素材の置き場を選ぶ', canSelectFiles: false, canSelectFolders: true
                });
                if (!selected) { return; }
                this.messages.info('素材を移動しています…');
                this.dialog?.showLibraryMoveProgress(undefined);
                const poll = window.setInterval(() => {
                    void this.tools.libraryMoveProgress().then(value => this.dialog?.showLibraryMoveProgress(value));
                }, 400);
                try {
                    const result = await this.tools.moveLibrary(selected.path.fsPath());
                    this.messages.info(result.state === 'pending'
                        ? '同期される場所です。移動する前に、素材の設定で確認してください。'
                        : '素材の置き場を変えました。');
                    await this.dialog?.refreshLibraryStatus();
                } catch (error) {
                    this.messages.error(error instanceof Error ? error.message : '素材を移動できませんでした。');
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
            'akari.export.openFolderAfter': { type: 'boolean', default: false },
            'akari.export.notifyAfter': { type: 'boolean', default: true },
            [AKARI_EXPORT_FILENAME_PATTERN]: { type: 'string', enum: ['project-date-time', 'project-name'], default: 'project-date-time' },
            'akari.update.channel': { type: 'string', enum: ['stable', 'prerelease'], default: 'prerelease' },
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
        commands.registerCommand({ id: 'akari.settings.open', label: 'AKARI Video の設定' }, {
            execute: (arg?: unknown) => {
                const section = resolveSettingsSectionId(arg);
                if (section) {
                    this.requestedSection = section;
                    this.dialog?.showSection(section);
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
        this.maintenance ??= this.connectionsProvider.createProxy<AkariSettingsMaintenanceService>(AKARI_SETTINGS_MAINTENANCE_PATH);
        const root = this.workspaceService.tryGetRoots()[0]?.resource.path.fsPath();
        const dialog = new AkariSettingsDialog(this.preferences, this.connections, this.store, this.windows, this.commands, this.tools, this.files, this.env, this.fileDialogs, this.maintenance, root, this.widgetManager, this.shell, this.pluginServer, this.narrationEngines, this.keybindingRegistry, this.commandRegistry, this.keymapsService, this.keyboardLayout, this.requestedSection);
        this.dialog = dialog;
        try { await dialog.open(); }
        finally {
            this.dialog = undefined;
            this.requestedSection = undefined;
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
/** 状態のピルは「接続済み / 未接続」の 2 値（キーが通らないと分かったときだけ「繋がらない」）。確認の詳細は下の 1 行に出す。 */
function doctorPill(row: ConnectionRow): [string, 'ok' | 'neutral' | 'warn'] {
    if (!row.configured || row.doctor.status === 'unconfigured') { return ['未接続', 'neutral']; }
    if (row.doctor.status === 'unauthorized') { return ['繋がらない', 'warn']; }
    return ['接続済み', 'ok'];
}
function doctorLabel(doctor: ConnectionDoctor): string {
    if (doctor.status === 'unconfigured') { return '未登録'; }
    if (doctor.status === 'ok') { return `繋がった · ${doctor.last_checked ? new Date(doctor.last_checked).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''}`; }
    if (!doctor.last_checked) { return '登録済み · 未確認'; }
    return `繋がらない（${doctor.detail}）`;
}
