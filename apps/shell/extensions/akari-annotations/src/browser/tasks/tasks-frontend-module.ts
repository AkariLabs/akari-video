import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WebSocketConnectionProvider, WidgetFactory } from '@theia/core/lib/browser';
import { AkariTasksService, AKARI_TASKS_SERVICE_PATH } from '../../common/akari-tasks-protocol';
import { TaskService } from './task-service';
import { TaskCommands } from './task-commands';
import { AkariTaskBoardWidget } from './task-board-widget';

export default new ContainerModule(bind => {
    bind(AkariTasksService).toDynamicValue(context =>
        WebSocketConnectionProvider.createProxy(context.container, AKARI_TASKS_SERVICE_PATH)
    ).inSingletonScope();
    bind(TaskService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TaskService);
    bind(TaskCommands).toSelf().inSingletonScope();
    bind(CommandContribution).toService(TaskCommands);
    bind(AkariTaskBoardWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariTaskBoardWidget.FACTORY_ID,
        createWidget: async () => context.container.get(AkariTaskBoardWidget)
    })).inSingletonScope();
});
