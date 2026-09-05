import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { AkariColorContribution } from './akari-color-contribution';
import { AkariButtonStyleContribution } from './akari-button-style-contribution';
import { AkariCssVariableForceContribution } from './akari-css-variable-force-contribution';
import { AkariShellCardLayoutContribution } from './akari-shell-card-layout';
import { AkariShellInnerChromeContribution } from './akari-shell-inner-chrome';

export default new ContainerModule(bind => {
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
