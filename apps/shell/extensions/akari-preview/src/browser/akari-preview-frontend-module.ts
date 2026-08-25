import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, OpenHandler, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { FileResourceResolver } from '@theia/filesystem/lib/browser/file-resource';
import { AkariPreviewService, AKARI_PREVIEW_SERVICE_PATH } from '../common/akari-preview-protocol';
import { AkariAudioOpenHandler } from './akari-audio-open-handler';
import { AkariFileResourceResolver } from './akari-file-resource-resolver';
import { AkariImageOpenHandler } from './akari-image-open-handler';
import { AkariOutputPreviewOpenHandler, AkariPreviewOpenHandler } from './akari-preview-open-handler';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(FileResourceResolver).to(AkariFileResourceResolver).inSingletonScope();

    bind(AkariPreviewService).toDynamicValue(context =>
        WebSocketConnectionProvider.createProxy(context.container, AKARI_PREVIEW_SERVICE_PATH)
    ).inSingletonScope();

    bind(AkariPreviewOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariPreviewOpenHandler);
    bind(AkariOutputPreviewOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariOutputPreviewOpenHandler);
    bind(AkariAudioOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariAudioOpenHandler);
    bind(AkariImageOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariImageOpenHandler);
    bind(FrontendApplicationContribution).toService(AkariPreviewOpenHandler);
    bind(FrontendApplicationContribution).toService(AkariAudioOpenHandler);
});
