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
html, body { background-color: var(--akari-loading-ground, #0b1222) !important; }
.theia-preload { background-color: var(--akari-loading-ground, #0b1222) !important; }
body[data-akari-scope] #theia-app-shell,
body[data-akari-scope] #theia-left-right-split-panel,
body[data-akari-scope] #theia-bottom-split-panel,
body[data-akari-scope] #theia-top-panel {
    transition: background-color 350ms ease;
}`;

@injectable()
export class AkariScopeGroundContribution implements FrontendApplicationContribution {
    onStart(): void {
        const updateGround = (): void => {
            const scope = document.body.dataset.akariScope === 'project' ? 'project'
                : document.body.dataset.akariScope === 'channel' ? 'channel'
                    : window.localStorage.getItem('akari.ground.scope') === 'project' ? 'project' : 'channel';
            const theme = document.body.classList.contains('theia-light') ? 'light'
                : document.body.classList.contains('theia-dark') ? 'dark'
                    : window.localStorage.getItem('akari.ground.theme') === 'light' ? 'light' : 'dark';
            window.localStorage.setItem('akari.ground.scope', scope);
            window.localStorage.setItem('akari.ground.theme', theme);
            const palette = theme === 'light' ? LIGHT : DARK;
            const color = scope === 'project' ? palette.groundProject : palette.groundChannel;
            document.documentElement.style.setProperty('--akari-loading-ground', color);
            const core = (window as unknown as { electronTheiaCore?: { setBackgroundColor(color: string): void } }).electronTheiaCore;
            core?.setBackgroundColor(color);
        };
        const storedScope = window.localStorage.getItem('akari.ground.scope');
        const storedTheme = window.localStorage.getItem('akari.ground.theme');
        const palette = storedTheme === 'light' ? LIGHT : DARK;
        document.documentElement.style.setProperty('--akari-loading-ground', storedScope === 'project' ? palette.groundProject : palette.groundChannel);
        if (document.getElementById('akari-scope-ground')) { return; }
        const style = document.createElement('style');
        style.id = 'akari-scope-ground';
        style.textContent = AKARI_SCOPE_GROUND_CSS;
        document.head.appendChild(style);
        new MutationObserver(updateGround).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-akari-scope'] });
        updateGround();
    }
}
