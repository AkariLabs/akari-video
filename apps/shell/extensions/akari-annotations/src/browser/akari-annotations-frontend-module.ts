import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import {
    FrontendApplicationContribution,
    WebSocketConnectionProvider,
    WidgetFactory
} from '@theia/core/lib/browser';
import { AkariAnnotationsService, AKARI_ANNOTATIONS_SERVICE_PATH } from '../common/akari-annotations-protocol';
import { AkariAnnotationsContribution } from './akari-annotations-contribution';
import { AkariAnnotationsWidget } from './akari-annotations-widget';
import { AkariInspectorWidget } from './akari-inspector-widget';
import { AkariReviewBoardWidget } from './akari-review-board-widget';
import { AkariReviewPanelWidget } from './akari-review-panel-widget';
import { ReviewModel } from './review-model';
import { TimelineSelectionModel } from './timeline-selection-model';

export default new ContainerModule(bind => {
    bind(AkariAnnotationsService).toDynamicValue(context =>
        WebSocketConnectionProvider.createProxy(context.container, AKARI_ANNOTATIONS_SERVICE_PATH)
    ).inSingletonScope();

    bind(ReviewModel).toSelf().inSingletonScope();
    bind(TimelineSelectionModel).toSelf().inSingletonScope();

    bind(AkariAnnotationsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariAnnotationsWidget.FACTORY_ID,
        createWidget: async () => context.container.get(AkariAnnotationsWidget)
    })).inSingletonScope();

    bind(AkariReviewPanelWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariReviewPanelWidget.FACTORY_ID,
        createWidget: async () => context.container.get(AkariReviewPanelWidget)
    })).inSingletonScope();

    bind(AkariInspectorWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariInspectorWidget.FACTORY_ID,
        createWidget: async () => context.container.get(AkariInspectorWidget)
    })).inSingletonScope();

    bind(AkariReviewBoardWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariReviewBoardWidget.FACTORY_ID,
        createWidget: async () => context.container.get(AkariReviewBoardWidget)
    })).inSingletonScope();

    bind(AkariAnnotationsContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariAnnotationsContribution);
    bind(MenuContribution).toService(AkariAnnotationsContribution);
    bind(FrontendApplicationContribution).toService(AkariAnnotationsContribution);
});
