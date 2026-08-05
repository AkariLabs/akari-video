import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService, DisposableCollection, MessageService } from '@theia/core/lib/common';
import { OpenerService, QuickInputService, open } from '@theia/core/lib/browser';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent, FileStat, FileStatWithMetadata } from '@theia/filesystem/lib/common/files';
import {
    AkariProjectService,
    AssetCatalogViewItem,
    DroppedAsset,
    StoreConnectionStatus,
    StoreDeviceStartOutcome
} from '../common/akari-project-protocol';
import { AkariWorkflowService } from './akari-workflow-service';
import { shouldShowProjectPath } from '../common/project-tree-policy';
import { isUnorganizedRootEntry } from '../common/unorganized-materials';
import { nextCandidateAssetName } from '../common/asset-naming';
import { AnalysisJson, deriveAnalysisDurationSeconds, formatDurationBadge } from '../common/analysis-summary';
import { composeMaterialAskAgentPrompt } from '../common/agent-context-packet';
import { CATALOG_CATEGORIES, CatalogItemMeta, filterCatalogItems, parseCatalogItemMeta } from '../common/catalog-reader';
import { composeCatalogAskAgentPrompt, composeCatalogImportPrompt } from '../common/catalog-context-packet';
import { assetStateBadgeText } from '../common/asset-catalog-view';
import { AssetBinChildNode, isAssetBinGroupDirectory } from '../common/asset-bin-grouping';

// パートナー拡張の公開コマンド ID とミラー（extension 間の npm 依存を作らない。
// akari-partner-command-contribution.ts の AkariPartnerCommands.INJECT_PROMPT と同一）。
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';

const AKARI_CATALOG_ROOT_PREFERENCE = 'akari.catalog.root';
const CATALOG_UNRESOLVED_MESSAGE = 'カタログの場所が未設定です（設定 akari.catalog.root）';
const ASSET_STATE_BADGE_LABEL: Record<NonNullable<AssetCatalogViewItem['state']>, string> = {
    cached: '✓ 取得済み',
    available: '☁ 未取得',
    locked: '¥ 未購入'
};

/** 上段（素材）の内部遷移先。タブではなく widget 内遷移 — U6 裁定。 */
type TopView = 'materials' | 'catalog';
type MaterialKind = 'video' | 'audio' | 'image' | 'other';
type OutputEntryKind = 'export' | 'report';

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
    /** true = プロジェクトルート直下（非再帰）の未整理素材。「assets へ移動」アクションを持つ。 */
    unorganized: boolean;
    /**
     * meta.json を含むディレクトリ = 1 素材グループのときのみ設定される（task.md 決定事項2）。
     * 設定されている場合、タイトル/サムネ/種別バッジは meta.json 由来の値で表示する。
     */
    assetGroup?: { category: string };
}

/** 下段「できたもの」の 1 件（exports/ 直下のファイル、または .akari/reports/ の HTML）。read-only。 */
interface OutputEntry {
    uri: URI;
    relativePath: string;
    name: string;
    kind: OutputEntryKind;
    mtime: number;
    size: number;
    /** report のみ: <title> から抽出した見出し。無ければ未設定（ファイル名で表示）。 */
    title?: string;
    /** export の動画/画像のみ: サムネキャッシュ。無ければアイコン表示。 */
    thumbnailUri?: URI;
}

