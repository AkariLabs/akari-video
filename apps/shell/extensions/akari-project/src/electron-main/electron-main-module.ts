import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';
import { AkariProjectElectronApi } from './electron-api-main';
import { AssetSiteMain } from './asset-site-main';

export default new ContainerModule(bind => {
    bind(AkariProjectElectronApi).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AkariProjectElectronApi);
    bind(AssetSiteMain).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AssetSiteMain);
});
