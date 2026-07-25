import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AkariQuickExportService, AKARI_QUICK_EXPORT_SERVICE_PATH } from '../common/quick-export-protocol';
import { AkariQuickExportServiceImpl } from './akari-quick-export-service';

export default new ContainerModule(bind => {
    bind(AkariQuickExportServiceImpl).toSelf().inSingletonScope();
    bind(AkariQuickExportService).toService(AkariQuickExportServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_QUICK_EXPORT_SERVICE_PATH, () => context.container.get(AkariQuickExportService))
    ).inSingletonScope();
});
