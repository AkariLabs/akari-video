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
import { PreferenceSchemaService } from '@theia/core/lib/common/preferences/preference-schema';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { inject, injectable } from '@theia/core/shared/inversify';
import { OPEN_AKARI_DAIHON } from '../akari-transcript-commands';
import { AkariDaihonWidget } from './akari-daihon-widget';
import { AkariTranscribeDialog, listenTranscribeRange, TRANSCRIBE_ENGINE_CARDS, transcribeEngineList } from './akari-transcribe-dialog';
import { AkariEditHistoryService } from 'akari-annotations/lib/browser/akari-edit-history-service';
import { DaihonOpenTarget } from '../../common/daihon-focus-target';
import { setDaihonHistoryService } from '../../common/captions-button';
import { TranscribeConnectionStatus, TranscribeToolStatus } from '../../common/transcribe-steps';

const DAIHON_PANEL_RANK = 190;
export const OPEN_AKARI_CUTS: Command = { id: 'akari.cuts.open', label: 'カットを整える' };
export const AKARI_TRANSCRIBE_OPEN_DIALOG: Command = { id: 'akari.transcribe.openDialog', label: '文字起こしのポップアップを開く' };
export const AKARI_TRANSCRIBE_ENGINES: Command = { id: 'akari.transcribe.engines', label: '文字起こしエンジン一覧' };

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
    @inject(PreferenceSchemaService) protected readonly schemas!: PreferenceSchemaService;

    initialize(): void {
        this.schemas.addSchema({
            properties: {
                'akari.daihon.wordUnit': {
                    type: 'string',
                    enum: ['word', 'token'],
                    default: 'word',
                    description: '台本で選択・操作する単位（単語または認識トークン）'
                },
                'akari.daihon.showBreaks': {
                    type: 'boolean',
                    default: true,
                    description: '台本の本文に自動・手置きの表示区切りを表示する'
                },
                'akari.daihon.showCutMarks': {
                    type: 'boolean', default: true, description: '台本の本文にカット候補の印を表示する'
                },
                'akari.daihon.silenceMin': {
                    type: 'number', default: 0.45, minimum: 0, description: 'カット候補にする無音の長さ（秒）'
                },
                'akari.daihon.silenceKeep': {
                    type: 'number', default: 0.15, minimum: 0, description: '無音カットで残す長さ（秒）'
                },
                'akari.daihon.attachmentMode': {
                    type: 'string',
                    enum: ['all', 'text', 'none'],
                    default: 'all',
                    description: '台本に表示する添付の種類'
                }
            }
        });
    }

    registerCommands(commands: CommandRegistry): void {
        setDaihonHistoryService(this.history);
        commands.registerCommand(OPEN_AKARI_DAIHON, { execute: (target?: DaihonOpenTarget) => this.open(target) });
        commands.registerCommand(OPEN_AKARI_CUTS, { execute: (request?: { candidateId?: string }) => this.openCuts(request) });
        commands.registerCommand(AKARI_TRANSCRIBE_OPEN_DIALOG, {
            execute: (request: { projectRoot: string; relativePath: string; backend?: string; autoStart?: boolean }) => this.openTranscribeDialog(commands, request)
        });
        commands.registerCommand(AKARI_TRANSCRIBE_ENGINES, { execute: async (request: { projectRoot: string }) => {
            if (!request?.projectRoot) throw new Error('プロジェクトが指定されていません');
            const [tools, connections] = await Promise.all([
                commands.executeCommand<{ tools: TranscribeToolStatus[] }>('akari.settings.readStatus', '/services/akari-surfaces-new-project')
                    .then(result => result?.tools ?? [], () => [] as TranscribeToolStatus[]),
                commands.executeCommand<{ providers: TranscribeConnectionStatus[] }>('akari.settings.readStatus', '/services/akari-surfaces-connections')
                    .then(result => result?.providers ?? [], () => [] as TranscribeConnectionStatus[])
            ]);
            return transcribeEngineList(TRANSCRIBE_ENGINE_CARDS, tools, connections, this.preferences.get('akari.transcribe.backend', 'auto'));
        } });
    }

    protected async openTranscribeDialog(commands: CommandRegistry,
        request: { projectRoot: string; relativePath: string; backend?: string; autoStart?: boolean }): Promise<'opened' | 'running' | 'cancelled'> {
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
            }, states[request.relativePath] === 'done', request.autoStart ?? true, request.backend);
        await dialog.open().finally(() => stopListening?.());
        return dialog.wasCancelled ? 'cancelled' : 'opened';
    }

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        return guardInitLayout('akari-transcript', async () => {
            // Layout must finish even when project files or a widget factory are unavailable.
            let daihon: AkariDaihonWidget | undefined;
            try {
                daihon = await this.ensureWidget();
            } catch (error) {
                console.warn('[akari-daihon] layout initialization failed', error);
            }
            for (const widget of [daihon]) {
                if (!widget) continue;
                try {
                    void widget.configure().catch(error => widget.showError(error));
                } catch (error) {
                    widget.showError(error);
                }
            }
        });
    }

    async openCuts(request?: { candidateId?: string }): Promise<boolean> {
        const widget = await this.ensureWidget();
        await this.shell.activateWidget(widget.id);
        return widget.openCutDialog(request);
    }

    async open(target?: DaihonOpenTarget): Promise<boolean> {
        const widget = await this.ensureWidget();
        await this.shell.activateWidget(widget.id);
        return target ? widget.focusTarget(target) : true;
    }

    protected async ensureWidget(): Promise<AkariDaihonWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariDaihonWidget>(AkariDaihonWidget.FACTORY_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'right', rank: DAIHON_PANEL_RANK });
        }
        return widget;
    }
}
