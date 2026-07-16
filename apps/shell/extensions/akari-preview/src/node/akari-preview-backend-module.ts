import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AkariPreviewService, AKARI_PREVIEW_SERVICE_PATH } from '../common/akari-preview-protocol';
import { AkariPreviewServiceImpl } from './akari-preview-service';

export default new ContainerModule(bind => {
    bind(AkariPreviewServiceImpl).toSelf().inSingletonScope();
    bind(AkariPreviewService).toService(AkariPreviewServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_PREVIEW_SERVICE_PATH, () => context.container.get(AkariPreviewService))
    ).inSingletonScope();
});
