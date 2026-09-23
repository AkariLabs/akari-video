import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
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
import { AkariNarrationEnginesService, AKARI_NARRATION_ENGINES_SERVICE_PATH } from '../common/narration-engines-protocol';
import { AkariNarrationEnginesServiceImpl } from './narration-engines';

export default new ContainerModule(bind => {
    bind(AkariNarrationEnginesServiceImpl).toSelf().inSingletonScope();
    bind(AkariNarrationEnginesService).toService(AkariNarrationEnginesServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_NARRATION_ENGINES_SERVICE_PATH, () => context.container.get(AkariNarrationEnginesService))
    ).inSingletonScope();
    bind(LibraryMigrationContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(LibraryMigrationContribution);
    bind(AkariConnectionsServiceImpl).toSelf().inSingletonScope();
    bind(AkariConnectionsService).toService(AkariConnectionsServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_CONNECTIONS_SERVICE_PATH, () => context.container.get(AkariConnectionsService))
    ).inSingletonScope();
    bind(AkariNewProjectServiceImpl).toSelf().inSingletonScope();
    bind(AkariNewProjectService).toService(AkariNewProjectServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_NEW_PROJECT_SERVICE_PATH, () => context.container.get(AkariNewProjectService))
    ).inSingletonScope();
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
