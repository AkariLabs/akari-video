import { guardInitLayout } from 'akari-theme/lib/browser/init-layout-guard';
import { FrontendApplication, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { installHomeTabAnchor } from './akari-home-tab-anchor';
import { AkariHomeWidget } from './akari-home-widget';

@injectable()
export class AkariHomeContribution implements FrontendApplicationContribution {
    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        return guardInitLayout('akari-surfaces', async () => {
            const widget = await this.widgetManager.getOrCreateWidget<AkariHomeWidget>(AkariHomeWidget.ID);
            if (!widget.isAttached) {
                app.shell.addWidget(widget, { area: 'main', rank: 10 });
            }
            const anchor = installHomeTabAnchor(app.shell, widget);
            widget.disposed.connect(() => anchor.dispose());
            await app.shell.activateWidget(widget.id);
            void Promise.resolve().then(() => widget.start()).catch(error => {
                console.warn('[akari-surfaces] home start failed', error);
            });
        });
    }
}
