import { ContainerModule } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { AKARI_CHAT_SERVICE_PATH, AkariChatService, AkariChatClient } from '../common/chat-protocol';
import { AkariChatServiceImpl } from './akari-chat-service';

export class AkariChatSessionRegistry implements BackendApplicationContribution {
    private readonly services = new Set<AkariChatServiceImpl>();

    add(service: AkariChatServiceImpl): void { this.services.add(service); }

    async remove(service: AkariChatServiceImpl): Promise<void> {
        this.services.delete(service);
        await service.dispose();
    }

    async onStop(): Promise<void> {
        await Promise.allSettled([...this.services].map(service => this.remove(service)));
    }
}

export default new ContainerModule(bind => {
    bind(AkariChatSessionRegistry).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(AkariChatSessionRegistry);
    bind(ConnectionContainerModule).toDynamicValue(context => {
        const registry = context.container.get(AkariChatSessionRegistry);
        return ConnectionContainerModule.create(({ bind: bindConnection, bindBackendService }) => {
            bindConnection(AkariChatServiceImpl).toSelf().inSingletonScope();
            bindConnection(AkariChatService).toService(AkariChatServiceImpl);
            bindBackendService<AkariChatServiceImpl, AkariChatClient>(
                AKARI_CHAT_SERVICE_PATH, AkariChatServiceImpl, (service, client) => {
                    service.setClient(client);
                    registry.add(service);
                    client.onDidCloseConnection(() => { void registry.remove(service); });
                    return service;
                }
            );
        });
    }).inSingletonScope();
});
