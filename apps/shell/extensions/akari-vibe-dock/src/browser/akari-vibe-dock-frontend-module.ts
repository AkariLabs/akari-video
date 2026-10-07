/* eslint-disable @typescript-eslint/no-var-requires -- browser bindings load after the module is applied */
import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import type { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { Widget } from '@theia/core/shared/@lumino/widgets';
import { isVibePreviewEnabled } from '../common/vibe-preview';

export default new ContainerModule(bind => {
    // Browser-only widgets are loaded when Theia applies the module, so importing this module
    // for static checks does not require a document.
    const { FrontendApplicationContribution } = require('@theia/core/lib/browser');
    const { bindRootContributionProvider } = require('@theia/core/lib/common/contribution-provider');
    const { RightPanelDockSlot } = require('akari-shell-strip/lib/browser/right-panel-dock-slot');
    const { guardInitLayout } = require('akari-theme/lib/browser/init-layout-guard');
    const { VibeDockState } = require('../common/vibe-dock-state');
    const { VibeDockPointing } = require('./vibe-dock-pointing');
    const { VibeDockWidget } = require('./vibe-dock-widget');
    const { PreferenceContribution } = require('@theia/core/lib/common/preferences');
    const { SettingsSectionBodyContributionSymbol } = require('akari-surfaces/lib/common/settings-section-body');
    const { ListeningPreferenceContribution, VibeModeMigration } = require('./listening-preferences');
    const { ListeningSettingsSection } = require('./listening-settings-section');
    const { NowVibeDockTab, SettingsVibeDockTab, VibeDockTabContributionSymbol, VibeDockTabs } = require('./vibe-dock-tabs');
    const { RoughCanvasDockTab } = require('./rough-canvas-dock-tab');
    const { RoughCanvasEarBridge } = require('./rough-canvas-ear-bridge');
    const { TaskifyJobsBridge } = require('./taskify-jobs-bridge');

    class VibeDockStartup implements FrontendApplicationContribution {
        constructor(protected readonly container: interfaces.Container) {}
        onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
            if (!isVibePreviewEnabled(window.localStorage)) return Promise.resolve();
            return guardInitLayout('akari-vibe-dock', () => {
                this.container.get<InstanceType<typeof RightPanelDockSlot>>(RightPanelDockSlot)
                    .attach(this.container.get<Widget>(VibeDockWidget));
            });
        }
    }

    bind(VibeDockState).toDynamicValue(() => new VibeDockState()).inSingletonScope();
    bind(ListeningPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(ListeningPreferenceContribution);
    bind(VibeModeMigration).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(VibeModeMigration);
    bind(ListeningSettingsSection).toSelf().inSingletonScope();
    bind(SettingsSectionBodyContributionSymbol).toService(ListeningSettingsSection);
    bind(VibeDockPointing).toSelf().inSingletonScope();
    bind(VibeDockTabs).toSelf().inSingletonScope();
    bindRootContributionProvider(bind, VibeDockTabContributionSymbol);
    bind(NowVibeDockTab).toSelf().inSingletonScope();
    bind(SettingsVibeDockTab).toSelf().inSingletonScope();
    bind(RoughCanvasDockTab).toSelf().inSingletonScope();
    bind(VibeDockTabContributionSymbol).toService(NowVibeDockTab);
    bind(VibeDockTabContributionSymbol).toService(SettingsVibeDockTab);
    bind(VibeDockTabContributionSymbol).toService(RoughCanvasDockTab);
    bind(VibeDockWidget).toSelf().inSingletonScope();
    bind(VibeDockStartup).toDynamicValue(context => new VibeDockStartup(context.container)).inSingletonScope();
    bind(FrontendApplicationContribution).toService(VibeDockStartup);
    bind(RoughCanvasEarBridge).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(RoughCanvasEarBridge);
    bind(TaskifyJobsBridge).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TaskifyJobsBridge);
    if (isVibePreviewEnabled(window.localStorage)) require('./jev-frontend-module').bindJev(bind);
});
