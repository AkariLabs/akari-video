import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, OpenHandler, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { AkariPreviewService, AKARI_PREVIEW_SERVICE_PATH } from '../common/akari-preview-protocol';
import { AkariPreviewOpenHandler } from './akari-preview-open-handler';

export default new ContainerModule(bind => {
    bind(AkariPreviewService).toDynamicValue(context =>
        WebSocketConnectionProvider.createProxy(context.container, AKARI_PREVIEW_SERVICE_PATH)
    ).inSingletonScope();

    bind(AkariPreviewOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariPreviewOpenHandler);
    bind(FrontendApplicationContribution).toService(AkariPreviewOpenHandler);
});
