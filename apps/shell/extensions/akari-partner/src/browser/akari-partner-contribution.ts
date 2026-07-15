import { inject, injectable } from '@theia/core/shared/inversify';
import {
    ApplicationShell,
    FrontendApplication,
    FrontendApplicationContribution,
    WidgetManager
} from '@theia/core/lib/browser';
import { VSXExtensionsViewContainer } from '@theia/vsx-registry/lib/browser/vsx-extensions-view-container';
import { AkariPartnerWidget } from './akari-partner-widget';
import { AkariPartnerCatalogWidget } from './akari-partner-catalog-widget';

@injectable()
export class AkariPartnerContribution implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    async onStart(app: FrontendApplication): Promise<void> {
        const onboarding = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
        if (!onboarding.isAttached) {
            await app.shell.addWidget(onboarding, { area: 'right', rank: 100 });
        }
        app.shell.activateWidget(onboarding.id);

        const rawOpenVsx = await this.widgetManager.getOrCreateWidget(VSXExtensionsViewContainer.ID);
        rawOpenVsx?.dispose();
        const catalog = await this.widgetManager.getOrCreateWidget<AkariPartnerCatalogWidget>(AkariPartnerCatalogWidget.FACTORY_ID);
        if (!catalog.isAttached) {
            await this.shell.addWidget(catalog, { area: 'left', rank: 300 });
        }
    }
}
