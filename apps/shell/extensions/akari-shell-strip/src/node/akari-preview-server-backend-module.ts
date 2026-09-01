import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { AkariPreviewServerService, AKARI_PREVIEW_SERVER_SERVICE_PATH } from '../common/preview-server-protocol';
import { AkariPreviewServerServiceImpl } from './akari-preview-server-service';

export default new ContainerModule(bind => {
    bind(AkariPreviewServerServiceImpl).toSelf().inSingletonScope();
    bind(AkariPreviewServerService).toService(AkariPreviewServerServiceImpl);
    // シェル終了時に子プロセス（preview-server）を道連れにする（孤児を残さない）。
    bind(BackendApplicationContribution).toService(AkariPreviewServerServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_PREVIEW_SERVER_SERVICE_PATH, () => context.container.get(AkariPreviewServerService))
    ).inSingletonScope();
});
