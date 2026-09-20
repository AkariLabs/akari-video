import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import {
    AkariCompanionService,
    AKARI_COMPANION_SERVICE_PATH
} from '../common/akari-companion-protocol';
import { AkariCompanionClientImpl } from './akari-companion-client';
import { AkariCompanionContribution } from './akari-companion-contribution';
import { AkariCompanionPreferenceContribution } from './akari-companion-preferences';

export default new ContainerModule(bind => {
    bind(AkariCompanionClientImpl).toSelf().inSingletonScope();
    bind(AkariCompanionService).toDynamicValue(context =>
        WebSocketConnectionProvider.createProxy(
            context.container,
            AKARI_COMPANION_SERVICE_PATH,
            context.container.get(AkariCompanionClientImpl)
        )
    ).inSingletonScope();

    bind(AkariCompanionPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(AkariCompanionPreferenceContribution);

    bind(AkariCompanionContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariCompanionContribution);
});
