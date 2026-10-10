import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { ConnectService, CONNECT_SERVICE_PATH } from '../common/connect-protocol';
import { ConnectServiceImpl } from './connect-service';

export default new ContainerModule(bind => {
    bind(ConnectionContainerModule).toConstantValue(ConnectionContainerModule.create(({ bind: bindConnection, bindBackendService }) => {
        bindConnection(ConnectServiceImpl).toSelf().inSingletonScope();
        bindConnection(ConnectService).toService(ConnectServiceImpl);
        bindBackendService(CONNECT_SERVICE_PATH, ConnectServiceImpl);
    }));
});
