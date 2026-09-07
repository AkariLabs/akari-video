import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { AkariQuickExportService, AKARI_QUICK_EXPORT_SERVICE_PATH } from '../common/quick-export-protocol';
import { AkariQuickExportServiceImpl } from './akari-quick-export-service';
import { AkariExportThumbnailService, AKARI_EXPORT_THUMBNAIL_SERVICE_PATH } from '../common/export-thumbnail-protocol';
import { AkariExportThumbnailServiceImpl } from './akari-export-thumbnail-service';
import { AkariProjectCleanService, AKARI_PROJECT_CLEAN_SERVICE_PATH } from '../common/project-clean-protocol';
import { AkariProjectCleanServiceImpl } from './akari-project-clean-service';

export default new ContainerModule(bind => {
    bind(AkariQuickExportServiceImpl).toSelf().inSingletonScope();
    bind(AkariQuickExportService).toService(AkariQuickExportServiceImpl);
    // シェル終了時に走っている書き出しの子プロセスツリーを道連れにする（孤児を残さない）。
    bind(BackendApplicationContribution).toService(AkariQuickExportServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_QUICK_EXPORT_SERVICE_PATH, () => context.container.get(AkariQuickExportService))
    ).inSingletonScope();
    bind(AkariExportThumbnailServiceImpl).toSelf().inSingletonScope();
    bind(AkariExportThumbnailService).toService(AkariExportThumbnailServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_EXPORT_THUMBNAIL_SERVICE_PATH, () => context.container.get(AkariExportThumbnailService))
    ).inSingletonScope();
    bind(AkariProjectCleanServiceImpl).toSelf().inSingletonScope();
    bind(AkariProjectCleanService).toService(AkariProjectCleanServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_PROJECT_CLEAN_SERVICE_PATH, () => context.container.get(AkariProjectCleanService))
    ).inSingletonScope();
});
