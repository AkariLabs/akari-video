import { deriveStoreLabBaseUrl } from 'akari-project/lib/common/asset-catalog-view';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { AkariNewProjectService, AkariToolCheckResult, AkariToolId } from '../common/akari-new-project-protocol';
import { AkariFirstRunSetupDialog } from './akari-first-run-setup-dialog';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { CommonCommands } from '@theia/core/lib/browser';
import { OS } from '@theia/core/lib/common/os';
import { buildExportEncoderChoices, ExportEncoder } from 'akari-shell-strip/lib/common/export-encoder-choices';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandContribution, CommandRegistry, CommandService } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
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
import {
    AKARI_TRANSCRIBE_MODE, AKARI_TRANSCRIBE_AUTO_CUTS, AKARI_TRANSCRIBE_BACKEND, AKARI_TRANSCRIBE_COMPARE_SET,
    AKARI_QUALITY_TIER, AKARI_DEVELOPER_MODE, AKARI_AGENT_TURN_END_NOTIFICATION, AKARI_CATALOG_ROOT,
    AKARI_TIMELINE_VISUAL_THUMBNAILS,
    WORKBENCH_COLOR_THEME, AKARI_EXPORT_QUALITY, AKARI_EXPORT_OUTPUT_DIRECTORY,
    AKARI_EXPORT_ENCODER, AKARI_EXPORT_CODEC, AKARI_EXPORT_FPS, EXPORT_CODEC_CHOICES, EXPORT_FPS_CHOICES,
    SETTINGS_SECTIONS, SettingsSectionId, QUALITY_TIER_CHOICES, THEME_CHOICES, EXPORT_QUALITY_CHOICES, TRANSCRIBE_MODE_CHOICES,
    normalizeQualityTier, normalizeTheme, normalizeExportQuality, normalizeOutputDirectory,
    sectionForPreferenceKey, resolveSettingsSectionId, settingsSectionElementId, isSettingsSectionVisible,
    SETTINGS_SECTION_DESCRIPTIONS, SETTINGS_LAST_SECTION_KEY, initialSettingsSection, QUALITY_TIER_RESERVED_NOTE,
    normalizeExportEncoder, normalizeExportCodec, normalizeExportFps
} from '../common/settings-sections';
import { settingsIcon, SettingsIconName } from './settings/settings-icons';
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
/** エンコーダのセグメントは短い名前で並べ、正式名は title（ホバー）に残す。 */
const ENCODER_SHORT_LABELS: Record<ExportEncoder, string> = {
    auto: '自動', videotoolbox: 'GPU', nvenc: 'NVENC', qsv: 'QSV', amf: 'AMF', mf: 'Media Foundation', x264: 'CPU'
};
const TOOL_ICONS: Record<AkariToolId, SettingsIconName> = {
    ffmpeg: 'film', whisper: 'mic', 'yt-dlp': 'download', voicevox: 'user', blender: 'cube', 'speech-analyzer': 'spark', 'xcode-clt': 'terminal'
};

export class AkariSettingsDialog extends AbstractDialog<void> {
    protected readonly body = element('main');
    protected readonly transcribe = element('section');
    protected readonly connections = element('section');
    protected readonly providerList = element('div');
    protected readonly storage = element('div');
    /** Akari アカウント節の中身（アカウント帯 + AKARI Store のグループ）。renderStore が描き直す。 */
    protected readonly storeRow = element('div');
    protected readonly sections = new Map<SettingsSectionId, HTMLElement>();
    protected readonly storeController: StoreConnectionFlowController;
    protected storeState: StoreConnectionFlowState = { connection: { connected: false }, connectionLoading: true, phase: 'idle' };
    protected storeReconnect = false;
    protected storeStatusGeneration = 0;
    protected readonly notice = element('p');
    protected preferenceWrites: Promise<unknown> = Promise.resolve();
    protected readonly toolsView: SettingsToolsView;
    protected compareEnabled: boolean;
    protected compareDraft: string[];
    protected connectionSummary: { configured: number; total: number } | undefined;

