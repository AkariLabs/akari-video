import { FrontendApplication, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariHomeWidget } from './akari-home-widget';

@injectable()
export class AkariHomeContribution implements FrontendApplicationContribution {
    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariHomeWidget>(AkariHomeWidget.ID);
        await widget.start();
        if (!widget.isAttached) {
            app.shell.addWidget(widget, { area: 'main', rank: 10 });
        }
        await app.shell.activateWidget(widget.id);
    }
}
