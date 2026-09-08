import { guardInitLayout } from 'akari-theme/lib/browser/init-layout-guard';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import {
    ApplicationShell,
    FrontendApplication,
    FrontendApplicationContribution,
    WidgetManager
} from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { OPEN_AKARI_DAIHON } from '../akari-transcript-commands';
import { AkariCutsWidget } from './akari-cuts-widget';
import { AkariDaihonWidget } from './akari-daihon-widget';

const DAIHON_PANEL_RANK = 190;
export const OPEN_AKARI_CUTS: Command = { id: 'akari.cuts.open', label: 'カット候補を開く' };

@injectable()
export class AkariDaihonContribution implements CommandContribution, FrontendApplicationContribution {
    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(OPEN_AKARI_DAIHON, { execute: () => this.open() });
        commands.registerCommand(OPEN_AKARI_CUTS, { execute: () => this.openCuts() });
    }

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        return guardInitLayout('akari-transcript', async () => {
            // Layout must finish even when project files or a widget factory are unavailable.
            let daihon: AkariDaihonWidget | undefined;
            let cuts: AkariCutsWidget | undefined;
            try {
                daihon = await this.ensureWidget();
            } catch (error) {
                console.warn('[akari-daihon] layout initialization failed', error);
            }
            try {
                cuts = await this.ensureCutsWidget();
            } catch (error) {
                console.warn('[akari-cuts] layout initialization failed', error);
            }
            // Attach both tabs before starting independent reads; never await configuration here.
            for (const widget of [daihon, cuts]) {
                if (!widget) continue;
                try {
                    void widget.configure().catch(error => widget.showError(error));
                } catch (error) {
                    widget.showError(error);
                }
            }
        });
    }

    async openCuts(): Promise<AkariCutsWidget> {
        const widget = await this.ensureCutsWidget();
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected async ensureCutsWidget(): Promise<AkariCutsWidget> {
        const cuts = await this.widgetManager.getOrCreateWidget<AkariCutsWidget>(AkariCutsWidget.FACTORY_ID);
        if (!cuts.isAttached) this.shell.addWidget(cuts, { area: 'right', rank: DAIHON_PANEL_RANK + 1 });
        return cuts;
    }

    async open(): Promise<AkariDaihonWidget> {
        const widget = await this.ensureWidget();
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected async ensureWidget(): Promise<AkariDaihonWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariDaihonWidget>(AkariDaihonWidget.FACTORY_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'right', rank: DAIHON_PANEL_RANK });
        }
        return widget;
    }
}
