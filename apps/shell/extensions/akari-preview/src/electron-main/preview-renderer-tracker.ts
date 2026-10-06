/** Electron に依存しない、webview iframe と OS renderer PID の対応表。 */
import { previewDiagnosticsKindFromWidgetId } from '../common/preview-init-diagnostics';

export function previewWidgetIdFromUrl(url: string): string | undefined {
    try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith('.webview.localhost')) return undefined;
        const id = parsed.searchParams.get('id');
        if (id && previewDiagnosticsKindFromWidgetId(id)) {
            return id;
        }
    } catch { /* 初期の空 URL は対象外。 */ }
    return undefined;
}

interface TrackedFrame {
    contentsId: number;
    routingId: number;
    pid: number;
    widgetId: string;
    seenAlive: boolean;
    missingPolls: number;
}

export class PreviewRendererTracker {
    private readonly frames = new Map<string, TrackedFrame>();

    pollIfTracked(
        readLivePids: () => ReadonlySet<number>,
        validFrame: (contentsId: number, routingId: number, pid: number) => boolean
    ): Array<{ contentsId: number; pid: number; widgetId: string }> {
        if (this.frames.size === 0) return [];
        return this.poll(readLivePids(), validFrame);
    }

    observe(contentsId: number, routingId: number, pid: number, url: string): void {
        const key = `${contentsId}:${routingId}`;
        const widgetId = previewWidgetIdFromUrl(url);
        if (!widgetId || pid <= 0) {
            this.frames.delete(key);
            return;
        }
        const previous = this.frames.get(key);
        for (const [otherKey, other] of this.frames) {
            if (otherKey !== key && other.contentsId === contentsId && other.widgetId === widgetId) {
                this.frames.delete(otherKey);
            }
        }
        this.frames.set(key, {
            contentsId, routingId, pid, widgetId,
            seenAlive: previous?.pid === pid ? previous.seenAlive : false,
            missingPolls: 0
        });
    }

    forgetContents(contentsId: number): void {
        for (const [key, frame] of this.frames) {
            if (frame.contentsId === contentsId) this.frames.delete(key);
        }
    }

    poll(livePids: ReadonlySet<number>, validFrame: (contentsId: number, routingId: number, pid: number) => boolean):
        Array<{ contentsId: number; pid: number; widgetId: string }> {
        const gone: Array<{ contentsId: number; pid: number; widgetId: string }> = [];
        for (const [key, frame] of this.frames) {
            if (livePids.has(frame.pid)) {
                // 停止した OOPIF の WebFrameMain getter は Electron 39 で同期的に固まる。
                // getter を使う妥当性確認は PID が生きている間だけ行う。
                if (!validFrame(frame.contentsId, frame.routingId, frame.pid)) {
                    this.frames.delete(key);
                    continue;
                }
                frame.seenAlive = true;
                frame.missingPolls = 0;
            } else if (frame.seenAlive && ++frame.missingPolls >= 2) {
                gone.push({ contentsId: frame.contentsId, pid: frame.pid, widgetId: frame.widgetId });
                this.frames.delete(key);
            }
        }
        return gone;
    }
}
