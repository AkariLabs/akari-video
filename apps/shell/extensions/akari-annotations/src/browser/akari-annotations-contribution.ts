import URI from '@theia/core/lib/common/uri';
import {
    CommandContribution,
    CommandRegistry,
    MenuContribution,
    MenuModelRegistry,
    MessageService
} from '@theia/core/lib/common';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    ApplicationShell,
    CommonMenus,
    FrontendApplication,
    FrontendApplicationContribution,
    WidgetManager
} from '@theia/core/lib/browser';
import { FileChangeType, FileStat } from '@theia/filesystem/lib/common/files';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    ADD_MATERIAL_AT_PLAYHEAD,
    ATTACH_AKARI_ANNOTATIONS_PASSIVE,
    OPEN_AKARI_ANNOTATIONS,
    OPEN_AKARI_CANVAS,
    OPEN_AKARI_INSPECTOR,
    OPEN_AKARI_REVIEW_BOARD,
    OPEN_AKARI_REVIEW_PANEL,
    SELECT_DOC_BLOCK,
    SELECT_IMAGE_BLOCK
} from './akari-annotations-commands';
import { Annotation } from '../common/akari-annotations-protocol';
import { parseDocTarget } from '../common/doc-target';
import { AkariCanvasDialog } from './akari-canvas-dialog';
import { AkariImageAnnotationDialog } from './akari-image-annotation-dialog';
import { AkariAnnotationsWidget, PreviewPlaybackTick } from './akari-annotations-widget';
import { AkariInspectorWidget } from './akari-inspector-widget';
import { AkariReviewBoardWidget } from './akari-review-board-widget';
import { AkariReviewPanelWidget } from './akari-review-panel-widget';
import { ProjectLocation } from './project-location';
import { installRightPanelTabStyle } from './right-panel-tab-style';
import { ReviewModel } from './review-model';

export { OPEN_AKARI_ANNOTATIONS, OPEN_AKARI_CANVAS, OPEN_AKARI_INSPECTOR, OPEN_AKARI_REVIEW_BOARD, OPEN_AKARI_REVIEW_PANEL };

/** キャンバスのアスペクトが取れない場合の既定値（task.md 指示 1）。 */
const DEFAULT_CANVAS_ASPECT = { w: 1920, h: 1080 };

// ドットディレクトリ（.git/.akari/.claude 等）と node_modules は名前探索の対象外。
// スキル同梱の開発用フィクスチャ（.claude/skills/**/dev-fixtures/）を拾わないための除外。
const isSkippedSearchDirectory = (name: string): boolean => name.startsWith('.') || name === 'node_modules';
const CANONICAL_ANALYSIS_SUFFIX = '.analysis/analysis.json';
// akari-preview 側の PREVIEW_PLAYBACK_TICK_EVENT とミラー。
const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';
const PREVIEW_OVERLAY_SELECTED_EVENT = 'akari.preview.overlaySelected';
// akari-preview 側の PREVIEW_LAYER_SELECTED_EVENT とミラー（CF-select）。
const PREVIEW_LAYER_SELECTED_EVENT = 'akari.preview.layerSelected';

// akari-annotations-widget.ts の同名定数とミラー（拡張内で完結させ、他拡張への npm 依存を作らない）。
const PARTNER_WIDGET_ID = 'akari-partner-onboarding';
// 縦アイコンバー固定配置（task.md 指示2）: 注釈を AI とインスペクターの間の rank に置く。
const REVIEW_PANEL_RANK = 150;
const INSPECTOR_PANEL_RANK = 200;
// Theia の SidePanelHandler.setLayoutData()（node_modules/@theia/core 実装を実測）は保存済み
// レイアウトのタブ順をそのまま tabBar.addTab() で再生するだけで、rank による再ソートをしない。
// そのため rank 指定だけでは、注釈タブを知らない古い保存済みレイアウトを持つ既存ユーザーで
// 並びが崩れる（reconcileRightPanelOrder で起動のたびに明示的に揃え直す）。
const RIGHT_PANEL_FIXED_ORDER: readonly string[] = [
    PARTNER_WIDGET_ID,
    AkariReviewPanelWidget.FACTORY_ID,
    AkariInspectorWidget.FACTORY_ID
];

