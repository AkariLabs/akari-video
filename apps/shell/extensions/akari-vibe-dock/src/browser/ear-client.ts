import { injectable } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { AkariEarClient, EarStatus, EarUtterance } from '../common/ear-protocol';

@injectable()
export class AkariEarClientImpl implements AkariEarClient {
    protected readonly statusEmitter = new Emitter<EarStatus>();
    protected readonly levelEmitter = new Emitter<number>();
    protected readonly utteranceEmitter = new Emitter<EarUtterance>();
    readonly statusEvent = this.statusEmitter.event;
    readonly levelEvent = this.levelEmitter.event;
    readonly utteranceEvent = this.utteranceEmitter.event;
    protected lastLevelAt = -Infinity;
    protected now = () => performance.now();

    onStatus(status: EarStatus): void { this.statusEmitter.fire(status); }
    onLevel(rms: number): void {
        const at = this.now();
        if (at - this.lastLevelAt < 100) return;
        this.lastLevelAt = at;
        this.levelEmitter.fire(rms);
    }
    onUtterance(utterance: EarUtterance): void { this.utteranceEmitter.fire(utterance); }
}
