import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';
import { AkariProjectElectronApi } from './electron-api-main';

export default new ContainerModule(bind => {
    bind(AkariProjectElectronApi).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariProjectElectronApi);
});
