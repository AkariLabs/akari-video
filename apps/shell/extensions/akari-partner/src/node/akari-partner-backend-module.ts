import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import {
    AKARI_PARTNER_SERVICE_PATH,
    AkariPartnerServer
} from '../common/akari-partner-protocol';
import { AkariPartnerServerImpl } from './akari-partner-server';

export default new ContainerModule(bind => {
    bind(AkariPartnerServerImpl).toSelf().inSingletonScope();
    bind(AkariPartnerServer).toService(AkariPartnerServerImpl);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(
        AKARI_PARTNER_SERVICE_PATH,
        () => ctx.container.get(AkariPartnerServer)
    )).inSingletonScope();
});
