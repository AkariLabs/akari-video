import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WebSocketConnectionProvider, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common';
import { ConnectService, CONNECT_SERVICE_PATH } from '../common/connect-protocol';
import { ConnectWidget } from './connect-widget';
import { ConnectContribution } from './connect-contribution';

export default new ContainerModule(bind => {
    bind(ConnectService).toDynamicValue(ctx => WebSocketConnectionProvider.createProxy(ctx.container, CONNECT_SERVICE_PATH)).inSingletonScope();
    bind(ConnectWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: ConnectWidget.ID, createWidget: () => ctx.container.get(ConnectWidget) })).inSingletonScope();
    bind(ConnectContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ConnectContribution);
    bind(FrontendApplicationContribution).toService(ConnectContribution);
});
