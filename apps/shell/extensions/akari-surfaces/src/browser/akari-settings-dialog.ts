import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { AKARI_BORDER, AKARI_SURFACE } from 'akari-project/lib/common/akari-surface-tokens';
import {
    AkariConnectionsService, ConnectionDoctor, ConnectionRow, ConnectionsList, TRANSCRIBE_BACKENDS, TranscribeBackend
} from '../common/akari-connections-protocol';
import { storeReconnectRequired, STORE_RECONNECT_REQUIRED_MESSAGE } from '../common/store-entitlements-visibility';
import { AKARI_TRANSCRIBE_AUTO_CUTS, AKARI_TRANSCRIBE_BACKEND, AKARI_TRANSCRIBE_COMPARE_SET } from './akari-preferences';

const ENGINE_LABELS: Record<string, string> = {
    'speech-analyzer': 'SpeechAnalyzer（この Mac）', 'whisper-cpp': 'Whisper.cpp（ローカル）',
    'cloud:scribe': 'Scribe（クラウド）', 'cloud:groq': 'Groq（クラウド）'
};

export class AkariSettingsDialog extends AbstractDialog<void> {
    protected readonly body = element('main');
    protected readonly transcribe = element('section');
    protected readonly connections = element('section');
    protected readonly providerList = element('div');
    protected readonly storage = element('div');
    protected readonly notice = element('p');
    protected preferenceWrites: Promise<unknown> = Promise.resolve();
    protected compareEnabled: boolean;
    protected compareDraft: string[];

    constructor(
        protected readonly preferences: PreferenceService,
        protected readonly service: AkariConnectionsService,
        protected readonly storeService: AkariProjectService,
        protected readonly openStore: () => Promise<void>
    ) {
        super({ title: 'AKARI Video の設定' });
        this.compareDraft = preferences.get<string[]>(AKARI_TRANSCRIBE_COMPARE_SET, []);
        this.compareEnabled = this.compareDraft.length > 0;
        this.buildDom();
        this.renderTranscribe();
        this.toDispose.push(preferences.onPreferenceChanged(change => {
            if (change.preferenceName.startsWith('akari.transcribe.')) {
                this.renderTranscribe();
            }
        }));
        void this.loadConnections();
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
        nav.setAttribute('aria-label', '設定の項目');
        Object.assign(nav.style, { flex: '0 0 180px', maxWidth: '32%', overflowY: 'auto', padding: '16px 8px', borderRight: AKARI_BORDER.hairline });
        nav.append(element('h3', '設定'));
        for (const [label, target] of [
            ['はじめかた', 'start'], ['書き出し', 'export'], ['プレビュー品質', 'quality'],
            ['文字起こし', 'transcribe'], ['接続と API キー', 'connections'], ['通知', 'notifications'], ['道具', 'tools']
        ]) {
            nav.append(this.navigation(label, target));
        }
        nav.append(element('h3', '開発者'), this.navigation('開発者モード', 'developer'));
        Object.assign(this.body.style, { flex: '1', minWidth: '0', overflowY: 'auto', padding: '20px 24px', scrollBehavior: 'smooth' });
        this.notice.setAttribute('role', 'alert');
        this.notice.style.color = 'var(--theia-errorForeground)';
        this.body.append(this.notice);
        for (const [label, id] of [['はじめかた', 'start'], ['書き出し', 'export'], ['プレビュー品質', 'quality']]) {
            this.body.append(this.later(label, id));
        }
        this.transcribe.id = 'akari-settings-transcribe';
        this.transcribe.setAttribute('data-akari-settings-section', 'transcribe');
        this.connections.id = 'akari-settings-connections';
        this.connections.setAttribute('data-akari-settings-section', 'connections');
        this.connections.append(element('h2', '接続と API キー'), description('登録後は末尾 4 桁だけを表示します。鍵はレポート・差分・チャットへ出しません。'), this.providerList, this.storage);
        this.providerList.textContent = '接続を読み込んでいます…';
        this.body.append(this.transcribe, this.connections);
        for (const [label, id] of [['通知', 'notifications'], ['道具', 'tools'], ['開発者モード', 'developer']]) {
            this.body.append(this.later(label, id));
        }
        this.contentNode.append(nav, this.body);
    }

