import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { MessageService } from '@theia/core/lib/common/message-service';
import { LibraryMigrationContribution } from './library-migration-contribution';
import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AkariNewProjectService, AKARI_NEW_PROJECT_SERVICE_PATH } from '../common/akari-new-project-protocol';
import { AkariNewProjectServiceImpl } from './akari-new-project-service';

import { AkariConnectionsService, AKARI_CONNECTIONS_SERVICE_PATH } from '../common/akari-connections-protocol';
import { AkariConnectionsServiceImpl } from './akari-connections-service';
import { AkariKitsService, AKARI_KITS_SERVICE_PATH } from '../common/akari-kits-protocol';
import { AkariKitsServiceImpl } from './akari-kits-service';
import { AkariSettingsMaintenanceService, AKARI_SETTINGS_MAINTENANCE_PATH } from '../common/settings-maintenance-protocol';
import { AkariSettingsMaintenanceServiceImpl } from './settings-maintenance-service';

export default new ContainerModule(bind => {
    bind(LibraryMigrationContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(LibraryMigrationContribution);
    bind(AkariConnectionsServiceImpl).toSelf().inSingletonScope();
    bind(AkariConnectionsService).toService(AkariConnectionsServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_CONNECTIONS_SERVICE_PATH, () => context.container.get(AkariConnectionsService))
    ).inSingletonScope();
    bind(AkariNewProjectServiceImpl).toSelf().inSingletonScope();
    bind(AkariNewProjectService).toService(AkariNewProjectServiceImpl);
    // A frontend connection is needed for the existing Theia toast service.
    // Startup does the migration; this same implementation claims the notice once connected.
    bind(ConnectionContainerModule).toConstantValue(ConnectionContainerModule.create(({ bind: bindConnection }) => {
        bindConnection(ConnectionHandler).toDynamicValue(context => {
            const migration = context.container.get(LibraryMigrationContribution);
            const messages = context.container.get(MessageService);
            void migration.migrate(async message => { await messages.info(message); });
            return new JsonRpcConnectionHandler(AKARI_NEW_PROJECT_SERVICE_PATH, () => context.container.get(AkariNewProjectService));
        }).inSingletonScope();
    }));
    bind(AkariKitsServiceImpl).toSelf().inSingletonScope();
    bind(AkariKitsService).toService(AkariKitsServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_KITS_SERVICE_PATH, () => context.container.get(AkariKitsService))
    ).inSingletonScope();
    bind(AkariSettingsMaintenanceServiceImpl).toSelf().inSingletonScope();
    bind(AkariSettingsMaintenanceService).toService(AkariSettingsMaintenanceServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_SETTINGS_MAINTENANCE_PATH, () => context.container.get(AkariSettingsMaintenanceService))
    ).inSingletonScope();
});
