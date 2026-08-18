import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import {
    AkariAnnotationsClient,
    AkariAnnotationsService,
    AKARI_ANNOTATIONS_SERVICE_PATH
} from '../common/akari-annotations-protocol';
import { AkariAnnotationsServiceImpl } from './akari-annotations-service';

export default new ContainerModule(bind => {
    bind(AkariAnnotationsServiceImpl).toSelf().inSingletonScope();
    bind(AkariAnnotationsService).toService(AkariAnnotationsServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler<AkariAnnotationsClient>(AKARI_ANNOTATIONS_SERVICE_PATH, client => {
            const service = context.container.get<AkariAnnotationsService>(AkariAnnotationsService);
            service.setClient(client);
            return service;
        })
    ).inSingletonScope();
});
