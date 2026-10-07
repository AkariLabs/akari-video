import {
    ElectronMainApplication,
    ElectronMainApplicationContribution
} from '@theia/core/lib/electron-main/electron-main-application';
import { app, ipcMain, powerMonitor, systemPreferences, webContents, webFrameMain } from '@theia/core/electron-shared/electron';
import type { WebContents, RenderProcessGoneDetails } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHANNEL_ASK_MICROPHONE_ACCESS, CHANNEL_CAPTURE_VISUAL_THUMBNAIL, CHANNEL_CAPTURE_PREVIEW_FRAME, CHANNEL_FINISH_PREVIEW_FRAME, CHANNEL_PREVIEW_RENDERER_GONE, CHANNEL_CONNECTION_DIAGNOSTIC, CHANNEL_APPEND_DIAGNOSTIC_LOG } from '../electron-common/electron-api';
import { appendConnectionDiagnostic, appendDiagnosticLogLines } from './connection-diagnostics-log';
import { capturePreviewFrame, finishPreviewFrame } from './preview-frame-capture';
import { captureVisualThumbnail } from './visual-thumbnail-capture';
import { PREVIEW_RENDERER_POLL_MS, PreviewRendererTracker, previewWidgetIdFromUrl } from './preview-renderer-tracker';

@injectable()
export class AkariPreviewElectronApi implements ElectronMainApplicationContribution {
    protected readonly rendererTracker = new PreviewRendererTracker();
    protected readonly contents = new Map<number, WebContents>();
    protected readonly recentGone = new Map<number, { details: RenderProcessGoneDetails; at: number }>();

    onStart(_application: ElectronMainApplication): void {
        this.watchPreviewRenderers();
        this.watchConnectionAndPower();
        ipcMain.handle(CHANNEL_APPEND_DIAGNOSTIC_LOG, (_event, lines: string[]) => appendDiagnosticLogLines(lines));
        ipcMain.handle(CHANNEL_CAPTURE_PREVIEW_FRAME, (event, request) => capturePreviewFrame(event.sender, request));
        ipcMain.handle(CHANNEL_FINISH_PREVIEW_FRAME, (event, captureId, discard) => finishPreviewFrame(event.sender, captureId, discard));
        ipcMain.handle(CHANNEL_CAPTURE_VISUAL_THUMBNAIL, (_event, page) => captureVisualThumbnail(page));
        ipcMain.handle(CHANNEL_ASK_MICROPHONE_ACCESS, async () => {
            if (process.platform !== 'darwin') {
                return true;
            }
            const allowed = await systemPreferences.askForMediaAccess('microphone');
            return allowed;
        });
    }

    protected watchConnectionAndPower(): void {
        ipcMain.on(CHANNEL_CONNECTION_DIAGNOSTIC, (_event, event: unknown, reason: unknown) => {
            if (event !== 'socket-disconnect' && event !== 'socket-reconnect') return;
            appendConnectionDiagnostic(event, typeof reason === 'string' ? reason : undefined);
        });
        powerMonitor.on('suspend', () => appendConnectionDiagnostic('power-suspend'));
        powerMonitor.on('resume', () => appendConnectionDiagnostic('power-resume'));
        powerMonitor.on('lock-screen', () => appendConnectionDiagnostic('power-lock-screen'));
        powerMonitor.on('unlock-screen', () => appendConnectionDiagnostic('power-unlock-screen'));
    }

    protected watchPreviewRenderers(): void {
        const attach = (contents: WebContents): void => {
            if (this.contents.has(contents.id)) return;
            this.contents.set(contents.id, contents);
            contents.on('did-frame-navigate', (_event, url, _code, _text, isMainFrame, frameProcessId, frameRoutingId) => {
                if (isMainFrame) return;
                if (!previewWidgetIdFromUrl(url)) {
                    this.rendererTracker.observe(contents.id, frameRoutingId, 0, url);
                    return;
                }
                try {
                    // fromId で遷移した 1 frame のみ取得する。停止済み frame を木から辿らない。
                    const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
                    this.rendererTracker.observe(contents.id, frameRoutingId, frame?.osProcessId ?? 0, url);
                } catch { /* 遷移した frame が既に失われた場合は追跡を解く。 */
                    this.rendererTracker.observe(contents.id, frameRoutingId, 0, url);
                }
            });
            contents.on('destroyed', () => {
                this.rendererTracker.forgetContents(contents.id);
                this.contents.delete(contents.id);
                this.recentGone.delete(contents.id);
            });
        };
        webContents.getAllWebContents().forEach(attach);
        app.on('web-contents-created', (_event, contents) => attach(contents));
        app.on('render-process-gone', (_event, contents, details) => {
            this.recentGone.set(contents.id, { details, at: Date.now() });
        });
        // OOPIF は WebContents の停止イベントが出ない場合がある。生存を確認済みの
        // frame PID が二度続けて metrics から消え、遷移・破棄イベントで追跡が解かれていない時だけ通知する。
        const timer = setInterval(() => {
            const gone = this.rendererTracker.pollIfTracked(
                () => new Set(app.getAppMetrics().map(metric => metric.pid)));
            for (const item of gone) {
                const contents = this.contents.get(item.contentsId);
                if (!contents || contents.isDestroyed()) continue;
                const recorded = this.recentGone.get(item.contentsId);
                const details = recorded && Date.now() - recorded.at < 2000 ? recorded.details : undefined;
                contents.send(CHANNEL_PREVIEW_RENDERER_GONE, {
                    webviewId: item.widgetId,
                    reason: details?.reason ?? 'unknown',
                    exitCode: details?.exitCode ?? null,
                    observedAt: item.observedAt,
                    at: new Date().toISOString()
                });
            }
        }, PREVIEW_RENDERER_POLL_MS);
        app.once('before-quit', () => clearInterval(timer));
    }
}
