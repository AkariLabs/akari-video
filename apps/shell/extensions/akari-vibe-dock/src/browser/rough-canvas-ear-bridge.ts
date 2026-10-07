import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { AkariEarFrontend } from '../common/ear-frontend';
import { RoughCanvasEarEvent } from '../common/ear-protocol';
import { isVibePreviewEnabled } from '../common/vibe-preview';

interface CanvasEventDetail { key: string; at: number }

@injectable()
export class RoughCanvasEarBridge implements FrontendApplicationContribution {
    @inject(AkariEarFrontend) protected readonly ear!: AkariEarFrontend;

    protected readonly opened = (event: Event): void => { void this.forward('roughCanvas.opened', event); };
    protected readonly closed = (event: Event): void => { void this.forward('roughCanvas.closed', event); };

    onStart(): void {
        // ブラウザの保存領域があるときだけプレビュー設定を判定する。
        if ('localStorage' in window && !isVibePreviewEnabled(window.localStorage)) return;
        window.addEventListener('akari.sketch.opened', this.opened);
        window.addEventListener('akari.sketch.closed', this.closed);
    }

    onStop(): void {
        window.removeEventListener('akari.sketch.opened', this.opened);
        window.removeEventListener('akari.sketch.closed', this.closed);
    }

    protected async forward(type: RoughCanvasEarEvent['type'], event: Event): Promise<void> {
        const detail = (event as CustomEvent<CanvasEventDetail>).detail;
        if (!detail || typeof detail.key !== 'string' || !Number.isFinite(detail.at)) return;
        const browserWindow = 'localStorage' in window;
        try {
            await this.ear.notifyRoughCanvas({ type, canvasId: detail.key, at: browserWindow ? detail.at * 1000 : detail.at });
            if (browserWindow && type === 'roughCanvas.closed') {
                const transcript = await this.ear.takeTranscript(detail.key);
                if (transcript) window.dispatchEvent(new CustomEvent('akari.sketch.transcript', {
                    detail: { key: detail.key, transcript }
                }));
            }
        } catch (error) {
            if (browserWindow) return;
            console.warn('[akari-vibe-dock] canvas ear notification failed', error);
        }
        finally {
            if (browserWindow && type === 'roughCanvas.closed') {
                window.dispatchEvent(new CustomEvent('akari.sketch.earClosed', { detail: { key: detail.key } }));
            }
        }
    }
}
