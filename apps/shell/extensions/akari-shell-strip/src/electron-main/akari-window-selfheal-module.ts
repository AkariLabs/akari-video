import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';
import { AkariDockMenu } from './akari-dock-menu';
import { AkariWindowSelfHeal } from './akari-window-selfheal';

export default new ContainerModule(bind => {
    bind(AkariWindowSelfHeal).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariWindowSelfHeal);

    bind(AkariDockMenu).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariDockMenu);
});
