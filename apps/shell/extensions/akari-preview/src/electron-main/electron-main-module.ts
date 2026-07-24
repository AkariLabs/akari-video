import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';
import { AkariPreviewElectronApi } from './electron-api-main';

export default new ContainerModule(bind => {
    bind(AkariPreviewElectronApi).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariPreviewElectronApi);
});
