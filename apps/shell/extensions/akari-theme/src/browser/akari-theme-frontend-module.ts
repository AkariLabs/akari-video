import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { AkariWebviewWidget } from './akari-webview-widget';
import { AkariColorContribution } from './akari-color-contribution';
import { AkariButtonStyleContribution } from './akari-button-style-contribution';
import { AkariCssVariableForceContribution } from './akari-css-variable-force-contribution';
import { AkariShellCardLayoutContribution } from './akari-shell-card-layout';
import { AkariShellInnerChromeContribution } from './akari-shell-inner-chrome';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // src-gen/frontend/index.js は plugin-ext の後に akari-theme を読み込む。
    rebind(WebviewWidget).to(AkariWebviewWidget);

    bind(AkariColorContribution).toSelf().inSingletonScope();
    bind(ColorContribution).toService(AkariColorContribution);

    bind(AkariButtonStyleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariButtonStyleContribution);

    bind(AkariCssVariableForceContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariCssVariableForceContribution);

    bind(AkariShellCardLayoutContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariShellCardLayoutContribution);

    // カードの外殻の「中身」。外殻より後に読ませる必要はない（両者とも ID 込みの
    // セレクタで書いてあり、重なる箇所は本ファイル側を 2 ID にして勝たせてある）。
    bind(AkariShellInnerChromeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariShellInnerChromeContribution);
});
