import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { VSXExtensionsModel } from '@theia/vsx-registry/lib/browser/vsx-extensions-model';
import { AkariPartnerServer } from '../common/akari-partner-protocol';
import { PARTNER_CATALOG, PartnerCatalogEntry, PlatformBinaryVerification } from './partner-catalog';
import { PartnerSessionService, PartnerTerminal } from './partner-session-service';

type FlowState = 'idle' | 'working' | 'complete' | 'failed';

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

    protected flowState: FlowState = 'idle';
    protected selected?: PartnerCatalogEntry;
    protected status = '';
    protected detail = '';
    protected warning = '';

    @postConstruct()
    protected init(): void {
        this.id = AkariPartnerWidget.ID;
        this.title.label = 'パートナー';
        this.title.caption = 'AI パートナー';
        this.title.iconClass = 'codicon codicon-comment-discussion';
        this.title.closable = false;
        this.update();
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
            this.setProgress('共有スキルを準備しています…', '同梱の原本から共有ストアへ同期中');
            const launch = await this.partnerServer.prepareLaunch(entry.agent);
            this.setProgress('パートナー PTY を起動しています…', `${bootstrap.runtimeMode}: ${bootstrap.runtimePath}`);
            const roots = await this.workspaceService.roots;
            const cwd = roots[0]?.resource.toString();
            const terminal = await this.terminalService.newTerminal({
                title: entry.name,
                shellPath: bootstrap.executablePath,
                // This is a CLI process, not a shell. Avoid Theia's platform shell args (for example, macOS `-l`).
                // The partner launch plan appends plugin-dir / harness / shared-policy flags (contract §3/§4).
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
            this.sessionService.useTerminal(terminal);
            this.flowState = 'complete';
            this.status = `${entry.name} を開始しました`;
            this.detail = 'PTY の案内に沿ってログインしてください。ログイン後、そのまま作業を開始できます。';
            this.update();
            setTimeout(() => this.shell.activateWidget(terminal.id), 1800);
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

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    protected render(): React.ReactNode {
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
