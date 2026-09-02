import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory, FrontendApplication, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { AkariQuickExportService, AKARI_QUICK_EXPORT_SERVICE_PATH } from '../common/quick-export-protocol';
import { AkariPreviewServerService, AKARI_PREVIEW_SERVER_SERVICE_PATH } from '../common/preview-server-protocol';
import { AkariActivityBarCuration } from './akari-activity-bar-curation';
import { AkariSettingsWidget } from './akari-settings-widget';
import { AkariSettingsContribution } from './akari-settings-contribution';
import { AkariMenuWidget } from './akari-menu-widget';
import { AkariMenuContribution } from './akari-menu-contribution';
import { AkariMenuCuration } from './akari-menu-curation';
import { AkariFrontendApplication } from './akari-frontend-application';
import { AkariDeveloperModeService } from './akari-developer-mode-service';
import { AkariTerminalMenuCuration } from './akari-terminal-menu-curation';
import { AkariRightPanelCuration } from './akari-right-panel-curation';
import { AkariExportPreferenceContribution } from './akari-export-preferences';
import { AkariExportSessionService } from './akari-export-session-service';
import { AkariExportDialog } from './export-dialog/akari-export-dialog';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    bind(AkariExportPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(AkariExportPreferenceContribution);
    bind(AkariExportSessionService).toSelf().inSingletonScope();
    // ReactDialog 自身の DialogProps コンストラクタ注入を通さず、必要な依存を明示して生成する。
    bind(AkariExportDialog).toDynamicValue(ctx =>
        new AkariExportDialog(ctx.container.get(AkariExportSessionService))
    ).inSingletonScope();

    // 「この場で書き出す」バックエンド（edit-lint / render-cut CLI 直接実行）。
    bind(AkariQuickExportService).toDynamicValue(ctx =>
        WebSocketConnectionProvider.createProxy(ctx.container, AKARI_QUICK_EXPORT_SERVICE_PATH)
    ).inSingletonScope();

    // 「ブラウザプレビュー」バックエンド（preview-server 子プロセス起動・URL 表示）。
    bind(AkariPreviewServerService).toDynamicValue(ctx =>
        WebSocketConnectionProvider.createProxy(ctx.container, AKARI_PREVIEW_SERVER_SERVICE_PATH)
    ).inSingletonScope();

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

    // 5番目のアイコン（メニュー）— 「ひらく」よく使う画面へのショートカットと
    // 「やらせる（スキル）」プロジェクトの .claude/skills 一覧を見せる v0
    bind(AkariMenuWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariMenuWidget.ID,
        createWidget: () => ctx.container.get(AkariMenuWidget)
    })).inSingletonScope();
    bind(AkariMenuContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariMenuContribution);

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
