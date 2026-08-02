import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { CommandContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';
import {
    FrontendApplicationContribution,
    OpenHandler,
    WidgetFactory
} from '@theia/core/lib/browser';
import { AkariHomeCommandContribution } from './akari-home-command-contribution';
import { AkariHomeContribution } from './akari-home-contribution';
import { AkariHomeWidget } from './akari-home-widget';
import { AkariPreferenceContribution } from './akari-preferences';
import { AkariSettingsWidget } from './akari-settings-widget';
import { AkariSurfaceOpenHandler } from './akari-surface-open-handler';

export default new ContainerModule(bind => {
    bind(AkariPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(AkariPreferenceContribution);

    bind(AkariHomeWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariHomeWidget.ID,
        createWidget: () => ctx.container.get(AkariHomeWidget)
    })).inSingletonScope();
    bind(AkariHomeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariHomeContribution);

    // v4 ミニマル化（task 2026-08-02-home-v4-minimal）: ホームから撤去した
    // 進め方フォームの開く経路をコマンド 1 個として残す（裁定 R2）。
    bind(AkariHomeCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariHomeCommandContribution);

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
