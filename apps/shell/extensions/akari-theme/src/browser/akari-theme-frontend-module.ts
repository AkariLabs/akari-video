import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { AkariColorContribution } from './akari-color-contribution';
import { AkariButtonStyleContribution } from './akari-button-style-contribution';
import { AkariCssVariableForceContribution } from './akari-css-variable-force-contribution';
import { AkariShellCardLayoutContribution } from './akari-shell-card-layout';

export default new ContainerModule(bind => {
    bind(AkariColorContribution).toSelf().inSingletonScope();
    bind(ColorContribution).toService(AkariColorContribution);

    bind(AkariButtonStyleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariButtonStyleContribution);

    bind(AkariCssVariableForceContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariCssVariableForceContribution);

    bind(AkariShellCardLayoutContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariShellCardLayoutContribution);
});
