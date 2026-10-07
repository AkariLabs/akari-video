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
    const { NowVibeDockTab, SettingsVibeDockTab, VibeDockTabContributionSymbol, VibeDockTabs } = require('./vibe-dock-tabs');

    @injectable()
    class VibeDockStartup implements FrontendApplicationContribution {
        @inject(RightPanelDockSlot) protected readonly slot!: InstanceType<typeof RightPanelDockSlot>;
        @inject(VibeDockWidget) protected readonly widget!: Widget;
        onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
            return guardInitLayout('akari-vibe-dock', () => { this.slot.attach(this.widget); });
        }
    }

    bind(VibeDockState).toDynamicValue(() => new VibeDockState()).inSingletonScope();
    bind(VibeDockPointing).toSelf().inSingletonScope();
    bind(VibeDockTabs).toSelf().inSingletonScope();
    bindRootContributionProvider(bind, VibeDockTabContributionSymbol);
    bind(NowVibeDockTab).toSelf().inSingletonScope();
    bind(SettingsVibeDockTab).toSelf().inSingletonScope();
    bind(VibeDockTabContributionSymbol).toService(NowVibeDockTab);
    bind(VibeDockTabContributionSymbol).toService(SettingsVibeDockTab);
    bind(VibeDockWidget).toSelf().inSingletonScope();
    bind(VibeDockStartup).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(VibeDockStartup);
});
