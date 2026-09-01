import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import {
    ApplicationShell,
    FrontendApplication,
    FrontendApplicationContribution,
    WidgetManager
} from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { OPEN_AKARI_DAIHON } from '../akari-transcript-commands';
import { AkariDaihonWidget } from './akari-daihon-widget';

const DAIHON_PANEL_RANK = 190;

@injectable()
export class AkariDaihonContribution implements CommandContribution, FrontendApplicationContribution {
    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(OPEN_AKARI_DAIHON, { execute: () => this.open() });
    }

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        await this.ensureWidget();
    }

    async open(): Promise<AkariDaihonWidget> {
        const widget = await this.ensureWidget();
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected async ensureWidget(): Promise<AkariDaihonWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariDaihonWidget>(AkariDaihonWidget.FACTORY_ID);
        await widget.configure();
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'right', rank: DAIHON_PANEL_RANK });
        }
        return widget;
    }
}
