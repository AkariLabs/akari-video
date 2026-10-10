import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AKARI_CHAT_SERVICE_PATH, AkariChatService, AkariChatClient } from '../common/chat-protocol';
import { AkariChatServiceImpl } from './akari-chat-service';

export default new ContainerModule(bind => {
    bind(AkariChatServiceImpl).toSelf().inSingletonScope();
    bind(AkariChatService).toService(AkariChatServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler<AkariChatClient>(AKARI_CHAT_SERVICE_PATH, client => {
            const service = context.container.get<AkariChatService>(AkariChatService);
            service.setClient(client);
            return service;
        })
    ).inSingletonScope();
});
