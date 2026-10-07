import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import {
    AkariAnnotationsClient,
    AkariAnnotationsService,
    AKARI_ANNOTATIONS_SERVICE_PATH
} from '../common/akari-annotations-protocol';
import { AkariAnnotationsServiceImpl } from './akari-annotations-service';
import { AkariTasksService, AKARI_TASKS_SERVICE_PATH } from '../common/akari-tasks-protocol';
import { AkariTasksServiceImpl } from './akari-tasks-service';
import { AkariRoughCanvasService, AKARI_ROUGH_CANVAS_SERVICE_PATH } from '../common/rough-canvas-protocol';
import { AkariRoughCanvasServiceImpl } from './rough-canvas-service';

export default new ContainerModule(bind => {
    bind(AkariRoughCanvasServiceImpl).toSelf().inSingletonScope();
    bind(AkariRoughCanvasService).toService(AkariRoughCanvasServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_ROUGH_CANVAS_SERVICE_PATH,
            () => context.container.get<AkariRoughCanvasService>(AkariRoughCanvasService))
    ).inSingletonScope();
    bind(AkariAnnotationsServiceImpl).toSelf().inSingletonScope();
    bind(AkariAnnotationsService).toService(AkariAnnotationsServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler<AkariAnnotationsClient>(AKARI_ANNOTATIONS_SERVICE_PATH, client => {
            const service = context.container.get<AkariAnnotationsService>(AkariAnnotationsService);
            service.setClient(client);
            return service;
        })
    ).inSingletonScope();
    bind(AkariTasksServiceImpl).toSelf().inSingletonScope();
    bind(AkariTasksService).toService(AkariTasksServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_TASKS_SERVICE_PATH, () =>
            context.container.get<AkariTasksService>(AkariTasksService))
    ).inSingletonScope();
});
