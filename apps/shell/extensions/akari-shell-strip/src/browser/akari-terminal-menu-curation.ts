import { inject, injectable } from '@theia/core/shared/inversify';
import { CommonMenus, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Disposable, MenuModelRegistry } from '@theia/core/lib/common';
import { TerminalCommands } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { AkariDeveloperModeService } from './akari-developer-mode-service';

/** F6: developer mode の間だけ、既存 terminal:new command への導線を File に出す。 */
@injectable()
export class AkariTerminalMenuCuration implements FrontendApplicationContribution {

    @inject(MenuModelRegistry)
    protected readonly menus!: MenuModelRegistry;

    @inject(AkariDeveloperModeService)
    protected readonly developerMode!: AkariDeveloperModeService;

    protected terminalMenuItem: Disposable | undefined;

    onStart(): void {
        this.reconcile();
        this.developerMode.onDidChange(() => this.reconcile());
    }

    protected reconcile(): void {
        if (this.developerMode.isEnabled) {
            if (!this.terminalMenuItem) {
                this.terminalMenuItem = this.menus.registerMenuAction(CommonMenus.FILE_NEW, {
                    commandId: TerminalCommands.NEW.id,
                    label: '新しいターミナル',
                    order: 'z_terminal'
                });
                console.info('[akari-shell-strip] developer terminal menu item shown:', TerminalCommands.NEW.id);
            }
            return;
        }

        if (this.terminalMenuItem) {
            this.terminalMenuItem.dispose();
            this.terminalMenuItem = undefined;
            console.info('[akari-shell-strip] developer terminal menu item hidden:', TerminalCommands.NEW.id);
        }
    }
}
