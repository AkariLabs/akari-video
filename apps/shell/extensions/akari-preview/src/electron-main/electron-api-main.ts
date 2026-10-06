import {
    ElectronMainApplication,
    ElectronMainApplicationContribution
} from '@theia/core/lib/electron-main/electron-main-application';
import { app, ipcMain, systemPreferences, webContents } from '@theia/core/electron-shared/electron';
import type { WebContents, WebFrameMain, RenderProcessGoneDetails } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHANNEL_ASK_MICROPHONE_ACCESS, CHANNEL_CAPTURE_VISUAL_THUMBNAIL, CHANNEL_CAPTURE_PREVIEW_FRAME, CHANNEL_FINISH_PREVIEW_FRAME, CHANNEL_PREVIEW_RENDERER_GONE } from '../electron-common/electron-api';
import { capturePreviewFrame, finishPreviewFrame } from './preview-frame-capture';
import { captureVisualThumbnail } from './visual-thumbnail-capture';
import { PreviewRendererTracker, previewWidgetIdFromUrl } from './preview-renderer-tracker';

@injectable()
export class AkariPreviewElectronApi implements ElectronMainApplicationContribution {
    protected readonly rendererTracker = new PreviewRendererTracker();
    protected readonly frames = new Map<string, { frame: WebFrameMain; widgetId: string }>();
    protected readonly contents = new Map<number, WebContents>();
    protected readonly recentGone = new Map<number, { details: RenderProcessGoneDetails; at: number }>();

    onStart(_application: ElectronMainApplication): void {
        this.watchPreviewRenderers();
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

    protected watchPreviewRenderers(): void {
        const attach = (contents: WebContents): void => {
            if (this.contents.has(contents.id)) return;
            this.contents.set(contents.id, contents);
            const observe = (frame: WebFrameMain, url = frame.url): void => {
                const key = `${contents.id}:${frame.routingId}`;
                const widgetId = previewWidgetIdFromUrl(url);
                if (widgetId) {
                    for (const [otherKey, other] of this.frames) {
                        if (otherKey !== key && other.widgetId === widgetId) this.frames.delete(otherKey);
                    }
                    this.frames.set(key, { frame, widgetId });
                    this.rendererTracker.observe(contents.id, frame.routingId, frame.osProcessId, url);
                } else {
                    this.frames.delete(key);
                    this.rendererTracker.observe(contents.id, frame.routingId, 0, url);
                }
            };
            contents.on('frame-created', (_event, { frame }) => {
                if (frame) observe(frame);
            });
            contents.on('did-frame-navigate', (_event, url, _code, _text, isMainFrame, _processId, routingId) => {
                if (isMainFrame) return;
                const find = (parent: WebFrameMain): WebFrameMain | undefined => {
                    for (const frame of parent.frames) {
                        if (frame.routingId === routingId) return frame;
                        const nested = find(frame);
                        if (nested) return nested;
                    }
                    return undefined;
                };
                try {
                    const frame = find(contents.mainFrame);
                    if (frame) observe(frame, url);
                } catch { /* 遷移中に frame が破棄された。次の観測へ任せる。 */ }
            });
            contents.on('destroyed', () => {
                this.rendererTracker.forgetContents(contents.id);
                this.contents.delete(contents.id);
                this.recentGone.delete(contents.id);
                for (const key of this.frames.keys()) {
                    if (key.startsWith(`${contents.id}:`)) this.frames.delete(key);
                }
            });
            try {
                const visit = (frame: WebFrameMain): void => {
                    observe(frame);
                    frame.frames.forEach(visit);
                };
                visit(contents.mainFrame);
            } catch { /* 起動時点では mainFrame が無い場合がある。 */ }
        };
        webContents.getAllWebContents().forEach(attach);
        app.on('web-contents-created', (_event, contents) => attach(contents));
        app.on('render-process-gone', (_event, contents, details) => {
            this.recentGone.set(contents.id, { details, at: Date.now() });
        });
        // OOPIF は WebContents の停止イベントが出ない場合がある。生存を確認済みの
        // frame PID が二度続けて metrics から消え、frame が遷移・破棄されていない時だけ通知する。
        const timer = setInterval(() => {
            const gone = this.rendererTracker.pollIfTracked(
                () => new Set(app.getAppMetrics().map(metric => metric.pid)),
                (contentsId, routingId, pid) => {
                    const frame = this.frames.get(`${contentsId}:${routingId}`)?.frame;
                    try {
                        return !!frame && !frame.detached
                            && (frame.osProcessId === pid || frame.osProcessId === 0);
                    } catch { return false; }
                });
            for (const item of gone) {
                for (const [key, tracked] of this.frames) {
                    if (tracked.widgetId === item.widgetId && key.startsWith(`${item.contentsId}:`)) {
                        this.frames.delete(key);
                    }
                }
                const contents = this.contents.get(item.contentsId);
                if (!contents || contents.isDestroyed()) continue;
                const recorded = this.recentGone.get(item.contentsId);
                const details = recorded && Date.now() - recorded.at < 2000 ? recorded.details : undefined;
                contents.send(CHANNEL_PREVIEW_RENDERER_GONE, {
                    webviewId: item.widgetId,
                    reason: details?.reason ?? 'unknown',
                    exitCode: details?.exitCode ?? null,
                    at: new Date().toISOString()
                });
            }
        }, 250);
        app.once('before-quit', () => clearInterval(timer));
    }
}
