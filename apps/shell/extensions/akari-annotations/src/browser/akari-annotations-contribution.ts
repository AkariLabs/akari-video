import URI from '@theia/core/lib/common/uri';
import {
    Command,
    CommandContribution,
    CommandRegistry,
    MenuContribution,
    MenuModelRegistry
} from '@theia/core/lib/common';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    ApplicationShell,
    CommonMenus,
    FrontendApplicationContribution,
    WidgetManager
} from '@theia/core/lib/browser';
import { FileChangeType, FileStat } from '@theia/filesystem/lib/common/files';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariAnnotationsWidget } from './akari-annotations-widget';
import { ProjectLocation } from './project-location';

export const OPEN_AKARI_ANNOTATIONS: Command = {
    id: 'akari.annotations.open',
    label: 'タイムラインを開く'
};

const SKIPPED_DIRECTORIES = new Set(['.git', '.akari', 'node_modules']);
const CANONICAL_ANALYSIS_SUFFIX = '.analysis/analysis.json';

@injectable()
export class AkariAnnotationsContribution implements CommandContribution, FrontendApplicationContribution, MenuContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    protected readonly toDispose = new DisposableCollection();

    async onStart(): Promise<void> {
        await this.workspaceService.ready;
        for (const root of await this.workspaceService.roots) {
            await this.watchForReview(root.resource);
        }
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(OPEN_AKARI_ANNOTATIONS, {
            execute: () => this.open()
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: OPEN_AKARI_ANNOTATIONS.id,
            label: OPEN_AKARI_ANNOTATIONS.label,
            order: 'z20'
        });
    }

    protected async watchForReview(root: URI): Promise<void> {
        this.toDispose.push(await this.fileService.watch(root, { recursive: true, excludes: [] }));
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            for (const change of event.changes) {
                if (change.type === FileChangeType.ADDED && change.resource.path.base === 'review.json') {
                    void this.open();
                }
            }
        }));
    }

    async open(): Promise<AkariAnnotationsWidget | undefined> {
        const location = await this.locate();
        if (!location) {
            return undefined;
        }
        const widget = await this.widgetManager.getOrCreateWidget<AkariAnnotationsWidget>(AkariAnnotationsWidget.FACTORY_ID);
        await widget.configure(location);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'bottom' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected async locate(): Promise<ProjectLocation | undefined> {
        const roots = await this.workspaceService.roots;
        for (const root of roots) {
            const analysisUri = await this.findFirstCanonicalAnalysis(root.resource);
            const editUri = await this.findFirstNamed(root.resource, 'edit.json');
            let videoUri = '';
            if (analysisUri) {
                try {
                    const analysis = JSON.parse(await this.readText(analysisUri));
                    videoUri = typeof analysis?.source === 'string'
                        ? analysisUri.parent.resolve(analysis.source).normalizePath().toString()
                        : '';
                } catch {
                    videoUri = '';
                }
            }
            const base = editUri ? editUri.parent : root.resource.resolve('project');
            return {
                root: root.resource,
                analysisUri,
                videoUri,
                editUri,
                captionsUri: base.resolve('captions.json'),
                reviewUri: base.resolve('review.json')
            };
        }
        return undefined;
    }

    protected async findFirstCanonicalAnalysis(root: URI): Promise<URI | undefined> {
        const sidecars = root.resolve('.akari/sidecars');
        let found: URI | undefined;
        const visit = async (directory: URI): Promise<void> => {
            if (found) {
                return;
            }
            let stat: FileStat;
            try {
                stat = await this.fileService.resolve(directory);
            } catch {
                return;
            }
            if (!stat.isDirectory) {
                return;
            }
            if (stat.resource.path.base.toLowerCase().endsWith('.analysis')) {
                const analysisUri = stat.resource.resolve('analysis.json');
                if (await this.fileService.exists(analysisUri)) {
                    const relative = sidecars.relative(analysisUri)?.toString();
                    if (relative?.endsWith(CANONICAL_ANALYSIS_SUFFIX)) {
                        found = analysisUri;
                    }
                }
                return;
            }
            const children = [...(stat.children ?? [])]
                .filter(child => child.isDirectory)
                .sort((left, right) => left.resource.toString().localeCompare(right.resource.toString()));
            for (const child of children) {
                await visit(child.resource);
            }
        };
        await visit(sidecars);
        return found;
    }

    protected async findFirstNamed(directory: URI, name: string): Promise<URI | undefined> {
        let stat: FileStat;
        try {
            stat = await this.fileService.resolve(directory);
        } catch {
            return undefined;
        }
        if (stat.isFile) {
            return stat.resource.path.base === name ? stat.resource : undefined;
        }
        const children = [...(stat.children ?? [])]
            .filter(child => !SKIPPED_DIRECTORIES.has(child.resource.path.base))
            .sort((left, right) => left.resource.toString().localeCompare(right.resource.toString()));
        for (const child of children) {
            const found = await this.findFirstNamed(child.resource, name);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    protected async readText(uri: URI): Promise<string> {
        return (await this.fileService.readFile(uri)).value.toString();
    }
}
