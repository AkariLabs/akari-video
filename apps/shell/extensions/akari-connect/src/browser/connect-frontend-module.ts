import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common';
import { ConnectService, CONNECT_SERVICE_PATH } from '../common/connect-protocol';
import { ConnectSettingsSection } from './connect-settings-section';
import { SettingsSectionBodyContributionSymbol } from 'akari-surfaces/lib/common/settings-section-body';
import { ConnectContribution } from './connect-contribution';

export default new ContainerModule(bind => {
    bind(ConnectService).toDynamicValue(ctx => WebSocketConnectionProvider.createProxy(ctx.container, CONNECT_SERVICE_PATH)).inSingletonScope();
    bind(ConnectSettingsSection).toSelf().inSingletonScope();
    bind(SettingsSectionBodyContributionSymbol).toService(ConnectSettingsSection);
    bind(ConnectContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ConnectContribution);
    bind(FrontendApplicationContribution).toService(ConnectContribution);
});
