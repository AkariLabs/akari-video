import { interfaces } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { AkariChannelContextService } from './channel/akari-channel-context-service';
import { AkariChannelWidget } from './channel/akari-channel-widget';
import { AkariChannelContribution } from './channel/akari-channel-contribution';

export function bindChannelPanel(bind: interfaces.Bind): void {
    bind(AkariChannelContextService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariChannelContextService);
    bind(AkariChannelWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariChannelWidget.ID,
        createWidget: () => ctx.container.get(AkariChannelWidget)
    })).inSingletonScope();
    bind(AkariChannelContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariChannelContribution);
}
