import type { Event } from '@theia/core/lib/common/event';
import type { EarEngineId, EarPurpose, EarStatus, EarUtterance, EarTranscript, RoughCanvasEarEvent } from './ear-protocol';

export const AkariEarFrontend = Symbol('AkariEarFrontend');

export interface AkariEarFrontend {
    capabilities(): Promise<{ engines: Array<{ id: EarEngineId; available: boolean; reason?: string }> }>;
    start(options: { purpose: EarPurpose; engine?: EarEngineId }): Promise<EarStatus>;
    stop(): Promise<EarStatus>;
    notifyRoughCanvas(event: RoughCanvasEarEvent): Promise<void>;
    takeTranscript(canvasId: string): Promise<EarTranscript | undefined>;
    appendAudio(chunk: Uint8Array): Promise<void>;
    readonly onStatus: Event<EarStatus>;
    readonly onLevel: Event<number>;
    readonly onUtterance: Event<EarUtterance>;
}
