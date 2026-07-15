import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { ContainerModule } from '@theia/core/shared/inversify';
import {
    FrontendApplicationContribution,
    OpenHandler,
    WidgetFactory
} from '@theia/core/lib/browser';
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
