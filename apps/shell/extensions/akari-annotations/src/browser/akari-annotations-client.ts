import { Emitter, Event } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';
import {
    AkariAnnotationsClient,
    DeferredLintNotification
} from '../common/akari-annotations-protocol';

@injectable()
export class AkariAnnotationsClientImpl implements AkariAnnotationsClient {
    protected readonly willWriteEmitter = new Emitter<string>();
    readonly onWillWriteEvent: Event<string> = this.willWriteEmitter.event;

    protected readonly lintResultEmitter = new Emitter<DeferredLintNotification>();
    readonly onLintResultEvent: Event<DeferredLintNotification> = this.lintResultEmitter.event;

    onWillWrite(uri: string): void {
        this.willWriteEmitter.fire(uri);
    }

    onLintResult(notification: DeferredLintNotification): void {
        this.lintResultEmitter.fire(notification);
    }
}
