import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import {
    AKARI_PARTNER_SERVICE_PATH,
    AkariPartnerServer
} from '../common/akari-partner-protocol';
import { AkariPartnerServerImpl } from './akari-partner-server';
import { CliPathStartupContribution } from './cli-path-startup';

export default new ContainerModule(bind => {
    bind(CliPathStartupContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(CliPathStartupContribution);
    bind(AkariPartnerServerImpl).toSelf().inSingletonScope();
    bind(AkariPartnerServer).toService(AkariPartnerServerImpl);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(
        AKARI_PARTNER_SERVICE_PATH,
        () => ctx.container.get(AkariPartnerServer)
    )).inSingletonScope();
});
