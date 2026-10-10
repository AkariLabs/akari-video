import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ContainerModule } from '@theia/core/shared/inversify';
import { ChatScreenCaptureMain } from './screen-capture-main';

export default new ContainerModule(bind => {
    bind(ChatScreenCaptureMain).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(ChatScreenCaptureMain);
});
