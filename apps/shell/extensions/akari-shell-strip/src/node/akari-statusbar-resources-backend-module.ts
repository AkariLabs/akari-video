import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AkariStatusbarResourcesService, AKARI_STATUSBAR_RESOURCES_PATH } from '../common/statusbar-resources-protocol';
import { AkariStatusbarResourcesServiceImpl } from './akari-statusbar-resources-service';

export default new ContainerModule(bind => {
    bind(AkariStatusbarResourcesServiceImpl).toSelf().inSingletonScope();
    bind(AkariStatusbarResourcesService).toService(AkariStatusbarResourcesServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_STATUSBAR_RESOURCES_PATH, () => context.container.get(AkariStatusbarResourcesService))
    ).inSingletonScope();
});
