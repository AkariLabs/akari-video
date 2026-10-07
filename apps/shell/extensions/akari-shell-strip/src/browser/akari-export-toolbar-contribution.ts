import * as React from '@theia/core/shared/react';
import { ApplicationShell } from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry, CommandService, DisposableCollection, Emitter, MessageService } from '@theia/core/lib/common';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { AkariExportAvailabilityService } from './akari-export-availability-service';
import { AkariExportSessionService } from './akari-export-session-service';
import { AkariExportDialog } from './export-dialog/akari-export-dialog';
import { exportUnavailableReason, exportToolbarState } from '../common/export-toolbar-state';

export const OPEN_EXPORT_DIALOG: Command = { id: 'akari.export.openDialog', label: '書き出し…' };

@injectable()
export class AkariExportToolbarContribution implements CommandContribution, TabBarToolbarContribution {
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(AkariExportAvailabilityService) protected readonly availability!: AkariExportAvailabilityService;
    @inject(AkariExportSessionService) protected readonly exportSession!: AkariExportSessionService;
    @inject(AkariExportDialog) protected readonly exportDialog!: AkariExportDialog;

    protected readonly changed = new Emitter<void>();
    protected readonly toDispose = new DisposableCollection();

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.changed);
        this.toDispose.push(this.availability.onDidChange(() => this.changed.fire()));
        this.toDispose.push(this.exportSession.onDidChange(() => this.changed.fire()));
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(OPEN_EXPORT_DIALOG, { execute: () => this.openExportDialog() });
    }

    protected async openExportDialog(): Promise<void> {
        const availability = await this.availability.refresh();
        const reason = exportUnavailableReason(availability);
        if (!this.exportSession.running && reason) {
            this.messages.info(reason);
            return;
        }
        await this.exportSession.prepareCurrentProject();
        void this.exportDialog.open(false);
    }

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({
            id: 'akari.export.openDialog.toolbar',
            command: OPEN_EXPORT_DIALOG.id,
            group: 'navigation',
            priority: 100,
            isVisible: widget => !!widget && this.shell.getAreaFor(widget) === 'main',
            onDidChange: this.changed.event,
            render: () => this.renderButton()
        });
    }

    protected renderButton(): React.ReactNode {
        const state = exportToolbarState(this.availability.snapshot, this.exportSession.snapshot.status);
        return React.createElement('button', {
            type: 'button',
            className: 'theia-button',
            'data-akari-export-toolbar': 'true',
            disabled: state.disabled,
            title: state.title,
            'aria-label': state.label,
            style: { alignItems: 'center', display: 'inline-flex', gap: '4px', height: '24px',
                margin: '0 4px', padding: '0 8px' },
            onClick: (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                void this.commands.executeCommand(OPEN_EXPORT_DIALOG.id);
            }
        }, React.createElement('span', { className: 'codicon codicon-desktop-download', 'aria-hidden': true }),
        React.createElement('span', undefined, state.label));
    }
}
