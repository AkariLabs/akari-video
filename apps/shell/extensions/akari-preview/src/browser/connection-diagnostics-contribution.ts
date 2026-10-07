import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WebSocketConnectionSource } from '@theia/core/lib/browser/messaging/ws-connection-source';
import { inject, injectable } from '@theia/core/shared/inversify';

/** Theia の socket.io イベントから切断理由を採り、backend 不通中も Electron main に記録する。 */
@injectable()
export class ConnectionDiagnosticsContribution implements FrontendApplicationContribution {
    @inject(WebSocketConnectionSource)
    protected readonly connectionSource!: WebSocketConnectionSource;

    onStart(): void {
        const socket = this.connectionSource.socket;
        if (!socket || !window.electronAkariPreview) return;
        let disconnected = false;
        socket.on('disconnect', reason => {
            disconnected = true;
            window.electronAkariPreview.recordConnectionDiagnostic('socket-disconnect', reason);
        });
        socket.on('connect', () => {
            if (!disconnected) return;
            disconnected = false;
            window.electronAkariPreview.recordConnectionDiagnostic('socket-reconnect');
        });
    }
}
