import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { AkariMenuWidget, SkillEntry } from './akari-menu-widget';
import { akariMenuRows, AkariMenuRow } from '../common/menu-rows';
import { AkariScopeService } from './akari-scope-service';
import { AkariMenuFocusArgs, readAkariMenuFocusArgs } from '../common/menu-focus';

export const AkariMenuFocusCommands = {
    FOCUS: { id: 'akari.menu.focus', label: 'メニューを開いて節へ移動' } as Command,
    LIST_SKILLS: { id: 'akari.menu.listSkills', label: 'メニューのスキル一覧を返す' } as Command,
    LIST_OPEN_TARGETS: { id: 'akari.menu.listOpenTargets', label: 'メニューの「ひらく」項目の一覧を返す' } as Command
};

@injectable()
export class AkariMenuFocusCommandContribution implements CommandContribution {
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(AkariScopeService) protected readonly scopeService!: AkariScopeService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(AkariMenuFocusCommands.FOCUS, {
            execute: async (raw?: unknown): Promise<boolean> => {
                const args: AkariMenuFocusArgs | undefined = readAkariMenuFocusArgs(raw);
                if (args === undefined) {
                    return false;
                }
                const widget = await this.widgetManager.getOrCreateWidget<AkariMenuWidget>(AkariMenuWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'left', rank: 500 });
                }
                await this.shell.activateWidget(widget.id);
                return widget.focusSection(args);
            }
        });
        registry.registerCommand(AkariMenuFocusCommands.LIST_SKILLS, {
            execute: async (): Promise<SkillEntry[]> => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariMenuWidget>(AkariMenuWidget.ID);
                return widget.listSkills();
            }
        });
        registry.registerCommand(AkariMenuFocusCommands.LIST_OPEN_TARGETS, {
            execute: async (): Promise<Pick<AkariMenuRow, 'id' | 'label'>[]> =>
                akariMenuRows({ worldMap: this.scopeService.worldMap.state === 'present' })
                    .map(row => ({ id: row.id, label: row.label }))
        });
    }
}
