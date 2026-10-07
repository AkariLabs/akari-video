import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { AkariPartnerServer, PartnerAgentId, PartnerWebLaunch } from '../common/akari-partner-protocol';
import { PARTNER_AGENT_LABELS, PARTNER_CLI_ICON_CLASSES } from './partner-catalog';
import '../electron-common/electron-api';

@injectable()
export class PartnerWebWidget extends ReactWidget {
    static readonly ID = 'akari-partner-web';
    @inject(AkariPartnerServer) protected readonly server!: AkariPartnerServer;
    private launch?: PartnerWebLaunch;
    private ownerId?: string;
    private host?: HTMLElement;
    private ticker?: ReturnType<typeof setInterval>;
    private loaded = false;
    private slowLoading = false;
    private retryLoading?: () => void;
    private cancelLoading?: (error: Error) => void;
    private closePromise?: Promise<void>;

    @postConstruct()
    protected init(): void {
        this.id = PartnerWebWidget.ID;
        this.title.label = PARTNER_AGENT_LABELS.deepseek;
        this.title.iconClass = PARTNER_CLI_ICON_CLASSES.deepseek;
        this.title.closable = true;
        this.node.style.height = '100%';
        this.ticker = setInterval(() => void this.updateBounds().catch(() => undefined), 120);
        this.disposed.connect(() => {
            if (this.ticker) clearInterval(this.ticker);
            this.cancelLoading?.(new Error('DeepSeek Harness の作業画面が閉じられました'));
            void this.closeLaunch();
        });
        this.update();
    }

    isRunning(): boolean { return !!this.launch && this.launch.pid > 0 && !this.isDisposed; }
    get pid(): number | undefined { return this.launch?.pid; }
    get hasLaunch(): boolean { return !!this.launch; }
    get launchCwd(): string | undefined { return this.launch?.cwd; }

    async open(agent: PartnerAgentId, launch: PartnerWebLaunch, ownerId: string): Promise<void> {
        this.title.label = PARTNER_AGENT_LABELS[agent];
        this.title.iconClass = PARTNER_CLI_ICON_CLASSES[agent];
        this.launch = launch;
        this.ownerId = ownerId;
        this.loaded = false;
        this.update();
        try {
            for (;;) {
                if (this.slowLoading) {
                    this.slowLoading = false;
                    this.update();
                }
                const slowTimer = setTimeout(() => {
                    this.slowLoading = true;
                    this.update();
                }, 20_000);
                const retry = new Promise<'retry'>(resolve => {
                    this.retryLoading = () => {
                        this.retryLoading = undefined;
                        resolve('retry');
                    };
                });
                const cancelled = new Promise<never>((_resolve, reject) => { this.cancelLoading = reject; });
                let outcome: 'retry' | 'loaded';
                try {
                    outcome = await Promise.race([
                        window.electronAkariPartner.web.open(launch.url).then(() => 'loaded' as const),
                        retry, cancelled
                    ]);
                } finally {
                    clearTimeout(slowTimer);
                    this.retryLoading = undefined;
                    this.cancelLoading = undefined;
                }
                if (outcome === 'retry') {
                    await window.electronAkariPartner.web.close().catch(() => undefined);
                    if (this.isDisposed) throw new Error('DeepSeek Harness の作業画面が閉じられました');
                    continue;
                }
                if (this.isDisposed) throw new Error('DeepSeek Harness の作業画面が閉じられました');
                this.loaded = true;
                this.slowLoading = false;
                this.update();
                await this.updateBounds();
                return;
            }
        } catch (error) {
            this.dispose();
            await this.closeLaunch();
            throw error;
        }
    }

    private closeLaunch(): Promise<void> {
        if (this.closePromise) return this.closePromise;
        const pid = this.launch?.pid;
        const ownerId = this.ownerId;
        this.launch = undefined;
        this.ownerId = undefined;
        this.closePromise = (async () => {
            await window.electronAkariPartner.web.close().catch(() => undefined);
            if (pid && ownerId) await this.server.stopWebPartner(pid, ownerId).catch(() => undefined);
        })();
        return this.closePromise;
    }

    private async updateBounds(): Promise<void> {
        if (!this.host || !this.launch) return;
        const rect = this.host.getBoundingClientRect();
        const visible = this.isVisible && rect.width > 0 && rect.height > 0 && rect.left < window.innerWidth;
        await window.electronAkariPartner.web.bounds({
            x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible
        });
    }

    protected override render(): React.ReactNode {
        return <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: '0 0 auto', padding: '5px 10px', borderBottom: '1px solid var(--theia-panel-border)',
                fontSize: 11 }}>
                <div>{this.launch?.providerNote}</div>
                {this.launch?.guidance && <div>{this.launch.guidance}</div>}
                {this.launch && !this.loaded && <>
                    <div>DeepSeek Harness を読み込んでいます…</div>
                    {this.slowLoading && <div>
                        時間がかかっています。このウィンドウを前面に出すと読み込みが進みます。
                        <button onClick={() => this.retryLoading?.()}>再試行</button>
                    </div>}
                </>}
            </div>
            <div ref={node => { this.host = node ?? undefined; }}
                style={{ flex: '1 1 auto', minHeight: 0, background: 'var(--theia-editor-background)' }} />
        </div>;
    }
}
