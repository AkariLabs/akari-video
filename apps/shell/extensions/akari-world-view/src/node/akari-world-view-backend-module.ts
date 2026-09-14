import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AKARI_WORLD_VIEW_SERVICE_PATH, AkariWorldViewService } from '../common/akari-world-view-protocol';
import { AkariWorldViewServiceImpl } from './akari-world-view-service';

export default new ContainerModule(bind => {
    bind(AkariWorldViewServiceImpl).toSelf().inSingletonScope();
    bind(AkariWorldViewService).toService(AkariWorldViewServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context => new JsonRpcConnectionHandler(
        AKARI_WORLD_VIEW_SERVICE_PATH, () => context.container.get(AkariWorldViewService)
    )).inSingletonScope();
});
