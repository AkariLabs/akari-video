import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { AKARI_WORLD_VIEW_SERVICE_PATH, AkariWorldViewService } from '../common/akari-world-view-protocol';
import { AkariWorldViewContribution } from './akari-world-view-contribution';

export default new ContainerModule(bind => {
    bind(AkariWorldViewService).toDynamicValue(context => WebSocketConnectionProvider.createProxy(
        context.container, AKARI_WORLD_VIEW_SERVICE_PATH
    )).inSingletonScope();
    bind(AkariWorldViewContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariWorldViewContribution);
});
