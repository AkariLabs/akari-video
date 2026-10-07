/* eslint-disable @typescript-eslint/no-var-requires -- browser bindings load after the module is applied */
import { ContainerModule, inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { Widget } from '@theia/core/shared/@lumino/widgets';

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

    @injectable()
    class VibeDockStartup implements FrontendApplicationContribution {
        @inject(RightPanelDockSlot) protected readonly slot!: InstanceType<typeof RightPanelDockSlot>;
        @inject(VibeDockWidget) protected readonly widget!: Widget;
        onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
            return guardInitLayout('akari-vibe-dock', () => { this.slot.attach(this.widget); });
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
    bind(VibeDockStartup).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(VibeDockStartup);
    bind(RoughCanvasEarBridge).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(RoughCanvasEarBridge);
});