interface PreviewOverlaySelection {
    videoUri?: string;
    overlayId?: string | null;
}

interface PreviewLayerSelection {
    editUri?: string;
    layerId?: string | null;
}

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

    @inject(FileDialogService)
    protected readonly fileDialogService!: FileDialogService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    protected readonly toDispose = new DisposableCollection();

    /** 自動アタッチの重複判定・dispose 監視の対象として追跡中のタイムライン widget インスタンス。 */
    protected timelineWidget?: AkariAnnotationsWidget;
    /** ワークスペースと edit.json の配置はセッション中不変として、再帰探索結果を共有する。 */
    protected projectLocationPromise?: Promise<ProjectLocation | undefined>;
    /** セッション内でユーザーがタイムラインを明示的に閉じたら true。以降の自動アタッチを抑止する（アプリ再起動でリセット）。 */
    protected timelineDismissedThisSession = false;

    /**
     * レポート面のブロック選択導線（doc-annotation-ui タスク）で使う、開いている akari-surface
     * webview（akari-surfaces の AkariSurfaceOpenHandler が生成・所有）を widget.id で追跡する。
     * WidgetManager は共有サービスであり、生成元の拡張（akari-surfaces・編集禁止）を変更せずに
     * 同一インスタンスへ setContentOptions / onMessage / sendMessage できる（report.md §統合点調査）。
     */
    protected readonly trackedSurfaces = new Map<string, WebviewWidget>();
    protected reconcileHandle?: ReturnType<typeof setInterval>;
    /** ReviewModel.annotations の直近プッシュ済み参照（不要な再送を避ける差分検知に使う）。 */
    protected lastPushedAnnotations?: readonly Annotation[];

    async onStart(): Promise<void> {
        installRightPanelTabStyle(this.shell.rightPanelHandler.tabBar);
        await this.workspaceService.ready;
        for (const root of await this.workspaceService.roots) {
            await this.watchForReview(root.resource);
        }
        await this.ensureReviewPanelTab();
        this.widgetManager.onDidCreateWidget(event => {
            if (event.factoryId !== WebviewWidget.FACTORY_ID || !(event.widget instanceof WebviewWidget)) {
                return;
            }
            const { id, viewId } = event.widget.identifier;
            if (!id.startsWith('akari-surface-') || !viewId) {
                return;
            }
            const widget = event.widget;
            this.trackedSurfaces.set(id, widget);
            widget.disposed.connect(() => this.trackedSurfaces.delete(id));
            this.applyDocBlockSelectionBridge(widget);
            void this.pushDocAnnotationPins(widget);
            this.ensureReconcileLoop();
        });
        this.toDispose.push(this.review.onChanged(() => {
            // ReviewModel.annotations の setter は変更のたびに新しい配列参照を作るため、
            // 参照比較だけで「注釈内容が実際に変わったか」を安く判定できる（statusFilter /
            // selectedSourceT / docSelection の変更では参照が変わらないため再送しない）。
            if (this.review.annotations === this.lastPushedAnnotations) {
                return;
            }
            this.lastPushedAnnotations = this.review.annotations;
            for (const widget of this.trackedSurfaces.values()) {
                if (!widget.isDisposed) {
                    void this.pushDocAnnotationPins(widget);
                }
            }
        }));
    }

    onStop(): void {
        this.toDispose.dispose();
        if (this.reconcileHandle) {
            clearInterval(this.reconcileHandle);
            this.reconcileHandle = undefined;
        }
    }

    /**
     * task.md 指示2・制約「アイコンの並び位置は毎回変わらないこと」。rank だけでは保存済み
     * レイアウトの復元後に順序を保証できない（reconcileRightPanelOrder の JSDoc 参照）ため、
     * レイアウト初期化の直後と、対象 widget が追加されるたびに明示的に並べ直す。
     */
    onDidInitializeLayout(app: FrontendApplication): void {
        this.reconcileRightPanelOrder();
        app.shell.onDidAddWidget(widget => {
            if (RIGHT_PANEL_FIXED_ORDER.includes(widget.id)) {
                this.reconcileRightPanelOrder();
            }
        });
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
        commands.registerCommand(OPEN_AKARI_REVIEW_BOARD, {
            execute: () => this.openBoard()
        });
        commands.registerCommand(OPEN_AKARI_CANVAS, {
            execute: () => this.openCanvas()
        });
        commands.registerCommand(ATTACH_AKARI_ANNOTATIONS_PASSIVE, {
            execute: () => this.attachPassively()
        });
        commands.registerCommand(SELECT_DOC_BLOCK, {
            execute: (blockId: unknown) => this.handleSelectDocBlock(blockId)
        });
        commands.registerCommand(SELECT_IMAGE_BLOCK, {
            execute: (blockId: unknown, imageSrc: unknown) => this.handleSelectImageBlock(blockId, imageSrc)
        });
        commands.registerCommand(ADD_MATERIAL_AT_PLAYHEAD, {
            execute: (request: unknown) => this.addMaterialAtPlayhead(request)
        });
        const onPlaybackTick = (event: Event): void => {
            const request = (event as CustomEvent<PreviewPlaybackTick>).detail;
            if (request && this.timelineWidget?.canHandlePlaybackTick(request.videoUri)) {
                this.timelineWidget.handlePlaybackTick(request);
            }
        };
        window.addEventListener(PREVIEW_PLAYBACK_TICK_EVENT, onPlaybackTick);
        this.toDispose.push({ dispose: () => window.removeEventListener(PREVIEW_PLAYBACK_TICK_EVENT, onPlaybackTick) });
        const onOverlaySelected = (event: Event): void => {
            const request = (event as CustomEvent<PreviewOverlaySelection>).detail;
            if (request?.videoUri && (typeof request.overlayId === 'string' || request.overlayId === null)) {
                this.timelineWidget?.handleOverlaySelection(request.videoUri, request.overlayId);
            }
        };
        window.addEventListener(PREVIEW_OVERLAY_SELECTED_EVENT, onOverlaySelected);
        this.toDispose.push({
            dispose: () => window.removeEventListener(PREVIEW_OVERLAY_SELECTED_EVENT, onOverlaySelected)
        });
        const onLayerSelected = (event: Event): void => {
            const request = (event as CustomEvent<PreviewLayerSelection>).detail;
            if (request?.editUri && (typeof request.layerId === 'string' || request.layerId === null)) {
                this.timelineWidget?.handleLayerSelection(request.editUri, request.layerId);
            }
        };
        window.addEventListener(PREVIEW_LAYER_SELECTED_EVENT, onLayerSelected);
        this.toDispose.push({
            dispose: () => window.removeEventListener(PREVIEW_LAYER_SELECTED_EVENT, onLayerSelected)
        });
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
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: OPEN_AKARI_REVIEW_BOARD.id,
            label: OPEN_AKARI_REVIEW_BOARD.label,
            order: 'z22'
        });
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: OPEN_AKARI_CANVAS.id,
            label: OPEN_AKARI_CANVAS.label,
            order: 'z23'
        });
    }

    /**
     * 注釈パネルのタブを縦アイコンバーへ常時固定する（task.md 指示2）。プロジェクトの有無に
     * 関わらずアイコン自体は毎回同じ位置に存在させ、クリックで開閉できる状態にする —
     * データ読み込み（location 解決）は開いた後に ReviewModel 側で解決される（widget 側は
     * location 未設定を許容する設計、akari-review-panel-widget.ts 参照）。activate はしない
     * （AI パネルの既定表示を奪わない — 排他切り替えの維持、task.md 指示3）。
     */
    protected async ensureReviewPanelTab(): Promise<AkariReviewPanelWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariReviewPanelWidget>(AkariReviewPanelWidget.FACTORY_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'right', rank: REVIEW_PANEL_RANK });
        }
        return widget;
    }

    /**
     * 縦アイコンバーの並び順を [AI, 注釈, インスペクター] に固定する（RIGHT_PANEL_FIXED_ORDER
     * の JSDoc 参照）。`TabBar.insertTab()`（@lumino/widgets 実装を実測確認）は対象の title が
     * 既にバーにあれば移動するだけで複製しないため、安全に何度でも呼べる冪等な操作。
     */
    protected reconcileRightPanelOrder(): void {
        const tabBar = this.shell.rightPanelHandler.tabBar;
        let insertAt = 0;
        for (const id of RIGHT_PANEL_FIXED_ORDER) {
            const title = Array.from(tabBar.titles).find(candidate => candidate.owner.id === id && !candidate.owner.isDisposed);
            if (!title) {
                continue;
            }
            tabBar.insertTab(insertAt, title);
            insertAt++;
        }
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

    /**
     * `command:akari.annotations.selectDocBlock?["<blockId>"]` リンク（template.html 側が
     * data-block-id クリックで合成する）から着地する。webview 内は acquireVsCodeApi() の
     * 単一取得制約（akari-surfaces のブリッジ script が既に取得済み）で postMessage による
     * 直接通知ができないため、Theia core の CommandOpenHandler + WebviewContentOptions.
     * enableCommandUris を bridge として採用した（report.md §統合点調査に詳細）。
     */
    protected async handleSelectDocBlock(blockId: unknown): Promise<void> {
        if (typeof blockId !== 'string' || !blockId) {
            return;
        }
        const widget = this.resolveActiveSurfaceWidget();
        const viewId = widget?.identifier.viewId;
        if (!viewId) {
            return;
        }
        const location = await this.locate();
        if (!location) {
            return;
        }
        const relative = location.root.relative(new URI(viewId).normalizePath());
        if (!relative) {
            return;
        }
        this.review.docSelection = { path: relative.toString(), blockId };
    }

    /**
     * `command:akari.annotations.selectImage?["<blockId>","<imageSrc>"]` リンク（template.html
     * 側が `<img data-block-id>` クリックで合成する）から着地する。doc: と異なりレポート面には
     * 選択チップ + パネル入力の導線を設けず（契約 §4-1: ペンは文書面ではなく画像面）、クリック
     * 直後にポップアップ（AkariImageAnnotationDialog・作成モード）を開く。
     * `imageSrc` は render-analysis-report.mjs が `toPosixRelative(outDir, kfAbsolutePath)` で
     * 埋め込んだ「レポート HTML 自身からの相対パス」— レポートの絶対 URI（viewId）を起点に解決し、
     * プロジェクト相対パスへ変換してから `image:<path>` として使う（doc: 解決と同じ規律）。
     */
    protected async handleSelectImageBlock(blockId: unknown, imageSrc: unknown): Promise<void> {
        if (typeof imageSrc !== 'string' || !imageSrc) {
            return;
        }
        const widget = this.resolveActiveSurfaceWidget();
        const viewId = widget?.identifier.viewId;
        if (!viewId) {
            return;
        }
        const location = await this.locate();
        if (!location) {
            return;
        }
        // doc: 経路（addDocAnnotation）はパネル（openReviewPanel が先に attach() を通す）経由でのみ
        // 呼ばれるため ReviewModel.location は既に設定済みだが、画像ポップアップはパネルを介さず
        // 直接開くため、ここで明示的に設定しないとタイムライン/パネルを一度も開いていないセッションで
        // 「プロジェクトを特定できません」になる（実機 L1 で検出）。
        this.review.location = location;
        const reportUri = new URI(viewId).normalizePath();
        const imageUri = reportUri.parent.resolve(imageSrc).normalizePath();
        const relative = location.root.relative(imageUri);
        if (!relative) {
            return;
        }
        if (!await this.fileService.exists(imageUri)) {
            return;
        }
        const dialog = new AkariImageAnnotationDialog(
            { title: '画像に注釈', mode: 'create', imageUri, relativePath: relative.toString(), maxWidth: 960 },
            this.fileService,
            this.review
        );
        await dialog.open();
    }

    /**
     * command: URI 実行時点でどのレポートタブが対象かを ApplicationShell.activeWidget から解決する
     * （WebviewWidget は ApplicationShellMouseTracker 経由でクリックをフォーカスとしてシェルへ
     * 報告するため、リンククリック時点で対象の webview が activeWidget になっている想定）。
     * 一致しない場合のフォールバックとして、追跡中の akari-surface が 1 つだけならそれを使う。
     */
    protected resolveActiveSurfaceWidget(): WebviewWidget | undefined {
        const active = this.shell.activeWidget;
        if (active instanceof WebviewWidget && active.identifier.id.startsWith('akari-surface-')) {
            return active;
        }
        return this.trackedSurfaces.size === 1 ? [...this.trackedSurfaces.values()][0] : undefined;
    }

    /**
     * akari-surfaces（編集禁止）の setContentOptions 呼び出しは enableCommandUris を含まないため、
     * このメソッドの呼び出し（widget 生成時 + 再調整ループ）で上書きし直す。setContentOptions は
     * 内容が deep-equal なら no-op なので、定常状態では実質コストゼロ。
     */
    protected applyDocBlockSelectionBridge(widget: WebviewWidget): void {
        const viewId = widget.identifier.viewId;
        if (!viewId) {
            return;
        }
        widget.setContentOptions({
            allowScripts: true,
            allowForms: true,
            localResourceRoots: [new URI(viewId).parent.toString()],
            enableCommandUris: [SELECT_DOC_BLOCK.id, SELECT_IMAGE_BLOCK.id]
        });
    }

    /**
     * この report.html（widget の viewId）を対象とする doc: 注釈の一覧を webview へ push する
     * （指示 5・6: レポート再表示時のピン表示。host → webview のみで完結し、webview からの
     * 応答は不要 — template.html 側は window の 'message' イベントで受け取るだけでよい）。
     */
    protected async pushDocAnnotationPins(widget: WebviewWidget): Promise<void> {
        const viewId = widget.identifier.viewId;
        if (!viewId || widget.isDisposed) {
            return;
        }
        const location = await this.locate();
        if (!location) {
            return;
        }
        const relativePath = location.root.relative(new URI(viewId).normalizePath())?.toString();
        if (!relativePath || widget.isDisposed) {
            return;
        }
        const blocks = this.review.annotations
            .map(annotation => ({ annotation, doc: parseDocTarget(annotation.target) }))
            .filter((entry): entry is { annotation: Annotation; doc: { path: string; blockId: string } } => Boolean(entry.doc))
            .filter(entry => entry.doc.path === relativePath)
            .map(entry => ({ blockId: entry.doc.blockId, status: entry.annotation.status }));
        widget.sendMessage({ type: 'akari-doc-annotations', blocks });
    }

    /**
     * akari-surfaces が configureSurface() を再実行する（再オープン・別ファイルからの遷移等）たびに
     * enableCommandUris が上書きされ得る。setContentOptions/setHTML の再実行を検知できる公開
     * イベントが WebviewWidget に無いため、短い間隔で再付与して自己修復する
     * （report.md §統合点調査「採った bridge 方式」参照）。
     */
    protected ensureReconcileLoop(): void {
        if (this.reconcileHandle) {
            return;
        }
        this.reconcileHandle = setInterval(() => {
            for (const widget of this.trackedSurfaces.values()) {
                if (!widget.isDisposed) {
                    this.applyDocBlockSelectionBridge(widget);
                    // ファイル変更等で akari-surfaces が setHTML を再実行すると DOM ごと作り直され、
                    // 前回 push したピンも消える。ピン再送も同じ間隔で自己修復する。
                    void this.pushDocAnnotationPins(widget);
                }
            }
        }, 1500);
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
     * 素材追加コマンド（ADD_MATERIAL_AT_PLAYHEAD）の受け側（task 2026-08-10-timeline-clip-menu
     * 指示4・司令塔裁定6）。widget が未オープンなら `open()`（= akari.annotations.open と同じ経路）
     * で開いてから挿入する。それでも edit.json のロケーションが取れない場合は widget 側の
     * addMaterialAtPlayhead が messages.warn 1文で誘導する（ここでは「プロジェクト自体が
     * 見つからない」場合のみ warn する）。引数の型検証（kind/relativePath）は widget 側で行う
     * （司令塔裁定4・5）。
     */
    protected async addMaterialAtPlayhead(request: unknown): Promise<void> {
        const payload = request as { relativePath?: unknown; kind?: unknown } | undefined;
        const relativePath = typeof payload?.relativePath === 'string' ? payload.relativePath : '';
        const kind = typeof payload?.kind === 'string' ? payload.kind : '';
        const widget = await this.open();
        if (!widget) {
            this.messages.warn('プロジェクトを特定できません。タイムラインを開いてから追加してください。');
            return;
        }
        await widget.addMaterialAtPlayhead(relativePath, kind);
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
        const widget = await this.ensureReviewPanelTab();
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    /**
     * レビューボードをエディタ領域（main）のタブとして開く。分析レポートタブと同じ流儀
     * （WidgetManager.getOrCreateWidget → shell.addWidget({area:'main'}) → activateWidget）。
     * データ読み込みはタイムライン側（ReviewModel）に相乗りするため、先に `attach()` で
     * タイムラインを構成する（ただし `open()` と異なりタイムライン自体は activate/reveal しない
     * — ボードを開いた際にボトムパネルが勝手にせり出さないようにするため）。
     */
    async openBoard(): Promise<AkariReviewBoardWidget | undefined> {
        const timeline = await this.attach();
        if (!timeline) {
            return undefined;
        }
        const widget = await this.widgetManager.getOrCreateWidget<AkariReviewBoardWidget>(AkariReviewBoardWidget.FACTORY_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    /**
     * インスペクターを右サイドへ開く。選択のたびタイムライン側から呼ばれる想定のため、
     * フォーカスは奪わず reveal のみに留める（一度開けば常駐し、内容だけが更新される）。
     */
    async openInspectorPanel(): Promise<AkariInspectorWidget | undefined> {
        const timeline = this.timelineWidget?.isAttached ? this.timelineWidget : await this.attach();
        if (!timeline) {
            return undefined;
        }
        const widget = await this.widgetManager.getOrCreateWidget<AkariInspectorWidget>(AkariInspectorWidget.FACTORY_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'right', rank: INSPECTOR_PANEL_RANK });
        }
        await this.shell.revealWidget(widget.id);
        return widget;
    }

    /**
     * 「キャンバスを開く」（contract-2026-07-26-canvas-surface）: 出力アスペクトの白板を
     * ダイアログで開き、閉じたら review/canvas/c-NNNN/ に記録原本を書く（review.json への着地は
     * 別途 skills/compile-review-session を実行する — §4）。
     */
    protected async openCanvas(): Promise<void> {
        const location = await this.locate();
        if (!location) {
            this.messages.error('プロジェクトを特定できません。タイムラインを開いてから開いてください。');
            return;
        }
        this.review.location = location;
        const { aspect, aspectSource } = await this.resolveCanvasAspect(location);
        const dialog = new AkariCanvasDialog(
            { title: 'キャンバスを開く', mode: 'create', aspect, aspectSource, maxWidth: 1200 },
            this.fileService,
            this.review,
            this.fileDialogService
        );
        const id = await dialog.open();
        if (id) {
            this.messages.info(`キャンバスを記録しました: ${id}（コンパイルすると review.json の注釈として着地します）`);
        }
    }

    /**
     * プロジェクトの出力解像度からキャンバスのアスペクトを導出する（task.md 指示 1）。
     * edit.json（v0/v1 共通 `output.width`/`output.height` — packages/schemas/edit.schema.json）
     * から読めればそれを使い、読めなければ 1920x1080 既定へ落とし、導出元を canvas.json に残す
     * （呼び出し側 = AkariCanvasDialog.isValid → saveCanvas）。
     */
    protected async resolveCanvasAspect(
        location: ProjectLocation
    ): Promise<{ aspect: { w: number; h: number }; aspectSource: 'edit.json' | 'default' }> {
        if (location.editUri) {
            try {
                const parsed = JSON.parse(await this.readText(location.editUri)) as {
                    output?: { width?: unknown; height?: unknown };
                };
                const width = parsed?.output?.width;
                const height = parsed?.output?.height;
                if (typeof width === 'number' && Number.isFinite(width) && width > 0
                    && typeof height === 'number' && Number.isFinite(height) && height > 0) {
                    return { aspect: { w: width, h: height }, aspectSource: 'edit.json' };
                }
            } catch (error) {
                console.warn('[akari-annotations] failed to resolve output aspect from edit.json', error);
            }
        }
        return { aspect: { ...DEFAULT_CANVAS_ASPECT }, aspectSource: 'default' };
    }

    protected async locate(): Promise<ProjectLocation | undefined> {
        this.projectLocationPromise ??= this.resolveProjectLocation();
        return this.projectLocationPromise;
    }

    protected async resolveProjectLocation(): Promise<ProjectLocation | undefined> {
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
            .filter(child => !isSkippedSearchDirectory(child.resource.path.base))
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
