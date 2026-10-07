import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { TaskService, type NewTask } from './task-service';

@injectable()
export class TaskCommands implements CommandContribution {
    @inject(TaskService) protected readonly tasks!: TaskService;
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;

    registerCommands(registry: CommandRegistry): void {
        const add = (name: string, execute: (...args: any[]) => unknown) =>
            registry.registerCommand({ id: `akari.tasks.${name}` }, { execute });
        add('create', (input: NewTask) => this.tasks.create(input));
        add('summary', () => this.tasks.summary());
        add('nextRows', () => this.tasks.nextRows());
        add('send', (input: { ids: string[] }) => this.tasks.send(input.ids));
        add('dismiss', (input: { id: string }) => this.tasks.dismiss(input.id));
        add('confirm', (input: { id: string }) => this.tasks.confirm(input.id));
        add('markPasted', (input: { id: string }) => this.tasks.markPasted(input.id));
        add('openBoard', async () => {
            const widget = await this.widgets.getOrCreateWidget('akari-task-board-widget');
            if (!widget.isAttached) await this.shell.addWidget(widget, { area: 'main' });
            await this.shell.activateWidget(widget.id);
        });
    }
}
