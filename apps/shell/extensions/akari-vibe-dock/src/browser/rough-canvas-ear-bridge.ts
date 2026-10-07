import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { AkariEarFrontend } from '../common/ear-frontend';
import { RoughCanvasEarEvent } from '../common/ear-protocol';

interface CanvasEventDetail { key: string; at: number }

@injectable()
export class RoughCanvasEarBridge implements FrontendApplicationContribution {
    @inject(AkariEarFrontend) protected readonly ear!: AkariEarFrontend;

    protected readonly opened = (event: Event): void => this.forward('roughCanvas.opened', event);
    protected readonly closed = (event: Event): void => this.forward('roughCanvas.closed', event);

    onStart(): void {
        window.addEventListener('akari.sketch.opened', this.opened);
        window.addEventListener('akari.sketch.closed', this.closed);
    }

    onStop(): void {
        window.removeEventListener('akari.sketch.opened', this.opened);
        window.removeEventListener('akari.sketch.closed', this.closed);
    }

    protected forward(type: RoughCanvasEarEvent['type'], event: Event): void {
        const detail = (event as CustomEvent<CanvasEventDetail>).detail;
        if (!detail || typeof detail.key !== 'string' || !Number.isFinite(detail.at)) return;
        try {
            void Promise.resolve(this.ear.notifyRoughCanvas({ type, canvasId: detail.key, at: detail.at }))
                .catch(error => console.warn('[akari-vibe-dock] canvas ear notification failed', error));
        } catch (error) {
            console.warn('[akari-vibe-dock] canvas ear notification failed', error);
        }
    }
}
