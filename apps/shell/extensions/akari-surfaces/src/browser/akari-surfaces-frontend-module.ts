import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';
import {
    FrontendApplicationContribution,
    KeybindingContribution,
    OpenHandler,
    WebSocketConnectionProvider,
    WidgetFactory
} from '@theia/core/lib/browser';
import { WindowTitleContribution } from '@theia/core/lib/browser/window/window-title-service';
import { AkariHomeCommandContribution } from './akari-home-command-contribution';
import { AkariHomeContribution } from './akari-home-contribution';
import { AkariHomeWidget } from './akari-home-widget';
import { AkariProjectLauncherCommandContribution } from './akari-project-launcher-dialog';
import { AkariPreferenceContribution } from './akari-preferences';
import { AkariSettingsWidget } from './akari-settings-widget';
import { AkariSurfaceOpenHandler } from './akari-surface-open-handler';
import { AkariWelcomeWindowTitleContribution } from './akari-welcome-window-title-contribution';
import { AkariNewProjectService, AKARI_NEW_PROJECT_SERVICE_PATH } from '../common/akari-new-project-protocol';

export default new ContainerModule(bind => {
    bind(AkariPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(AkariPreferenceContribution);

    // F5/U5: 専用バックエンドサービスへの RPC プロキシ（akari-project 拡張の既存
    // サービスとパスを共有すると channel 二重 open で恒久ハングするため専用パスにした
    // 経緯は common/akari-new-project-protocol.ts のコメント参照）。
    bind(AkariNewProjectService).toDynamicValue(ctx =>
        WebSocketConnectionProvider.createProxy(ctx.container, AKARI_NEW_PROJECT_SERVICE_PATH)
    ).inSingletonScope();

    // U1（task 2026-08-03-home-v5-terms）: ウィンドウタイトルへ「(<作業場名>)」を
    // 付加していた AkariWindowTitleContribution / AkariCurrentLocationHolder は
    // 「作業場」という語を UI から追放する裁定にあわせて撤去した
    // （旧 F6 の現在地表示は状態バッジ・renderStatusBadge に置き換え済み）。

    bind(AkariHomeWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariHomeWidget.ID,
        createWidget: () => ctx.container.get(AkariHomeWidget)
    })).inSingletonScope();
    bind(AkariHomeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariHomeContribution);

    // v4 ミニマル化（task 2026-08-02-home-v4-minimal）: ホームから撤去した
    // 進め方フォームの開く経路をコマンド 1 個として残す（裁定 R2）。
    // 2026-08-07: File メニューの「新規プロジェクト作成」もここへ寄せたため
    // MenuContribution も同じクラスから供給する。
    bind(AkariHomeCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariHomeCommandContribution);
    bind(MenuContribution).toService(AkariHomeCommandContribution);
    bind(KeybindingContribution).toService(AkariHomeCommandContribution);

    // プロジェクト・ランチャーの手動再表示コマンド（task 2026-08-17-home-launcher-popup・
    // 正本 §3.2「手動再表示」）。ダイアログ自体は akari-project-launcher-dialog.ts が持つ。
    bind(AkariProjectLauncherCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariProjectLauncherCommandContribution);

    // F11（task 2026-08-05-welcome-screen）: 未選択時のウィンドウタイトルを
    // 「AKARI Video」だけにする（実測: Theia 既定の macOS テンプレートのままだと
    // 「ホーム」になってしまう。akari-welcome-window-title-contribution.ts 参照）。
    bind(AkariWelcomeWindowTitleContribution).toSelf().inSingletonScope();
    bind(WindowTitleContribution).toService(AkariWelcomeWindowTitleContribution);

    // akari-shell-strip registers the same factory id for its Wave 0 placeholder.
    // WidgetManager builds a Map in contribution order, so this later registration
    // deliberately overwrites that entry without editing the owner extension.
    bind(AkariSettingsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariSettingsWidget.ID,
        createWidget: () => ctx.container.get(AkariSettingsWidget)
    })).inSingletonScope();

    bind(AkariSurfaceOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariSurfaceOpenHandler);
    bind(FrontendApplicationContribution).toService(AkariSurfaceOpenHandler);
});
