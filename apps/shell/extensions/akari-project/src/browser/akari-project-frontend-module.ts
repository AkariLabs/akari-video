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
import { AkariRoleBucketsWidget } from './akari-role-buckets-widget';
import { AkariCatalogCommandContribution } from './akari-catalog-command-contribution';

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

    // 非開発者モード向けの「素材」差し替えビュー（ロール別ボタン + フラット一覧）。
    // activity bar 上での explorer-view-container との切り替えは
    // akari-shell-strip の AkariActivityBarCuration が担当する。
    bind(AkariRoleBucketsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariRoleBucketsWidget.ID,
        createWidget: () => ctx.container.get(AkariRoleBucketsWidget)
    })).inSingletonScope();

    bind(AkariProjectContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariProjectContribution);
    bind(MenuContribution).toService(AkariProjectContribution);
    bind(FrontendApplicationContribution).toService(AkariProjectContribution);
    bind(TabBarToolbarContribution).toService(AkariProjectContribution);

    // F12（task 2026-08-05-welcome-screen）: コマンドパレット「カタログを開く」。
    // developer mode で消える「＋ カタログから素材をさがす」入口の逃げ道。
    bind(AkariCatalogCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariCatalogCommandContribution);
    bind(PreferenceContribution).toConstantValue({
        schema: {
            type: 'object',
            properties: {
                'akari.developerMode': {
                    type: 'boolean',
                    default: false,
                    description: 'すべてのプロジェクトファイルと詳細情報を表示します。'
                },
                'akari.catalog.root': {
                    type: 'string',
                    default: '',
                    description: 'カタログタブが読むディレクトリ（catalog/ 相当）。' +
                        '未設定のときはリポ開発配置の catalog/ を自動検出します。'
                }
            }
        }
    });
});
