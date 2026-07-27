import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { PreferenceService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { VSXExtensionsModel } from '@theia/vsx-registry/lib/browser/vsx-extensions-model';
import { PluginViewRegistry } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-registry';
import { AkariPartnerServer } from '../common/akari-partner-protocol';
import {
    PARTNER_CATALOG,
    PARTNER_CLI_ICON_CLASSES,
    PartnerCatalogEntry,
    PartnerCliCatalogEntry,
    PartnerExtensionCatalogEntry,
    PlatformBinaryVerification
} from './partner-catalog';
import { PartnerSessionService, PartnerTerminal } from './partner-session-service';
import { PartnerChannel, TerminalPartnerChannel } from './partner-channel';

// ホーム v2（task.md 2026-07-21-home-flow）の接続ゲートが読む SSOT と同じ
// フィールド。「接続済み」の唯一の判定源は connections.json の
// akari-cloud provider の doctor.status（skills/manage-connections/bin/doctor.mjs
// が書く語彙をそのまま使う）— ここでは新しい判定基準を作らず、CLI 接続が
// 実際に成立した瞬間にその同じフィールドを ok へ倒すだけ。
const CONNECTIONS_RELATIVE_PATH = '.akari/connections.json';
const CLOUD_PROVIDER_ID = 'akari-cloud';

type FlowState = 'idle' | 'working' | 'complete' | 'failed';

interface EntryFlow {
    state: FlowState;
    status: string;
    detail: string;
    warning: string;
}

interface ChatMessage {
    role: 'me' | 'ai';
    text: string;
}

// akari-shell-strip/src/browser/akari-developer-mode-service.ts と同じキー。
// スキーマは akari-project/akari-surfaces が所有し登録は済んでいるため、
// ここでは（同ファイルの流儀に倣い）読むだけで拡張間の依存を増やさない。
const DEVELOPER_MODE_PREFERENCE = 'akari.developerMode';

// 最大保持メッセージ数（無制限成長を避けるための素朴なキャップ、v0）。
const MAX_MESSAGES = 200;

// 4 分割前に永続化された PTY タブだけを新しい一意ラベルへ移行する。
// kind も同時に照合するため、同名の一般ターミナルや拡張ビューには触れない。
const LEGACY_CLI_LABELS: Record<PartnerCliCatalogEntry['agent'], string[]> = {
    claude: ['Claude Code'],
    codex: ['Codex']
};

@injectable()
export class AkariPartnerWidget extends ReactWidget {

    static readonly ID = 'akari-partner-onboarding';

    @inject(VSXExtensionsModel)
    protected readonly extensionsModel!: VSXExtensionsModel;

    @inject(PluginViewRegistry)
    protected readonly pluginViewRegistry!: PluginViewRegistry;

    @inject(AkariPartnerServer)
    protected readonly partnerServer!: AkariPartnerServer;

    @inject(TerminalService)
    protected readonly terminalService!: TerminalService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(PartnerSessionService)
    protected readonly sessionService!: PartnerSessionService;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    @inject(FileService)
    protected readonly fileService!: FileService;

    protected flowState: FlowState = 'idle';
    protected selected?: PartnerCatalogEntry;
    protected status = '';
    protected detail = '';
    protected warning = '';
    protected readonly entryFlows = new Map<string, EntryFlow>();
    protected readonly liveTerminals = new Map<string, TerminalWidget>();
    protected readonly observedTerminals = new WeakSet<TerminalWidget>();

    // チャットガワ v0（task.md 2026-07-21-partner-pane 指示2/5）状態。
    // task/2026-07-25-partner-raw-terminal-default: 既定経路からは外れたが
    // renderChat() 自体は温存するため状態は残す（削除禁止）。
    protected terminal?: TerminalWidget;
    protected channel?: PartnerChannel;
    protected messages: ChatMessage[] = [];
    protected composerValue = '';
    protected devMode = false;
    protected executablePath = '';

    @postConstruct()
    protected init(): void {
        this.id = AkariPartnerWidget.ID;
        this.title.label = 'パートナーを追加';
        this.title.caption = 'パートナーを追加';
        this.title.iconClass = 'codicon codicon-add';
        this.title.closable = false;

        this.devMode = this.preferences.get<boolean>(DEVELOPER_MODE_PREFERENCE, false);
        // akari-developer-mode-service.ts と同じ流儀: change イベントの値を
        // 直接使わず、preferenceName の一致だけ見て都度 get() で読み直す。
        this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName === DEVELOPER_MODE_PREFERENCE) {
                this.refreshDeveloperMode();
            }
        });
        void this.preferences.ready.then(() => this.refreshDeveloperMode());
        this.extensionsModel.onDidChange(() => this.update());
        this.terminalService.onDidCreateTerminal(terminal => {
            if (terminal.kind === PartnerTerminal.KIND) {
                this.observeTerminalLifecycle(terminal);
            }
        });

        this.update();
    }

    /**
     * ホーム v2 の接続ゲート CTA（akari-partner-command-contribution.ts の
     * `akari.partner.beginOnboarding` コマンド経由）から呼ばれる薄いラッパー。
     * 既に接続中/接続済みなら新しいオンボーディングは始めず、ペインを
     * 表に出すだけに留める（begin() の二重起動を避ける）。
     */
    async beginRecommended(): Promise<void> {
        const entry = PARTNER_CATALOG.find(candidate => candidate.recommended) ?? PARTNER_CATALOG[0];
        if (entry) {
            await this.begin(entry);
        }
    }

    /**
     * ホーム v2 の進め方フォーム送信（`akari.partner.send` コマンド経由）から
     * 呼ばれる。T4 のガワと全く同じ経路（`pushMessage` + `PartnerChannel#send`）
     * を再利用する — 新しい注入経路は作らない。channel が無い（未接続）場合は
     * 何もせず false を返す。
     */
    sendFromExternal(text: string): boolean {
        const trimmed = text.trim();
        if (!trimmed || !this.channel) {
            return false;
        }
        this.pushMessage('me', trimmed);
        this.channel.send(trimmed);
        return true;
    }

    async begin(entry: PartnerCatalogEntry): Promise<void> {
        if (this.entryFlow(entry).state === 'working') {
            return;
        }
        this.entryFlows.delete(entry.id);

        if (entry.form === 'cli') {
            const existing = await this.findExistingCliTerminal(entry);
            if (existing) {
                this.selected = entry;
                await this.attachTerminal(existing, entry);
                return;
            }
            await this.beginCli(entry);
            return;
        }
        if (this.extensionsModel.isInstalled(entry.extensionId)) {
            await this.openExtension(entry);
            return;
        }
        await this.beginExtension(entry);
    }

    protected async beginCli(entry: PartnerCliCatalogEntry): Promise<void> {
        this.shell.activateWidget(this.id);
        this.selected = entry;
        this.setProgress(entry, 'CLI を確認しています…', entry.id);
        try {
            const roots = await this.workspaceService.roots;
            const cwd = roots[0]?.resource.toString();

            this.setProgress(entry, 'CLI を確認しています…', '同梱ランタイムで実行中');
            const bootstrap = await this.partnerServer.bootstrap(entry.agent, cwd);
            this.executablePath = bootstrap.executablePath;
            this.setProgress(entry,
                bootstrap.reused ? 'インストール済みの CLI を検出しました' : 'CLI をダウンロード・インストールしました',
                bootstrap.executablePath
            );
            if (entry.agent === 'claude') {
                // task/2026-07-25-partner-plugin-autowire: the plugin-wiring
                // step's outcome is always the last bootstrap.log line for the
                // claude agent (wirePluginSkills runs last in bootstrap-runner.ts's
                // claude branch, right before it emits the result JSON).
                const wiringLog = bootstrap.log[bootstrap.log.length - 1];
                if (wiringLog) {
                    this.setProgress(entry, 'スキル配線を確認しています…', wiringLog);
                }
            }
            const launch = await this.partnerServer.prepareLaunch(entry.agent);
            this.setProgress(entry, 'パートナー PTY を起動しています…', `${bootstrap.runtimeMode}: ${bootstrap.runtimePath}`);
            const terminal = await this.terminalService.newTerminal({
                title: entry.name,
                iconClass: PARTNER_CLI_ICON_CLASSES[entry.agent],
                shellPath: bootstrap.executablePath,
                // This is a CLI process, not a shell. Avoid Theia's platform shell args (for example, macOS `-l`).
                shellArgs: launch.args,
                cwd,
                kind: PartnerTerminal.KIND,
                attributes: {
                    'akari.partner': entry.agent,
                    'akari.executable': bootstrap.executablePath
                },
                destroyTermOnClose: false,
                useServerTitle: false
            });
            await terminal.start();
            await this.shell.addWidget(terminal, { area: 'right', rank: 50 });
            await this.attachTerminal(terminal, entry);
        } catch (error) {
            this.setFailure(entry, `${entry.name} のセットアップに失敗しました`, this.errorMessage(error));
            console.error('[akari-partner] onboarding failed:', error);
        }
    }

    protected async beginExtension(entry: PartnerExtensionCatalogEntry): Promise<void> {
        this.shell.activateWidget(this.id);
        this.selected = entry;
        this.setProgress(entry, '拡張情報を確認しています…', entry.extensionId);

        try {
            const extension = await this.extensionsModel.resolve(entry.extensionId);
            if (!extension.installed) {
                this.setProgress(entry, '拡張をダウンロード・インストールしています…', entry.extensionId);
                await extension.install();
            }

            const platformKey = await this.partnerServer.getPlatformKey();
            const verification = entry.binaryVerification[platformKey];
            if (verification?.required) {
                this.setProgress(entry, 'プラットフォーム用バイナリを検証しています…', platformKey);
                await this.verifyPlatformBinary(entry, verification);
            }
            await this.openExtension(entry);
        } catch (error) {
            this.setFailure(entry, `${entry.name} のセットアップに失敗しました`, this.errorMessage(error));
            console.error('[akari-partner] extension onboarding failed:', error);
        }
    }

    protected async openExtension(entry: PartnerExtensionCatalogEntry): Promise<void> {
        this.selected = entry;
        this.setProgress(entry, `${entry.name} を開いています…`, entry.extensionId);
        try {
            for (let attempt = 0; attempt < 20; attempt++) {
                for (const containerId of entry.viewContainerIds) {
                    const widget = await this.pluginViewRegistry.openViewContainer(containerId);
                    if (widget) {
                        this.setComplete(entry, `${entry.name} を開きました`, containerId);
                        this.shell.activateWidget(widget.id);
                        return;
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            throw new Error(`利用可能なビューコンテナが見つかりません: ${entry.viewContainerIds.join(', ')}`);
        } catch (error) {
            this.setFailure(entry, `${entry.name} を開けませんでした`, this.errorMessage(error));
            console.error('[akari-partner] extension view open failed:', error);
        }
    }

    protected async verifyPlatformBinary(entry: PartnerExtensionCatalogEntry, verification: PlatformBinaryVerification): Promise<void> {
        let packagePath: string | undefined;
        for (let attempt = 0; attempt < 20 && !packagePath; attempt++) {
            const refreshed = await this.extensionsModel.resolve(entry.extensionId);
            packagePath = refreshed.plugin?.metadata.model.packagePath;
            if (!packagePath) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
        if (!packagePath) {
            this.setWarning(entry, '拡張バイナリの配置先を取得できませんでした。拡張ビューの起動を続行します。');
            this.update();
            return;
        }
        const result = await this.partnerServer.verifyExtensionBinary({
            packagePath,
            executableNames: verification.executableNames,
            platformTokens: verification.platformTokens
        });
        if (!result.found) {
            this.setWarning(entry, `拡張のプラットフォーム用バイナリ検証: ${result.reason || '見つかりませんでした'}。拡張ビューの起動を続行します。`);
        }
    }

    protected entryFlow(entry: PartnerCatalogEntry): EntryFlow {
        return this.entryFlows.get(entry.id) ?? {
            state: 'idle',
            status: '',
            detail: '',
            warning: ''
        };
    }

    protected setProgress(entry: PartnerCatalogEntry, status: string, detail: string): void {
        this.setEntryFlow(entry, {
            state: 'working',
            status,
            detail,
            warning: this.entryFlow(entry).warning
        });
    }

    protected setComplete(entry: PartnerCatalogEntry, status: string, detail: string): void {
        this.setEntryFlow(entry, {
            state: 'complete',
            status,
            detail,
            warning: this.entryFlow(entry).warning
        });
    }

    protected setFailure(entry: PartnerCatalogEntry, status: string, detail: string): void {
        this.setEntryFlow(entry, {
            state: 'failed',
            status,
            detail,
            warning: this.entryFlow(entry).warning
        });
    }

    protected setWarning(entry: PartnerCatalogEntry, warning: string): void {
        this.setEntryFlow(entry, {
            ...this.entryFlow(entry),
            warning
        });
    }

    protected setEntryFlow(entry: PartnerCatalogEntry, flow: EntryFlow): void {
        this.entryFlows.set(entry.id, flow);
        this.selected = entry;
        this.flowState = flow.state;
        this.status = flow.status;
        this.detail = flow.detail;
        this.warning = flow.warning;
        this.update();
    }

    /**
     * レイアウト復元後に既存パートナー PTY を再照合する。Theia は保存した
     * terminalId へ非同期で attach するため processId の解決を待ち、生きた
     * ものだけをエントリ状態へ同期する。attach できなかった復元 widget と
     * 同一エントリの重複 widget は破棄する。
     */
    async restorePartnerTerminals(): Promise<void> {
        const restored: Array<{ entry: PartnerCliCatalogEntry; terminal: TerminalWidget }> = [];
        for (const entry of PARTNER_CATALOG) {
            if (entry.form !== 'cli') {
                continue;
            }
            const terminal = await this.findExistingCliTerminal(entry, true);
            if (terminal) {
                restored.push({ entry, terminal });
            }
        }
        const active = restored.find(candidate => candidate.entry.recommended) ?? restored[0];
        if (active) {
            this.syncTerminalState(active.terminal, active.entry, true);
        }
        this.update();
    }

    protected async findExistingCliTerminal(
        entry: PartnerCliCatalogEntry,
        waitForRestore = false
    ): Promise<TerminalWidget | undefined> {
        const labels = new Set([entry.name, ...LEGACY_CLI_LABELS[entry.agent]]);
        const candidates = this.terminalService.all.filter(terminal =>
            terminal.kind === PartnerTerminal.KIND && labels.has(terminal.title.label)
        );
        const alive: TerminalWidget[] = [];
        for (const terminal of candidates) {
            if (await this.isTerminalAlive(terminal, waitForRestore)) {
                if (terminal.title.label !== entry.name) {
                    terminal.title.label = entry.name;
                    terminal.title.caption = entry.name;
                }
                alive.push(terminal);
            } else if (!terminal.isDisposed) {
                terminal.dispose();
            }
        }
        const preferred = this.liveTerminals.get(entry.id);
        const terminal = preferred && alive.includes(preferred) ? preferred : alive[0];
        for (const duplicate of alive) {
            if (duplicate !== terminal && !duplicate.isDisposed) {
                duplicate.dispose();
            }
        }
        if (terminal) {
            this.liveTerminals.set(entry.id, terminal);
            this.observeTerminalLifecycle(terminal, entry);
        } else {
            this.liveTerminals.delete(entry.id);
        }
        return terminal;
    }

    protected async isTerminalAlive(terminal: TerminalWidget, waitForRestore: boolean): Promise<boolean> {
        const attempts = waitForRestore ? 40 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (terminal.isDisposed || terminal.exitStatus) {
                return false;
            }
            if (terminal.terminalId >= 0) {
                try {
                    const processId = await terminal.processId;
                    return Number.isInteger(processId) && processId > 0;
                } catch {
                    // Restore may still be attaching. Retry only in the restore hook.
                }
            }
            if (attempt + 1 < attempts) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        return false;
    }

    protected observeTerminalLifecycle(terminal: TerminalWidget, entry?: PartnerCliCatalogEntry): void {
        if (this.observedTerminals.has(terminal)) {
            return;
        }
        const resolvedEntry = entry ?? PARTNER_CATALOG.find(candidate =>
            candidate.form === 'cli' &&
            terminal.kind === PartnerTerminal.KIND &&
            [candidate.name, ...LEGACY_CLI_LABELS[candidate.agent]].includes(terminal.title.label)
        ) as PartnerCliCatalogEntry | undefined;
        if (!resolvedEntry) {
            return;
        }
        this.observedTerminals.add(terminal);
        const clear = () => {
            if (this.liveTerminals.get(resolvedEntry.id) === terminal) {
                this.liveTerminals.delete(resolvedEntry.id);
            }
            if (this.terminal === terminal) {
                this.channel?.dispose();
                this.channel = undefined;
                this.terminal = undefined;
            }
            this.update();
        };
        this.toDispose.push(terminal.onTerminalDidClose(clear));
        this.toDispose.push(terminal.onDidOpenFailure(clear));
    }

    protected syncTerminalState(terminal: TerminalWidget, entry: PartnerCliCatalogEntry, restored: boolean): void {
        this.sessionService.useTerminal(terminal);
        this.liveTerminals.set(entry.id, terminal);
        this.observeTerminalLifecycle(terminal, entry);

        if (this.channel) {
            this.channel.dispose();
        }
        this.selected = entry;
        this.terminal = terminal;
        this.channel = new TerminalPartnerChannel(terminal);
        this.toDispose.push(this.channel);
        this.setComplete(
            entry,
            restored ? `${entry.name} を復元しました` : `${entry.name} を開始しました`,
            restored
                ? '既存の PTY セッションへ再接続しました。'
                : 'PTY の案内に沿ってログインしてください。ログイン後、そのまま作業を開始できます。'
        );
    }
    /**
     * PTY 起動済みの terminal をパートナー接続へ組み込む（task.md 2026-07-21
     * 指示2、表示先は task/2026-07-25-partner-raw-terminal-default で生ターミナル
     * 既定に変更）。`begin()` の成功パスから呼ぶ本体だが、独立したメソッドに
     * 切り出すことで、PartnerChannel 配線・flowState 遷移・表示反映だけを、
     * ネットワークを伴う拡張インストール/CLI ブートストラップを経由せずに
     * 検証できる（このメソッド自体はテスト専用コードではなく、begin() が
     * 使う実装をそのまま指している）。
     */
    protected async attachTerminal(terminal: TerminalWidget, entry: PartnerCliCatalogEntry): Promise<void> {
        this.syncTerminalState(terminal, entry, false);
        // task/2026-07-25-partner-raw-terminal-default: チャットガワ封印に伴い
        // onReply→吹き出し表示への配線はしない（channel.send は維持）。

        // xterm.js 側の初期化（term.open()）は、この widget が一度でも可視状態
        // （isVisible && isAttached）で onUpdateRequest を通らないと走らない
        // （Theia 1.73.1 terminal-widget-impl.js を実測: onOutput の配信元である
        // term.onWriteParsed の購読は open() の中で一度だけ登録される）。
        // 単一ドキュメントモードの dock パネルでは「追加されただけ」ではまだ
        // 可視ではない（別タブがアクティブなため）。そのため必ず一度アクティブ
        // 化して xterm を開かせる。
        await this.ensureTerminalOpened(terminal);
        // task/2026-07-25-partner-raw-terminal-default: 生ターミナルを既定表示
        // にするため、接続後は常時表示・アクティブ化する。
        this.applyDeveloperModeVisibility();

        // ホーム v2（task.md 2026-07-21-home-flow）の接続ゲートは
        // connections.json の akari-cloud provider の doctor.status を唯一の
        // 判定源として読む。実際に PTY 接続が成立したこの瞬間に、その同じ
        // フィールドを ok へ更新する（新しい判定基準を作らず、既存 SSOT を
        // 実態に追従させるだけ）。
        await this.markCloudConnectionOk();
    }

    /**
     * connections.json の akari-cloud provider の doctor を ok に倒す。
     * provider エントリが存在しない（プロジェクトが古い/手動生成された）場合や
     * ファイルが読めない場合は何もしない（ホーム v2 のゲートは未接続のまま
     * 留まるだけで、他の機能に影響しない安全側のフォールバック）。
     */
    protected async markCloudConnectionOk(): Promise<void> {
        try {
            const roots = await this.workspaceService.roots;
            const root = roots[0]?.resource;
            if (!root) {
                return;
            }
            const uri = root.resolve(CONNECTIONS_RELATIVE_PATH);
            const content = await this.fileService.readFile(uri);
            const registry = JSON.parse(content.value.toString());
            const providers = Array.isArray(registry?.providers) ? registry.providers : undefined;
            const provider = providers?.find((candidate: { id?: unknown }) => candidate?.id === CLOUD_PROVIDER_ID);
            if (!provider) {
                return;
            }
            provider.doctor = {
                last_checked: new Date().toISOString(),
                status: 'ok',
                detail: 'AI パートナーの接続を確認しました（ローカル CLI 接続の成立で判定、v0）。'
            };
            await this.fileService.writeFile(uri, BinaryBuffer.fromString(`${JSON.stringify(registry, null, 2)}\n`));
        } catch (error) {
            console.warn('[akari-partner] connections.json update skipped:', error);
        }
    }

    protected async ensureTerminalOpened(terminal: TerminalWidget): Promise<void> {
        this.shell.activateWidget(terminal.id);
        for (let attempt = 0; attempt < 40 && !terminal.isDisposed; attempt++) {
            if (terminal.node.querySelector('.xterm')) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    /**
     * task/2026-07-25-partner-raw-terminal-default: パートナー表示は devMode
     * に依存しなくなった（生ターミナルが常時表示の既定）。購読自体は残すが
     * ここでは状態更新のみ行い、表示の出し入れは行わない。
     */
    protected refreshDeveloperMode(): void {
        const next = this.preferences.get<boolean>(DEVELOPER_MODE_PREFERENCE, false);
        if (next === this.devMode) {
            return;
        }
        this.devMode = next;
        this.update();
    }

    /**
     * task/2026-07-25-partner-raw-terminal-default: 接続後のターミナルは
     * devMode に関わらず right パネルへ常時表示・アクティブ化する
     * （旧実装の devMode off → parent=null 退避分岐は廃止）。
     */
    protected applyDeveloperModeVisibility(): void {
        const terminal = this.terminal;
        if (!terminal || terminal.isDisposed) {
            return;
        }
        const rightWidgets = Array.from(this.shell.rightPanelHandler.dockPanel.widgets());
        if (!rightWidgets.includes(terminal)) {
            void this.shell.addWidget(terminal, { area: 'right', rank: 50 }).then(() => this.shell.activateWidget(terminal.id));
        } else {
            this.shell.activateWidget(terminal.id);
        }
        this.update();
    }

    protected pushMessage(role: ChatMessage['role'], text: string): void {
        this.messages = [...this.messages, { role, text }].slice(-MAX_MESSAGES);
        this.update();
    }

    protected submitComposer(): void {
        const text = this.composerValue.trim();
        if (!text || !this.channel) {
            return;
        }
        this.pushMessage('me', text);
        this.composerValue = '';
        this.channel.send(text);
        this.update();
    }

    protected render(): React.ReactNode {
        return this.renderOnboarding();
    }

    protected entryIsOpen(entry: PartnerCatalogEntry): boolean {
        if (entry.form === 'extension') {
            return this.extensionsModel.isInstalled(entry.extensionId);
        }
        const terminal = this.liveTerminals.get(entry.id);
        return !!terminal && !terminal.isDisposed && !terminal.exitStatus && terminal.terminalId >= 0;
    }

    protected entryActionLabel(entry: PartnerCatalogEntry): string {
        if (this.entryIsOpen(entry)) {
            return '開く';
        }
        return entry.form === 'extension' ? 'インストールして始める' : '始める';
    }

    /**
     * task/2026-07-25-partner-raw-terminal-default: 接続後の既定表示。
     * 生ターミナルが right パネルに常時表示されているため、この widget 側は
     * 簡素なステータス（接続済み・使用 CLI パス・ターミナルを表示するボタン）
     * のみを見せる。
     */
    protected renderConnected(): React.ReactNode {
        return (
            <div style={styles.container}>
                <div style={styles.heroIcon}>✦</div>
                <h2 style={styles.heading}>パートナー接続済み</h2>
                <div style={styles.statusCard} role='status' aria-live='polite' data-akari-flow-state={this.flowState}>
                    <div style={styles.statusRow}>
                        <span className='codicon codicon-pass-filled' style={{ color: 'var(--theia-successBackground)' }} />
                        <strong>{this.selected?.name ?? ''} 接続済み</strong>
                    </div>
                    <div style={styles.detail}>{this.executablePath}</div>
                </div>
                <button
                    className='theia-button main'
                    style={styles.primaryButton}
                    onClick={() => this.terminal && this.shell.activateWidget(this.terminal.id)}
                >ターミナルを表示</button>
            </div>
        );
    }

    /**
     * チャットガワ v0（task.md 2026-07-21-partner-pane 指示2）。吹き出しログ +
     * 入力欄。task/2026-07-25-partner-raw-terminal-default でチャットガワは
     * 既定経路から外れたため render() からは呼ばれなくなったが、削除禁止
     * （将来 (c) 方式で作り直す前提の温存 — 正本 §4-3）。
     */
    protected renderChat(): React.ReactNode {
        return (
            <div style={chatStyles.container}>
                <div style={chatStyles.header}>
                    <span style={{ ...chatStyles.dot, background: 'var(--theia-successBackground)' }} />
                    <strong>パートナー</strong>
                    <span style={chatStyles.headerMeta}>
                        {this.selected?.name ?? ''} 接続済み{this.devMode ? ' · 開発者モード（生ターミナルを表示中）' : ''}
                    </span>
                </div>
                <div style={chatStyles.log} ref={el => { if (el) { el.scrollTop = el.scrollHeight; } }}>
                    {this.messages.map((message, index) => (
                        <div key={index} style={message.role === 'me' ? chatStyles.bubbleMe : chatStyles.bubbleAi}>
                            {message.text}
                        </div>
                    ))}
                </div>
                <div style={chatStyles.composer}>
                    <input
                        type='text'
                        value={this.composerValue}
                        placeholder='パートナーに話しかける…'
                        aria-label='パートナーに話しかける'
                        style={chatStyles.input}
                        onChange={event => { this.composerValue = event.target.value; this.update(); }}
                        onKeyDown={event => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                this.submitComposer();
                            }
                        }}
                    />
                    <button
                        className='theia-button main'
                        style={chatStyles.send}
                        aria-label='送信'
                        onClick={() => this.submitComposer()}
                    >送信</button>
                </div>
            </div>
        );
    }

    protected renderOnboarding(): React.ReactNode {
        const selectedFlow = this.selected ? this.entryFlow(this.selected) : undefined;
        return (
            <div style={styles.container}>
                <div style={styles.heroIcon}><span className='codicon codicon-add' /></div>
                <h2 style={styles.heading}>パートナーを追加</h2>
                <p style={styles.lead}>CLI または公式拡張を選んで、右パネルに追加します。</p>

                <div style={styles.buttonStack}>
                    {PARTNER_CATALOG.map(entry => {
                        const flow = this.entryFlow(entry);
                        return <button
                            key={entry.id}
                            className={entry.recommended ? 'theia-button main' : 'theia-button secondary'}
                            style={entry.recommended ? styles.primaryButton : styles.secondaryButton}
                            data-partner-entry={entry.id}
                            data-partner-form={entry.form}
                            data-partner-action={this.entryActionLabel(entry)}
                            disabled={flow.state === 'working'}
                            onClick={() => this.begin(entry)}
                        >
                            <span style={styles.buttonLabel}>
                                {entry.name}
                                {entry.recommended && <span style={styles.recommendedBadge}>推奨</span>}
                            </span>
                            <span style={styles.buttonAction}>
                                {flow.state === 'working' ? '処理中…' : this.entryActionLabel(entry)}
                            </span>
                        </button>;
                    })}
                </div>

                {selectedFlow && selectedFlow.state !== 'idle' && <div
                    style={styles.statusCard}
                    role='status'
                    aria-live='polite'
                    data-akari-flow-state={selectedFlow.state}
                    data-partner-entry={this.selected?.id}
                >
                    <div style={styles.statusRow}>
                        {selectedFlow.state === 'working' && <span className='codicon codicon-loading codicon-modifier-spin' />}
                        {selectedFlow.state === 'complete' && <span className='codicon codicon-pass-filled' style={{ color: 'var(--theia-successBackground)' }} />}
                        {selectedFlow.state === 'failed' && <span className='codicon codicon-error' style={{ color: 'var(--theia-errorForeground)' }} />}
                        <strong>{selectedFlow.status}</strong>
                    </div>
                    <div style={styles.detail}>{selectedFlow.detail}</div>
                    {selectedFlow.warning && <div style={styles.warning}>{selectedFlow.warning}</div>}
                    {selectedFlow.state === 'failed' && <button
                        className='theia-button secondary'
                        style={styles.retryButton}
                        onClick={() => this.selected && this.begin(this.selected)}
                    >再試行</button>}
                </div>}

                <p style={styles.note}>インストール中も進捗を表示します。失敗した場合は原因をこの画面に表示します。</p>
            </div>
        );
    }
}

const styles: Record<string, React.CSSProperties> = {
    container: { padding: '28px 22px', maxWidth: 420, margin: '0 auto', textAlign: 'center' },
    heroIcon: { fontSize: 32, color: 'var(--theia-focusBorder)', marginBottom: 8 },
    heading: { margin: '0 0 10px', fontSize: 21 },
    lead: { margin: '0 0 24px', opacity: 0.78, lineHeight: 1.55 },
    buttonStack: { display: 'flex', flexDirection: 'column', gap: 10 },
    primaryButton: { width: '100%', minHeight: 46, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    secondaryButton: { width: '100%', minHeight: 46, background: 'transparent', border: '1px solid var(--theia-input-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    buttonLabel: { display: 'inline-flex', alignItems: 'center', gap: 7, textAlign: 'left' },
    buttonAction: { fontSize: 11, opacity: 0.82, whiteSpace: 'nowrap' },
    recommendedBadge: { padding: '2px 6px', borderRadius: 9, fontSize: 9, background: 'var(--theia-badge-background)', color: 'var(--theia-badge-foreground)' },
    statusCard: { padding: 16, borderRadius: 8, background: 'var(--theia-editorWidget-background)', border: '1px solid var(--theia-widget-border)' },
    statusRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
    detail: { marginTop: 9, opacity: 0.75, fontSize: 12, overflowWrap: 'anywhere' },
    warning: { marginTop: 12, padding: 9, textAlign: 'left', borderRadius: 5, color: 'var(--theia-warningForeground)', background: 'var(--theia-inputValidation-warningBackground)' },
    retryButton: { marginTop: 14 },
    note: { marginTop: 18, fontSize: 11, opacity: 0.55, lineHeight: 1.5 }
};

// チャットガワ（接続済み表示）用スタイル。色は直値ではなく Theia テーマ変数を
// 参照する（task.md 指示6 — テーマ本体は並走 T1 の縄張りなので触らない。
// T1 が --theia-* を LP トークンへ差し替えれば、ここは無変更で追随する）。
const chatStyles: Record<string, React.CSSProperties> = {
    container: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
    header: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        borderBottom: '1px solid var(--theia-widget-border)', flex: '0 0 auto'
    },
    dot: { width: 8, height: 8, borderRadius: '50%', flex: 'none' },
    headerMeta: { marginLeft: 'auto', fontSize: 11, opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    log: {
        flex: '1 1 auto', overflowY: 'auto', padding: 14,
        display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0
    },
    bubbleAi: {
        alignSelf: 'flex-start', maxWidth: '88%', padding: '9px 13px', borderRadius: 14, borderTopLeftRadius: 4,
        background: 'var(--theia-editorWidget-background)', border: '1px solid var(--theia-widget-border)',
        fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'
    },
    bubbleMe: {
        alignSelf: 'flex-end', maxWidth: '88%', padding: '9px 13px', borderRadius: 14, borderTopRightRadius: 4,
        background: 'var(--theia-list-activeSelectionBackground)', color: 'var(--theia-list-activeSelectionForeground)',
        fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'
    },
    composer: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        borderTop: '1px solid var(--theia-widget-border)', flex: '0 0 auto'
    },
    input: {
        flex: '1 1 auto', background: 'var(--theia-input-background)', color: 'var(--theia-input-foreground)',
        border: '1px solid var(--theia-input-border)', borderRadius: 8, padding: '8px 10px', fontSize: 13
    },
    send: { flex: 'none', minWidth: 56 }
};
