import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AkariAnnotationsService, AKARI_ANNOTATIONS_SERVICE_PATH } from '../common/akari-annotations-protocol';
import { AkariAnnotationsServiceImpl } from './akari-annotations-service';

export default new ContainerModule(bind => {
    bind(AkariAnnotationsServiceImpl).toSelf().inSingletonScope();
    bind(AkariAnnotationsService).toService(AkariAnnotationsServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_ANNOTATIONS_SERVICE_PATH, () => context.container.get(AkariAnnotationsService))
    ).inSingletonScope();
});
