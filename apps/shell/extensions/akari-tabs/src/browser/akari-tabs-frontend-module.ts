import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { AkariTabsContribution } from './akari-tabs-contribution';

export default new ContainerModule(bind => {
    bind(AkariTabsContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariTabsContribution);
    bind(TabBarDecorator).toService(AkariTabsContribution);
});
