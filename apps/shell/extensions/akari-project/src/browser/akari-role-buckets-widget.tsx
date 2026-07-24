import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { OpenerService, QuickInputService, open } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { AkariProjectService, DroppedAsset } from '../common/akari-project-protocol';
import { AkariWorkflowService } from './akari-workflow-service';
import { shouldShowProjectPath } from '../common/project-tree-policy';
import { AnalysisJson, deriveAnalysisDurationSeconds, formatDurationBadge } from '../common/analysis-summary';
import { composeMaterialAskAgentPrompt } from '../common/agent-context-packet';
import { CatalogItemMeta, filterCatalogItems, parseCatalogItemMeta } from '../common/catalog-reader';
import { composeCatalogAskAgentPrompt, composeCatalogImportPrompt } from '../common/catalog-context-packet';

// パートナー拡張の公開コマンド ID とミラー（extension 間の npm 依存を作らない。
// akari-partner-command-contribution.ts の AkariPartnerCommands.INJECT_PROMPT と同一）。
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';

const AKARI_CATALOG_ROOT_PREFERENCE = 'akari.catalog.root';
/** カタログルート直下の走査対象カテゴリディレクトリ（task.md 指定の 6 種）。 */
const CATALOG_CATEGORIES = ['3d', 'telop', 'audio', 'broll', 'font', 'luts'] as const;
const CATALOG_UNRESOLVED_MESSAGE = 'カタログの場所が未設定です（設定 akari.catalog.root）';

type TabId = 'materials' | 'plan' | 'catalog';
type MaterialKind = 'video' | 'audio' | 'image' | 'other';

const SUPPORTED_DROP_EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv|avi|wav|mp3|m4a|aac|flac|ogg|png|jpg|jpeg|gif|webp)$/i;

interface MaterialCardEntry {
    uri: URI;
    relativePath: string;
    name: string;
    kind: MaterialKind;
    analyzed: boolean;
    durationSeconds?: number;
    thumbnailUri?: URI;
    /** analysis.json のプロジェクト相対パス。analyzed のときのみ設定される。 */
    analysisRelativePath?: string;
}

/**
 * 非開発者モード向けの「素材」差し替えビュー。
 *
 * 標準 Explorer ツリーの代わりに、パネル内タブ（素材 / プラン / カタログ）と
 * ドメインオブジェクトのカード棚を見せる。素材タブはノイズ（隠しディレクトリ・
 * サイドカー）を project-tree-policy.ts の判定に委ねて隠し、analyze-footage が
 * 書く analysis.json（.akari/sidecars/<素材相対パス>.analysis/analysis.json）から
 * サムネ・尺・分析済み判定を読む。プラン / カタログタブは本ラウンドでは空状態のみ。
 * 書き出しタブは置かない（オーナー裁定 — ノイズ。書き出しは将来 Export ボタン側）。
 *
 * activity bar 上での explorer-view-container との切り替え（表示するのはどちらか
 * 一方のみ）は akari-shell-strip の AkariActivityBarCuration が担当する
 * （developer mode の持ち主が akari-project、activity bar の持ち主が
 * akari-shell-strip という既存の役割分担に合わせた配置）。widget id
 * （AkariRoleBucketsWidget.ID）は akari-shell-strip 側が文字列リテラルで参照して
 * いるため変更しない。
 */
@injectable()
export class AkariRoleBucketsWidget extends ReactWidget {
    static readonly ID = 'akari-role-buckets-widget';

    @inject(AkariWorkflowService)
    protected readonly workflow!: AkariWorkflowService;
    @inject(AkariProjectService)
    protected readonly projectService!: AkariProjectService;
    @inject(FileService)
    protected readonly files!: FileService;
    @inject(OpenerService)
    protected readonly openers!: OpenerService;
    @inject(MessageService)
    protected readonly messages!: MessageService;
    @inject(CommandService)
    protected readonly commandService!: CommandService;
    @inject(QuickInputService)
    protected readonly quickInputService!: QuickInputService;
    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    protected activeTab: TabId = 'materials';
    protected materials: MaterialCardEntry[] = [];
    protected materialsLoading = false;
    protected lintAvailable = false;
    protected lintCount?: number;

