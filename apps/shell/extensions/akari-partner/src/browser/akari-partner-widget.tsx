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
import { AkariPartnerServer } from '../common/akari-partner-protocol';
import { PARTNER_CATALOG, PartnerCatalogEntry, PlatformBinaryVerification } from './partner-catalog';
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

@injectable()
export class AkariPartnerWidget extends ReactWidget {

    static readonly ID = 'akari-partner-onboarding';

    @inject(VSXExtensionsModel)
    protected readonly extensionsModel!: VSXExtensionsModel;

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

    // チャットガワ v0（task.md 2026-07-21-partner-pane 指示2/5）状態。
    protected terminal?: TerminalWidget;
    protected channel?: PartnerChannel;
    protected messages: ChatMessage[] = [];
    protected composerValue = '';
    protected devMode = false;

    @postConstruct()
    protected init(): void {
        this.id = AkariPartnerWidget.ID;
        this.title.label = 'パートナー';
        this.title.caption = 'AI パートナー';
        this.title.iconClass = 'codicon codicon-comment-discussion';
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

        this.update();
    }

    /**
     * ホーム v2 の接続ゲート CTA（akari-partner-command-contribution.ts の
     * `akari.partner.beginOnboarding` コマンド経由）から呼ばれる薄いラッパー。
     * 既に接続中/接続済みなら新しいオンボーディングは始めず、ペインを
     * 表に出すだけに留める（begin() の二重起動を避ける）。
     */
    async beginRecommended(): Promise<void> {
        if (this.flowState === 'working' || this.flowState === 'complete') {
            this.shell.activateWidget(this.id);
            return;
        }
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
        if (this.flowState === 'working') {
            return;
        }
        this.shell.activateWidget(this.id);
        this.selected = entry;
        this.flowState = 'working';
        this.warning = '';
        this.setProgress('拡張情報を確認しています…', entry.id);

        try {
            const extension = await this.extensionsModel.resolve(entry.extensionId);
            if (!extension.installed) {
                this.setProgress('拡張をダウンロード・インストールしています…', entry.id);
                await extension.install();
            } else {
                this.setProgress('拡張はインストール済みです', entry.id);
            }

            const platformKey = await this.partnerServer.getPlatformKey();
            const verification = entry.binaryVerification[platformKey];
            if (verification?.required) {
                this.setProgress('プラットフォーム用バイナリを検証しています…', platformKey);
                await this.verifyPlatformBinary(entry.extensionId, verification);
            }

            this.setProgress('CLI をダウンロード・インストールしています…', '同梱ランタイムで実行中');
            const bootstrap = await this.partnerServer.bootstrap(entry.agent);
            const launch = await this.partnerServer.prepareLaunch(entry.agent);
            this.setProgress('パートナー PTY を起動しています…', `${bootstrap.runtimeMode}: ${bootstrap.runtimePath}`);
            const roots = await this.workspaceService.roots;
            const cwd = roots[0]?.resource.toString();
            const terminal = await this.terminalService.newTerminal({
                title: entry.name,
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
            await this.attachTerminal(terminal, entry.name);
        } catch (error) {
            this.flowState = 'failed';
            this.status = `${entry.name} のセットアップに失敗しました`;
            this.detail = this.errorMessage(error);
            console.error('[akari-partner] onboarding failed:', error);
            this.update();
        }
    }

    protected async verifyPlatformBinary(extensionId: string, verification: PlatformBinaryVerification): Promise<void> {
        let packagePath: string | undefined;
        for (let attempt = 0; attempt < 20 && !packagePath; attempt++) {
            const refreshed = await this.extensionsModel.resolve(extensionId);
            packagePath = refreshed.plugin?.metadata.model.packagePath;
            if (!packagePath) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
        if (!packagePath) {
            this.warning = '拡張バイナリの配置先を取得できませんでした。CLI の独立インストールを続行します。';
            this.update();
            return;
        }
        const result = await this.partnerServer.verifyExtensionBinary({
            packagePath,
            executableNames: verification.executableNames,
            platformTokens: verification.platformTokens
        });
        if (!result.found) {
            this.warning = `拡張のプラットフォーム用バイナリ検証: ${result.reason || '見つかりませんでした'}。CLI の独立インストールを続行します。`;
            this.update();
        }
    }

    protected setProgress(status: string, detail: string): void {
        this.status = status;
        this.detail = detail;
        this.update();
    }

    /**
     * PTY 起動済みの terminal をチャットガワへ接続する（task.md 指示2）。
     * `begin()` の成功パスから呼ぶ本体だが、独立したメソッドに切り出すことで
     * ガワ側（PartnerChannel 配線・flowState 遷移・開発者モード反映）だけを、
     * ネットワークを伴う拡張インストール/CLI ブートストラップを経由せずに
     * 検証できる（このメソッド自体はテスト専用コードではなく、begin() が
     * 使う実装をそのまま指している）。
     */
    protected async attachTerminal(terminal: TerminalWidget, label: string): Promise<void> {
        this.sessionService.useTerminal(terminal);

        this.terminal = terminal;
        this.channel = new TerminalPartnerChannel(terminal);
        this.toDispose.push(this.channel);
        this.toDispose.push(this.channel.onReply(text => this.pushMessage('ai', text)));

        this.flowState = 'complete';
        this.status = `${label} を開始しました`;
        this.detail = 'PTY の案内に沿ってログインしてください。ログイン後、そのまま作業を開始できます。';
        this.messages = [{ role: 'ai', text: 'つながりました。下の入力欄からそのまま話しかけてください。' }];
        this.update();

        // xterm.js 側の初期化（term.open()）は、この widget が一度でも可視状態
        // （isVisible && isAttached）で onUpdateRequest を通らないと走らない
        // （Theia 1.73.1 terminal-widget-impl.js を実測: onOutput の配信元である
        // term.onWriteParsed の購読は open() の中で一度だけ登録される）。
        // 単一ドキュメントモードの dock パネルでは「追加されただけ」では
        // まだ可視ではない（別タブがアクティブなため）。開発者モード off
        // （既定）で即 detach すると一度も可視化されないまま終わり、
        // onOutput が一生発火しない = チャットガワが応答を一切受け取れない
        // （実機で確認した不具合）。そのため必ず一度アクティブ化して xterm を
        // 開かせてから、applyDeveloperModeVisibility() で最終的な見た目
        // （ガワ/生ターミナルのどちらを見せるか）を確定する。
        await this.ensureTerminalOpened(terminal);
        // 開発者モード off（既定）ならガワのみ・on なら生ターミナルを表示する
        // （task.md 指示3）。旧実装にあった 1800ms の setTimeout は「常に生
        // ターミナルへ自動フォーカス」する演出用ディレイで、ガワ既定の v2 では
        // 意味が無くなったため廃止した。
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
     * 開発者モード on では生ターミナルをそのまま見せ、off ではガワ（この
     * widget）のみを見せる（task.md 指示3）。実測当たり所として指示された
     * akari-shell-strip の F7（akari-right-panel-curation.ts）は「dispose せず
     * parent=null で detach、再表示時に同じ instance を再利用」という
     * 退避流儀を採る — 本 widget もこの流儀を踏襲する。ただし文字どおりの
     * `close()` は使わない: Theia 1.73.1 の terminal-widget-impl.js を実測すると
     * `close()` は BaseWidget.onCloseRequest 経由で `dispose()` まで進み、
     * `closeOnDispose`（既定 true、`storeState()` 経由でのみ false になる）が
     * 立ったままだと裏の PTY を kill してしまう（destroyTermOnClose とは別軸）。
     * 隠れている間もチャットガワの CLI セッションを生かし続ける必要があるため、
     * 同じ「dispose しない」目的を安全に達成できる parent=null 方式を採る。
     */
    protected refreshDeveloperMode(): void {
        const next = this.preferences.get<boolean>(DEVELOPER_MODE_PREFERENCE, false);
        if (next === this.devMode) {
            return;
        }
        this.devMode = next;
        this.applyDeveloperModeVisibility();
    }

    protected applyDeveloperModeVisibility(): void {
        const terminal = this.terminal;
        if (!terminal || terminal.isDisposed) {
            return;
        }
        const rightWidgets = Array.from(this.shell.rightPanelHandler.dockPanel.widgets());
        if (this.devMode) {
            if (!rightWidgets.includes(terminal)) {
                void this.shell.addWidget(terminal, { area: 'right', rank: 50 }).then(() => this.shell.activateWidget(terminal.id));
            } else {
                this.shell.activateWidget(terminal.id);
            }
        } else {
            if (rightWidgets.includes(terminal)) {
                terminal.parent = null;
            }
            this.shell.activateWidget(this.id);
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
        if (this.flowState === 'complete') {
            return this.renderChat();
        }
        return this.renderOnboarding();
    }

    /**
     * チャットガワ v0（task.md 指示2）。吹き出しログ + 入力欄。未接続時の
     * オンボーディング表示（renderOnboarding）はここでは一切触らない。
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
        return (
            <div style={styles.container}>
                <div style={styles.heroIcon}>✦</div>
                <h2 style={styles.heading}>AI パートナーと始める</h2>
                <p style={styles.lead}>拡張と CLI をセットアップし、このプロジェクトですぐに会話を始めます。</p>

                {this.flowState === 'idle' && <div style={styles.buttonStack}>
                    {PARTNER_CATALOG.map(entry => <button
                        key={entry.id}
                        className='theia-button main'
                        style={entry.recommended ? styles.primaryButton : styles.secondaryButton}
                        onClick={() => this.begin(entry)}
                    >
                        {entry.agent === 'claude' ? 'Claude で始める（推奨）' : 'Codex で始める'}
                    </button>)}
                </div>}

                {this.flowState !== 'idle' && <div
                    style={styles.statusCard}
                    role='status'
                    aria-live='polite'
                    data-akari-flow-state={this.flowState}
                >
                    <div style={styles.statusRow}>
                        {this.flowState === 'working' && <span className='codicon codicon-loading codicon-modifier-spin' />}
                        {this.flowState === 'complete' && <span className='codicon codicon-pass-filled' style={{ color: 'var(--theia-successBackground)' }} />}
                        {this.flowState === 'failed' && <span className='codicon codicon-error' style={{ color: 'var(--theia-errorForeground)' }} />}
                        <strong>{this.status}</strong>
                    </div>
                    <div style={styles.detail}>{this.detail}</div>
                    {this.warning && <div style={styles.warning}>{this.warning}</div>}
                    {this.flowState === 'failed' && <button
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
    primaryButton: { width: '100%', minHeight: 40, fontWeight: 600 },
    secondaryButton: { width: '100%', minHeight: 40, background: 'transparent', border: '1px solid var(--theia-input-border)' },
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
