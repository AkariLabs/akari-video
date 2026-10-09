import { FrontendApplication, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { RAIL_SKILLS_WIDGET_ID } from '../../common/rail-ids';

@injectable()
export class AkariSkillsContribution implements FrontendApplicationContribution {
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;

    async onStart(app: FrontendApplication): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget(RAIL_SKILLS_WIDGET_ID);
        if (!app.shell.getWidgetById(RAIL_SKILLS_WIDGET_ID)) {
            await app.shell.addWidget(widget, { area: 'left', rank: 40 });
        }
    }
}
