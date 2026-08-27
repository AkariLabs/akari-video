import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';

import { AkariOsrExportContribution } from './akari-osr-export-contribution';

export default new ContainerModule(bind => {
  bind(AkariOsrExportContribution).toSelf().inSingletonScope();
  bind(ElectronMainApplicationContribution).toService(AkariOsrExportContribution);
});
