import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariAudioMeterWidget } from './akari-audio-meter-widget';

@injectable()
export class AkariAudioMeterContribution implements CommandContribution {
    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand({
            id: 'akari.preview.openAudioMeter', label: '音声メーターを開く'
        }, { execute: () => this.open() });
    }

    async open(): Promise<AkariAudioMeterWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariAudioMeterWidget>(
            AkariAudioMeterWidget.FACTORY_ID
        );
        if (!widget.isAttached) await this.shell.addWidget(widget, { area: 'right', rank: 220 });
        await this.shell.activateWidget(widget.id);
        return widget;
    }
}
