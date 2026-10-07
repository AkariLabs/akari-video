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
    private host?: HTMLElement;
    private ticker?: ReturnType<typeof setInterval>;

    @postConstruct()
    protected init(): void {
        this.id = PartnerWebWidget.ID;
        this.title.closable = true;
        this.node.style.height = '100%';
        this.ticker = setInterval(() => void this.updateBounds().catch(() => undefined), 120);
        this.disposed.connect(() => {
            if (this.ticker) clearInterval(this.ticker);
            const pid = this.launch?.pid;
            this.launch = undefined;
            void (async () => {
                await window.electronAkariPartner.web.close().catch(() => undefined);
                if (pid) await this.server.stopWebPartner(pid).catch(() => undefined);
            })();
        });
        this.update();
    }

    isRunning(): boolean { return !!this.launch && this.launch.pid > 0 && !this.isDisposed; }
    get pid(): number | undefined { return this.launch?.pid; }

    async open(agent: PartnerAgentId, launch: PartnerWebLaunch): Promise<void> {
        this.title.label = PARTNER_AGENT_LABELS[agent];
        this.title.iconClass = PARTNER_CLI_ICON_CLASSES[agent];
        await window.electronAkariPartner.web.open(launch.url);
        this.launch = launch;
        this.update();
        await this.updateBounds();
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
                overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11 }}>
                <div>{this.launch?.providerNote}</div>
                {this.launch?.guidance && <div>{this.launch.guidance}</div>}
            </div>
            <div ref={node => { this.host = node ?? undefined; }}
                style={{ flex: '1 1 auto', minHeight: 0, background: 'var(--theia-editor-background)' }} />
        </div>;
    }
}