    protected navigation(label: string, target: string): HTMLButtonElement {
        const button = action(label, () => {
            this.body.querySelector(`#akari-settings-${target}`)?.scrollIntoView({ block: 'start' });
            for (const item of Array.from(this.contentNode.querySelectorAll('[data-settings-nav]'))) { item.removeAttribute('aria-current'); }
            button.setAttribute('aria-current', 'true');
        });
        button.setAttribute('data-settings-nav', target);
        Object.assign(button.style, { display: 'block', textAlign: 'left', width: '100%', margin: '4px 0', padding: '8px', whiteSpace: 'normal' });
        if (target === 'transcribe' || target === 'connections') { button.style.color = 'var(--theia-textLink-foreground)'; }
        return button;
    }

    protected later(label: string, id: string): HTMLElement {
        const row = element('div', `${label} · 後で`);
        row.id = `akari-settings-${id}`;
        Object.assign(row.style, { color: 'var(--theia-descriptionForeground)', padding: '8px 0', fontSize: '12px' });
        return row;
    }

    protected renderTranscribe(): void {
        const backend = this.preferences.get<TranscribeBackend>(AKARI_TRANSCRIBE_BACKEND, 'auto');
        const compareSet = this.preferences.get<string[]>(AKARI_TRANSCRIBE_COMPARE_SET, []);
        if (compareSet.length > 0) { this.compareDraft = compareSet; this.compareEnabled = true; }
        this.transcribe.replaceChildren(element('h2', '文字起こし'));
        const auto = choice('radio', 'おまかせ（この Mac のエンジンを優先）', backend === 'auto');
        const fixed = choice('radio', '決めたエンジンだけ使う', backend !== 'auto');
        auto.input.name = fixed.input.name = 'akari-transcribe-default';
        auto.input.addEventListener('change', () => this.savePreference(AKARI_TRANSCRIBE_BACKEND, 'auto'));
        const select = element('select');
        select.className = 'theia-select';
        select.setAttribute('aria-label', '文字起こしのエンジン');
        for (const id of TRANSCRIBE_BACKENDS) { const option = element('option', ENGINE_LABELS[id]); option.value = id; select.append(option); }
        select.value = backend === 'auto' ? 'speech-analyzer' : backend;
        select.disabled = backend === 'auto';
        fixed.input.addEventListener('change', () => this.savePreference(AKARI_TRANSCRIBE_BACKEND, select.value));
        select.addEventListener('change', () => this.savePreference(AKARI_TRANSCRIBE_BACKEND, select.value));
        this.transcribe.append(auto.label, description('SpeechAnalyzer → Whisper の順。クラウドは自分で選んだときだけ使う'), fixed.label, select);
        const compare = choice('checkbox', '比べるときは、いつもこの組', this.compareEnabled);
        const engines = element('div');
        Object.assign(engines.style, { display: this.compareEnabled ? 'grid' : 'none', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '4px', marginLeft: '20px' });
        compare.input.addEventListener('change', () => {
            this.compareEnabled = compare.input.checked;
            engines.style.display = this.compareEnabled ? 'grid' : 'none';
            this.savePreference(AKARI_TRANSCRIBE_COMPARE_SET, this.compareEnabled ? [...this.compareDraft] : []);
        });
        for (const id of TRANSCRIBE_BACKENDS) {
            const item = choice('checkbox', ENGINE_LABELS[id], this.compareDraft.includes(id));
            item.input.addEventListener('change', () => {
                this.compareDraft = TRANSCRIBE_BACKENDS.filter(engine => engine === id ? item.input.checked : this.compareDraft.includes(engine));
                this.savePreference(AKARI_TRANSCRIBE_COMPARE_SET, [...this.compareDraft]);
            });
            engines.append(item.label);
        }
        const cuts = choice('checkbox', 'フィラー・言い直し・無音のカット候補を自動で作る', this.preferences.get<boolean>(AKARI_TRANSCRIBE_AUTO_CUTS, true));
        cuts.input.addEventListener('change', () => this.savePreference(AKARI_TRANSCRIBE_AUTO_CUTS, cuts.input.checked));
        this.transcribe.append(compare.label, description('比較は選択式（毎回ではない）。比べるエンジンにチェックを付けます。'), engines, cuts.label, description('作るだけ。タイムラインには入れない'));
    }

