import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import {
    AkariCompanionClient,
    AkariCompanionService,
    AKARI_COMPANION_SERVICE_PATH
} from '../common/akari-companion-protocol';
import { AkariCompanionServiceImpl } from './akari-companion-service';

export default new ContainerModule(bind => {
    bind(AkariCompanionServiceImpl).toSelf().inSingletonScope();
    bind(AkariCompanionService).toService(AkariCompanionServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler<AkariCompanionClient>(AKARI_COMPANION_SERVICE_PATH, client => {
            const service = context.container.get<AkariCompanionService>(AkariCompanionService);
            service.setClient(client);
            return service;
        })
    ).inSingletonScope();
});
