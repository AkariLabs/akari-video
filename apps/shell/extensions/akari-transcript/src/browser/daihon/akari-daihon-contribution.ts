import { guardInitLayout } from 'akari-theme/lib/browser/init-layout-guard';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import {
    ApplicationShell,
    FrontendApplication,
    FrontendApplicationContribution,
    OpenerService,
    WidgetManager
} from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { inject, injectable } from '@theia/core/shared/inversify';
import { OPEN_AKARI_DAIHON } from '../akari-transcript-commands';
import { AkariCutsWidget } from './akari-cuts-widget';
import { AkariDaihonWidget } from './akari-daihon-widget';
import { AkariTranscribeDialog, listenTranscribeRange } from './akari-transcribe-dialog';
import { AkariEditHistoryService } from 'akari-annotations/lib/browser/akari-edit-history-service';
import { setDaihonHistoryService } from '../../common/captions-button';

const DAIHON_PANEL_RANK = 190;
export const OPEN_AKARI_CUTS: Command = { id: 'akari.cuts.open', label: 'カット候補を開く' };
export const AKARI_TRANSCRIBE_OPEN_DIALOG: Command = { id: 'akari.transcribe.openDialog', label: '文字起こしのポップアップを開く' };

@injectable()
export class AkariDaihonContribution implements CommandContribution, FrontendApplicationContribution {
    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;
    @inject(OpenerService) protected readonly opener!: OpenerService;
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(FileService) protected readonly files!: FileService;
    @inject(AkariProjectService) protected readonly projectService!: AkariProjectService;
    @inject(AkariEditHistoryService) protected readonly history!: AkariEditHistoryService;

    registerCommands(commands: CommandRegistry): void {
        setDaihonHistoryService(this.history);
        commands.registerCommand(OPEN_AKARI_DAIHON, { execute: () => this.open() });
        commands.registerCommand(OPEN_AKARI_CUTS, { execute: () => this.openCuts() });
        commands.registerCommand(AKARI_TRANSCRIBE_OPEN_DIALOG, {
            execute: (request: { projectRoot: string; relativePath: string }) => this.openTranscribeDialog(commands, request)
        });
    }

    protected async openTranscribeDialog(commands: CommandRegistry,
        request: { projectRoot: string; relativePath: string }): Promise<'opened' | 'running' | 'cancelled'> {
        if (!request?.projectRoot || !request.relativePath) throw new Error('文字起こし対象が指定されていません');
        const states = await this.projectService.transcriptStates({
            projectRoot: request.projectRoot, relativePaths: [request.relativePath]
        });
        if (states[request.relativePath] === 'running') return 'running';
        const root = new URI(request.projectRoot);
        let stopListening: (() => void) | undefined;
        const dialog = new AkariTranscribeDialog(root, request.relativePath, this.preferences,
            this.projectService, this.files, commands, async (start, end) => {
                stopListening?.();
                stopListening = await listenTranscribeRange(commands, this.shell, this.opener,
                    root.resolve(request.relativePath).normalizePath().toString(), start, end);
                if (dialog.isDisposed) stopListening();
            }, states[request.relativePath] === 'done', true);
        await dialog.open().finally(() => stopListening?.());
        return dialog.wasCancelled ? 'cancelled' : 'opened';
    }

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        return guardInitLayout('akari-transcript', async () => {
            // Layout must finish even when project files or a widget factory are unavailable.
            let daihon: AkariDaihonWidget | undefined;
            let cuts: AkariCutsWidget | undefined;
            try {
                daihon = await this.ensureWidget();
            } catch (error) {
                console.warn('[akari-daihon] layout initialization failed', error);
            }
            try {
                cuts = await this.ensureCutsWidget();
            } catch (error) {
                console.warn('[akari-cuts] layout initialization failed', error);
            }
            // Attach both tabs before starting independent reads; never await configuration here.
            for (const widget of [daihon, cuts]) {
                if (!widget) continue;
                try {
                    void widget.configure().catch(error => widget.showError(error));
                } catch (error) {
                    widget.showError(error);
                }
            }
        });
    }

    async openCuts(): Promise<AkariCutsWidget> {
        const widget = await this.ensureCutsWidget();
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected async ensureCutsWidget(): Promise<AkariCutsWidget> {
        const cuts = await this.widgetManager.getOrCreateWidget<AkariCutsWidget>(AkariCutsWidget.FACTORY_ID);
        if (!cuts.isAttached) this.shell.addWidget(cuts, { area: 'right', rank: DAIHON_PANEL_RANK + 1 });
        return cuts;
    }

    async open(): Promise<AkariDaihonWidget> {
        const widget = await this.ensureWidget();
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected async ensureWidget(): Promise<AkariDaihonWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariDaihonWidget>(AkariDaihonWidget.FACTORY_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'right', rank: DAIHON_PANEL_RANK });
        }
        return widget;
    }
}