    protected catalogItems: CatalogItemMeta[] = [];
    protected catalogLoading = false;
    protected catalogRootResolved = false;
    protected catalogMissingCount = 0;
    protected catalogQuery = '';
    protected catalogCategory = 'all';
    protected readonly catalogBrokenThumbnails = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.id = AkariRoleBucketsWidget.ID;
        this.title.label = '素材';
        this.title.caption = 'ドメインオブジェクトのカード棚';
        this.title.iconClass = 'codicon codicon-files';
        this.title.closable = false;
        // 俯瞰の取り込みドロップゾーンと同じ流儀: このパネルへのドロップは
        // akari-project-contribution.ts のグローバルハンドラ（isDelegatedDropzone）
        // に割り込まれず、このウィジェット自身が最後まで処理する。
        this.node.setAttribute('data-akari-dropzone', 'true');
        this.node.addEventListener('drop', event => this.handleDrop(event));
        this.toDispose.push(this.workflow.onDidChange(() => this.refresh()));
        // カタログはワークスペース非依存（catalog/ は参照配布データ）なので
        // 素材タブと違いプロジェクトを開く前でも読み込む。
        void this.loadCatalog();
        this.toDispose.push(this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName === AKARI_CATALOG_ROOT_PREFERENCE) {
                void this.loadCatalog();
            }
        }));
        this.update();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.refresh();
    }

    protected refresh(): void {
        void this.loadMaterials();
        void this.refreshLint();
    }

    protected selectTab(tab: TabId): void {
        this.activeTab = tab;
        this.update();
    }

    // --- 素材カード ---------------------------------------------------------

    protected async loadMaterials(): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root) {
            this.materials = [];
            this.update();
            return;
        }
        this.materialsLoading = true;
        this.update();
        const files = await this.collectAssetFiles(root.resolve('assets'));
        this.materials = await Promise.all(files.map(file => this.buildMaterialEntry(root, file)));
        this.materialsLoading = false;
        this.update();
    }

    protected async collectAssetFiles(assetsRoot: URI): Promise<FileStat[]> {
        let stat: FileStat;
        try {
            stat = await this.files.resolve(assetsRoot);
        } catch {
            return [];
        }
        const result: FileStat[] = [];
        const walk = async (node: FileStat): Promise<void> => {
            for (const child of node.children ?? []) {
                const relative = this.workflow.relativePath(child.resource);
                if (!shouldShowProjectPath(relative, this.workflow.current.tree, false)) {
                    continue;
                }
                if (child.isDirectory) {
                    try {
                        await walk(await this.files.resolve(child.resource));
                    } catch {
                        // Directory disappeared mid-walk; skip it.
                    }
                } else {
                    result.push(child);
                }
            }
        };
        await walk(stat);
        result.sort((left, right) => left.resource.path.base.localeCompare(right.resource.path.base, 'ja'));
        return result;
    }

    protected async buildMaterialEntry(root: URI, file: FileStat): Promise<MaterialCardEntry> {
        const relativePath = this.workflow.relativePath(file.resource) ?? file.resource.path.base;
        const kind = this.classifyKind(file.resource.path.base);
        const analysisRelativePath = `.akari/sidecars/${relativePath}.analysis/analysis.json`;
        const analysisUri = root.resolve(analysisRelativePath);
        const analysis = await this.readAnalysis(analysisUri);
        if (!analysis) {
            return { uri: file.resource, relativePath, name: file.resource.path.base, kind, analyzed: false };
        }
        return {
            uri: file.resource,
            relativePath,
            name: file.resource.path.base,
            kind,
            analyzed: true,
            durationSeconds: deriveAnalysisDurationSeconds(analysis),
            thumbnailUri: this.resolveThumbnail(analysisUri, analysis),
            analysisRelativePath
        };
    }

    protected async readAnalysis(analysisUri: URI): Promise<AnalysisJson | undefined> {
        try {
            const content = await this.files.readFile(analysisUri);
            const parsed = JSON.parse(content.value.toString()) as Partial<AnalysisJson>;
            if (!parsed || parsed.version !== 0) {
                return undefined;
            }
            return parsed as AnalysisJson;
        } catch {
            // 未分析（未生成/壊れた sidecar）は正常系のプレースホルダ状態として扱う。
            return undefined;
        }
    }

    protected resolveThumbnail(analysisUri: URI, analysis: AnalysisJson): URI | undefined {
        const first = analysis.keyframes?.[0];
        return first?.path ? analysisUri.parent.resolve(first.path) : undefined;
    }

    protected classifyKind(name: string): MaterialKind {
        const lower = name.toLowerCase();
        if (/\.(mp4|mov|m4v|webm|mkv|avi)$/.test(lower)) {
            return 'video';
        }
        if (/\.(wav|mp3|m4a|aac|flac|ogg)$/.test(lower)) {
            return 'audio';
        }
        if (/\.(png|jpg|jpeg|gif|webp)$/.test(lower)) {
            return 'image';
        }
        return 'other';
    }

    protected placeholderIcon(kind: MaterialKind): string {
        switch (kind) {
            case 'video': return 'codicon codicon-device-camera-video';
            case 'audio': return 'codicon codicon-unmute';
            case 'image': return 'codicon codicon-file-media';
            default: return 'codicon codicon-file';
        }
    }

    protected async openFile(uri: URI): Promise<void> {
        await open(this.openers, uri);
    }

    /**
     * 素材カード「エージェントに頼む」アクション。ファイルパスも文脈説明も
     * ユーザーに書かせず、カードが知っている情報から文脈パケットを組み立てて
     * パートナーへ注入する（輸入リスト④）。入力キャンセル時は何もしない。
     */
    protected async askAgent(entry: MaterialCardEntry): Promise<void> {
        const request = await this.quickInputService.input({
            placeHolder: 'この素材について何を頼みますか'
        });
        if (!request || !request.trim()) {
            return;
        }
        const packet = composeMaterialAskAgentPrompt(
            {
                relativePath: entry.relativePath,
                analyzed: entry.analyzed,
                durationSeconds: entry.durationSeconds,
                analysisRelativePath: entry.analysisRelativePath
            },
            request
        );
        await this.commandService.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, packet);
    }

    // --- カタログ ---------------------------------------------------------

    /**
     * カタログルート解決 → 6 カテゴリディレクトリ走査 → 各アイテムの meta.json を
     * 寛容リーダーで読む。取得もステージ実装もしない（読み取り専用の参照データ）。
     * meta.json 欠落・壊れは例外にせず catalogMissingCount へ計上するだけで、
     * 他アイテムの表示は継続する。
     */
    protected async loadCatalog(): Promise<void> {
        this.catalogLoading = true;
        this.update();
        const preferenceRoot = this.preferences.get<string>(AKARI_CATALOG_ROOT_PREFERENCE, '');
        const rootUriString = await this.projectService.resolveCatalogRoot(preferenceRoot);
        if (!rootUriString) {
            this.catalogRootResolved = false;
            this.catalogItems = [];
            this.catalogMissingCount = 0;
            this.catalogLoading = false;
            this.update();
            return;
        }
        const rootUri = new URI(rootUriString);
        const items: CatalogItemMeta[] = [];
        let missing = 0;
        for (const category of CATALOG_CATEGORIES) {
            let categoryStat: FileStat;
            try {
                categoryStat = await this.files.resolve(rootUri.resolve(category));
            } catch {
                continue;
            }
            for (const child of categoryStat.children ?? []) {
                if (!child.isDirectory) {
                    continue;
                }
                const parsed = await this.readCatalogItemMeta(child.resource.resolve('meta.json'));
                if (parsed) {
                    items.push(parsed);
                } else {
                    missing++;
                }
            }
        }
        items.sort((left, right) => left.title.localeCompare(right.title, 'ja'));
        this.catalogRootResolved = true;
        this.catalogItems = items;
        this.catalogMissingCount = missing;
        this.catalogLoading = false;
        this.update();
    }

    protected async readCatalogItemMeta(metaUri: URI): Promise<CatalogItemMeta | undefined> {
        try {
            const content = await this.files.readFile(metaUri);
            return parseCatalogItemMeta(content.value.toString());
        } catch {
            return undefined;
        }
    }

    protected filteredCatalogItems(): CatalogItemMeta[] {
        return filterCatalogItems(this.catalogItems, this.catalogQuery, this.catalogCategory);
    }

    protected catalogCategoryChips(): string[] {
        return Array.from(new Set(this.catalogItems.map(item => item.category))).sort((left, right) => left.localeCompare(right, 'ja'));
    }

    protected setCatalogQuery(query: string): void {
        this.catalogQuery = query;
        this.update();
    }

    protected selectCatalogCategory(category: string): void {
        this.catalogCategory = category;
        this.update();
    }

    protected catalogItemKey(item: CatalogItemMeta): string {
        return `${item.category}/${item.id}`;
    }

    protected handleCatalogThumbnailError(item: CatalogItemMeta): void {
        this.catalogBrokenThumbnails.add(this.catalogItemKey(item));
        this.update();
    }

    protected catalogPlaceholderIcon(category: string): string {
        switch (category) {
            case '3d': return 'codicon codicon-package';
            case 'telop': return 'codicon codicon-text-size';
            case 'audio': return 'codicon codicon-unmute';
            case 'broll': return 'codicon codicon-device-camera-video';
            case 'font': return 'codicon codicon-symbol-key';
            case 'luts': return 'codicon codicon-symbol-color';
            default: return 'codicon codicon-file';
        }
    }

    /** 「取り込む」— 固定パケット。取得・配置は setup-library 系スキルの領分。 */
    protected async importCatalogItem(item: CatalogItemMeta): Promise<void> {
        await this.commandService.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, composeCatalogImportPrompt(item));
    }

    /** 「頼む」— quick-input 1 行 → 同要素 + when_to_use 先頭 1 文 + 入力文。 */
    protected async askAgentAboutCatalogItem(item: CatalogItemMeta): Promise<void> {
        const request = await this.quickInputService.input({
            placeHolder: 'この素材で何をしますか'
        });
        if (!request || !request.trim()) {
            return;
        }
        await this.commandService.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, composeCatalogAskAgentPrompt(item, request));
    }

    // --- ドロップ振り分け -----------------------------------------------------

    protected handleDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        const transfer = event.dataTransfer;
        if (!transfer) {
            return;
        }
        const { accepted, rejectedCount } = this.classifyDropped(transfer);
        if (accepted.length) {
            void this.importDropped(accepted);
        }
        if (rejectedCount) {
            this.messages.warn(
                `対応していないファイル形式のため ${rejectedCount} 件を取り込めませんでした（動画・音声・画像のみ取り込めます）。`
            );
        }
    }

    protected classifyDropped(transfer: DataTransfer): { accepted: DroppedAsset[]; rejectedCount: number } {
        const accepted: DroppedAsset[] = [];
        let rejectedCount = 0;
        const files = Array.from(transfer.files);
        for (const file of files) {
            if (SUPPORTED_DROP_EXTENSIONS.test(file.name)) {
                accepted.push({ name: file.name, sourcePath: this.resolveDroppedFilePath(file) });
            } else {
                rejectedCount++;
            }
        }
        if (!files.length) {
            const uriList = transfer.getData('text/uri-list');
            for (const line of uriList.split(/\r?\n/)) {
                if (!line.startsWith('file:')) {
                    continue;
                }
                const uri = new URI(line);
                if (SUPPORTED_DROP_EXTENSIONS.test(uri.path.base)) {
                    accepted.push({ name: uri.path.base, sourcePath: uri.path.fsPath() });
                } else {
                    rejectedCount++;
                }
            }
        }
        return { accepted, rejectedCount };
    }

    protected resolveDroppedFilePath(file: File): string | undefined {
        const theiaCore = (window as Window & {
            electronTheiaCore?: { getPathForFile?: (candidate: File) => string };
        }).electronTheiaCore;
        let sourcePath: string | undefined;
        if (typeof theiaCore?.getPathForFile === 'function') {
            try {
                sourcePath = theiaCore.getPathForFile(file) || undefined;
            } catch {
                // Fall back for environments without the Electron preload bridge.
            }
        }
        return sourcePath ?? (file as File & { path?: string }).path;
    }

    protected async importDropped(assets: DroppedAsset[]): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            return;
        }
        try {
            const results = await this.projectService.recordDroppedAssets(root.toString(), assets);
            const imported = results.filter(result => result.success).length;
            const failed = results.length - imported;
            if (imported) {
                void this.loadMaterials();
            }
            if (failed) {
                const message = 'ファイルを取り込めませんでした。Finder からもう一度ドラッグしてください。';
                if (imported) {
                    this.messages.warn(`${failed} 件の${message}`);
                } else {
                    this.messages.error(message);
                }
            }
        } catch {
            this.messages.error('ファイルを取り込めませんでした。Finder からもう一度ドラッグしてください。');
        }
    }

    // --- lint バッジ ---------------------------------------------------------

    protected async refreshLint(): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root) {
            this.lintAvailable = false;
            this.lintCount = undefined;
            this.update();
            return;
        }
        const outcome = await this.projectService.runEditLint(root.toString());
        this.lintAvailable = outcome.available;
        this.lintCount = outcome.available ? outcome.issueCount : undefined;
        this.update();
    }

    // --- 描画 -----------------------------------------------------------------

    protected override render(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {this.renderTabBar()}
                <div style={{ flex: '1 1 auto', overflow: 'auto' }}>
                    {this.activeTab === 'materials' && this.renderMaterialsTab()}
                    {this.activeTab === 'plan' && this.renderEmptyTab(
                        'プランはここに入ります。企画・構成の管理は今後この場所でできるようになります。'
                    )}
                    {this.activeTab === 'catalog' && this.renderCatalogTab()}
                </div>
                {this.renderLintBadge()}
            </div>
        );
    }

    protected renderTabBar(): React.ReactNode {
        const tabs: Array<{ id: TabId; label: string }> = [
            { id: 'materials', label: '素材' },
            { id: 'plan', label: 'プラン' },
            { id: 'catalog', label: 'カタログ' }
        ];
        return (
            <div role='tablist' style={{ display: 'flex', flex: '0 0 auto', borderBottom: '1px solid var(--theia-sideBar-border)' }}>
                {tabs.map(tab => {
                    const active = this.activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            role='tab'
                            aria-selected={active}
                            onClick={() => this.selectTab(tab.id)}
                            style={{
                                flex: '1 1 0',
                                padding: '8px 4px',
                                background: 'transparent',
                                border: 'none',
                                borderBottom: active ? '2px solid var(--theia-focusBorder)' : '2px solid transparent',
                                color: active ? 'var(--theia-sideBar-foreground)' : 'var(--theia-descriptionForeground)',
                                cursor: 'pointer'
                            }}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>
        );
    }

    protected renderEmptyTab(description: string): React.ReactNode {
        return (
            <div style={{ padding: '16px' }}>
                <p style={{ margin: 0, opacity: 0.75 }}>{description}</p>
            </div>
        );
    }

    protected renderMaterialsTab(): React.ReactNode {
        if (!this.workflow.workspaceRoot) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>プロジェクトを開いてください。</p>;
        }
        if (this.materialsLoading) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>読み込み中…</p>;
        }
        if (!this.materials.length) {
            return (
                <p style={{ opacity: 0.7, padding: '16px' }}>
                    ここにはまだ素材がありません。動画・音声・画像をこのパネルへドラッグすると取り込めます。
                </p>
            );
        }
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', padding: '10px' }}>
                {this.materials.map(entry => this.renderMaterialCard(entry))}
            </div>
        );
    }

    protected renderMaterialCard(entry: MaterialCardEntry): React.ReactNode {
        return (
            <div
                key={entry.uri.toString()}
                onClick={() => void this.openFile(entry.uri)}
                title={entry.name}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: 'pointer',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    background: 'var(--theia-sideBar-background)',
                    border: '1px solid var(--theia-sideBar-border)'
                }}
            >
                <div
                    style={{
                        position: 'relative',
                        aspectRatio: '16 / 9',
                        background: 'var(--theia-editorWidget-background)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    {entry.thumbnailUri
                        ? <img
                            src={entry.thumbnailUri.toString()}
                            alt=''
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        : <span className={this.placeholderIcon(entry.kind)} aria-hidden='true' style={{ fontSize: '1.8em', opacity: 0.5 }} />}
                    <span
                        title={entry.analyzed ? '分析済み' : '未分析'}
                        aria-label={entry.analyzed ? '分析済み' : '未分析'}
                        style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            width: '9px',
                            height: '9px',
                            borderRadius: '50%',
                            background: entry.analyzed ? 'var(--theia-badge-background)' : 'var(--theia-descriptionForeground)'
                        }}
                    />
                    <button
                        type='button'
                        title='エージェントに頼む'
                        aria-label={`${entry.name} についてエージェントに頼む`}
                        onClick={event => { event.stopPropagation(); void this.askAgent(entry); }}
                        style={{
                            position: 'absolute',
                            bottom: '4px',
                            left: '4px',
                            width: '20px',
                            height: '20px',
                            padding: 0,
                            borderRadius: '50%',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            cursor: 'pointer'
                        }}
                    >
                        <span className='codicon codicon-comment-discussion' aria-hidden='true' style={{ fontSize: '12px' }} />
                    </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', padding: '4px 6px' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85em' }}>
                        {entry.name}
                    </span>
                    <span style={{ opacity: 0.7, fontSize: '0.75em', flex: '0 0 auto' }}>
                        {entry.analyzed ? formatDurationBadge(entry.durationSeconds ?? 0) : '--:--'}
                    </span>
                </div>
            </div>
        );
    }

    protected renderCatalogTab(): React.ReactNode {
        if (this.catalogLoading) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>読み込み中…</p>;
        }
        if (!this.catalogRootResolved) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>{CATALOG_UNRESOLVED_MESSAGE}</p>;
        }
        const filtered = this.filteredCatalogItems();
        return (
            <div
                style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                data-akari-catalog-item-count={this.catalogItems.length}
                data-akari-catalog-missing-count={this.catalogMissingCount}
            >
                {this.renderCatalogControls()}
                <div style={{ flex: '1 1 auto', overflow: 'auto' }}>
                    {!filtered.length
                        ? <p style={{ opacity: 0.7, padding: '16px' }}>
                            {this.catalogItems.length
                                ? '条件に一致するカタログ項目がありません。'
                                : 'カタログ項目が見つかりませんでした。'}
                        </p>
                        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', padding: '10px' }}>
                            {filtered.map(item => this.renderCatalogCard(item))}
                        </div>}
                </div>
            </div>
        );
    }

    protected renderCatalogControls(): React.ReactNode {
        const categories = ['all', ...this.catalogCategoryChips()];
        return (
            <div style={{
                flex: '0 0 auto',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                borderBottom: '1px solid var(--theia-sideBar-border)'
            }}>
                <input
                    type='text'
                    value={this.catalogQuery}
                    onChange={event => this.setCatalogQuery(event.target.value)}
                    placeholder='検索（名前・説明・タグ）'
                    aria-label='カタログを検索'
                    style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '4px 8px',
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '4px'
                    }}
                />
                <div role='tablist' aria-label='カタログのカテゴリ' style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {categories.map(category => {
                        const active = this.catalogCategory === category;
                        return (
                            <button
                                key={category}
                                type='button'
                                role='tab'
                                aria-selected={active}
                                onClick={() => this.selectCatalogCategory(category)}
                                style={{
                                    padding: '2px 10px',
                                    borderRadius: '12px',
                                    border: '1px solid var(--theia-sideBar-border)',
                                    background: active ? 'var(--theia-button-background)' : 'transparent',
                                    color: active ? 'var(--theia-button-foreground)' : 'var(--theia-sideBar-foreground)',
                                    cursor: 'pointer',
                                    fontSize: '0.8em'
                                }}
                            >
                                {category === 'all' ? 'All' : category}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    protected renderCatalogCard(item: CatalogItemMeta): React.ReactNode {
        const key = this.catalogItemKey(item);
        const thumbnailBroken = this.catalogBrokenThumbnails.has(key);
        const previewUrl = item.source?.preview_url;
        const tags = (item.tags ?? []).slice(0, 3);
        return (
            <div
                key={key}
                title={item.title}
                data-akari-catalog-item={key}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    background: 'var(--theia-sideBar-background)',
                    border: '1px solid var(--theia-sideBar-border)'
                }}
            >
                <div
                    style={{
                        position: 'relative',
                        aspectRatio: '16 / 9',
                        background: 'var(--theia-editorWidget-background)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    {previewUrl && !thumbnailBroken
                        ? <img
                            src={previewUrl}
                            alt=''
                            onError={() => this.handleCatalogThumbnailError(item)}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        : <span
                            className={this.catalogPlaceholderIcon(item.category)}
                            aria-hidden='true'
                            style={{ fontSize: '1.8em', opacity: 0.5 }}
                        />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px' }}>
                    <span style={{ fontSize: '0.85em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title}
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', fontSize: '0.72em', opacity: 0.85 }}>
                        <span>{item.category}</span>
                        {tags.map(tag => (
                            <span
                                key={tag}
                                style={{
                                    padding: '0 4px',
                                    borderRadius: '8px',
                                    background: 'var(--theia-badge-background)',
                                    color: 'var(--theia-badge-foreground)'
                                }}
                            >
                                {tag}
                            </span>
                        ))}
                        {item.license?.spdx && (
                            <span style={{ padding: '0 4px', borderRadius: '8px', border: '1px solid var(--theia-sideBar-border)' }}>
                                {item.license.spdx}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                            type='button'
                            className='theia-button secondary'
                            title={`${item.title} をエージェントに取り込ませる`}
                            style={{ flex: '1 1 0', fontSize: '0.78em', padding: '2px 4px' }}
                            onClick={() => void this.importCatalogItem(item)}
                        >
                            取り込む
                        </button>
                        <button
                            type='button'
                            className='theia-button secondary'
                            title={`${item.title} についてエージェントに頼む`}
                            style={{ flex: '1 1 0', fontSize: '0.78em', padding: '2px 4px' }}
                            onClick={() => void this.askAgentAboutCatalogItem(item)}
                        >
                            頼む
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    protected renderLintBadge(): React.ReactNode {
        if (!this.lintAvailable) {
            return undefined;
        }
        const label = this.lintCount === undefined ? '未実行' : `${this.lintCount} 件`;
        return (
            <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--theia-sideBar-border)', padding: '6px' }}>
                <button
                    className='theia-button secondary'
                    title='クリックして再実行'
                    onClick={() => void this.refreshLint()}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                    <span>Lint</span>
                    <span>{label}</span>
                </button>
            </div>
        );
    }
}
