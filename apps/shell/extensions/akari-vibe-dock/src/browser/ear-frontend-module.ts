import { ContainerModule } from '@theia/core/shared/inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { AkariEarService, AKARI_EAR_SERVICE_PATH } from '../common/ear-protocol';
import { AkariEarFrontend } from '../common/ear-frontend';
import { AkariEarClientImpl } from './ear-client';

export default new ContainerModule(bind => {
    bind(AkariEarClientImpl).toSelf().inSingletonScope();
    bind(AkariEarService).toDynamicValue(context => WebSocketConnectionProvider.createProxy(
        context.container, AKARI_EAR_SERVICE_PATH, context.container.get(AkariEarClientImpl)
    )).inSingletonScope();
    bind(AkariEarFrontend).toDynamicValue(context => {
        const service = context.container.get<AkariEarService>(AkariEarService);
        const client = context.container.get(AkariEarClientImpl);
        return {
            capabilities: () => service.getCapabilities(),
            start: (options: Parameters<AkariEarService['start']>[0]) => service.start(options),
            stop: () => service.stop(),
            notifyRoughCanvas: (event: Parameters<AkariEarService['notifyRoughCanvas']>[0]) => service.notifyRoughCanvas(event),
            takeTranscript: (canvasId: string) => service.takeTranscript(canvasId),
            appendAudio: (chunk: Uint8Array) => service.appendAudio(chunk),
            onStatus: client.statusEvent,
            onLevel: client.levelEvent,
            onUtterance: client.utteranceEvent
        } satisfies AkariEarFrontend;
    }).inSingletonScope();
});
