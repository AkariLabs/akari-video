import { ApplicationShell, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AssetSiteWidget } from './asset-site-widget';

export const BROWSER_REQUEST_OPEN_EVENT = 'akari.browser.requestOpen';

@injectable()
export class BrowserOpenListener implements FrontendApplicationContribution {
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    private readonly handle = (): void => { void this.open(); };

    onStart(): void { window.addEventListener(BROWSER_REQUEST_OPEN_EVENT, this.handle); }
    onStop(): void { window.removeEventListener(BROWSER_REQUEST_OPEN_EVENT, this.handle); }

    async open(): Promise<void> {
        const widget = await this.widgets.getOrCreateWidget<AssetSiteWidget>(AssetSiteWidget.ID);
        if (!widget.isAttached) this.shell.addWidget(widget, { area: 'main' });
        await this.shell.activateWidget(widget.id);
        await widget.openEmptyBrowser();
    }
}
