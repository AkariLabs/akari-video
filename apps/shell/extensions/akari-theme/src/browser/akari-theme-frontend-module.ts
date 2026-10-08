import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { PluginViewRegistry } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-registry';
import { AkariWebviewWidget } from './akari-webview-widget';
import { AkariPluginViewRegistry } from './akari-plugin-view-registry';
import { AkariColorContribution } from './akari-color-contribution';
import { AkariButtonStyleContribution } from './akari-button-style-contribution';
import { AkariCssVariableForceContribution } from './akari-css-variable-force-contribution';
import { AkariShellCardLayoutContribution } from './akari-shell-card-layout';
import { AkariShellInnerChromeContribution } from './akari-shell-inner-chrome';
import { NotificationManager } from '@theia/messages/lib/browser/notifications-manager';
import { NotificationsRenderer } from '@theia/messages/lib/browser/notifications-renderer';
import { NotificationsContribution } from '@theia/messages/lib/browser/notifications-contribution';
import { AkariNotificationManager } from './akari-notification-manager';
import { AkariNotificationsRenderer } from './akari-notifications-renderer';
import { AkariNotificationsContribution } from './akari-notifications-contribution';
import { AkariNotificationStyleContribution } from './akari-notification-style-contribution';
import { AkariScopeGroundContribution } from './akari-scope-ground';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // src-gen/frontend/index.js は plugin-ext の後に akari-theme を読み込む。
    rebind(WebviewWidget).to(AkariWebviewWidget);
    // @theia/messages is a package dependency, so its frontend module is loaded first.
    rebind(NotificationManager).to(AkariNotificationManager).inSingletonScope();
    rebind(NotificationsRenderer).to(AkariNotificationsRenderer).inSingletonScope();
    rebind(NotificationsContribution).to(AkariNotificationsContribution).inSingletonScope();
    bind(AkariNotificationStyleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariNotificationStyleContribution);
    rebind(PluginViewRegistry).to(AkariPluginViewRegistry).inSingletonScope();

    bind(AkariColorContribution).toSelf().inSingletonScope();
    bind(ColorContribution).toService(AkariColorContribution);

    bind(AkariButtonStyleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariButtonStyleContribution);

    bind(AkariCssVariableForceContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariCssVariableForceContribution);
    bind(AkariScopeGroundContribution).toSelf().inSingletonScope(); bind(FrontendApplicationContribution).toService(AkariScopeGroundContribution);

    bind(AkariShellCardLayoutContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariShellCardLayoutContribution);

    // カードの外殻の「中身」。外殻より後に読ませる必要はない（両者とも ID 込みの
    // セレクタで書いてあり、重なる箇所は本ファイル側を 2 ID にして勝たせてある）。
    bind(AkariShellInnerChromeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariShellInnerChromeContribution);
    bind(CommandContribution).toService(AkariShellInnerChromeContribution);
});
