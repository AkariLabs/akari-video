import { FrontendApplication, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariChannelWidget } from './akari-channel-widget';

@injectable()
export class AkariChannelContribution implements FrontendApplicationContribution {
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;

    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        const widget = await this.widgets.getOrCreateWidget<AkariChannelWidget>(AkariChannelWidget.ID);
        if (!widget.isAttached) app.shell.addWidget(widget, { area: 'left', rank: 300 });
    }
}
