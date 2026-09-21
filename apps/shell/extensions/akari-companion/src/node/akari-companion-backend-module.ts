import { ContainerModule } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import {
    AkariCompanionClient,
    AkariCompanionService,
    AKARI_COMPANION_SERVICE_PATH
} from '../common/akari-companion-protocol';
import { AkariCompanionServiceImpl } from './akari-companion-service';
import { CompanionProcessManager } from './companion-process-manager';

export default new ContainerModule(bind => {
    bind(CompanionProcessManager).toDynamicValue(() => new CompanionProcessManager()).inSingletonScope();
    bind(BackendApplicationContribution).toService(CompanionProcessManager);
    bind(ConnectionContainerModule).toConstantValue(ConnectionContainerModule.create(({ bind: bindConnection, bindBackendService }) => {
        bindConnection(AkariCompanionServiceImpl).toSelf().inSingletonScope();
        bindConnection(AkariCompanionService).toService(AkariCompanionServiceImpl);
        bindBackendService<AkariCompanionServiceImpl, AkariCompanionClient>(
            AKARI_COMPANION_SERVICE_PATH, AkariCompanionServiceImpl, (service, client) => {
                service.setClient(client);
                client.onDidCloseConnection(() => service.dispose());
                return service;
            }
        );
    }));
});
