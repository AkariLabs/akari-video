import { guardInitLayout } from 'akari-theme/lib/browser/init-layout-guard';
import { FrontendApplication, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { installHomeTabAnchor } from './akari-home-tab-anchor';
import { AkariHomeWidget } from './akari-home-widget';
import { ProjectProgressService } from './home/project-progress';
import { CommandRegistry, CommandService } from '@theia/core/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AKARI_COMMANDS } from 'akari-shell-strip/lib/common/rail-ids';

@injectable()
export class AkariHomeContribution implements FrontendApplicationContribution {
    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;
    @inject(ProjectProgressService) protected readonly progress!: ProjectProgressService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(CommandRegistry) protected readonly registry!: CommandRegistry;

    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        return guardInitLayout('akari-surfaces', async () => {
            const widget = await this.widgetManager.getOrCreateWidget<AkariHomeWidget>(AkariHomeWidget.ID);
            if (!widget.isAttached) {
                app.shell.addWidget(widget, { area: 'main', rank: 10 });
            }
            const anchor = installHomeTabAnchor(app.shell, widget);
            widget.disposed.connect(() => anchor.dispose());
            if (!this.progress) {
                await app.shell.activateWidget(widget.id);
                void Promise.resolve().then(() => widget.start()).catch(error => {
                    console.warn('[akari-surfaces] home start failed', error);
                });
                return;
            }
            void Promise.resolve().then(() => widget.start()).catch(error => {
                console.warn('[akari-surfaces] home start failed', error);
            });
            let presence = this.progress.presence;
            if (!presence) {
                presence = await new Promise(resolve => {
                    let finished = false;
                    const done = (value: typeof presence): void => {
                        if (finished) return;
                        finished = true;
                        clearTimeout(timer);
                        listener.dispose();
                        resolve(value);
                    };
                    const listener = this.progress.onDidChange(value => done(value));
                    const timer = setTimeout(() => done(undefined), 3000);
                    if (this.progress.presence) done(this.progress.presence);
                });
            }
            if (presence?.editHasContent && this.registry.getCommand(AKARI_COMMANDS.previewEnsureVisible)) {
                const root = (await this.workspace.roots)[0]?.resource;
                if (root) {
                    try {
                        await this.commands.executeCommand(AKARI_COMMANDS.previewEnsureVisible, { editUri: root.resolve('edit.json').toString() });
                        return;
                    } catch { /* プレビューが開けないときはホームを前面にする。 */ }
                }
            }
            await app.shell.activateWidget(widget.id);
        });
    }
}