    constructor(
        protected readonly preferences: PreferenceService,
        protected readonly service: AkariConnectionsService,
        protected readonly storeService: AkariProjectService,
        protected readonly windows: WindowService,
        protected readonly commands: CommandService,
        toolsService: AkariNewProjectService, files: FileService, env: EnvVariablesServer,
        protected readonly fileDialogs: FileDialogService, initialSection?: SettingsSectionId
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
        let stored: string | null = null;
        try { stored = localStorage.getItem(SETTINGS_LAST_SECTION_KEY); } catch { /* 保存不可でも設定は使える。 */ }
        this.showSection(initialSettingsSection(initialSection, stored));
        for (const section of SETTINGS_SECTIONS) { this.renderSection(section.id); }
        this.toDispose.push(preferences.onPreferenceChanged(change => {
            const section = sectionForPreferenceKey(change.preferenceName);
            if (section) { this.renderSection(section); }
        }));
        void this.toolsView.refresh();
        void this.loadConnections();
        void this.storeController.refreshStatus();
    }

    get value(): void { return undefined; }
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
        const title = element('h3', '設定');
        title.className = 'akari-set-nav-title';
        nav.append(title);
        for (const section of SETTINGS_SECTIONS) {
            if (section.group === 'developer') {
                const group = element('h3', '開発者');
                group.className = 'akari-set-nav-group';
                nav.append(group);
            }
            nav.append(this.navigation(section.label, section.id, section.icon));
        }
        Object.assign(this.body.style, { display: 'flex', flexDirection: 'column', flex: '1', minWidth: '0', minHeight: '0' });
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
        const storeMoved = settingsNote('AKARI Store の接続は「Akari アカウント」へ移りました。');
        storeMoved.append(' ', inlineLink('Akari アカウントを開く', () => this.showSection('account')));
        this.connections.append(...this.sectionHeading('connections'), storeMoved, this.providerList, this.storage);
        this.providerList.append(settingsNote('接続を読み込んでいます…'));
        this.renderStore();
        this.contentNode.append(nav, this.body);
    }

    showSection(section: SettingsSectionId): void {
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

    protected navigation(label: string, target: SettingsSectionId, icon: SettingsIconName): HTMLButtonElement {
        const button = element('button');
        button.type = 'button';
        button.className = 'akari-set-nav-item';
        button.append(settingsIcon(icon), element('span', label));
        button.addEventListener('click', () => this.showSection(target));
        button.setAttribute('data-settings-nav', target);
        return button;
    }

    protected sectionHeading(id: SettingsSectionId): HTMLElement[] {
        const heading = element('h2', SETTINGS_SECTIONS.find(item => item.id === id)!.label);
        heading.id = `${settingsSectionElementId(id)}-heading`;
        const lead = description(SETTINGS_SECTION_DESCRIPTIONS[id]);
        lead.className = 'akari-set-lead';
        return [heading, lead];
    }

    protected renderSection(id: SettingsSectionId): void {
        if (id === 'transcribe') { this.renderTranscribe(); return; }
        if (id === 'connections') { return; }
        const section = this.sections.get(id)!;
        section.replaceChildren(...this.sectionHeading(id));
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
            copy.append(heroTitle, description('道具のインストール・作業場・AI パートナーを順番に案内します。いつでもやり直せます'));
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
            const theme = normalizeTheme(this.preferences.get(WORKBENCH_COLOR_THEME));
            const themes: { value: string; label: string; preview?: HTMLElement }[] = THEME_CHOICES.map(option => ({ ...option, preview: themePreview(option.value) }));
            if (!themes.some(option => option.value === theme)) { themes.push({ value: theme, label: theme }); }
            section.append(groupCard('テーマ', choiceCards({ label: 'テーマ', options: themes, value: theme, columns: 3,
                onChange: value => this.savePreference(WORKBENCH_COLOR_THEME, value) })));
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
                    }, { small: true }))));
        }
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

    protected savePreference(key: string, value: unknown): void {
        this.preferenceWrites = this.preferenceWrites.then(() => this.preferences.set(key, value, PreferenceScope.User)).catch(() => {
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
        this.storage.replaceChildren(groupCard('キーの保存先', settingRow('保存場所', detail, segmentedControl<'file' | 'encrypted'>({
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
                    this.updateConnectionSummary(list.providers);
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
        const button = action('残高を見る', async () => {
            button.disabled = true;
            value.className = 'akari-set-bal-value';
            value.setAttribute('data-state', 'loading');
            value.textContent = '確認中…';
            time.textContent = '';
            try {
                const result = await this.service.readBalance(row.id);
                if (this.isDisposed) { return; }
                if (result.ok) {
                    value.textContent = result.display ?? '';
                    value.setAttribute('data-state', 'ok');
                    time.textContent = 'たった今';
                    time.title = new Date(result.checked_at).toLocaleString('ja-JP');
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
        node.append(button, value, time);
        return {
            node,
            setConfigured: configured => {
                button.disabled = !configured;
                if (!configured) {
                    value.className = 'akari-set-bal-value';
                    value.setAttribute('data-state', 'idle');
                    value.textContent = '未接続';
                    time.textContent = '';
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
        if (tool.version) { extra(tool.version); }
        if (tool.id === 'whisper' && tool.model) {
            const voiceInk = tool.model.path ? /[\\/]com\.prakashjoshipax\.VoiceInk[\\/]/.test(tool.model.path) : false;
            const line = tool.model.path
                ? `モデル: ${voiceInk ? 'VoiceInk のモデルを使います · ' : ''}${tool.model.path}`
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
    @inject(AkariConnectionsService) protected readonly connections!: AkariConnectionsService;
    @inject(AkariProjectService) protected readonly store!: AkariProjectService;
    @inject(WindowService) protected readonly windows!: WindowService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(AkariNewProjectService) protected readonly tools!: AkariNewProjectService;
    @inject(FileService) protected readonly files!: FileService;
    @inject(FileDialogService) protected readonly fileDialogs!: FileDialogService;
    @inject(EnvVariablesServer) protected readonly env!: EnvVariablesServer;
    protected dialog: AkariSettingsDialog | undefined;
    protected requestedSection: SettingsSectionId | undefined;
    protected opened: Promise<unknown> | undefined;

    registerCommands(commands: CommandRegistry): void {
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
        const dialog = new AkariSettingsDialog(this.preferences, this.connections, this.store, this.windows, this.commands, this.tools, this.files, this.env, this.fileDialogs, this.requestedSection);
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
/** テーマの見本（そのテーマのパレットで描いた小さな画面）。 */
function themePreview(theme: string): HTMLElement {
    const preview = el('div', 'akari-set-theme-preview');
    preview.setAttribute('data-theme', theme);
    preview.setAttribute('aria-hidden', 'true');
    preview.append(el('i'), el('i', 'm'), el('i'));
    return preview;
}
function doctorPill(row: ConnectionRow): [string, 'ok' | 'neutral' | 'warn'] {
    if (!row.configured || row.doctor.status === 'unconfigured') { return ['未接続', 'neutral']; }
    if (row.doctor.status === 'ok') { return ['接続済み', 'ok']; }
    if (row.doctor.status === 'unauthorized') { return ['繋がらない', 'warn']; }
    return ['登録済み', 'neutral'];
}
function doctorLabel(doctor: ConnectionDoctor): string {
    if (doctor.status === 'unconfigured') { return '未登録'; }
    if (doctor.status === 'ok') { return `繋がった · ${doctor.last_checked ? new Date(doctor.last_checked).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''}`; }
    if (!doctor.last_checked) { return '登録済み · 未確認'; }
    return `繋がらない（${doctor.detail}）`;
}