    protected savePreference(key: string, value: unknown): void {
        this.preferenceWrites = this.preferenceWrites.then(() => this.preferences.set(key, value, PreferenceScope.User)).catch(() => {
            this.notice.textContent = '設定を保存できませんでした。';
            this.renderTranscribe();
        });
    }

    protected async loadConnections(): Promise<void> {
        try {
            const list = await this.service.listConnections();
            if (this.isDisposed) { return; }
            this.providerList.replaceChildren(...list.providers.map(row => this.providerRow(row)));
            const store = element('article');
            styleCard(store);
            const status = element('span', list.store.connected ? '接続済み' : '未接続');
            status.setAttribute('role', 'status');
            store.append(element('strong', 'AKARI Store'), description('素材・パックの購入と取得（デバイス接続）'), status, action('確認', () => {
                this.close();
                void this.openStore().catch(() => undefined);
            }));
            this.providerList.append(store);
            this.renderStorage(list.credentials);
            if (list.store.connected) {
                try {
                    const view = await this.storeService.getAssetCatalogView(undefined);
                    if (storeReconnectRequired(true, view.entitlementsStatus)) { status.textContent = STORE_RECONNECT_REQUIRED_MESSAGE; }
                } catch { /* Keep the same saved-credential status as home. */ }
            }
        } catch {
            this.providerList.replaceChildren(description('接続一覧を読み込めませんでした。'), action('再読み込み', () => void this.loadConnections()));
        }
    }

    protected renderStorage(credentials: ConnectionsList['credentials']): void {
        const current = choice('radio', `いまのファイル（${credentials.path}）`, true);
        current.input.name = 'akari-credential-storage';
        const encrypted = choice('radio', '暗号化して保存（この Mac のログイン鍵で） · 次', false);
        encrypted.input.name = 'akari-credential-storage'; encrypted.input.disabled = true;
        this.storage.replaceChildren(element('h3', '鍵の保存先'), current.label,
            description(!credentials.exists ? '登録すると作成します。平文・自分だけ読める権限（600）。CLI やスキルもこのファイルを読みます。'
                : credentials.secure_permissions ? '平文・自分だけ読める権限（600）。CLI やスキルもこのファイルを読みます。'
                    : '現在のファイル権限は 600 ではありません。次の登録・削除時に修正します。'), encrypted.label);
    }