/**
 * 非開発者モード向けの「素材」差し替えビュー。
 *
 * 標準 Explorer ツリーの代わりに、上下 2 分割のドメインビューを見せる
 * （U6 裁定 2026-08-03、正本: internal `planning/notes-2026-08-03-owner-feedback-shell-v013.md`）:
 * - 上段「素材」: assets/ カード + 未整理セクション + D&D。末尾の「＋ カタログから
 *   素材をさがす」ボタンで widget 内遷移してカタログ面を表示する（タブではない —
 *   `topView` で表示先を切り替えるだけで、両者は同じ widget インスタンスの状態）
 * - 下段「できたもの」: exports/ 直下のファイルと .akari/reports/ の HTML を
 *   新しい順に read-only 一覧表示。クリックで中央に開く（`openFile` — 既存の
 *   akari-menu-widget.openExportedArtifact と同じ `open(this.openers, uri)` 型）
 *
 * 「プラン」タブは撤去済み（2026-08-03 — 空実装 stub のため。旧 `renderEmptyTab`/
 * `TabId.plan` は削除）。素材タブはノイズ（隠しディレクトリ・サイドカー）を
 * project-tree-policy.ts の判定に委ねて隠し、analyze-footage が書く analysis.json
 * （.akari/sidecars/<素材相対パス>.analysis/analysis.json）からサムネ・尺・
 * 分析済み判定を読む。
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
    @inject(FileDialogService)
    protected readonly dialogs!: FileDialogService;
    @inject(WindowService)
    protected readonly windowService!: WindowService;

    protected topView: TopView = 'materials';
    protected materials: MaterialCardEntry[] = [];
    protected unorganizedMaterials: MaterialCardEntry[] = [];
    protected materialsLoading = false;
    protected materialsGeneration = 0;
    protected materialsWatch = new DisposableCollection();
    protected materialsWatchRootKey?: string;
    protected materialsWatchTimer?: ReturnType<typeof setTimeout>;
    protected lintAvailable = false;
    protected lintCount?: number;

    protected outputs: OutputEntry[] = [];
    protected outputsLoading = false;
    protected outputsGeneration = 0;
    protected outputsWatch = new DisposableCollection();
    protected outputsWatchRootKey?: string;
    protected outputsWatchTimer?: ReturnType<typeof setTimeout>;

    /** カタログ面「1 ビュー」= resolver 合成 + ローカル catalog/ のマージ済み一覧。 */
    protected assetCatalogItems: AssetCatalogViewItem[] = [];
    protected catalogLoading = false;
    protected catalogQuery = '';
    protected catalogCategory = 'all';
    protected readonly catalogBrokenThumbnails = new Set<string>();
    protected catalogPickError?: string;
    protected catalogPicking = false;
    protected storeConnection: StoreConnectionStatus = { connected: false };
    protected storeConnectionLoading = true;
    protected storeConnectionPhase: 'idle' | 'starting' | 'pending' | 'expired' | 'error' = 'idle';
    protected storeConnectionError?: string;
    protected storeDeviceStart?: Extract<StoreDeviceStartOutcome, { status: 'started' }>;
    protected storePollTimer?: ReturnType<typeof setTimeout>;
    protected storeFlowGeneration = 0;
    /** 「使う」クリックから resolveAsset() 完了までの in-flight 集合（key 単位）。スピナー/無効化に使う。 */
    protected readonly resolvingAssetKeys = new Set<string>();

    /**
     * カタログ面 audio カードの共有試聴プレイヤー。ウィジェット全体で 1 本だけ生成し、
     * 別カードを再生すると前の再生を止めて切り替える（同時再生 1 本 —
     * lab/asset-oneview-proto の共有プレイヤー方式）。preload しない（クリックまで
     * ネットワークへ触れない）ため src はトグル時にだけ設定する。
     */
    protected readonly catalogAudioElement: HTMLAudioElement = new Audio();
    /** 再生中カードの key。undefined は非再生中。 */
    protected playingCatalogAudioKey?: string;
    /** 直近の再生失敗カードの key。カード上へ短いエラー表示するために使う。 */
    protected catalogAudioErrorKey?: string;

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
        this.toDispose.push(this.workflow.onDidChange(() => {
            this.ensureMaterialsWatch();
            this.ensureOutputsWatch();
            this.refresh();
        }));
        this.ensureMaterialsWatch();
        this.ensureOutputsWatch();
        // カタログはワークスペース非依存（resolver 合成分・ローカル catalog/ 分ともに
        // アカウント/参照データなので）素材タブと違いプロジェクトを開く前でも読み込む。
        void this.loadAssetCatalogView();
        void this.refreshStoreConnectionStatus();
        this.catalogAudioElement.preload = 'none';
        this.catalogAudioElement.addEventListener('ended', () => {
            this.playingCatalogAudioKey = undefined;
            this.update();
        });
        this.catalogAudioElement.addEventListener('error', () => {
            // src 未設定の初期状態（'' 相当）では発火しない —
            // 実際に再生を試みていたときだけエラー扱いにする。
            if (!this.playingCatalogAudioKey) {
                return;
            }
            console.warn('[akari-project] カタログ音源の再生に失敗しました:', this.catalogAudioElement.error);
            this.catalogAudioErrorKey = this.playingCatalogAudioKey;
            this.playingCatalogAudioKey = undefined;
            this.update();
        });
        this.toDispose.push({ dispose: () => this.catalogAudioElement.pause() });
        this.toDispose.push({ dispose: () => this.stopStorePolling() });
        this.toDispose.push(this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName === AKARI_CATALOG_ROOT_PREFERENCE) {
                void this.loadAssetCatalogView();
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
        void this.loadOutputs();
        void this.refreshLint();
    }

    protected selectTopView(view: TopView): void {
        this.topView = view;
        if (view === 'catalog') {
            void this.refreshStoreConnectionStatus();
        }
        this.update();
    }

    // --- 素材カード ---------------------------------------------------------

    protected async loadMaterials(): Promise<void> {
        const root = this.workflow.workspaceRoot;
        const generation = ++this.materialsGeneration;
        if (!root) {
            this.materials = [];
            this.unorganizedMaterials = [];
            this.update();
            return;
        }
        this.materialsLoading = true;
        this.update();
        const [assetEntries, rootFiles] = await Promise.all([
            this.collectAssetEntries(root.resolve('assets')),
            this.collectUnorganizedRootFiles(root)
        ]);
        const [fileMaterials, groupMaterials, unorganizedMaterials] = await Promise.all([
            Promise.all(assetEntries.files.map(file => this.buildMaterialEntry(root, file, false))),
            Promise.all(assetEntries.assetGroups.map(dir => this.buildAssetGroupEntry(root, dir))),
            Promise.all(rootFiles.map(file => this.buildMaterialEntry(root, file, true)))
        ]);
        if (generation !== this.materialsGeneration) {
            return; // A newer load superseded this one (e.g. rapid watch events); discard stale results.
        }
        const materials = [...fileMaterials, ...groupMaterials];
        materials.sort((left, right) => left.name.localeCompare(right.name, 'ja'));
        this.materials = materials;
        this.unorganizedMaterials = unorganizedMaterials;
        this.materialsLoading = false;
        this.update();
        void this.hydrateCachedThumbnails(root, generation, [...materials, ...unorganizedMaterials]);
    }

    /**
     * `assets/` を再帰 walk し、ファイル単位の従来素材（`files`）と
     * 「meta.json を含むディレクトリ = 1 素材」のグループ（`assetGroups`）に分ける
     * （task.md 決定事項2）。判定そのものは深さに依存しない純関数
     * （asset-bin-grouping.ts の isAssetBinGroupDirectory）に委ねる — この walk は
     * 訪れたディレクトリごとにその直下の子一覧を渡して判定させているだけなので、
     * 旧配置 `assets/<id>/` 直下・新配置 `assets/<category>/<id>/` のどちらでも同じ
     * ロジックで 1 カードに集約される（受入2）。meta.json が見つかったディレクトリは
     * そこで打ち切り、配下（fragment.html 等）は展開しない。見つからなければ従来どおり
     * ファイル単位まで再帰する（受入3: 撮影素材の挙動は無変更）。
     */
    protected async collectAssetEntries(assetsRoot: URI): Promise<{ files: FileStat[]; assetGroups: FileStat[] }> {
        let stat: FileStat;
        try {
            stat = await this.files.resolve(assetsRoot);
        } catch {
            return { files: [], assetGroups: [] };
        }
        const files: FileStat[] = [];
        const assetGroups: FileStat[] = [];
        const walk = async (node: FileStat): Promise<void> => {
            for (const child of node.children ?? []) {
                const relative = this.workflow.relativePath(child.resource);
                if (!shouldShowProjectPath(relative, this.workflow.current.tree, false)) {
                    continue;
                }
                if (!child.isDirectory) {
                    files.push(child);
                    continue;
                }
                let resolvedChild: FileStat;
                try {
                    resolvedChild = await this.files.resolve(child.resource);
                } catch {
                    continue; // Directory disappeared mid-walk; skip it.
                }
                if (isAssetBinGroupDirectory(this.toAssetBinChildren(resolvedChild))) {
                    assetGroups.push(resolvedChild);
                    continue;
                }
                await walk(resolvedChild);
            }
        };
        await walk(stat);
        files.sort((left, right) => left.resource.path.base.localeCompare(right.resource.path.base, 'ja'));
        assetGroups.sort((left, right) => left.resource.path.base.localeCompare(right.resource.path.base, 'ja'));
        return { files, assetGroups };
    }

    protected toAssetBinChildren(node: FileStat): AssetBinChildNode[] {
        return (node.children ?? []).map(child => ({ name: child.resource.path.base, isDirectory: child.isDirectory }));
    }

    /**
     * プロジェクトルート**直下**（非再帰）の未整理素材を集める。判定は
     * unorganized-materials.ts の純関数（project-tree-policy.ts の既存ノイズ判定 +
     * ルート直下契約 JSON の除外）に委ねる。
     */
    protected async collectUnorganizedRootFiles(root: URI): Promise<FileStat[]> {
        let stat: FileStat;
        try {
            stat = await this.files.resolve(root);
        } catch {
            return [];
        }
        const policy = this.workflow.current.tree;
        const result = (stat.children ?? []).filter(child =>
            isUnorganizedRootEntry({ name: child.resource.path.base, isDirectory: child.isDirectory }, policy)
        );
        result.sort((left, right) => left.resource.path.base.localeCompare(right.resource.path.base, 'ja'));
        return result;
    }

    protected async buildMaterialEntry(root: URI, file: FileStat, unorganized: boolean): Promise<MaterialCardEntry> {
        const relativePath = this.workflow.relativePath(file.resource) ?? file.resource.path.base;
        const kind = this.classifyKind(file.resource.path.base);
        const analysisRelativePath = `.akari/sidecars/${relativePath}.analysis/analysis.json`;
        const analysisUri = root.resolve(analysisRelativePath);
        const analysis = await this.readAnalysis(analysisUri);
        if (!analysis) {
            return { uri: file.resource, relativePath, name: file.resource.path.base, kind, analyzed: false, unorganized };
        }
        return {
            uri: file.resource,
            relativePath,
            name: file.resource.path.base,
            kind,
            analyzed: true,
            durationSeconds: deriveAnalysisDurationSeconds(analysis),
            thumbnailUri: this.resolveThumbnail(analysisUri, analysis),
            analysisRelativePath,
            unorganized
        };
    }

    /**
     * meta.json を含むディレクトリ = 1 素材グループのカードを組み立てる。
     * タイトル = meta.title（読めなければディレクトリ名）/ サムネ = 同ディレクトリの
     * preview.png（あれば）/ 種別バッジ = meta.category（task.md 決定事項2）。
     * クリック対象（uri）はディレクトリ自体を開けないため、preview.png → meta.json →
     * ディレクトリ自身の順にフォールバックする（最低限、素材として選択できること）。
     */
    protected async buildAssetGroupEntry(root: URI, dirStat: FileStat): Promise<MaterialCardEntry> {
        const relativePath = this.workflow.relativePath(dirStat.resource) ?? dirStat.resource.path.base;
        const dirName = dirStat.resource.path.base;
        const meta = await this.readAssetGroupMeta(dirStat);
        const children = dirStat.children ?? [];
        const previewChild = children.find(child => !child.isDirectory && child.resource.path.base === 'preview.png');
        const metaChild = children.find(child => !child.isDirectory && child.resource.path.base === 'meta.json');
        const openUri = previewChild?.resource ?? metaChild?.resource ?? dirStat.resource;
        return {
            uri: openUri,
            relativePath,
            name: meta?.title || dirName,
            kind: 'other',
            analyzed: false,
            thumbnailUri: previewChild?.resource,
            unorganized: false,
            assetGroup: { category: meta?.category ?? '' }
        };
    }

    /** グループ対象ディレクトリの meta.json を寛容リーダーで読む。無い/壊れていれば undefined（呼び出し側でディレクトリ名にフォールバック）。 */
    protected async readAssetGroupMeta(dirStat: FileStat): Promise<CatalogItemMeta | undefined> {
        const metaChild = (dirStat.children ?? []).find(
            child => !child.isDirectory && child.resource.path.base === 'meta.json'
        );
        if (!metaChild) {
            return undefined;
        }
        try {
            const content = await this.files.readFile(metaChild.resource);
            return parseCatalogItemMeta(content.value.toString());
        } catch {
            return undefined;
        }
    }

    /**
     * 分析済みでない動画/画像素材について、`.akari/cache/thumbnails/` のサムネキャッシュを
     * バックエンドへ問い合わせる（優先順位: analysis keyframe > cache > プレースホルダ）。
     * 音声・分析済みは対象外。generation が古くなっていれば結果を捨てる（stale ガード）。
     */
    protected async hydrateCachedThumbnails(root: URI, generation: number, entries: MaterialCardEntry[]): Promise<void> {
        const candidates = entries.filter(entry => !entry.analyzed && (entry.kind === 'video' || entry.kind === 'image'));
        await Promise.all(candidates.map(async entry => {
            let outcome;
            try {
                outcome = await this.projectService.resolveMaterialThumbnail(root.toString(), entry.relativePath, entry.kind as 'video' | 'image');
            } catch {
                return;
            }
            if (generation !== this.materialsGeneration || !outcome.available || !outcome.cacheRelativePath) {
                return;
            }
            entry.thumbnailUri = root.resolve(outcome.cacheRelativePath);
            this.update();
        }));
    }

    // --- ライブ反映（assets/ とルート直下の watch） ---------------------------

    protected ensureMaterialsWatch(): void {
        const root = this.workflow.workspaceRoot;
        const rootKey = root?.toString();
        if (rootKey === this.materialsWatchRootKey) {
            return;
        }
        this.materialsWatch.dispose();
        this.materialsWatch = new DisposableCollection();
        this.materialsWatchRootKey = rootKey;
        if (!root) {
            return;
        }
        const assetsUri = root.resolve('assets');
        this.materialsWatch.push(this.files.watch(root));
        this.materialsWatch.push(this.files.watch(assetsUri, { recursive: true, excludes: [] }));
        this.materialsWatch.push(this.files.onDidFilesChange(event => this.handleMaterialsFileChange(root, assetsUri, event)));
    }

    protected handleMaterialsFileChange(root: URI, assetsUri: URI, event: FileChangesEvent): void {
        const rootKey = root.toString();
        const relevant = event.changes.some(change =>
            change.resource.parent.toString() === rootKey || assetsUri.isEqualOrParent(change.resource)
        );
        if (!relevant) {
            return;
        }
        if (this.materialsWatchTimer) {
            clearTimeout(this.materialsWatchTimer);
        }
        this.materialsWatchTimer = setTimeout(() => {
            this.materialsWatchTimer = undefined;
            void this.loadMaterials();
        }, 300);
    }

    // --- 未整理 → assets へ移動 ------------------------------------------------

    /**
     * 「assets へ移動」アクション。edit.json がルート相対パスでこのファイルを参照している
     * 場合に参照が壊れる可能性を移動前に警告し、承諾したときだけ FileService.move する。
     * edit.json 自体は書き換えない（契約ファイルへの書き込み禁止 — task.md 指定）。
     * 同名衝突時は recordDroppedAssets と同じ stem-index.ext 規約で連番回避し、上書きはしない。
     */
    protected async moveToAssets(entry: MaterialCardEntry): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root) {
            return;
        }
        const confirmed = await new ConfirmDialog({
            title: 'assets へ移動しますか？',
            msg: `${entry.name} を assets/ 直下へ移動します。edit.json がこのファイルをルート相対パスで参照している場合、参照が壊れる可能性があります（edit.json は自動的に書き換えません）。`,
            ok: '移動する',
            cancel: 'キャンセル'
        }).open();
        if (!confirmed) {
            return;
        }
        const assetsUri = root.resolve('assets');
        const targetName = await this.availableAssetName(assetsUri, entry.name);
        try {
            await this.files.move(entry.uri, assetsUri.resolve(targetName), { overwrite: false });
        } catch {
            this.messages.error(`${entry.name} を移動できませんでした。`);
            return;
        }
        void this.loadMaterials();
    }

    protected async availableAssetName(assetsUri: URI, requestedName: string): Promise<string> {
        let candidate = requestedName;
        let index = 2;
        while (await this.files.exists(assetsUri.resolve(candidate))) {
            candidate = nextCandidateAssetName(requestedName, index++);
        }
        return candidate;
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

    // --- できたもの（下段・read-only） -----------------------------------------

    /**
     * `exports/` 直下のファイルと `.akari/reports/` の HTML を新しい順にまとめて読み込む。
     * どちらも非再帰（直下のみ）— exports/ のサブフォルダや reports/ の PNG 視認証跡は
     * 対象外（task.md 指定: 「HTML レポート」のみ）。
     */
    protected async loadOutputs(): Promise<void> {
        const root = this.workflow.workspaceRoot;
        const generation = ++this.outputsGeneration;
        if (!root) {
            this.outputs = [];
            this.update();
            return;
        }
        this.outputsLoading = true;
        this.update();
        const [exportFiles, reportFiles] = await Promise.all([
            this.collectTopLevelFiles(root.resolve('exports')),
            this.collectTopLevelFiles(root.resolve('.akari/reports'))
        ]);
        const [exportEntries, reportEntries] = await Promise.all([
            Promise.all(exportFiles.map(file => this.buildOutputEntry(root, file, 'export'))),
            Promise.all(
                reportFiles
                    .filter(file => /\.html?$/i.test(file.resource.path.base))
                    .map(file => this.buildOutputEntry(root, file, 'report'))
            )
        ]);
        if (generation !== this.outputsGeneration) {
            return; // A newer load superseded this one; discard stale results.
        }
        const merged = [...exportEntries, ...reportEntries];
        merged.sort((left, right) => right.mtime - left.mtime);
        this.outputs = merged;
        this.outputsLoading = false;
        this.update();
        void this.hydrateOutputThumbnails(root, generation, exportEntries);
    }

    /** ディレクトリ直下のファイルのみ（非再帰・ドットファイル除外）を size/mtime 付きで返す。 */
    protected async collectTopLevelFiles(dirUri: URI): Promise<FileStatWithMetadata[]> {
        let stat: FileStatWithMetadata;
        try {
            stat = await this.files.resolve(dirUri, { resolveMetadata: true });
        } catch {
            return [];
        }
        return (stat.children ?? []).filter(child => !child.isDirectory && !child.resource.path.base.startsWith('.'));
    }

    protected async buildOutputEntry(root: URI, file: FileStatWithMetadata, kind: OutputEntryKind): Promise<OutputEntry> {
        const relativePath = this.workflow.relativePath(file.resource) ?? file.resource.path.base;
        const entry: OutputEntry = {
            uri: file.resource,
            relativePath,
            name: file.resource.path.base,
            kind,
            mtime: file.mtime,
            size: file.size
        };
        if (kind === 'report') {
            entry.title = await this.readReportTitle(file.resource);
        }
        return entry;
    }

    /** report タイトル抽出。先頭 8KB のみ読む（埋め込み base64 等で巨大なレポートを丸読みしない）。 */
    protected async readReportTitle(uri: URI): Promise<string | undefined> {
        try {
            const content = await this.files.readFile(uri, { length: 8192 });
            const match = /<title[^>]*>([^<]*)<\/title>/i.exec(content.value.toString());
            const title = match?.[1]?.trim();
            return title || undefined;
        } catch {
            return undefined;
        }
    }

    /** exports/ の動画・画像のみサムネを試みる（既存の素材サムネキャッシュを流用）。 */
    protected async hydrateOutputThumbnails(root: URI, generation: number, entries: OutputEntry[]): Promise<void> {
        const candidates = entries.filter(entry => {
            const kind = this.classifyKind(entry.name);
            return kind === 'video' || kind === 'image';
        });
        await Promise.all(candidates.map(async entry => {
            const kind = this.classifyKind(entry.name) as 'video' | 'image';
            let outcome;
            try {
                outcome = await this.projectService.resolveMaterialThumbnail(root.toString(), entry.relativePath, kind);
            } catch {
                return;
            }
            if (generation !== this.outputsGeneration || !outcome.available || !outcome.cacheRelativePath) {
                return;
            }
            entry.thumbnailUri = root.resolve(outcome.cacheRelativePath);
            this.update();
        }));
    }

    protected ensureOutputsWatch(): void {
        const root = this.workflow.workspaceRoot;
        const rootKey = root?.toString();
        if (rootKey === this.outputsWatchRootKey) {
            return;
        }
        this.outputsWatch.dispose();
        this.outputsWatch = new DisposableCollection();
        this.outputsWatchRootKey = rootKey;
        if (!root) {
            return;
        }
        const exportsUri = root.resolve('exports');
        const reportsUri = root.resolve('.akari/reports');
        this.outputsWatch.push(this.files.watch(exportsUri, { recursive: true, excludes: [] }));
        this.outputsWatch.push(this.files.watch(reportsUri, { recursive: true, excludes: [] }));
        this.outputsWatch.push(this.files.onDidFilesChange(event => this.handleOutputsFileChange(exportsUri, reportsUri, event)));
    }

    protected handleOutputsFileChange(exportsUri: URI, reportsUri: URI, event: FileChangesEvent): void {
        const relevant = event.changes.some(change =>
            exportsUri.isEqualOrParent(change.resource) || reportsUri.isEqualOrParent(change.resource)
        );
        if (!relevant) {
            return;
        }
        if (this.outputsWatchTimer) {
            clearTimeout(this.outputsWatchTimer);
        }
        this.outputsWatchTimer = setTimeout(() => {
            this.outputsWatchTimer = undefined;
            void this.loadOutputs();
        }, 300);
    }

    protected formatOutputTimestamp(mtime: number): string {
        const date = new Date(mtime);
        const pad = (value: number) => value.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    protected formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes}B`;
        }
        const units = ['KB', 'MB', 'GB'];
        let value = bytes / 1024;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex++;
        }
        return `${value.toFixed(value >= 10 ? 0 : 1)}${units[unitIndex]}`;
    }

    protected formatOutputMeta(entry: OutputEntry): string {
        const when = this.formatOutputTimestamp(entry.mtime);
        return entry.kind === 'report' ? `${when} · HTML` : `${when} · ${this.formatFileSize(entry.size)}`;
    }

    // --- カタログ ---------------------------------------------------------

    /**
     * カタログ面「1 ビュー」の読み込み。backend の getAssetCatalogView() が
     * resolver 合成分（無料 + 購入済み + 取得状態）とローカル catalog/（外部ソース系）を
     * 既にマージ済みで返すため、ここでは preference を渡して結果をそのまま保持するだけ。
     * 空配列（=完全に何も無い）のときだけ従来の「フォルダを選ぶ」空状態を出す。
     */
    protected async loadAssetCatalogView(): Promise<void> {
        this.catalogLoading = true;
        this.update();
        const preferenceRoot = this.preferences.get<string>(AKARI_CATALOG_ROOT_PREFERENCE, '');
        this.catalogPickError = undefined;
        this.assetCatalogItems = await this.projectService.getAssetCatalogView(preferenceRoot);
        this.catalogLoading = false;
        this.update();
    }

    public async refreshStoreConnectionStatus(): Promise<void> {
        this.storeConnectionLoading = true;
        this.update();
        try {
            const connection = await this.projectService.getStoreConnectionStatus();
            this.storeConnection = connection;
            if (connection.connected) {
                this.stopStorePolling();
                this.storeFlowGeneration++;
                this.storeConnectionPhase = 'idle';
                this.storeConnectionError = undefined;
                this.storeDeviceStart = undefined;
            }
        } catch (error) {
            if (this.storeConnectionPhase === 'idle') {
                this.storeConnectionPhase = 'error';
                this.storeConnectionError = `接続状態を確認できませんでした: ${this.errorMessage(error)}`;
            }
        } finally {
            this.storeConnectionLoading = false;
            this.update();
        }
    }

    protected async startStoreConnection(): Promise<void> {
        this.stopStorePolling();
        const generation = ++this.storeFlowGeneration;
        this.storeConnectionPhase = 'starting';
        this.storeConnectionError = undefined;
        this.storeDeviceStart = undefined;
        this.update();
        let outcome: StoreDeviceStartOutcome;
        try {
            outcome = await this.projectService.startStoreDeviceConnection();
        } catch (error) {
            if (generation !== this.storeFlowGeneration) {
                return;
            }
            this.storeConnectionPhase = 'error';
            this.storeConnectionError = `接続を開始できませんでした: ${this.errorMessage(error)}`;
            this.update();
            return;
        }
        if (generation !== this.storeFlowGeneration) {
            return;
        }
        if (outcome.status !== 'started') {
            this.storeConnectionPhase = 'error';
            this.storeConnectionError = outcome.error;
            this.update();
            return;
        }
        this.storeDeviceStart = outcome;
        try {
            this.windowService.openNewWindow(outcome.verificationUrl, { external: true });
        } catch (error) {
            this.storeConnectionPhase = 'error';
            this.storeConnectionError = `承認ページを開けませんでした: ${this.errorMessage(error)}`;
            this.update();
            return;
        }
        this.storeConnectionPhase = 'pending';
        this.update();
        this.scheduleStorePoll(generation, outcome.intervalMs);
    }

    protected scheduleStorePoll(generation: number, intervalMs: number): void {
        this.stopStorePolling();
        this.storePollTimer = setTimeout(() => void this.pollStoreConnection(generation), intervalMs);
    }

    protected async pollStoreConnection(generation: number): Promise<void> {
        const start = this.storeDeviceStart;
        if (generation !== this.storeFlowGeneration || !start || this.storeConnectionPhase !== 'pending') {
            return;
        }
        if (Date.now() >= start.expiresAt) {
            this.expireStoreConnection();
            return;
        }
        let outcome;
        try {
            outcome = await this.projectService.pollStoreDeviceConnection({
                baseUrl: start.baseUrl,
                deviceCode: start.deviceCode
            });
        } catch (error) {
            if (generation !== this.storeFlowGeneration) {
                return;
            }
            this.storeConnectionPhase = 'error';
            this.storeConnectionError = `接続を確認できませんでした: ${this.errorMessage(error)}`;
            this.update();
            return;
        }
        if (generation !== this.storeFlowGeneration) {
            return;
        }
        if (outcome.status === 'pending') {
            this.scheduleStorePoll(generation, start.intervalMs);
            return;
        }
        if (outcome.status === 'expired') {
            this.expireStoreConnection();
            return;
        }
        if (outcome.status === 'network-error' || outcome.status === 'error') {
            this.storeConnectionPhase = 'error';
            this.storeConnectionError = outcome.error;
            this.update();
            return;
        }
        this.stopStorePolling();
        this.storeFlowGeneration++;
        this.storeConnection = outcome.connection;
        this.storeConnectionPhase = 'idle';
        this.storeConnectionError = undefined;
        this.storeDeviceStart = undefined;
        this.update();
        await this.loadAssetCatalogView();
    }

    protected expireStoreConnection(): void {
        this.stopStorePolling();
        this.storeConnectionPhase = 'expired';
        this.storeConnectionError = '確認コードの有効期限が切れました。';
        this.storeDeviceStart = undefined;
        this.update();
    }

    protected cancelStoreConnection(): void {
        this.stopStorePolling();
        this.storeFlowGeneration++;
        this.storeConnectionPhase = 'idle';
        this.storeConnectionError = undefined;
        this.storeDeviceStart = undefined;
        this.update();
    }

    protected stopStorePolling(): void {
        if (this.storePollTimer) {
            clearTimeout(this.storePollTimer);
            this.storePollTimer = undefined;
        }
    }

    protected async disconnectStoreAccount(): Promise<void> {
        const confirmed = await new ConfirmDialog({
            title: 'AKARI アカウントの接続を解除しますか？',
            msg: 'この端末に保存された接続情報を削除します。無料素材は引き続き使えます。',
            ok: '切断する',
            cancel: 'キャンセル'
        }).open();
        if (!confirmed) {
            return;
        }
        try {
            await this.projectService.disconnectStoreAccount();
            this.cancelStoreConnection();
            this.storeConnection = { connected: false };
            this.update();
            await this.loadAssetCatalogView();
        } catch (error) {
            this.messages.error(`接続を解除できませんでした: ${this.errorMessage(error)}`);
        }
    }

    /**
     * 空状態の「フォルダを選ぶ」ボタン。ネイティブフォルダ選択 → 妥当性検証 →
     * 合格なら preference（akari.catalog.root）を User スコープへ書き込む
     * （再起動後も効くように — ワークスペース依存にしない）。書き込み後は
     * onPreferenceChanged 経由でも loadAssetCatalogView() が走るが、体感を待たせないよう
     * ここでも明示的に再読込する。不合格・キャンセル時は preference を書き換えない。
     */
    protected async pickCatalogFolder(): Promise<void> {
        const destination = await this.dialogs.showOpenDialog({
            title: 'カタログの場所を選ぶ',
            canSelectFiles: false,
            canSelectFolders: true
        });
        if (!destination) {
            return;
        }
        this.catalogPicking = true;
        this.catalogPickError = undefined;
        this.update();
        const validation = await this.validateCatalogFolder(destination);
        if (validation.valid === false) {
            this.catalogPicking = false;
            this.catalogPickError = validation.reason;
            this.update();
            return;
        }
        await this.preferences.set(AKARI_CATALOG_ROOT_PREFERENCE, destination.path.fsPath(), PreferenceScope.User);
        this.catalogPicking = false;
        void this.loadAssetCatalogView();
    }

    /**
     * 直下に task.md 指定のカテゴリディレクトリ（3d/telop/audio/broll/font/luts）が
     * 1 つでもある、または INDEX.md があれば合格とする。どちらもなければ日本語の
     * 理由を返す（呼び出し側がそのまま画面に出す）。
     */
    protected async validateCatalogFolder(uri: URI): Promise<{ valid: true } | { valid: false; reason: string }> {
        let stat: FileStat;
        try {
            stat = await this.files.resolve(uri);
        } catch {
            return { valid: false, reason: '選んだフォルダーを読み込めませんでした。もう一度お試しください。' };
        }
        const children = stat.children ?? [];
        const hasIndex = children.some(child => !child.isDirectory && child.resource.path.base === 'INDEX.md');
        const hasCategoryDirectory = children.some(
            child => child.isDirectory && (CATALOG_CATEGORIES as readonly string[]).includes(child.resource.path.base)
        );
        if (hasIndex || hasCategoryDirectory) {
            return { valid: true };
        }
        return {
            valid: false,
            reason: '選んだフォルダーにカタログの内容が見つかりません'
                + '（scene3d・overlay・still・audio・broll・font のいずれかのフォルダー、または INDEX.md が必要です）。'
        };
    }

    protected filteredCatalogItems(): AssetCatalogViewItem[] {
        return filterCatalogItems(this.assetCatalogItems, this.catalogQuery, this.catalogCategory);
    }

    protected catalogCategoryChips(): string[] {
        return Array.from(new Set(this.assetCatalogItems.map(item => item.category))).sort((left, right) => left.localeCompare(right, 'ja'));
    }

    protected setCatalogQuery(query: string): void {
        this.catalogQuery = query;
        this.update();
    }

    protected selectCatalogCategory(category: string): void {
        this.catalogCategory = category;
        this.update();
    }

    protected handleCatalogThumbnailError(item: AssetCatalogViewItem): void {
        this.catalogBrokenThumbnails.add(item.key);
        this.update();
    }

    /**
     * カタログ面 audio カードの再生/停止トグル。同じカードを再クリックすると停止し、
     * 別カードをクリックすると共有プレイヤーの再生対象を切り替える。試聴のみが目的で
     * 「使う」（useAssetCatalogItem/resolveAsset）とは完全に独立 — カタログ項目の
     * state 等は一切変更しない。
     */
    protected toggleCatalogAudio(item: AssetCatalogViewItem): void {
        if (!item.mediaUrl) {
            return;
        }
        this.catalogAudioErrorKey = undefined;
        if (this.playingCatalogAudioKey === item.key) {
            this.catalogAudioElement.pause();
            this.playingCatalogAudioKey = undefined;
            this.update();
            return;
        }
        this.catalogAudioElement.pause();
        this.catalogAudioElement.src = item.mediaUrl;
        this.playingCatalogAudioKey = item.key;
        this.update();
        this.catalogAudioElement.play().catch(error => {
            console.warn('[akari-project] カタログ音源の再生を開始できませんでした:', error);
            this.catalogAudioErrorKey = item.key;
            if (this.playingCatalogAudioKey === item.key) {
                this.playingCatalogAudioKey = undefined;
            }
            this.update();
        });
    }

    protected catalogPlaceholderIcon(category: string): string {
        switch (category) {
            case 'scene3d': return 'codicon codicon-package';
            case 'overlay': return 'codicon codicon-text-size';
            case 'still': return 'codicon codicon-file-media';
            case 'audio': return 'codicon codicon-unmute';
            case 'broll': return 'codicon codicon-device-camera-video';
            case 'font': return 'codicon codicon-symbol-key';
            default: return 'codicon codicon-file';
        }
    }

    /**
     * origin='local'（ローカル catalog/ 由来。resolver 合成分には無い項目）専用の
     * 「取り込む」「頼む」が要る CatalogItemMeta 形へ戻すアダプタ。catalog-context-packet.ts
     * は既存パケット文言をそのまま維持するため変更しない（フィールド名の対応だけをここで吸収する）。
     */
    protected toLocalCatalogItemMeta(item: AssetCatalogViewItem): CatalogItemMeta {
        return {
            id: item.id,
            category: item.category,
            title: item.title,
            description: item.description,
            tags: item.tags,
            when_to_use: item.whenToUse,
            license: item.licenseSpdx ? { spdx: item.licenseSpdx } : undefined,
            source: (item.sourceUrl || item.previewUrl) ? { url: item.sourceUrl, preview_url: item.previewUrl } : undefined
        };
    }

    /** 「取り込む」— 固定パケット。取得・配置は setup-library 系スキルの領分（origin='local' 専用）。 */
    protected async importCatalogItem(item: AssetCatalogViewItem): Promise<void> {
        await this.commandService.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, composeCatalogImportPrompt(this.toLocalCatalogItemMeta(item)));
    }

    /** 「頼む」— quick-input 1 行 → 同要素 + when_to_use 先頭 1 文 + 入力文（origin='local' 専用）。 */
    protected async askAgentAboutCatalogItem(item: AssetCatalogViewItem): Promise<void> {
        const request = await this.quickInputService.input({
            placeHolder: 'この素材で何をしますか'
        });
        if (!request || !request.trim()) {
            return;
        }
        await this.commandService.executeCommand(
            PARTNER_INJECT_PROMPT_COMMAND_ID,
            composeCatalogAskAgentPrompt(this.toLocalCatalogItemMeta(item), request)
        );
    }

    /**
     * 「使う」— origin='resolver' の無料/取得済み素材専用（resolver 直行・エージェント非経由）。
     * resolveAsset() 完了で (1) バッジを cached へ更新 (2) 素材箱（loadMaterials）を再読込して
     * 反映を確認できるようにする。in-flight は resolvingAssetKeys でスピナー/二重クリック防止。
     */
    protected async useAssetCatalogItem(item: AssetCatalogViewItem): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            return;
        }
        if (this.resolvingAssetKeys.has(item.key)) {
            return;
        }
        this.resolvingAssetKeys.add(item.key);
        this.update();
        try {
            const outcome = await this.projectService.resolveAsset(item.id, root.toString());
            // tsconfig の strict:false（strictNullChecks off）下では `!outcome.success` /
            // if-else の判別共用体絞り込みが効かない（実測で確認済み）。`=== false` の
            // 明示比較だけが確実に絞り込めるため、これを使う。
            if (outcome.success === false) {
                this.messages.error(`素材を取得できませんでした: ${outcome.error}`);
                return;
            }
            this.assetCatalogItems = this.assetCatalogItems.map(entry =>
                entry.key === item.key ? { ...entry, state: 'cached' } : entry
            );
            void this.loadMaterials();
        } catch {
            this.messages.error('素材を取得できませんでした。ネットワーク環境をご確認ください。');
        } finally {
            this.resolvingAssetKeys.delete(item.key);
            this.update();
        }
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

    /**
     * 上下 2 分割（U6）。上 = 素材（+ カタログへの widget 内遷移）/ 下 = できたもの。
     * モック比率（上がやや広い）に合わせ flex-grow 1.2 : 1 を割り当てる
     * （`planning/attachments/2026-08-03-owner-feedback-shell-v013/shell-home-mock.html`
     * の `.lp-top { flex: 1.2 }` / `.lp-bottom { flex: 1 }` と同値）。
     */
    protected override render(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{
                    flex: '1.2 1 0%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    borderBottom: '1px solid var(--theia-sideBar-border)'
                }}>
                    {this.renderMaterialsPane()}
                </div>
                <div style={{ flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    {this.renderOutputsPane()}
                </div>
                {this.renderLintBadge()}
            </div>
        );
    }

    protected renderMaterialsPane(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} data-akari-top-view={this.topView}>
                {this.topView === 'materials' && (
                    <div style={{ flex: '0 0 auto', padding: '8px 10px 4px' }}>
                        <span style={{ fontSize: '0.78em', fontWeight: 700, letterSpacing: '0.04em', opacity: 0.75 }}>素材</span>
                    </div>
                )}
                <div style={{ flex: '1 1 auto', overflow: 'auto', minHeight: 0 }}>
                    {this.topView === 'materials' ? this.renderMaterialsTab() : this.renderCatalogTab()}
                </div>
                {this.topView === 'materials' && (
                    <div style={{ flex: '0 0 auto', padding: '8px', borderTop: '1px solid var(--theia-sideBar-border)' }}>
                        <button
                            type='button'
                            className='theia-button secondary'
                            data-akari-open-catalog
                            style={{ width: '100%' }}
                            onClick={() => this.selectTopView('catalog')}
                        >
                            ＋ カタログから素材をさがす
                        </button>
                    </div>
                )}
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
        if (!this.materials.length && !this.unorganizedMaterials.length) {
            return (
                <p style={{ opacity: 0.7, padding: '16px' }}>
                    ここにはまだ素材がありません。動画・音声・画像をこのパネルへドラッグすると取り込めます。
                </p>
            );
        }
        return (
            <div>
                {this.materials.length
                    ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', padding: '10px' }}>
                        {this.materials.map(entry => this.renderMaterialCard(entry))}
                    </div>
                    : <p style={{ opacity: 0.7, padding: '10px 16px 0' }}>assets/ にはまだ素材がありません。</p>}
                {this.unorganizedMaterials.length > 0 && this.renderUnorganizedSection()}
            </div>
        );
    }

    protected renderUnorganizedSection(): React.ReactNode {
        return (
            <div style={{ borderTop: '1px solid var(--theia-sideBar-border)', marginTop: '8px' }}>
                <div style={{ padding: '10px 10px 0', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '0.85em', fontWeight: 600 }}>未整理</span>
                    <span style={{ opacity: 0.7, fontSize: '0.78em' }}>
                        プロジェクトルート直下に置かれています。「assets へ移動」で整理できます。
                    </span>
                </div>
                <div
                    data-akari-unorganized-count={this.unorganizedMaterials.length}
                    style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', padding: '10px' }}
                >
                    {this.unorganizedMaterials.map(entry => this.renderMaterialCard(entry))}
                </div>
            </div>
        );
    }

    protected renderMaterialCard(entry: MaterialCardEntry): React.ReactNode {
        return (
            <div
                key={entry.uri.toString()}
                data-akari-material-path={entry.relativePath}
                data-akari-material-unorganized={entry.unorganized ? 'true' : 'false'}
                data-akari-material-asset-group={entry.assetGroup ? 'true' : 'false'}
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
                    {entry.unorganized && (
                        <span
                            title='未整理'
                            aria-label='未整理'
                            style={{
                                position: 'absolute',
                                top: '4px',
                                left: '4px',
                                padding: '0 6px',
                                borderRadius: '8px',
                                fontSize: '0.68em',
                                lineHeight: '16px',
                                background: 'var(--theia-editorWarning-foreground)',
                                color: 'var(--theia-editor-background)'
                            }}
                        >
                            未整理
                        </span>
                    )}
                    {entry.assetGroup && (
                        <span
                            title={`種別: ${entry.assetGroup.category || '不明'}`}
                            aria-label={`種別: ${entry.assetGroup.category || '不明'}`}
                            data-akari-asset-group-category={entry.assetGroup.category}
                            style={{
                                position: 'absolute',
                                top: '4px',
                                left: '4px',
                                padding: '0 6px',
                                borderRadius: '8px',
                                fontSize: '0.68em',
                                lineHeight: '16px',
                                background: 'var(--theia-badge-background)',
                                color: 'var(--theia-badge-foreground)'
                            }}
                        >
                            {entry.assetGroup.category || '素材'}
                        </span>
                    )}
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
                {entry.unorganized && (
                    <div style={{ padding: '0 6px 6px' }}>
                        <button
                            type='button'
                            className='theia-button secondary'
                            title={`${entry.name} を assets へ移動`}
                            style={{ width: '100%', fontSize: '0.75em', padding: '2px 4px' }}
                            onClick={event => { event.stopPropagation(); void this.moveToAssets(entry); }}
                        >
                            assets へ移動
                        </button>
                    </div>
                )}
            </div>
        );
    }

    /** widget 内遷移した「カタログ」面。「← 素材にもどる」で戻る（タブではない）。 */
    protected renderCatalogTab(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                {this.renderCatalogBackBar()}
                {this.renderStoreConnectionHeader()}
                <div style={{ flex: '1 1 auto', overflow: 'auto', minHeight: 0 }}>
                    {this.renderCatalogBody()}
                </div>
            </div>
        );
    }

    protected renderCatalogBackBar(): React.ReactNode {
        return (
            <div style={{ flex: '0 0 auto', padding: '6px 8px', borderBottom: '1px solid var(--theia-sideBar-border)' }}>
                <button
                    type='button'
                    className='theia-button secondary'
                    data-akari-back-to-materials
                    onClick={() => this.selectTopView('materials')}
                >
                    ← 素材にもどる
                </button>
            </div>
        );
    }

    protected renderStoreConnectionHeader(): React.ReactNode {
        const baseStyle: React.CSSProperties = {
            flex: '0 0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '8px',
            borderBottom: '1px solid var(--theia-sideBar-border)',
            fontSize: '0.82em'
        };
        if (this.storeConnection.connected) {
            return (
                <div style={baseStyle} data-akari-store-connection='connected'>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <span style={{ color: 'var(--theia-successBackground, #3fb950)', marginRight: '4px' }}>●</span>
                            {this.storeConnection.identifier} として接続中
                        </span>
                        <button
                            type='button'
                            className='theia-button secondary'
                            data-akari-store-disconnect
                            style={{ flex: '0 0 auto', padding: '2px 8px' }}
                            onClick={() => void this.disconnectStoreAccount()}
                        >
                            切断
                        </button>
                    </div>
                </div>
            );
        }
        if (this.storeConnectionLoading && this.storeConnectionPhase === 'idle') {
            return <div style={baseStyle} data-akari-store-connection='loading'>接続状態を確認中…</div>;
        }
        if (this.storeConnectionPhase === 'starting') {
            return <div style={baseStyle} data-akari-store-connection='starting'>接続を開始しています…</div>;
        }
        if (this.storeConnectionPhase === 'pending') {
            return (
                <div style={baseStyle} data-akari-store-connection='pending'>
                    <span>ブラウザで承認してください…</span>
                    {this.storeDeviceStart?.userCode && <span style={{ opacity: 0.75 }}>確認コード: {this.storeDeviceStart.userCode}</span>}
                    <button
                        type='button'
                        className='theia-button secondary'
                        style={{ alignSelf: 'flex-start', padding: '2px 8px' }}
                        onClick={() => this.cancelStoreConnection()}
                    >
                        キャンセル
                    </button>
                </div>
            );
        }
        if (this.storeConnectionPhase === 'expired' || this.storeConnectionPhase === 'error') {
            return (
                <div style={baseStyle} data-akari-store-connection={this.storeConnectionPhase}>
                    <span style={{ color: 'var(--theia-errorForeground)' }}>{this.storeConnectionError}</span>
                    <button
                        type='button'
                        className='theia-button secondary'
                        style={{ alignSelf: 'flex-start', padding: '2px 8px' }}
                        onClick={() => void this.startStoreConnection()}
                    >
                        もう一度試す
                    </button>
                </div>
            );
        }
        return (
            <div style={baseStyle} data-akari-store-connection='disconnected'>
                <span>アカウント未接続 — 接続すると購入素材もここに並びます</span>
                <button
                    type='button'
                    className='theia-button'
                    data-akari-store-connect
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => void this.startStoreConnection()}
                >
                    AKARI アカウントを接続
                </button>
            </div>
        );
    }

    protected renderCatalogBody(): React.ReactNode {
        if (this.catalogLoading) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>読み込み中…</p>;
        }
        // resolver 合成分・ローカル catalog/ 分のどちらも 1 件も無いときだけ、
        // 従来の「フォルダを選ぶ」空状態を出す（片方にでも項目があれば一覧を出す）。
        if (!this.assetCatalogItems.length) {
            return this.renderCatalogEmptyState();
        }
        const filtered = this.filteredCatalogItems();
        return (
            <div
                style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                data-akari-catalog-item-count={this.assetCatalogItems.length}
            >
                {this.renderCatalogControls()}
                <div style={{ flex: '1 1 auto', overflow: 'auto' }}>
                    {!filtered.length
                        ? <p style={{ opacity: 0.7, padding: '16px' }}>条件に一致するカタログ項目がありません。</p>
                        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', padding: '10px' }}>
                            {filtered.map(item => this.renderCatalogCard(item))}
                        </div>}
                </div>
            </div>
        );
    }

    protected renderCatalogEmptyState(): React.ReactNode {
        return (
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
                <p style={{ margin: 0, opacity: 0.7 }}>{CATALOG_UNRESOLVED_MESSAGE}</p>
                <button
                    type='button'
                    className='theia-button secondary'
                    disabled={this.catalogPicking}
                    onClick={() => void this.pickCatalogFolder()}
                >
                    フォルダを選ぶ
                </button>
                {this.catalogPickError && (
                    <p
                        data-akari-catalog-pick-error
                        style={{ margin: 0, color: 'var(--theia-errorForeground)', fontSize: '0.85em' }}
                    >
                        {this.catalogPickError}
                    </p>
                )}
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

    /** 状態バッジ（origin='resolver' のみ）。左上のサムネオーバーレイに乗せる小片を返す。 */
    protected renderAssetStateBadge(item: AssetCatalogViewItem): React.ReactNode {
        const label = assetStateBadgeText(item);
        if (!item.state || !label) {
            return undefined;
        }
        return (
            <span
                title={ASSET_STATE_BADGE_LABEL[item.state]}
                style={{
                    position: 'absolute',
                    top: '4px',
                    left: '4px',
                    padding: '1px 5px',
                    borderRadius: '10px',
                    fontSize: '0.72em',
                    fontWeight: 600,
                    background: item.state === 'locked' ? 'var(--theia-badge-background)' : 'var(--theia-editorWidget-background)',
                    color: item.state === 'locked' ? 'var(--theia-badge-foreground)' : 'var(--theia-sideBar-foreground)',
                    border: '1px solid var(--theia-sideBar-border)'
                }}
            >
                {label}
            </span>
        );
    }

    /**
     * audio カードのサムネ右下に重ねる再生/停止ボタン。mediaUrl が無ければ何も出さない
     * （origin='local' の音源や、files[] に音声拡張子が無い項目はここで自然に非表示になる）。
     */
    protected renderCatalogAudioControl(item: AssetCatalogViewItem): React.ReactNode {
        if (item.category !== 'audio' || !item.mediaUrl) {
            return undefined;
        }
        const playing = this.playingCatalogAudioKey === item.key;
        return (
            <button
                type='button'
                title={playing ? '停止' : '試聴する'}
                aria-label={playing ? `${item.title} の再生を停止` : `${item.title} を試聴`}
                data-akari-catalog-audio-toggle
                data-akari-catalog-audio-playing={playing ? 'true' : 'false'}
                onClick={event => { event.stopPropagation(); this.toggleCatalogAudio(item); }}
                style={{
                    position: 'absolute',
                    bottom: '4px',
                    right: '4px',
                    width: '24px',
                    height: '24px',
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
                <span className={playing ? 'codicon codicon-debug-stop' : 'codicon codicon-play'} aria-hidden='true' style={{ fontSize: '12px' }} />
            </button>
        );
    }

    /** 直近の再生失敗をカード上へ短く表示する（コンソールに黙って捨てない）。 */
    protected renderCatalogAudioError(item: AssetCatalogViewItem): React.ReactNode {
        if (this.catalogAudioErrorKey !== item.key) {
            return undefined;
        }
        return (
            <p data-akari-catalog-audio-error style={{ margin: 0, color: 'var(--theia-errorForeground)', fontSize: '0.72em' }}>
                再生できませんでした
            </p>
        );
    }

    /** カード下部のアクション行。origin で「使う」（resolver）か「取り込む/頼む」（local）かを切り替える。 */
    protected renderCatalogCardActions(item: AssetCatalogViewItem): React.ReactNode {
        if (item.origin === 'local') {
            return (
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
            );
        }
        if (item.state === 'locked') {
            return (
                <button
                    type='button'
                    className='theia-button secondary'
                    disabled
                    title='購入すると使えるようになります（ストア連携は今後実装）'
                    style={{ width: '100%', fontSize: '0.78em', padding: '2px 4px', opacity: 0.7 }}
                >
                    ストアで見る
                </button>
            );
        }
        const resolving = this.resolvingAssetKeys.has(item.key);
        return (
            <button
                type='button'
                className='theia-button'
                disabled={resolving}
                title={item.state === 'cached' ? `${item.title} はプロジェクトに配置済みです` : `${item.title} を取得してプロジェクトに配置します`}
                style={{ width: '100%', fontSize: '0.78em', padding: '2px 4px' }}
                onClick={() => void this.useAssetCatalogItem(item)}
            >
                {resolving ? '取得中…' : '使う'}
            </button>
        );
    }

    protected renderCatalogCard(item: AssetCatalogViewItem): React.ReactNode {
        const thumbnailBroken = this.catalogBrokenThumbnails.has(item.key);
        const previewUrl = item.previewUrl;
        const tags = item.tags.slice(0, 3);
        return (
            <div
                key={item.key}
                title={item.title}
                data-akari-catalog-item={item.key}
                data-akari-catalog-item-state={item.state ?? 'local'}
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
                    {this.renderAssetStateBadge(item)}
                    {this.renderCatalogAudioControl(item)}
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
                        {item.licenseSpdx && (
                            <span style={{ padding: '0 4px', borderRadius: '8px', border: '1px solid var(--theia-sideBar-border)' }}>
                                {item.licenseSpdx}
                            </span>
                        )}
                    </div>
                    {this.renderCatalogAudioError(item)}
                    {this.renderCatalogCardActions(item)}
                </div>
            </div>
        );
    }

    protected renderOutputsPane(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                <div style={{
                    flex: '0 0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px 4px'
                }}>
                    <span style={{ fontSize: '0.78em', fontWeight: 700, letterSpacing: '0.04em', opacity: 0.75 }}>できたもの</span>
                    <button
                        type='button'
                        title='できたものを更新'
                        aria-label='できたものを更新'
                        data-akari-outputs-refresh
                        onClick={() => void this.loadOutputs()}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            opacity: 0.7,
                            padding: '2px 4px',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        <span className='codicon codicon-refresh' aria-hidden='true' />
                    </button>
                </div>
                <div style={{ flex: '1 1 auto', overflow: 'auto', minHeight: 0 }}>
                    {this.renderOutputsBody()}
                </div>
            </div>
        );
    }

    protected renderOutputsBody(): React.ReactNode {
        if (!this.workflow.workspaceRoot) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>プロジェクトを開いてください。</p>;
        }
        if (this.outputsLoading) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>読み込み中…</p>;
        }
        if (!this.outputs.length) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>まだありません — 書き出すとここに並びます</p>;
        }
        return (
            <div
                data-akari-outputs-count={this.outputs.length}
                style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 10px 10px' }}
            >
                {this.outputs.map(entry => this.renderOutputCard(entry))}
            </div>
        );
    }

    protected renderOutputCard(entry: OutputEntry): React.ReactNode {
        const label = entry.title ?? entry.name;
        return (
            <div
                key={entry.uri.toString()}
                data-akari-output-path={entry.relativePath}
                data-akari-output-kind={entry.kind}
                onClick={() => void this.openFile(entry.uri)}
                title={label}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    background: 'var(--theia-sideBar-background)',
                    border: '1px solid var(--theia-sideBar-border)'
                }}
            >
                <div style={{
                    width: '34px',
                    height: '22px',
                    flex: 'none',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    background: 'var(--theia-editorWidget-background)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    {entry.thumbnailUri
                        ? <img src={entry.thumbnailUri.toString()} alt='' style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span
                            className={entry.kind === 'report' ? 'codicon codicon-file-code' : this.placeholderIcon(this.classifyKind(entry.name))}
                            aria-hidden='true'
                            style={{ fontSize: '1.1em', opacity: 0.55 }}
                        />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85em' }}>
                        {label}
                    </span>
                    <span style={{ opacity: 0.65, fontSize: '0.72em' }}>
                        {this.formatOutputMeta(entry)}
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

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
