import { t } from '../common/project-text';
import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, CommandService, MenuContribution, MessageService } from '@theia/core/lib/common';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import {
    FrontendApplicationContribution,
    LabelProviderContribution,
    WebSocketConnectionProvider,
    WidgetFactory
} from '@theia/core/lib/browser';
import { FileNavigatorFilter } from '@theia/navigator/lib/browser/navigator-filter';
import { AkariProjectService, AKARI_PROJECT_SERVICE_PATH } from '../common/akari-project-protocol';
import { AkariProjectContribution } from './akari-project-contribution';
import { AkariProjectModeService } from './akari-project-mode-service';
import { AkariWorkflowService } from './akari-workflow-service';
import { AkariFileNavigatorFilter } from './akari-file-navigator-filter';
import { AkariRoleLabelProvider } from './akari-role-label-provider';
import { AkariAssetInspector } from './akari-asset-inspector';
import { AkariRoleBucketsWidget } from './akari-role-buckets-widget';
import { AkariGenerationPickCommandContribution } from './akari-generation-pick-command-contribution';
import { AkariCatalogCommandContribution } from './akari-catalog-command-contribution';
import { AssetSiteWidget } from './asset-site-widget';
import { AssetSiteCommands } from './asset-site-commands';
import { BrowserCommands } from './browser-commands';
import { BrowserPreferences } from './browser-preferences';
import { BrowserHostGuardContribution } from './browser-host-guard-contribution';
import { BrowserOpenListener } from './browser-open-listener';
import { ShapeShelfService } from './shape-shelf-service';
import { LintResultsDialog } from './lint-results-dialog';
import { HandoffProvider } from './handoff-provider';
import { ScratchCommands } from './scratch-commands';
import { ActionHistoryWidget } from './action-history-widget';
import { AutomationGateBand } from './automation-gate-band';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(AkariProjectService).toDynamicValue(ctx =>
        WebSocketConnectionProvider.createProxy(ctx.container, AKARI_PROJECT_SERVICE_PATH)
    ).inSingletonScope();

    bind(AkariProjectModeService).toSelf().inSingletonScope();
    bind(AkariWorkflowService).toSelf().inSingletonScope();
    bind(HandoffProvider).toSelf().inSingletonScope();
    bind(ScratchCommands).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ScratchCommands);
    bind(CommandContribution).toService(HandoffProvider);
    bind(FrontendApplicationContribution).toService(HandoffProvider);
    bind(LintResultsDialog).toDynamicValue(ctx =>
        new LintResultsDialog(ctx.container.get(CommandService), ctx.container.get(MessageService))
    ).inSingletonScope();
    bind(FrontendApplicationContribution).toService(LintResultsDialog);

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
    bind(ActionHistoryWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ActionHistoryWidget.ID,
        createWidget: () => ctx.container.get(ActionHistoryWidget)
    })).inSingletonScope();
    bind(AutomationGateBand).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AutomationGateBand);

    // F12（task 2026-08-05-welcome-screen）: コマンドパレット「カタログを開く」。
    // developer mode で消える「＋ カタログから素材をさがす」入口の逃げ道。
    bind(AkariGenerationPickCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariGenerationPickCommandContribution);
    bind(AkariCatalogCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariCatalogCommandContribution);
    bind(AssetSiteWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: AssetSiteWidget.ID,
        createWidget: () => ctx.container.get(AssetSiteWidget) })).inSingletonScope();
    bind(AssetSiteCommands).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AssetSiteCommands);
    bind(BrowserCommands).toSelf().inSingletonScope();
    bind(CommandContribution).toService(BrowserCommands);
    bind(PreferenceContribution).toConstantValue(BrowserPreferences);
    bind(BrowserHostGuardContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(BrowserHostGuardContribution);
    bind(BrowserOpenListener).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(BrowserOpenListener);
    bind(ShapeShelfService).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ShapeShelfService);
    bind(FrontendApplicationContribution).toService(ShapeShelfService);
    bind(PreferenceContribution).toConstantValue({
        schema: {
            type: 'object',
            properties: {
                'akari.developerMode': {
                    type: 'boolean',
                    default: false,
                    description: t('project.workspace.preference.showAllProjectFilesDetailsAction')
                },
                'akari.catalog.root': {
                    type: 'string',
                    default: '',
                    description: t('project.workspace.preference.directoryReadCatalogTabEquivalentCatalogMessage') +
                        t('project.workspace.preference.ifUnsetCatalogDevelopmentRepositoryIsMessage')
                }
            }
        }
    });
});