    protected providerRow(row: ConnectionRow): HTMLElement {
        const card = element('article');
        card.setAttribute('data-akari-provider', row.id);
        styleCard(card);
        const heading = element('div');
        heading.append(element('strong', row.label));
        if (row.id === 'fal') {
            heading.append(pill('おすすめ'));
            card.style.borderColor = 'var(--theia-focusBorder)';
        }
        card.append(heading);
        if (row.id === 'fal') { card.append(description('1 つの鍵で 画像生成・動画生成・文字起こし')); }
        card.append(description(row.description));
        const controls = element('div');
        Object.assign(controls.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', margin: '10px 0' });
        const status = pill(doctorLabel(row.doctor));
        status.setAttribute('role', 'status');
        status.setAttribute('data-connection-status', row.doctor.status);
        const run = async (operation: () => Promise<void>): Promise<void> => {
            for (const control of Array.from(controls.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button'))) { control.disabled = true; }
            status.textContent = '確認中…';
            try {
                await operation();
                renderControls();
                const list = await this.service.listConnections();
                if (!this.isDisposed) { this.renderStorage(list.credentials); }
            } catch { status.textContent = '操作できませんでした。入力と保存先を確認してください。'; }
            finally {
                for (const control of Array.from(controls.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button'))) { control.disabled = false; }
            }
        };
        const renderControls = (): void => {
            controls.replaceChildren();
            status.textContent = doctorLabel(row.doctor);
            status.setAttribute('data-connection-status', row.doctor.status);
            if (row.configured) {
                controls.append(element('code', `sk_••••${row.masked_tail ?? ''}`), action('確認', () => void run(async () => {
                    row.doctor = (await this.service.checkConnection(row.id)).doctor;
                })), action('削除', () => void run(async () => {
                    await this.service.deleteCredential(row.id);
                    row.configured = false; row.masked_tail = null;
                    row.doctor = { status: 'unconfigured', detail: '未登録', last_checked: null };
                })));
            } else {
                const input = element('input');
                input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false;
                input.className = 'theia-input';
                input.placeholder = `${row.label} の鍵を貼る`;
                input.setAttribute('aria-label', `${row.label} の API キー`);
                Object.assign(input.style, { flex: '1 1 180px', minWidth: '0' });
                const save = action('登録して確認', () => void run(async () => {
                    // Send once, then immediately clear the DOM, including on failed requests.
                    let request: ReturnType<AkariConnectionsService['setCredential']>;
                    try { request = this.service.setCredential(row.id, input.value); }
                    finally { input.value = ''; }
                    const result = await request;
                    row.configured = result.ok; row.masked_tail = result.masked_tail; row.doctor = result.doctor;
                }));
                controls.append(input, save);
            }
        };
        renderControls();
        card.append(controls, status);
        if (row.setup_url?.startsWith('https://')) {
            const link = element('a', '取得先 ↗');
            link.href = row.setup_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
            Object.assign(link.style, { marginLeft: '12px', color: 'var(--theia-textLink-foreground)' });
            card.append(link);
        }
        return card;
    }
}

@injectable()
export class AkariSettingsCommandContribution implements CommandContribution {
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(AkariConnectionsService) protected readonly connections!: AkariConnectionsService;
    @inject(AkariProjectService) protected readonly store!: AkariProjectService;
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    protected opened: Promise<unknown> | undefined;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand({ id: 'akari.settings.open', label: 'AKARI Video の設定' }, {
            execute: () => {
                if (!this.opened) {
                    this.opened = this.openSettings().finally(() => { this.opened = undefined; });
                }
                return this.opened;
            }
        });
    }

    protected async openSettings(): Promise<void> {
        await this.preferences.ready;
        const dialog = new AkariSettingsDialog(this.preferences, this.connections, this.store, async () => {
            const widget = await this.widgets.getOrCreateWidget('akari-settings-widget');
            if (!widget.isAttached) { await this.shell.addWidget(widget, { area: 'left', rank: 400 }); }
            await this.shell.activateWidget(widget.id);
        });
        try { await dialog.open(); } finally { dialog.dispose(); }
    }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (text !== undefined) { node.textContent = text; }
    return node;
}
function action(label: string, click: () => void): HTMLButtonElement {
    const button = element('button', label);
    button.type = 'button'; button.className = 'theia-button secondary';
    button.addEventListener('click', click);
    return button;
}
function description(text: string): HTMLElement {
    const node = element('p', text);
    Object.assign(node.style, { color: 'var(--theia-descriptionForeground)', fontSize: '12px', lineHeight: '1.65', margin: '6px 0', overflowWrap: 'anywhere' });
    return node;
}
function choice(type: 'radio' | 'checkbox', text: string, checked: boolean): { label: HTMLLabelElement; input: HTMLInputElement } {
    const label = element('label'); const input = element('input');
    input.type = type; input.checked = checked;
    Object.assign(label.style, { display: 'flex', alignItems: 'baseline', gap: '8px', margin: '10px 0', lineHeight: '1.6', overflowWrap: 'anywhere' });
    label.append(input, element('span', text));
    return { label, input };
}
function styleCard(card: HTMLElement): void {
    Object.assign(card.style, { padding: '14px', border: AKARI_BORDER.hairline, borderRadius: '8px', margin: '10px 0', background: AKARI_SURFACE.card, minWidth: '0' });
}
function pill(text: string): HTMLElement {
    const node = element('span', text);
    Object.assign(node.style, { display: 'inline-block', fontSize: '11px', padding: '3px 8px', borderRadius: '999px', background: AKARI_SURFACE.elevated, marginLeft: '6px', overflowWrap: 'anywhere' });
    return node;
}
function doctorLabel(doctor: ConnectionDoctor): string {
    if (doctor.status === 'unconfigured') { return '未登録'; }
    if (doctor.status === 'ok') { return `繋がった · ${doctor.last_checked ? new Date(doctor.last_checked).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''}`; }
    if (!doctor.last_checked) { return '登録済み · 未確認'; }
    return `繋がらない（${doctor.detail}）`;
}
