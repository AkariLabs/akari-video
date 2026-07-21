import URI from '@theia/core/lib/common/uri';
import {
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
import {
    ATTACH_AKARI_ANNOTATIONS_PASSIVE,
    OPEN_AKARI_ANNOTATIONS,
    OPEN_AKARI_INSPECTOR,
    OPEN_AKARI_REVIEW_PANEL
} from './akari-annotations-commands';
import { AkariAnnotationsWidget, PreviewPlaybackTick } from './akari-annotations-widget';
import { AkariInspectorWidget } from './akari-inspector-widget';
import { AkariReviewPanelWidget } from './akari-review-panel-widget';
import { ProjectLocation } from './project-location';
import { ReviewModel } from './review-model';

export { OPEN_AKARI_ANNOTATIONS, OPEN_AKARI_INSPECTOR, OPEN_AKARI_REVIEW_PANEL };

const SKIPPED_DIRECTORIES = new Set(['.git', '.akari', 'node_modules']);
const CANONICAL_ANALYSIS_SUFFIX = '.analysis/analysis.json';
// akari-preview 側の PREVIEW_PLAYBACK_TICK_EVENT とミラー。
const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';

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

    @inject(ReviewModel)
    protected readonly review!: ReviewModel;

    protected readonly toDispose = new DisposableCollection();

    /** 自動アタッチの重複判定・dispose 監視の対象として追跡中のタイムライン widget インスタンス。 */
    protected timelineWidget?: AkariAnnotationsWidget;
    /** セッション内でユーザーがタイムラインを明示的に閉じたら true。以降の自動アタッチを抑止する（アプリ再起動でリセット）。 */
    protected timelineDismissedThisSession = false;

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
        commands.registerCommand(OPEN_AKARI_REVIEW_PANEL, {
            execute: () => this.openReviewPanel()
        });
        commands.registerCommand(OPEN_AKARI_INSPECTOR, {
            execute: () => this.openInspectorPanel()
        });
        commands.registerCommand(ATTACH_AKARI_ANNOTATIONS_PASSIVE, {
            execute: () => this.attachPassively()
        });
        const onPlaybackTick = (event: Event): void => {
            const request = (event as CustomEvent<PreviewPlaybackTick>).detail;
            if (request && this.timelineWidget?.canHandlePlaybackTick(request.videoUri)) {
                this.timelineWidget.handlePlaybackTick(request);
            }
        };
        window.addEventListener(PREVIEW_PLAYBACK_TICK_EVENT, onPlaybackTick);
        this.toDispose.push({ dispose: () => window.removeEventListener(PREVIEW_PLAYBACK_TICK_EVENT, onPlaybackTick) });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: OPEN_AKARI_ANNOTATIONS.id,
            label: OPEN_AKARI_ANNOTATIONS.label,
            order: 'z20'
        });
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: OPEN_AKARI_REVIEW_PANEL.id,
            label: OPEN_AKARI_REVIEW_PANEL.label,
            order: 'z21'
        });
    }

    protected async watchForReview(root: URI): Promise<void> {
        this.toDispose.push(await this.fileService.watch(root, { recursive: true, excludes: [] }));
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            for (const change of event.changes) {
                if (change.type === FileChangeType.ADDED && change.resource.path.base === 'review.json') {
                    void this.openReviewPanel();
                }
            }
        }));
    }

    async open(): Promise<AkariAnnotationsWidget | undefined> {
        const widget = await this.attach();
        if (!widget) {
            return undefined;
        }
        // 明示的なオープン操作なので、以前の自動アタッチ抑止状態（セッション内クローズ）は解除する。
        this.timelineDismissedThisSession = false;
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    /**
     * akari-preview の動画オープンから呼ばれる自動アタッチ。フォーカスは奪わない（reveal のみ）。
     * 既にタイムラインが開いていれば何もしない。ユーザーが直近のセッションで明示的に閉じていた
     * 場合も何もしない（アプリ再起動でリセットされる in-memory フラグで判定）。
     * `open()`（コマンドパレット等からの明示オープン）と異なり、edit.json が実在するプロジェクトに限る。
     */
    async attachPassively(): Promise<void> {
        if (this.timelineDismissedThisSession || this.timelineWidget?.isAttached) {
            return;
        }
        const location = await this.locate();
        if (!location?.editUri) {
            return;
        }
        const widget = await this.attachAt(location);
        // bottom パネルが閉じていると addWidget だけでは画面に現れない。
        // reveal はパネル展開のみでフォーカスは移さない（activate との違い）。
        await this.shell.revealWidget(widget.id);
    }

    protected async attach(): Promise<AkariAnnotationsWidget | undefined> {
        const location = await this.locate();
        if (!location) {
            return undefined;
        }
        return this.attachAt(location);
    }

    protected async attachAt(location: ProjectLocation): Promise<AkariAnnotationsWidget> {
        this.review.location = location;
        const widget = await this.widgetManager.getOrCreateWidget<AkariAnnotationsWidget>(AkariAnnotationsWidget.FACTORY_ID);
        this.trackTimelineWidget(widget);
        await widget.configure(location);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'bottom' });
        }
        return widget;
    }

    /** widget インスタンスにつき一度だけ onDidDispose を購読し、セッション内クローズを検知する。 */
    protected trackTimelineWidget(widget: AkariAnnotationsWidget): void {
        if (this.timelineWidget === widget) {
            return;
        }
        this.timelineWidget = widget;
        widget.disposed.connect(() => {
            this.timelineDismissedThisSession = true;
        });
    }

    /**
     * 注釈パネルを右サイドへ開く。データの読み込み主体はタイムライン側なので、
     * 先にタイムラインを構成して ReviewModel を満たしてからパネルを出す。
     */
    async openReviewPanel(): Promise<AkariReviewPanelWidget | undefined> {
        const timeline = await this.open();
        if (!timeline) {
            return undefined;
        }
        const widget = await this.widgetManager.getOrCreateWidget<AkariReviewPanelWidget>(AkariReviewPanelWidget.FACTORY_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'right', rank: 100 });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    /**
     * インスペクターを右サイドへ開く。選択のたびタイムライン側から呼ばれる想定のため、
     * フォーカスは奪わず reveal のみに留める（一度開けば常駐し、内容だけが更新される）。
     */
    async openInspectorPanel(): Promise<AkariInspectorWidget | undefined> {
        const timeline = await this.open();
        if (!timeline) {
            return undefined;
        }
        const widget = await this.widgetManager.getOrCreateWidget<AkariInspectorWidget>(AkariInspectorWidget.FACTORY_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'right', rank: 101 });
        }
        await this.shell.revealWidget(widget.id);
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
