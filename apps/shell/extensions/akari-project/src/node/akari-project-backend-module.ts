import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { DefaultWorkspaceServer } from '@theia/workspace/lib/node/default-workspace-server';
import { AkariProjectService, AKARI_PROJECT_SERVICE_PATH } from '../common/akari-project-protocol';
import { AkariProjectServiceImpl } from './akari-project-service';
import { AkariWorkspaceServer } from './akari-workspace-server';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(AkariProjectServiceImpl).toSelf().inSingletonScope();
    bind(AkariProjectService).toService(AkariProjectServiceImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(AKARI_PROJECT_SERVICE_PATH, () => context.container.get(AkariProjectService))
    ).inSingletonScope();
    // 最近開いたワークスペース台帳の read-modify-write を直列化・原子化する差し替え
    // （理由は akari-workspace-server.ts の頭）。`WorkspaceServer` と
    // `BackendApplicationContribution` は @theia/workspace 側で
    // `DefaultWorkspaceServer` へ toService されているので、ここを差し替えれば両方に効く。
    bind(AkariWorkspaceServer).toSelf().inSingletonScope();
    rebind(DefaultWorkspaceServer).toService(AkariWorkspaceServer);
});
