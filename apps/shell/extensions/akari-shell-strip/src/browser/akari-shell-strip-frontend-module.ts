import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory, FrontendApplication } from '@theia/core/lib/browser';
import { AkariActivityBarCuration } from './akari-activity-bar-curation';
import { AkariSettingsWidget } from './akari-settings-widget';
import { AkariSettingsContribution } from './akari-settings-contribution';
import { AkariMenuCuration } from './akari-menu-curation';
import { AkariFrontendApplication } from './akari-frontend-application';
import { AkariDeveloperModeService } from './akari-developer-mode-service';
import { AkariTerminalMenuCuration } from './akari-terminal-menu-curation';
import { AkariRightPanelCuration } from './akari-right-panel-curation';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    // S15: activity bar curation（起動時一括 + onDidAddWidget 常時フィルタ）
    bind(AkariActivityBarCuration).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariActivityBarCuration);

    // 4番目のアイコン（設定）のプレースホルダー widget
    bind(AkariSettingsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariSettingsWidget.ID,
        createWidget: () => ctx.container.get(AkariSettingsWidget)
    })).inSingletonScope();
    bind(AkariSettingsContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariSettingsContribution);

    // S17: メニューバー消し込み
    bind(AkariMenuCuration).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariMenuCuration);

    // F6/F7: developer mode のリアクティブな表示切替。
    bind(AkariDeveloperModeService).toSelf().inSingletonScope();
    bind(AkariTerminalMenuCuration).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariTerminalMenuCuration);
    bind(AkariRightPanelCuration).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariRightPanelCuration);

    // S18(a): 起動フェイルセーフ（レイアウト復元 try/catch + タイムアウト）
    // S18(b)（Workspace Trust ダイアログ無効化）はコード不要 —
    // package.json の theia.frontend.config.preferences で
    // security.workspace.trust.enabled=false を既定上書き（公式の
    // FrontendConfigPreferenceContribution 経由、Theia 標準の「製品側で
    // 既定プリファレンスを差し替える」正規の拡張点）。
    rebind(FrontendApplication).to(AkariFrontendApplication).inSingletonScope();
});
