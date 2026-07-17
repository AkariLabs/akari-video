import { Emitter, Event } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';

export interface AkariTranscriptSeekRequest {
    videoUri: string;
    time: number;
    captionId: string;
}

@injectable()
export class AkariTranscriptSeekService {
    protected readonly emitter = new Emitter<AkariTranscriptSeekRequest>();
    readonly onSeekRequested: Event<AkariTranscriptSeekRequest> = this.emitter.event;

    fire(request: AkariTranscriptSeekRequest): void {
        this.emitter.fire(request);
    }
}
