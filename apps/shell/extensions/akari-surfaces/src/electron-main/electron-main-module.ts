import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';
import { AkariUpdaterElectronMain } from './akari-updater-electron-main';
import { AkariAppearanceElectronMain } from './akari-appearance-electron-main';
import { AkariElectronMainApplication, AkariWindowEventsElectronMain } from './akari-window-events-electron-main';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainApplication).to(AkariElectronMainApplication).inSingletonScope();
    bind(AkariUpdaterElectronMain).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariUpdaterElectronMain);
    bind(AkariAppearanceElectronMain).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariAppearanceElectronMain);
    bind(AkariWindowEventsElectronMain).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariWindowEventsElectronMain);
});
