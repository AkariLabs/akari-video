import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AkariProjectService, AKARI_PROJECT_SERVICE_PATH } from '../common/akari-project-protocol';
import { AkariProjectServiceImpl } from './akari-project-service';

export default new ContainerModule(bind => {
    bind(AkariProjectServiceImpl).toSelf().inSingletonScope();
    bind(AkariProjectService).toService(AkariProjectServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_PROJECT_SERVICE_PATH, () => context.container.get(AkariProjectService))
    ).inSingletonScope();
});
