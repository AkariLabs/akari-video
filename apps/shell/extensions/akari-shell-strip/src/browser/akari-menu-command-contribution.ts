import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, CommandService } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariSkillCatalogService } from './akari-skill-catalog-service';
import { SkillEntry } from '../common/skill-catalog';
import { AKARI_COMMANDS, RAIL_SKILLS_WIDGET_ID } from '../common/rail-ids';

export const AkariMenuFocusCommands = {
    FOCUS: { id: 'akari.menu.focus', label: 'スキルまたはホームを開く' } as Command,
    LIST_SKILLS: { id: 'akari.menu.listSkills', label: 'スキル一覧を返す' } as Command,
    LIST_OPEN_TARGETS: { id: 'akari.menu.listOpenTargets', label: '旧「ひらく」項目の一覧を返す' } as Command
};

interface FocusArgs { section?: 'open' | 'skills'; pulse?: boolean; skill?: string }
function readFocusArgs(raw: unknown): FocusArgs | undefined {
    if (raw == null) return {};
    if (typeof raw !== 'object') return undefined;
    const { section, pulse, skill } = raw as Record<string, unknown>;
    if (section !== undefined && section !== 'open' && section !== 'skills') return undefined;
    if (pulse !== undefined && typeof pulse !== 'boolean') return undefined;
    if (skill !== undefined && (typeof skill !== 'string' || section !== 'skills')) return undefined;
    return { section, pulse, skill } as FocusArgs;
}

@injectable()
export class AkariMenuFocusCommandContribution implements CommandContribution {
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(AkariSkillCatalogService) protected readonly catalog!: AkariSkillCatalogService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(AkariMenuFocusCommands.FOCUS, {
            execute: async (raw?: unknown): Promise<boolean> => {
                const args = readFocusArgs(raw);
                if (!args) return false;
                if (args.section !== 'skills') {
                    await this.commands.executeCommand(AKARI_COMMANDS.homeOpen);
                    return true;
                }
                const widget = await this.widgetManager.getWidget(RAIL_SKILLS_WIDGET_ID);
                if (!widget) return false;
                await this.shell.revealWidget(RAIL_SKILLS_WIDGET_ID);
                return true;
            }
        });
        registry.registerCommand(AkariMenuFocusCommands.LIST_SKILLS, {
            execute: async (): Promise<SkillEntry[]> => this.catalog.loadSkills((await this.workspace.roots)[0]?.resource)
        });
        registry.registerCommand(AkariMenuFocusCommands.LIST_OPEN_TARGETS, {
            execute: async (): Promise<{ id: string; label: string }[]> => []
        });
    }
}
