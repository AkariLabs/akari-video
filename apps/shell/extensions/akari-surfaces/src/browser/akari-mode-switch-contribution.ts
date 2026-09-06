import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry, DisposableCollection, MenuContribution, MenuModelRegistry, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { applyAutonomy } from '../common/intake-autonomy';
import {
    IntakeAutonomy,
    INTAKE_AUTONOMY_DESCRIPTIONS,
    INTAKE_AUTONOMY_LABELS,
    INTAKE_AUTONOMY_ORDER,
    INTAKE_DEFAULT_AUTONOMY
} from '../common/intake-labels';

const MENU_ID = 'akari-mode-switch';
const MENU_PATH = ['akari-mode-switch-menu'];

@injectable()
export class AkariModeSwitchContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {
    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    protected readonly toDispose = new DisposableCollection();
    protected intakeUri: URI | undefined;
    protected refreshVersion = 0;
    protected writing = false;

    onStart(): void {
        this.updateMenu();
        this.toDispose.push(this.workspaceService.onWorkspaceChanged(() => { void this.refreshMenu(); }));
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (this.intakeUri && event.contains(this.intakeUri)) {
                void this.refreshMenu();
            }
        }));
        void this.refreshMenu();
    }

    onStop(): void {
        ++this.refreshVersion;
        this.toDispose.dispose();
        this.shell.rightPanelHandler.removeBottomMenu(MENU_ID);
    }

    registerCommands(registry: CommandRegistry): void {
        for (const autonomy of INTAKE_AUTONOMY_ORDER) {
            registry.registerCommand({
                id: `akari.mode.set.${autonomy}`,
                label: `${INTAKE_AUTONOMY_LABELS[autonomy]} — ${INTAKE_AUTONOMY_DESCRIPTIONS[autonomy]}`
            }, {
                execute: () => this.setAutonomy(autonomy),
                isEnabled: () => !this.writing
            });
        }
    }

    registerMenus(registry: MenuModelRegistry): void {
        INTAKE_AUTONOMY_ORDER.forEach((autonomy, index) => {
            registry.registerMenuAction(MENU_PATH, {
                commandId: `akari.mode.set.${autonomy}`,
                order: String(index)
            });
        });
    }

    protected async resolveIntakeUri(): Promise<URI | undefined> {
        const roots = await this.workspaceService.roots;
        return roots[0]?.resource.resolve('.akari/intake.json');
    }

    protected updateMenu(autonomy?: IntakeAutonomy): void {
        this.shell.rightPanelHandler.removeBottomMenu(MENU_ID);
        this.shell.rightPanelHandler.addBottomMenu({
            id: MENU_ID,
            iconClass: 'codicon codicon-settings',
            title: autonomy ? `進め方: ${INTAKE_AUTONOMY_LABELS[autonomy]}` : '進め方を切り替える',
            menuPath: MENU_PATH,
            order: 0
        });
    }

    protected async refreshMenu(): Promise<void> {
        const version = ++this.refreshVersion;
        let autonomy: IntakeAutonomy | undefined;
        try {
            const uri = await this.resolveIntakeUri();
            if (version !== this.refreshVersion) { return; }
            this.intakeUri = uri;
            if (uri && await this.fileService.exists(uri)) {
                const content = await this.fileService.readFile(uri);
                const parsed = JSON.parse(content.value.toString());
                autonomy = INTAKE_AUTONOMY_ORDER.includes(parsed?.autonomy)
                    ? parsed.autonomy : INTAKE_DEFAULT_AUTONOMY;
            }
        } catch {
            // 読めないファイルは変更せず、切り替え実行時にエラーを通知する。
        }
        if (version === this.refreshVersion) {
            this.updateMenu(autonomy);
        }
    }

    protected async setAutonomy(autonomy: IntakeAutonomy): Promise<void> {
        if (this.writing) { return; }
        this.writing = true;
        try {
            const uri = await this.resolveIntakeUri();
            if (!uri || !await this.fileService.exists(uri)) {
                void this.messages.info('進め方フォームで先に進め方を決めてください');
                return;
            }
            const content = await this.fileService.readFile(uri);
            const next = applyAutonomy(content.value.toString(), autonomy);
            await this.fileService.writeFile(uri, BinaryBuffer.fromString(next));
            await this.refreshMenu();
        } catch (error) {
            void this.messages.error(`進め方を変更できませんでした: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.writing = false;
        }
    }
}
