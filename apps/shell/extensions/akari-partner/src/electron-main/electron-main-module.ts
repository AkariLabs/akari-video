import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';
import { PartnerWebMain } from './partner-web-main';

export default new ContainerModule(bind => {
    bind(PartnerWebMain).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(PartnerWebMain);
});
