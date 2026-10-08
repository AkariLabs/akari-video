import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DARK, LIGHT } from './akari-theme-tokens';

export const AKARI_SCOPE_GROUND_CSS = [
    ['theia-light', LIGHT], ['theia-dark', DARK]
].map(([theme, palette]) => {
    const colors = palette as typeof DARK;
    return (['channel', 'project'] as const).map(scope => {
        const ground = scope === 'channel' ? colors.groundChannel : colors.groundProject;
        const bar = scope === 'channel' ? colors.barChannel : colors.barProject;
        return `body.${theme}[data-akari-scope="${scope}"] {
    --akari-ground: ${ground};
    --theia-titleBar-activeBackground: ${bar};
    --theia-titleBar-inactiveBackground: ${bar};
}`;
    }).join('\n');
}).join('\n') + `
body[data-akari-scope] #theia-app-shell,
body[data-akari-scope] #theia-left-right-split-panel,
body[data-akari-scope] #theia-bottom-split-panel,
body[data-akari-scope] #theia-top-panel {
    transition: background-color 350ms ease;
}`;

@injectable()
export class AkariScopeGroundContribution implements FrontendApplicationContribution {
    onStart(): void {
        if (document.getElementById('akari-scope-ground')) { return; }
        const style = document.createElement('style');
        style.id = 'akari-scope-ground';
        style.textContent = AKARI_SCOPE_GROUND_CSS;
        document.head.appendChild(style);
    }
}
