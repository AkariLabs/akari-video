import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { interfaces } from '@theia/core/shared/inversify';
import { RAIL_SKILLS_WIDGET_ID } from '../common/rail-ids';
import { AkariSkillsContribution } from './skills/akari-skills-contribution';
import { AkariSkillsWidget } from './skills/akari-skills-widget';

export function bindSkillsPanel(bind: interfaces.Bind): void {
    bind(AkariSkillsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: RAIL_SKILLS_WIDGET_ID,
        createWidget: () => ctx.container.get(AkariSkillsWidget)
    })).inSingletonScope();
    bind(AkariSkillsContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariSkillsContribution);
}
