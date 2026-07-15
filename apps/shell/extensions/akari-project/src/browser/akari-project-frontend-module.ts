import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import {
    FrontendApplicationContribution,
    LabelProviderContribution,
    WebSocketConnectionProvider,
    WidgetFactory
} from '@theia/core/lib/browser';
import { FileNavigatorFilter } from '@theia/navigator/lib/browser/navigator-filter';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { AkariProjectService, AKARI_PROJECT_SERVICE_PATH } from '../common/akari-project-protocol';
import { AkariProjectContribution } from './akari-project-contribution';
import { AkariProjectModeService } from './akari-project-mode-service';
import { AkariWorkflowService } from './akari-workflow-service';
import { AkariFileNavigatorFilter } from './akari-file-navigator-filter';
import { AkariRoleLabelProvider } from './akari-role-label-provider';
import { AkariAssetInspector } from './akari-asset-inspector';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(AkariProjectService).toDynamicValue(ctx =>
        WebSocketConnectionProvider.createProxy(ctx.container, AKARI_PROJECT_SERVICE_PATH)
    ).inSingletonScope();

    bind(AkariProjectModeService).toSelf().inSingletonScope();
    bind(AkariWorkflowService).toSelf().inSingletonScope();

    rebind(FileNavigatorFilter).to(AkariFileNavigatorFilter).inSingletonScope();
    bind(AkariRoleLabelProvider).toSelf().inSingletonScope();
    bind(LabelProviderContribution).toService(AkariRoleLabelProvider);

    bind(AkariAssetInspector).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariAssetInspector.ID,
        createWidget: () => ctx.container.get(AkariAssetInspector)
    })).inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariAssetInspector);

    bind(AkariProjectContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariProjectContribution);
    bind(MenuContribution).toService(AkariProjectContribution);
    bind(FrontendApplicationContribution).toService(AkariProjectContribution);
    bind(TabBarToolbarContribution).toService(AkariProjectContribution);
    bind(PreferenceContribution).toConstantValue({
        schema: {
            type: 'object',
            properties: {
                'akari.developerMode': {
                    type: 'boolean',
                    default: false,
                    description: 'すべてのプロジェクトファイルと詳細情報を表示します。'
                }
            }
        }
    });
});
