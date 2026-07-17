import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WebSocketConnectionProvider, WidgetFactory } from '@theia/core/lib/browser';
import { AkariAnnotationsService, AKARI_ANNOTATIONS_SERVICE_PATH } from '../common/akari-annotations-protocol';
import { AkariAnnotationsContribution } from './akari-annotations-contribution';
import { AkariAnnotationsWidget } from './akari-annotations-widget';

export default new ContainerModule(bind => {
    bind(AkariAnnotationsService).toDynamicValue(context =>
        WebSocketConnectionProvider.createProxy(context.container, AKARI_ANNOTATIONS_SERVICE_PATH)
    ).inSingletonScope();

    bind(AkariAnnotationsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariAnnotationsWidget.FACTORY_ID,
        createWidget: async () => context.container.get(AkariAnnotationsWidget)
    })).inSingletonScope();

    bind(AkariAnnotationsContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariAnnotationsContribution);
    bind(FrontendApplicationContribution).toService(AkariAnnotationsContribution);
});
