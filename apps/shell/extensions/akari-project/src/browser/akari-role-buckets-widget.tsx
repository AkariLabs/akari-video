import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { OpenerService, QuickInputService, open } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { AkariProjectService, DroppedAsset } from '../common/akari-project-protocol';
import { AkariWorkflowService } from './akari-workflow-service';
import { shouldShowProjectPath } from '../common/project-tree-policy';
import { AnalysisJson, deriveAnalysisDurationSeconds, formatDurationBadge } from '../common/analysis-summary';
import { composeMaterialAskAgentPrompt } from '../common/agent-context-packet';

// パートナー拡張の公開コマンド ID とミラー（extension 間の npm 依存を作らない。
// akari-partner-command-contribution.ts の AkariPartnerCommands.INJECT_PROMPT と同一）。
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';

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

    protected activeTab: TabId = 'materials';
    protected materials: MaterialCardEntry[] = [];
    protected materialsLoading = false;
    protected lintAvailable = false;
    protected lintCount?: number;

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
                    {this.activeTab === 'catalog' && this.renderEmptyTab(
                        'カタログはここに入ります。素材のキュレーション一覧は今後この場所に表示されます。'
                    )}
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
