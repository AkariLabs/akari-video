import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AkariNewProjectService, AKARI_NEW_PROJECT_SERVICE_PATH } from '../common/akari-new-project-protocol';
import { AkariNewProjectServiceImpl } from './akari-new-project-service';

export default new ContainerModule(bind => {
    bind(AkariNewProjectServiceImpl).toSelf().inSingletonScope();
    bind(AkariNewProjectService).toService(AkariNewProjectServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_NEW_PROJECT_SERVICE_PATH, () => context.container.get(AkariNewProjectService))
    ).inSingletonScope();
});
