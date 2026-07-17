import URI from '@theia/core/lib/common/uri';
import { CommandContribution, CommandRegistry, MessageService } from '@theia/core/lib/common';
import { ApplicationShell, OpenHandler, Widget, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AKARI_TRANSCRIPT_SEEK_REQUESTED, OPEN_AKARI_TRANSCRIPT } from './akari-transcript-commands';
import { AkariTranscriptSeekRequest, AkariTranscriptSeekService } from './akari-transcript-seek-service';
import { AkariTranscriptWidget } from './akari-transcript-widget';

const SKIPPED_DIRECTORIES = new Set(['.git', '.akari', 'node_modules', 'project']);

@injectable()
export class AkariTranscriptContribution implements OpenHandler, CommandContribution {
    readonly id = 'akari-transcript-open-handler';

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(AkariTranscriptSeekService)
    protected readonly seekService: AkariTranscriptSeekService;

    canHandle(uri: URI): number {
        return uri.path.base.toLowerCase().endsWith('.analysis.json') ? 1200 : 0;
    }

    async open(uri: URI, options?: any): Promise<Widget> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariTranscriptWidget>(
            AkariTranscriptWidget.FACTORY_ID,
            { analysisUri: uri.toString() }
        );
        if (!widget.isAttached) {
            this.shell.addWidget(widget, options?.widgetOptions ?? { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(OPEN_AKARI_TRANSCRIPT, {
            execute: () => this.openFirstTranscript()
        });
        commands.registerCommand(AKARI_TRANSCRIPT_SEEK_REQUESTED, {
            execute: (request: AkariTranscriptSeekRequest) => {
                this.seekService.fire(request);
                return false;
            }
        });
    }

    protected async openFirstTranscript(): Promise<void> {
        for (const root of await this.workspaceService.roots) {
            const found = await this.findAnalysis(root.resource);
            if (found) {
                await this.open(found);
                return;
            }
        }
        this.messages.info('文字起こしデータが見つかりません。素材の分析後にもう一度開いてください。');
    }

    protected async findAnalysis(directory: URI): Promise<URI | undefined> {
        let stat: FileStat;
        try {
            stat = await this.fileService.resolve(directory);
        } catch {
            return undefined;
        }
        if (stat.isFile) {
            return stat.resource.path.base.toLowerCase().endsWith('.analysis.json') ? stat.resource : undefined;
        }
        const children = [...(stat.children ?? [])]
            .filter(child => !SKIPPED_DIRECTORIES.has(child.resource.path.base))
            .sort((left, right) => left.resource.toString().localeCompare(right.resource.toString()));
        for (const child of children) {
            const found = await this.findAnalysis(child.resource);
            if (found) {
                return found;
            }
        }
        return undefined;
    }
}
