import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { GENERATION_PICK_INTO_COMMAND_ID, GENERATION_CANCEL_PICK_COMMAND_ID, GenerationPickRequest, GenerationPickResult } from '../common/generation-pick';
import { AkariRoleBucketsWidget } from './akari-role-buckets-widget';
import { AkariProjectModeService } from './akari-project-mode-service';

@injectable()
export class AkariGenerationPickCommandContribution implements CommandContribution {
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(AkariProjectModeService) protected readonly modeService!: AkariProjectModeService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: GENERATION_CANCEL_PICK_COMMAND_ID }, {
            execute: (): void => {
                this.widgetManager.tryGetWidget<AkariRoleBucketsWidget>(AkariRoleBucketsWidget.ID)?.cancelPick();
            }
        });
        registry.registerCommand({ id: GENERATION_PICK_INTO_COMMAND_ID }, {
            execute: async (request: GenerationPickRequest): Promise<GenerationPickResult> => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariRoleBucketsWidget>(AkariRoleBucketsWidget.ID);
                if (!widget.isAttached) {
                    // Match catalog.open: developer mode's left-panel curation closes this widget.
                    if (this.modeService.developerMode) { widget.title.closable = true; }
                    this.shell.addWidget(widget, { area: this.modeService.developerMode ? 'main' : 'left', rank: 100 });
                }
                await this.shell.activateWidget(widget.id);
                return widget.pickInto(request);
            }
        });
    }
}
