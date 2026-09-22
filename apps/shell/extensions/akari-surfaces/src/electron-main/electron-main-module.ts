import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';
import { AkariUpdaterElectronMain } from './akari-updater-electron-main';
import { AkariAppearanceElectronMain } from './akari-appearance-electron-main';

export default new ContainerModule(bind => {
    bind(AkariUpdaterElectronMain).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariUpdaterElectronMain);
    bind(AkariAppearanceElectronMain).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariAppearanceElectronMain);
});
