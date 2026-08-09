import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService, DisposableCollection, MessageService } from '@theia/core/lib/common';
import { OpenerService, QuickInputService, open } from '@theia/core/lib/browser';
import { ConfirmDialog, SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';
import { isOSX } from '@theia/core/lib/common/os';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent, FileStat, FileStatWithMetadata } from '@theia/filesystem/lib/common/files';
import {
    AkariProjectService,
    AssetCatalogResolverStatus,
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
import { composeMaterialAskAgentPrompt, composeOutputAskAgentPrompt } from '../common/agent-context-packet';
import { CATALOG_CATEGORIES, CatalogItemMeta, filterCatalogItems, parseCatalogItemMeta } from '../common/catalog-reader';
import { composeCatalogAskAgentPrompt, composeCatalogImportPrompt, composeCatalogPackImportPrompt } from '../common/catalog-context-packet';
import {
    assetDistributionBadgeText,
    assetStateBadgeText,
    assetStateBadgeTitle,
    CatalogPackGroup,
    deriveCatalogEmptyStateKind,
    formatCatalogPackBreakdown,
    groupCatalogItemsByPack,
    storeProductUrl,
    summarizeCatalogPackDistribution
} from '../common/asset-catalog-view';
import { AssetBinChildNode, isAssetBinGroupDirectory } from '../common/asset-bin-grouping';
import { CatalogPack } from '../common/catalog-packs';
import { AKARI_REVEAL_IN_FILE_MANAGER, AKARI_SHOW_ASSET_INFO, revealInFileManagerActionLabel } from './akari-reveal-commands';
import { buildMaterialContextMenuItems, MaterialContextMenuTarget } from '../common/material-context-menu-items';
import { openAkariContextMenu } from './akari-context-menu';
import { countReferences } from '../common/project-reference-check';
import { ElectronAkariProjectApi } from '../electron-common/electron-api';

// パートナー拡張の公開コマンド ID とミラー（extension 間の npm 依存を作らない。
// akari-partner-command-contribution.ts の AkariPartnerCommands.INJECT_PROMPT と同一）。
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';
// 姉妹拡張（タイムライン側、task 2026-08-10-timeline-clip-menu）の公開コマンド ID とミラー。
// 共有パッケージを作らず文字列を直書きする流儀（PARTNER_INJECT_PROMPT_COMMAND_ID と同じ）。
// 受け側が未合流でも executeCommand は失敗するだけなので本タスクは成立する（司令塔裁定2）。
const TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID = 'akari.timeline.addMaterialAtPlayhead';

const AKARI_CATALOG_ROOT_PREFERENCE = 'akari.catalog.root';
// 一般ユーザー向けの空状態文言（原因別。catalog-account-first-ux task.md §2）。
// どちらも `akari.catalog.root` という preference 名・「カタログの場所」という内部語を含まない
// — それらは開発者向け折りたたみ（renderDeveloperCatalogPanel）の中でのみ表記する。
const CATALOG_FETCH_FAILED_MESSAGE = '素材カタログを取得できませんでした。接続を確認して再試行してください。';
const CATALOG_EMPTY_MESSAGE = 'カタログに素材がまだありません。';

// 素材グリッド（renderMaterialsTab）専用。カタログ側 renderCatalogCard の 150px グリッドとは無関係
// — 「波及するなら素材グリッドだけに閉じる」（task.md「調べること」2）ため意図的に分けて定義する。
// gap はグリッドの gap と一致させること（calc(50% - gap/2) で最低 2 列を数式保証する）。
const MATERIAL_GRID_GAP = '8px';
// **見た目を変えたいときはこの 1 行だけ触る**（小さく = 減らす / 大きく = 増やす）。
// auto-fill なので「カード 1 枚の目標幅」であって列数の指定ではない: パネルが広いほど
// 列が増え、狭いと減る。ただし `min(…, calc(50% - gap/2))` の項が効くので **1 列には落ちない**。
//
// 34px（司令塔契約が「既定パネル幅 214px で 3 列」と書いたためレーンが導出した値）から
// 95px へ改める。理由: 214px は左パネルを畳んだ最小に近い幅で、そこを基準に 3 列を数式で
// 満たすとカード実寸が 37px まで縮み（レーン実測）、パネルを広げても auto-fill が
// 列数を増やすだけでカードが育たない（実測 499px で 10 列 × 36px）。オーナーの実機
// スクリーンショットのパネル幅（カード 2 列で 1 枚 ≈160px）から逆算した内容幅 ≈330px では
// 95px 基準で 3 列 × ≈104px となり、要望「正方形・3 列・今より 2 割ほど小さく」に一致する。
const MATERIAL_GRID_CARD_MIN_WIDTH = '95px';
const MATERIAL_GRID_COLUMNS =
    `repeat(auto-fill, minmax(min(${MATERIAL_GRID_CARD_MIN_WIDTH}, calc(50% - ${MATERIAL_GRID_GAP} / 2)), 1fr))`;

/** 上段（素材）の内部遷移先。タブではなく widget 内遷移 — U6 裁定。 */
type TopView = 'materials' | 'catalog';
type MaterialKind = 'video' | 'audio' | 'image' | 'other';
type OutputEntryKind = 'data' | 'plan' | 'export' | 'report';

const SUPPORTED_DROP_EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv|avi|wav|mp3|m4a|aac|flac|ogg|png|jpg|jpeg|gif|webp)$/i;

/**
 * 「編集データ」グループに出すルート直下の契約ファイル。project-structure-v0 §2-1
 * （ルート直下原則）がルート直下配置を認めている 3 ファイルだけを対象にする —
 * ここを増やすときは同契約の改訂が先。
 *
 * 表示名は初心者向けの日本語に差し替える（実ファイル名はメタ行に出すので同定はできる）。
 * `edit.json` は akari-preview の `akari-output-preview-open-handler`（優先度 1200）が
 * 拾ってネイティブビューワーで開くため、生 JSON は出ない。
 */
const PROJECT_DATA_FILES: ReadonlyArray<{ readonly name: string; readonly label: string }> = [
    { name: 'edit.json', label: '編集データ' },
    { name: 'captions.json', label: '字幕データ' },
    { name: 'review.json', label: 'レビュー・指摘' }
];

/** 「企画・メモ」グループに出すルート直下の md（`planning/` 配下は別途 walk する）。 */
const ROOT_PLAN_FILES: ReadonlyArray<string> = ['README.md'];

/** 下段のグループ見出しと表示順。中身が空のグループは見出しごと描画しない。 */
const OUTPUT_GROUPS: ReadonlyArray<{ readonly kind: OutputEntryKind; readonly label: string }> = [
    { kind: 'data', label: '編集データ' },
    { kind: 'plan', label: '企画・メモ' },
    { kind: 'export', label: '書き出し' },
    { kind: 'report', label: 'レポート' }
];

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

/** 下段「できたもの」の 1 件。4 グループ（編集データ / 企画・メモ / 書き出し / レポート）。read-only。 */
interface OutputEntry {
    uri: URI;
    relativePath: string;
    name: string;
    kind: OutputEntryKind;
    mtime: number;
    size: number;
    /**
     * ファイル名の代わりに出す見出し。report は HTML の <title>、plan は md の先頭 `#` 見出し、
     * data は PROJECT_DATA_FILES の日本語ラベル。取れなければ未設定（ファイル名で表示）。
     */
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
 * - 下段「できたもの」: プロジェクトの成果物を 4 グループ（編集データ / 企画・メモ /
 *   書き出し / レポート — OUTPUT_GROUPS）に分けて read-only 一覧表示。グループ内は
 *   新しい順。クリックで中央に開く（`openFile` — 既存の
 *   akari-menu-widget.openExportedArtifact と同じ `open(this.openers, uri)` 型）。
 *   開いた先の見え方は openers 側が既に持っている: `edit.json` は akari-preview の
 *   `akari-output-preview-open-handler` がネイティブビューワーで、`planning/**.md` と
 *   ルート直下 `README.md` は akari-surfaces の `AkariSurfaceOpenHandler` が整形
 *   サーフェスで開く（非開発者モードのとき）。ここは入口を足しているだけ
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
    /** ファイルをドラッグ中か（取り込み可能であることを枠で見せる。renderDropOverlay 参照）。 */
    protected dragActive = false;
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
    /** `catalog/packs.json`（無ければ空）。パック棚のグループ化はフロント側で行う。 */
    protected catalogPacks: CatalogPack[] = [];
    /**
     * resolver（アカウントの素材）の取得状態。初回読み込み前は undefined —
     * このときは空状態の原因分岐・見出し付近の件数/再試行表示のどちらも出さない
     * （読み込み中は renderCatalogBody 側の「読み込み中…」が先に出る）。
     */
    protected catalogResolver?: AssetCatalogResolverStatus;
    protected catalogLoading = false;
    protected catalogQuery = '';
    protected catalogCategory = 'all';
    protected readonly catalogBrokenThumbnails = new Set<string>();
    protected catalogPickError?: string;
    protected catalogPicking = false;
    /**
     * 「開発者向け: ローカルカタログを追加」折りたたみの開閉状態。空状態内の `<details>` と
     * 一覧表示中のヘッダ小リンク（renderCatalogDeveloperLinkRow）が同じ状態を共有する
     * （task.md 指示3「同じ導線に到達できる」）。既定は閉。
     */
    protected developerCatalogOpen = false;
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
    /**
     * 再生中カードのタイトル。再生開始時に playingCatalogAudioKey とセットで保存する
     * （検索・カテゴリでカードが一覧から消えても常設バーの表示名は失われない —
     * assetCatalogItems から都度引き直す設計だと、フィルタで消えた瞬間に参照できなくなる）。
     */
    protected playingCatalogAudioTitle?: string;
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
        // Theia 本体（frontend-application.ts）が document の **バブル段階**で
        // `dataTransfer.dropEffect = 'none'` を無条件に入れている（ウィンドウへのファイル
        // ドロップでブラウザ既定の遷移が起きるのを止めるため）。dropEffect が none のまま
        // dragover が終わるとブラウザはドロップを拒否し、**drop イベントが一度も発火しない** —
        // preventDefault だけでは足りない。実機計測（2026-08-09・CDP）: 素材パネル上で
        // dragover 19 回・types に Files・defaultPrevented true・dropEffect none・drop 0 回。
        // よって自前で copy を宣言し、Theia の document ハンドラまで到達させない
        // （ホームの取り込みゾーン akari-home-widget#handleDragOver が既にこの 3 点セットで
        //   動いており、本パネルだけが dragover を持たず取り残されていた）。
        this.node.addEventListener('dragover', event => this.handleDragOver(event));
        this.node.addEventListener('dragleave', event => this.handleDragLeave(event));
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
            this.playingCatalogAudioTitle = undefined;
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
            this.playingCatalogAudioTitle = undefined;
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

    /**
     * widget が非表示になるとき（タブ切替・activity bar 切替で explorer 側に譲るときなど）
     * カタログ試聴を止める（task.md 指示3「離脱で停止」）。dispose 時の pause
     * （コンストラクタの toDispose push）は破棄そのものへの後始末で、hide はそれとは別に
     * 「見えなくなったら止める」を担う。
     */
    protected override onAfterHide(msg: Message): void {
        super.onAfterHide(msg);
        this.stopCatalogAudio();
    }

    protected refresh(): void {
        void this.loadMaterials();
        void this.loadOutputs();
        void this.refreshLint();
    }

    protected selectTopView(view: TopView): void {
        if (this.topView === 'catalog' && view !== 'catalog') {
            // 「← 素材にもどる」でカタログ面を離れるとき（task.md 指示3「離脱で停止」）。
            this.stopCatalogAudio();
        }
        this.topView = view;
        if (view === 'catalog') {
            void this.refreshStoreConnectionStatus();
        }
        this.update();
    }

    /**
     * F12「カタログを開く」コマンド（task 2026-08-05-welcome-screen）専用の公開
     * エントリ。`akari-home-widget.tsx` の `openIntakeForm` と同じ流儀 — widget
     * 自身は呼び出し元（コマンド）を意識せず、表示先の出し分け（left/main area・
     * developer mode の出し分けとの衝突回避）は呼び出し側
     * （AkariCatalogCommandContribution）の責務にする。
     */
    openCatalogView(): void {
        this.selectTopView('catalog');
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

    // --- 右クリックメニュー（素材カード・できたもの共通。task 2026-08-09-material-context-menu-mvp） ---

    /**
     * 素材カード（未整理含む）の右クリックメニューを開く。既存クリック挙動は
     * 変えない — ここは onContextMenu の追加のみで renderMaterialCard へ配線する
     * （受入5）。
     */
    protected openMaterialContextMenu(event: React.MouseEvent<HTMLDivElement>, entry: MaterialCardEntry): void {
        event.preventDefault();
        event.stopPropagation();
        const target: MaterialContextMenuTarget = entry.unorganized ? 'unorganized' : 'material';
        openAkariContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: buildMaterialContextMenuItems(target, isOSX, { materialKind: entry.kind }),
            onSelect: id => this.handleMaterialContextMenuAction(id, entry)
        });
    }

    protected handleMaterialContextMenuAction(id: string, entry: MaterialCardEntry): void {
        switch (id) {
            case 'open':
                void this.openFile(entry.uri);
                break;
            case 'add-to-timeline':
                void this.addMaterialToTimeline(entry);
                break;
            case 'reveal':
                void this.revealInFileManagerCommand(entry.uri);
                break;
            case 'copy-file':
                void this.copyFileToClipboard(entry.uri);
                break;
            case 'copy-path':
                void this.copyPathToClipboard(entry.uri);
                break;
            case 'show-info':
                void this.showAssetInfo(entry.uri);
                break;
            case 'rename': {
                const renameTarget = this.materialFileSystemTarget(entry);
                void this.renameEntry(renameTarget.uri, entry.name, entry.relativePath, renameTarget.isDirectory, () => this.loadMaterials());
                break;
            }
            case 'delete': {
                const deleteTarget = this.materialFileSystemTarget(entry);
                void this.deleteEntry(deleteTarget.uri, entry.name, entry.relativePath, deleteTarget.isDirectory, () => this.loadMaterials());
                break;
            }
            case 'ask-agent':
                void this.askAgent(entry);
                break;
            case 'move-to-assets':
                void this.moveToAssets(entry);
                break;
            default:
                break;
        }
    }

    /**
     * 「タイムラインに追加」（送信側のみ、task 2026-08-10-material-menu-r2 指示2）。
     * 受け側（姉妹タスク 2026-08-10-timeline-clip-menu）のコマンド未登録も含め、失敗は
     * 握って messages.error に落とす（司令塔裁定2 — 実機ではほぼ同時に合流するため雑でよい）。
     */
    protected async addMaterialToTimeline(entry: MaterialCardEntry): Promise<void> {
        try {
            await this.commandService.executeCommand(TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID, {
                relativePath: entry.relativePath,
                kind: entry.kind
            });
        } catch {
            this.messages.error('タイムライン機能の更新が必要です。');
        }
    }

    /**
     * 「素材の情報を表示」（task 2026-08-10-material-menu-r2 指示2・3）。実処理
     * （パネルの reveal/activate・showAsset）は `AkariProjectContribution#showAssetInfo`
     * に委ねる（司令塔裁定5 — ApplicationShell 経由の widget 操作は akari-project 側に集約）。
     */
    protected async showAssetInfo(uri: URI): Promise<void> {
        await this.commandService.executeCommand(AKARI_SHOW_ASSET_INFO.id, uri);
    }

    /**
     * リネーム/削除の実操作対象を求める。素材グループ（`entry.assetGroup` あり）は
     * `entry.uri` がグループディレクトリ直下の preview.png / meta.json（`buildAssetGroupEntry`
     * 参照）のため、対象はその親ディレクトリになる（指示5「ディレクトリ名の変更になる」）。
     * それ以外（通常素材・未整理）は `entry.uri` 自身がファイル。
     */
    protected materialFileSystemTarget(entry: MaterialCardEntry): { uri: URI; isDirectory: boolean } {
        return entry.assetGroup ? { uri: entry.uri.parent, isDirectory: true } : { uri: entry.uri, isDirectory: false };
    }

    protected async revealInFileManagerCommand(uri: URI): Promise<void> {
        await this.commandService.executeCommand(AKARI_REVEAL_IN_FILE_MANAGER.id, uri);
    }

    protected async copyPathToClipboard(uri: URI): Promise<void> {
        try {
            await navigator.clipboard.writeText(uri.path.fsPath());
        } catch {
            this.messages.error('パスをコピーできませんでした。');
        }
    }

    /** 「ファイルをコピー」v0 = macOS のみ（司令塔裁定2）。新 IPC（指示7）を叩く。 */
    protected async copyFileToClipboard(uri: URI): Promise<void> {
        const api = (window as Window & { electronAkariProject?: ElectronAkariProjectApi }).electronAkariProject;
        if (!api) {
            this.messages.error('この機能は AKARI Video アプリでのみ使えます。');
            return;
        }
        const result = await api.copyFileToClipboard(uri.path.fsPath());
        if (result.ok) {
            this.messages.info('ファイルをコピーしました。Finder で ⌘V で貼り付けられます。');
        } else {
            this.messages.error(result.message ?? 'ファイルをコピーできませんでした。');
        }
    }

    /**
     * `edit.json` / `captions.json` をプロジェクトルートから読む（無ければスキップ）。
     * どちらかの読み取りに失敗したときは `failed: true` を返し、呼び出し側は
     * 「参照を確認できませんでした」文面に切り替える（指示9）。書き込みは一切しない。
     */
    protected async readProjectReferenceDocuments(root: URI): Promise<{ documents: string[]; failed: boolean }> {
        const documents: string[] = [];
        let failed = false;
        for (const name of ['edit.json', 'captions.json']) {
            const uri = root.resolve(name);
            let exists: boolean;
            try {
                exists = await this.files.exists(uri);
            } catch {
                failed = true;
                continue;
            }
            if (!exists) {
                continue;
            }
            try {
                const content = await this.files.readFile(uri);
                documents.push(content.value.toString());
            } catch {
                failed = true;
            }
        }
        return { documents, failed };
    }

    /**
     * リネーム前の参照警告（指示5）。参照が 0 件（かつ読み取り成功）なら確認なしで続行して
     * よい（true を返す）。1 件以上、または参照チェック自体が失敗したときは
     * moveToAssets と同じ文体の ConfirmDialog で警告する。
     */
    protected async confirmReferenceImpact(relativePath: string, isDirectory: boolean, actionLabel: string): Promise<boolean> {
        const root = this.workflow.workspaceRoot;
        if (!root) {
            return true;
        }
        const { documents, failed } = await this.readProjectReferenceDocuments(root);
        const count = failed ? undefined : countReferences(documents, relativePath, isDirectory);
        if (count === 0) {
            return true;
        }
        const message = count === undefined
            ? '参照を確認できませんでした。このまま進めると edit.json / captions.json の参照が壊れる可能性があります（edit.json は自動的に書き換えません）。'
            : `edit.json / captions.json から ${count} 箇所参照されています。`
                + `${actionLabel}すると参照が壊れる可能性があります（edit.json は自動的に書き換えません）。`;
        const confirmed = await new ConfirmDialog({
            title: `${actionLabel}しますか？`,
            msg: message,
            ok: '続ける',
            cancel: 'キャンセル'
        }).open();
        return !!confirmed;
    }

    /** 削除確認メッセージに参照チェック結果を必ず含める（指示6）。 */
    protected async buildDeleteReferenceMessage(relativePath: string, isDirectory: boolean): Promise<string> {
        const root = this.workflow.workspaceRoot;
        if (!root) {
            return '参照を確認できませんでした。';
        }
        const { documents, failed } = await this.readProjectReferenceDocuments(root);
        if (failed) {
            return '参照を確認できませんでした。';
        }
        const count = countReferences(documents, relativePath, isDirectory);
        return count > 0
            ? `edit.json / captions.json から ${count} 箇所参照されています。削除すると参照が壊れます。`
            : 'プロジェクトデータからの参照は見つかりませんでした。';
    }

    /**
     * 名前を変更（指示5）。参照ありなら SingleTextInputDialog の前に ConfirmDialog で警告する。
     * 同一ディレクトリ内での `FileService.move`（overwrite: false）。衝突・失敗時は
     * messages.error。成功後は呼び出し側が渡した `reload` で再読込する。
     */
    protected async renameEntry(uri: URI, currentName: string, relativePath: string, isDirectory: boolean, reload: () => void): Promise<void> {
        const proceed = await this.confirmReferenceImpact(relativePath, isDirectory, '名前を変更');
        if (!proceed) {
            return;
        }
        const newName = await new SingleTextInputDialog({
            title: '名前を変更',
            initialValue: currentName
        }).open();
        if (!newName || !newName.trim() || newName.trim() === currentName) {
            return;
        }
        const targetUri = uri.parent.resolve(newName.trim());
        try {
            await this.files.move(uri, targetUri, { overwrite: false });
        } catch {
            this.messages.error(`${currentName} の名前を変更できませんでした。`);
            return;
        }
        reload();
    }

    /**
     * 削除（指示6）。参照チェック結果を必ず含む ConfirmDialog → OK で
     * `FileService.delete(uri, { recursive: true, useTrash: true })`（恒久削除はしない）。
     * 失敗時は messages.error。成功後は呼び出し側が渡した `reload` で再読込する。
     */
    protected async deleteEntry(uri: URI, name: string, relativePath: string, isDirectory: boolean, reload: () => void): Promise<void> {
        const referenceMessage = await this.buildDeleteReferenceMessage(relativePath, isDirectory);
        const confirmed = await new ConfirmDialog({
            title: `${name} を削除しますか？`,
            msg: `${referenceMessage} 削除するとゴミ箱に移動します。`,
            ok: '削除する',
            cancel: 'キャンセル'
        }).open();
        if (!confirmed) {
            return;
        }
        try {
            await this.files.delete(uri, { recursive: true, useTrash: true });
        } catch {
            this.messages.error(`${name} を削除できませんでした。`);
            return;
        }
        reload();
    }

    // --- できたもの（下段・read-only） -----------------------------------------

    /**
     * 下段の 4 グループをまとめて読み込む。グループ内は新しい順、グループ間の順序は
     * OUTPUT_GROUPS の並び（描画側で束ねる）。
     *
     * - 編集データ: ルート直下の PROJECT_DATA_FILES（あるものだけ）
     * - 企画・メモ: `planning/` 配下の md（再帰）+ ルート直下の ROOT_PLAN_FILES
     * - 書き出し: `exports/` 直下（非再帰 — サブフォルダは対象外）
     * - レポート: `.akari/reports/` 直下の HTML のみ（PNG 視認証跡は対象外）
     *
     * 素材（`assets/`）は上段の持ち物なのでここには出さない。`.akari/work/` `.akari/cache/`
     * `.akari/sidecars/` も出さない — project-structure-v0 §2-2 が「再生成可能・削除安全な
     * 中間物」と定義した層であり、非開発者ビューが隠す対象そのものだから。
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
        const [dataFiles, planFiles, exportFiles, reportFiles] = await Promise.all([
            this.collectRootFilesNamed(root, PROJECT_DATA_FILES.map(file => file.name)),
            this.collectPlanFiles(root),
            this.collectTopLevelFiles(root.resolve('exports')),
            this.collectTopLevelFiles(root.resolve('.akari/reports'))
        ]);
        const [dataEntries, planEntries, exportEntries, reportEntries] = await Promise.all([
            Promise.all(dataFiles.map(file => this.buildOutputEntry(root, file, 'data'))),
            Promise.all(planFiles.map(file => this.buildOutputEntry(root, file, 'plan'))),
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
        const merged = [...dataEntries, ...planEntries, ...exportEntries, ...reportEntries];
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

    /** ルート直下から、指定した名前のファイルだけを（実在するものだけ）拾う。順序は names の並び。 */
    protected async collectRootFilesNamed(root: URI, names: readonly string[]): Promise<FileStatWithMetadata[]> {
        const children = await this.collectTopLevelFiles(root);
        const byName = new Map(children.map(child => [child.resource.path.base, child]));
        return names.map(name => byName.get(name)).filter((child): child is FileStatWithMetadata => !!child);
    }

    /**
     * 「企画・メモ」の対象を集める。`planning/` は再帰（スキルが下位分類を切ることがある）、
     * ルート直下は ROOT_PLAN_FILES のみ。どちらも md だけ。
     */
    protected async collectPlanFiles(root: URI): Promise<FileStatWithMetadata[]> {
        const [planning, rootFiles] = await Promise.all([
            this.collectMarkdownRecursively(root.resolve('planning')),
            this.collectRootFilesNamed(root, ROOT_PLAN_FILES)
        ]);
        return [...rootFiles, ...planning];
    }

    /** ディレクトリ配下の md を再帰的に集める（ドット始まりのファイル/ディレクトリは除外）。 */
    protected async collectMarkdownRecursively(dirUri: URI): Promise<FileStatWithMetadata[]> {
        let stat: FileStatWithMetadata;
        try {
            stat = await this.files.resolve(dirUri, { resolveMetadata: true });
        } catch {
            return [];
        }
        const found: FileStatWithMetadata[] = [];
        const walk = async (node: FileStatWithMetadata): Promise<void> => {
            for (const child of node.children ?? []) {
                if (child.resource.path.base.startsWith('.')) {
                    continue;
                }
                if (!child.isDirectory) {
                    if (/\.md$/i.test(child.resource.path.base)) {
                        found.push(child);
                    }
                    continue;
                }
                try {
                    await walk(await this.files.resolve(child.resource, { resolveMetadata: true }));
                } catch {
                    continue; // Directory disappeared mid-walk; skip it.
                }
            }
        };
        await walk(stat);
        return found;
    }

    protected async buildOutputEntry(root: URI, file: FileStatWithMetadata, kind: OutputEntryKind): Promise<OutputEntry> {
        const relativePath = this.workflow.relativePath(file.resource) ?? file.resource.path.base;
        const name = file.resource.path.base;
        const entry: OutputEntry = {
            uri: file.resource,
            relativePath,
            name,
            kind,
            mtime: file.mtime,
            size: file.size
        };
        if (kind === 'report') {
            entry.title = await this.readReportTitle(file.resource);
        } else if (kind === 'plan') {
            entry.title = await this.readMarkdownTitle(file.resource);
        } else if (kind === 'data') {
            entry.title = PROJECT_DATA_FILES.find(candidate => candidate.name === name)?.label;
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

    /**
     * md の見出し抽出（先頭の `# …` 1 本）。readReportTitle と同じく先頭 8KB のみ読む。
     * frontmatter しか無い / 見出しが無い md は undefined（ファイル名で表示される）。
     */
    protected async readMarkdownTitle(uri: URI): Promise<string | undefined> {
        try {
            const content = await this.files.readFile(uri, { length: 8192 });
            const match = /^#[ \t]+(.+)$/m.exec(content.value.toString());
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
        const planningUri = root.resolve('planning');
        this.outputsWatch.push(this.files.watch(exportsUri, { recursive: true, excludes: [] }));
        this.outputsWatch.push(this.files.watch(reportsUri, { recursive: true, excludes: [] }));
        this.outputsWatch.push(this.files.watch(planningUri, { recursive: true, excludes: [] }));
        this.outputsWatch.push(this.files.watch(root));
        this.outputsWatch.push(this.files.onDidFilesChange(event =>
            this.handleOutputsFileChange(root, { exportsUri, reportsUri, planningUri }, event)
        ));
    }

    protected handleOutputsFileChange(
        root: URI,
        watched: { exportsUri: URI; reportsUri: URI; planningUri: URI },
        event: FileChangesEvent
    ): void {
        const rootKey = root.toString();
        // ルート直下は名前で絞る。`.akari/cache/` の書き込みでも親（`.akari`）の変更として
        // ここに届くため、素通しにすると自分のサムネ生成で再読み込みループが回る。
        const watchedRootNames = new Set([...PROJECT_DATA_FILES.map(file => file.name), ...ROOT_PLAN_FILES]);
        const relevant = event.changes.some(change =>
            watched.exportsUri.isEqualOrParent(change.resource)
            || watched.reportsUri.isEqualOrParent(change.resource)
            || watched.planningUri.isEqualOrParent(change.resource)
            || (change.resource.parent.toString() === rootKey && watchedRootNames.has(change.resource.path.base))
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
        switch (entry.kind) {
            case 'report':
                return `${when} · HTML`;
            case 'export':
                return `${when} · ${this.formatFileSize(entry.size)}`;
            // data / plan は見出しを日本語ラベルや md 見出しに差し替えているため、
            // 実ファイルの同定ができるようメタ行に元のパスを出す。
            case 'data':
                return `${when} · ${entry.name}`;
            default:
                return `${when} · ${entry.relativePath}`;
        }
    }

    protected outputIcon(entry: OutputEntry): string {
        switch (entry.kind) {
            case 'report': return 'codicon codicon-file-code';
            case 'data': return 'codicon codicon-json';
            case 'plan': return 'codicon codicon-book';
            default: return this.placeholderIcon(this.classifyKind(entry.name));
        }
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
        const view = await this.projectService.getAssetCatalogView(preferenceRoot);
        this.assetCatalogItems = view.items;
        this.catalogPacks = view.packs;
        this.catalogResolver = view.resolver;
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
            this.stopCatalogAudio();
            return;
        }
        this.catalogAudioElement.pause();
        this.catalogAudioElement.src = item.mediaUrl;
        this.playingCatalogAudioKey = item.key;
        this.playingCatalogAudioTitle = item.title;
        this.update();
        this.catalogAudioElement.play().catch(error => {
            console.warn('[akari-project] カタログ音源の再生を開始できませんでした:', error);
            this.catalogAudioErrorKey = item.key;
            if (this.playingCatalogAudioKey === item.key) {
                this.playingCatalogAudioKey = undefined;
                this.playingCatalogAudioTitle = undefined;
            }
            this.update();
        });
    }

    /**
     * カタログ試聴の唯一の停止経路。常設バーの停止ボタン・面外クリック・面からの離脱・
     * widget の非表示のすべてがここを呼ぶ（task.md 指示1・2・3の共通実装）。
     * 何も再生していないときは no-op — 面内クリックのたびに無条件で呼んでも安全。
     */
    protected stopCatalogAudio(): void {
        if (!this.playingCatalogAudioKey) {
            return;
        }
        this.catalogAudioElement.pause();
        this.playingCatalogAudioKey = undefined;
        this.playingCatalogAudioTitle = undefined;
        this.update();
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

    /** パック棚ヘッダ「まとめて取り込む」の対象 = パック内の未 installed の free 品目。 */
    protected packImportCandidates(group: CatalogPackGroup): AssetCatalogViewItem[] {
        return group.items.filter(item => !item.installed && item.distribution === 'free');
    }

    /**
     * パック棚ヘッダ「まとめて取り込む」— 個別カードの「取り込む」と同じ思想
     * （アプリ自身は DL しない。定型プロンプトをエージェントへ投げるだけ）。
     * 対象 0 件（全品目が同梱済み or 無料 DL 以外）のときは何もしない
     * （呼び出し側のボタンも disabled にする）。
     */
    protected async importCatalogPack(group: CatalogPackGroup): Promise<void> {
        const candidates = this.packImportCandidates(group);
        if (!candidates.length) {
            return;
        }
        await this.commandService.executeCommand(
            PARTNER_INJECT_PROMPT_COMMAND_ID,
            composeCatalogPackImportPrompt(group.pack.title, candidates.map(item => this.toLocalCatalogItemMeta(item)))
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

    /**
     * ドロップを受け付ける意思表示。`preventDefault` + `dropEffect='copy'` + `stopPropagation`
     * の 3 点セットで初めてブラウザが drop を発火させる（理由はコンストラクタのコメント）。
     * ファイル以外のドラッグ（タブの並べ替え等）には触らない。
     */
    protected handleDragOver(event: DragEvent): void {
        const transfer = event.dataTransfer;
        if (!transfer || !transfer.types.includes('Files')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        transfer.dropEffect = 'copy';
        this.setDragActive(true);
    }

    /**
     * ドラッグがパネルの外へ出たときだけ表示を消す。子要素をまたぐたびに dragleave が
     * 飛ぶため、`relatedTarget`（次にホバーする要素）がパネル内ならまだ出ていない。
     * これを見ないと、カードの上を横切るたびに枠が点滅する。
     */
    protected handleDragLeave(event: DragEvent): void {
        const next = event.relatedTarget;
        if (next instanceof Node && this.node.contains(next)) {
            return;
        }
        this.setDragActive(false);
    }

    protected setDragActive(active: boolean): void {
        if (this.dragActive === active) {
            return;
        }
        this.dragActive = active;
        this.update();
    }

    protected handleDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.setDragActive(false);
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
                // 成功時に何も出さないと、一覧の更新に気づかない限り「無反応」に見える
                // （ホームの取り込みゾーンは以前から成功トーストを出している。ここだけ無言だった）。
                this.messages.info(`${imported} 件を素材に取り込みました。`);
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

    /**
     * ドラッグ中の「ここに落とせる」表示。ホームの取り込みゾーン
     * （akari-home-widget#renderDropOverlay）と同一の見た目にする — 破線枠は
     * `--theia-focusBorder`、塗りは `--theia-list-dropBackground`。どちらも
     * akari-theme がアクセント（オレンジ）に上書きしているのでブランド色で出る。
     * `pointerEvents: 'none'` は必須（重ねた要素が dragover を食うと点滅する）。
     */
    protected renderDropOverlay(): React.ReactNode {
        return (
            <div
                role='status'
                aria-live='polite'
                data-akari-drop-overlay='true'
                style={{
                    position: 'absolute', inset: '4px', zIndex: 20, pointerEvents: 'none',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                    background: 'var(--theia-list-dropBackground, rgba(127,127,127,0.12))',
                    border: '2px dashed var(--theia-focusBorder)', borderRadius: 8,
                    color: 'var(--theia-editorWidget-foreground)', textAlign: 'center', padding: '0 8px'
                }}
            >
                <span className='codicon codicon-cloud-upload' aria-hidden='true' style={{ fontSize: 22 }} />
                <strong style={{ fontSize: 12.5, lineHeight: 1.4 }}>ここに落とすと素材に取り込みます</strong>
            </div>
        );
    }

    protected renderMaterialsPane(): React.ReactNode {
        return (
            <div
                style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}
                data-akari-top-view={this.topView}
            >
                {this.dragActive && this.renderDropOverlay()}
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
                    ? <div style={{ display: 'grid', gridTemplateColumns: MATERIAL_GRID_COLUMNS, gap: MATERIAL_GRID_GAP, padding: '10px' }}>
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
                    style={{ display: 'grid', gridTemplateColumns: MATERIAL_GRID_COLUMNS, gap: MATERIAL_GRID_GAP, padding: '10px' }}
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
                onContextMenu={event => this.openMaterialContextMenu(event, entry)}
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
                        aspectRatio: '1 / 1',
                        background: 'var(--theia-editorWidget-background)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    {entry.thumbnailUri
                        // position: absolute で img をフレックスの外に出す。flex 子のまま
                        // height:'100%' にすると、親の aspectRatio:1/1 を無視して img 自身の
                        // 縦長比率で高さが決まってしまう（実機 CDP 計測で確認済みの挙動）。
                        ? <img
                            src={entry.thumbnailUri.toString()}
                            alt=''
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
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
                {/* 3 列運用（カード実測 ~40px）だと名前+時間の横並びは名前側が幅 0 に潰れて消える
                    （overflow:hidden の flex 子は自動最小幅が 0 になり、時間バッジに幅を奪われ切る —
                    実機 CDP 計測で確認済み）。縦積みにしてそれぞれへ全幅を渡す。 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', padding: '4px 6px' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78em' }}>
                        {entry.name}
                    </span>
                    <span style={{ opacity: 0.7, fontSize: '0.68em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

    /**
     * widget 内遷移した「カタログ」面。「← 素材にもどる」で戻る（タブではない）。
     *
     * 面内クリックでの試聴停止（task.md 指示2「面外クリックで停止」— オーナー要望の
     * 直訳「他の場所押したら再生停止する」）をこの面のルート要素 1 箇所の onClick で拾う。
     * 再生ボタン（renderCatalogAudioControl）と常設バー（renderCatalogAudioBar）は
     * 自身の onClick で event.stopPropagation() しているため、ここへは届かず誤って
     * 停止しない。それ以外（検索チップ・カード・「取り込む」「頼む」「使う」等）は
     * すべてバブリングで到達し、停止する（カードの動詞ボタン自体の動作は妨げない —
     * stopCatalogAudio は音声だけを止め、各ボタンの本来の onClick は別途そのまま走る）。
     */
    protected renderCatalogTab(): React.ReactNode {
        return (
            <div
                style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
                onClick={() => this.stopCatalogAudio()}
            >
                {this.renderCatalogBackBar()}
                {this.renderCatalogAccountHeader()}
                {this.renderStoreConnectionHeader()}
                <div style={{ flex: '1 1 auto', overflow: 'auto', minHeight: 0 }}>
                    {this.renderCatalogBody()}
                </div>
            </div>
        );
    }

    /**
     * 「アカウントで使える素材の棚」だと画面を見ただけで分かるための 1 行見出し
     * （task.md 指示4）。読み込み状態・空/一覧のどちらでも常に出す — 一般ユーザーが
     * この面の性質を最初に理解する手がかりにするため。リモート取得状態（件数 / 失敗時の
     * 再試行）はここに小さく添える。0 件で resolver 失敗のときは renderCatalogEmptyState
     * 側の大きい案内が主役になるため、ここでの再試行はあくまで補助（重複は許容 —
     * ローカル catalog/ 分だけで一覧が出ているケースでは、ここの表示だけが resolver 失敗の
     * 唯一の手がかりになる）。
     */
    protected renderCatalogAccountHeader(): React.ReactNode {
        const resolver = this.catalogResolver;
        return (
            <div
                data-akari-catalog-account-header
                style={{
                    flex: '0 0 auto',
                    padding: '8px 8px 0',
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '8px',
                    flexWrap: 'wrap'
                }}
            >
                <span style={{ fontWeight: 600, fontSize: '0.92em' }}>このアカウントで使える素材 — 無料 + 購入済み</span>
                {resolver?.status === 'ok' && (
                    <span data-akari-catalog-resolver-count style={{ fontSize: '0.78em', opacity: 0.65 }}>
                        カタログ {resolver.itemCount} 件
                    </span>
                )}
                {resolver?.status === 'failed' && (
                    <button
                        type='button'
                        className='theia-button secondary'
                        data-akari-catalog-retry-inline
                        style={{ fontSize: '0.75em', padding: '1px 8px' }}
                        onClick={() => void this.loadAssetCatalogView()}
                    >
                        取得失敗 — 再試行
                    </button>
                )}
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
        const { groups, ungrouped } = groupCatalogItemsByPack(filtered, this.catalogPacks);
        return (
            <div
                style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                data-akari-catalog-item-count={this.assetCatalogItems.length}
            >
                {this.renderCatalogControls()}
                {this.renderCatalogAudioBar()}
                <div style={{ flex: '1 1 auto', overflow: 'auto' }}>
                    {!filtered.length
                        ? <p style={{ opacity: 0.7, padding: '16px' }}>条件に一致するカタログ項目がありません。</p>
                        : <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 0' }}>
                            {groups.map(group => this.renderCatalogPackSection(group))}
                            {ungrouped.length > 0 && (
                                <div
                                    style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', padding: '0 10px' }}
                                >
                                    {ungrouped.map(item => this.renderCatalogCard(item))}
                                </div>
                            )}
                        </div>}
                </div>
            </div>
        );
    }

    /**
     * パック棚 1 件分（ヘッダ = タイトル + 内訳 + まとめて取り込む + summary、下にカード群）。
     * data-akari-catalog-pack-* は目視検収・E2E 用のフック。
     */
    protected renderCatalogPackSection(group: CatalogPackGroup): React.ReactNode {
        const candidates = this.packImportCandidates(group);
        return (
            <div
                key={`pack:${group.pack.id}`}
                data-akari-catalog-pack={group.pack.id}
                style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 10px 10px', borderBottom: '1px solid var(--theia-sideBar-border)' }}
            >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700 }}>{group.pack.title}</span>
                        <span data-akari-catalog-pack-breakdown style={{ fontSize: '0.78em', opacity: 0.75 }}>
                            {formatCatalogPackBreakdown(summarizeCatalogPackDistribution(group.items))}
                        </span>
                    </div>
                    <button
                        type='button'
                        className='theia-button secondary'
                        disabled={!candidates.length}
                        data-akari-catalog-pack-import
                        title={candidates.length
                            ? `未取得の無料素材 ${candidates.length} 件をまとめてエージェントに取り込ませる`
                            : 'まとめて取り込める未取得の無料素材はありません'}
                        style={{ fontSize: '0.78em', padding: '2px 8px', opacity: candidates.length ? 1 : 0.6 }}
                        onClick={() => void this.importCatalogPack(group)}
                    >
                        まとめて取り込む
                    </button>
                </div>
                {group.pack.summary && (
                    <p style={{ margin: 0, fontSize: '0.78em', opacity: 0.75 }}>{group.pack.summary}</p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
                    {group.items.map(item => this.renderCatalogCard(item))}
                </div>
            </div>
        );
    }

    /**
     * カタログ 0 件の空状態。原因（resolver 取得失敗 / 取得できたが 0 件）で文言を分ける
     * （deriveCatalogEmptyStateKind — task.md 指示2）。resolverStatus が未読み込み（undefined）
     * のときは 'empty' 相当の素直な文言にフォールバックする（catalogLoading=true の間は
     * renderCatalogBody が先に「読み込み中…」を返すため、実際にここへ来るのは
     * 読み込み完了後のみ）。どちらの分岐も `akari.catalog.root` / 「カタログの場所」を
     * 含まない — その 2 語は renderDeveloperCatalogPanelBody の折りたたみ内だけに置く。
     */
    protected renderCatalogEmptyState(): React.ReactNode {
        const kind = deriveCatalogEmptyStateKind(this.assetCatalogItems.length, this.catalogResolver?.status ?? 'ok');
        const resolverFailed = kind === 'resolver-failed';
        return (
            <div
                data-akari-catalog-empty-kind={kind}
                style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}
            >
                <p style={{ margin: 0, opacity: 0.7 }}>
                    {resolverFailed ? CATALOG_FETCH_FAILED_MESSAGE : CATALOG_EMPTY_MESSAGE}
                </p>
                {resolverFailed && (
                    <button
                        type='button'
                        className='theia-button secondary'
                        data-akari-catalog-retry
                        disabled={this.catalogLoading}
                        onClick={() => void this.loadAssetCatalogView()}
                    >
                        再試行
                    </button>
                )}
                {this.renderDeveloperCatalogDetails()}
            </div>
        );
    }

    /**
     * 「開発者向け: ローカルカタログを追加」の折りたたみ本体（`<details>`。既定は閉 —
     * developerCatalogOpen の初期値 false）。空状態専用 — 一覧表示中は代わりに
     * renderCatalogDeveloperLinkRow の小リンクから同じパネル本体
     * （renderDeveloperCatalogPanelBody）へ到達する（task.md 指示3）。
     */
    protected renderDeveloperCatalogDetails(): React.ReactNode {
        return (
            <details
                data-akari-developer-catalog-section
                open={this.developerCatalogOpen}
                onToggle={event => {
                    this.developerCatalogOpen = (event.target as HTMLDetailsElement).open;
                    this.update();
                }}
                style={{ width: '100%' }}
            >
                <summary style={{ cursor: 'pointer', opacity: 0.7, fontSize: '0.85em' }}>開発者向け: ローカルカタログを追加</summary>
                {this.renderDeveloperCatalogPanelBody()}
            </details>
        );
    }

    /**
     * ローカルカタログ追加パネルの中身（フォルダ選択ボタン + 現在の設定値 + 妥当性エラー）。
     * 折りたたみ内のみで使う語彙なので `akari.catalog.root` の表記可（task.md 指示3）。
     * pickCatalogFolder() / validateCatalogFolder() 自体は無変更（2026-07-25-catalog-root-fix
     * の既存挙動をそのまま流用）。
     */
    protected renderDeveloperCatalogPanelBody(): React.ReactNode {
        const currentValue = this.preferences.get<string>(AKARI_CATALOG_ROOT_PREFERENCE, '');
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px' }}>
                <p data-akari-catalog-root-value style={{ margin: 0, fontSize: '0.8em', opacity: 0.7 }}>
                    現在の設定（{AKARI_CATALOG_ROOT_PREFERENCE}）: {currentValue || '未設定'}
                </p>
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

    /**
     * 一覧表示中（=空状態が出ない）でもローカルカタログ追加へ到達できる、控えめな開発者向け行
     * （task.md 指示3「目立たせない」）。developerCatalogOpen を空状態側と共有し、開いていれば
     * 同じパネル本体をこの行の下に展開する。
     */
    protected renderCatalogDeveloperLinkRow(): React.ReactNode {
        return (
            <div style={{ paddingTop: '2px' }}>
                <button
                    type='button'
                    data-akari-developer-catalog-toggle
                    onClick={() => this.toggleDeveloperCatalogSection()}
                    style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--theia-descriptionForeground, var(--theia-sideBar-foreground))',
                        opacity: 0.6,
                        fontSize: '0.75em',
                        cursor: 'pointer',
                        textDecoration: 'underline'
                    }}
                >
                    開発者向け: ローカルカタログ…
                </button>
                {this.developerCatalogOpen && this.renderDeveloperCatalogPanelBody()}
            </div>
        );
    }

    protected toggleDeveloperCatalogSection(): void {
        this.developerCatalogOpen = !this.developerCatalogOpen;
        this.update();
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
                    // 検索欄をクリック/フォーカスしただけで試聴が止まると、再生中カードが
                    // フィルタアウトされる状況を自分で作れなくなる（受入2の前提そのものが
                    // 壊れる）。面外クリック検知（renderCatalogTab の onClick）から外す。
                    onClick={event => event.stopPropagation()}
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
                {this.renderCatalogDeveloperLinkRow()}
            </div>
        );
    }

    /**
     * 常設の再生中バー（task.md 指示1）。再生中のあいだ検索チップの下・一覧の上に
     * 常時表示し、一覧をどうフィルタしても（検索・カテゴリ切替でカードが消えても）
     * 停止手段が画面に残るようにする。何も再生していなければ何も描画しない。
     * 停止ボタンは event.stopPropagation() で renderCatalogTab の面外クリック検知
     * （どこを押しても停止）に二重に反応しないようにしている
     * （stopCatalogAudio 自体は冪等なので実害はないが、意図を明確にするため）。
     */
    protected renderCatalogAudioBar(): React.ReactNode {
        if (!this.playingCatalogAudioKey) {
            return undefined;
        }
        return (
            <div
                data-akari-catalog-audio-bar
                onClick={event => event.stopPropagation()}
                style={{
                    flex: '0 0 auto',
                    margin: '0 8px 8px',
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    borderRadius: '4px',
                    border: '1px solid var(--theia-sideBar-border)',
                    background: 'var(--theia-editorWidget-background)',
                    fontSize: '0.8em'
                }}
            >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span className='codicon codicon-unmute' aria-hidden='true' style={{ marginRight: '4px' }} />
                    再生中: {this.playingCatalogAudioTitle}
                </span>
                <button
                    type='button'
                    className='theia-button secondary'
                    data-akari-catalog-audio-bar-stop
                    style={{ flex: '0 0 auto', padding: '1px 10px' }}
                    onClick={() => this.stopCatalogAudio()}
                >
                    停止
                </button>
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
                title={assetStateBadgeTitle(item)}
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
     * 分類バッジ（origin='local' のみ）。左上のサムネオーバーレイに乗せる小片を返す。
     * resolver カードの状態バッジ（renderAssetStateBadge）とは origin で排他のため
     * 同じ左上スロットを共有してよい。
     */
    protected renderAssetDistributionBadge(item: AssetCatalogViewItem): React.ReactNode {
        if (item.origin !== 'local') {
            return undefined;
        }
        const label = assetDistributionBadgeText(item.distribution, item.sourceAcquisition);
        if (!label) {
            return undefined;
        }
        return (
            <span
                data-akari-catalog-distribution={item.distribution}
                style={{
                    position: 'absolute',
                    top: '4px',
                    left: '4px',
                    padding: '1px 5px',
                    borderRadius: '10px',
                    fontSize: '0.72em',
                    fontWeight: 600,
                    background: 'var(--theia-editorWidget-background)',
                    color: 'var(--theia-sideBar-foreground)',
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
                    {!item.installed && (
                        <button
                            type='button'
                            className='theia-button secondary'
                            title={`${item.title} をエージェントに取り込ませる`}
                            style={{ flex: '1 1 0', fontSize: '0.78em', padding: '2px 4px' }}
                            onClick={() => void this.importCatalogItem(item)}
                        >
                            取り込む
                        </button>
                    )}
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
            // 「使う」（resolveAsset）は実行しない — 価格とストアの商品ページを案内するだけ
            // （task.md B-2）。クリックでブラウザを開く（decision: 案内文だけでなく実際に
            // 購入できる場所へ連れて行く方が親切と判断）。
            const price = item.price ?? 0;
            const url = storeProductUrl(this.storeConnection.url, item.id);
            return (
                <button
                    type='button'
                    className='theia-button secondary'
                    title={`ストアの商品ページを開きます（¥${price.toLocaleString()}）: ${url}`}
                    style={{ width: '100%', fontSize: '0.78em', padding: '2px 4px' }}
                    onClick={() => this.windowService.openNewWindow(url, { external: true })}
                >
                    {`¥${price.toLocaleString()} で購入 — ストアを開く`}
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
                    {this.renderAssetDistributionBadge(item)}
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
            return <p style={{ opacity: 0.7, padding: '16px' }}>まだありません — 編集したり書き出したりするとここに並びます</p>;
        }
        return (
            <div
                data-akari-outputs-count={this.outputs.length}
                style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 10px 10px' }}
            >
                {OUTPUT_GROUPS.map(group => this.renderOutputGroup(group.kind, group.label))}
            </div>
        );
    }

    /** 1 グループ（見出し + カード）。該当 0 件なら見出しごと出さない。 */
    protected renderOutputGroup(kind: OutputEntryKind, label: string): React.ReactNode {
        const entries = this.outputs.filter(entry => entry.kind === kind);
        if (!entries.length) {
            return undefined;
        }
        return (
            <div
                key={kind}
                data-akari-outputs-group={kind}
                data-akari-outputs-group-count={entries.length}
                style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
            >
                <span style={{ fontSize: '0.72em', fontWeight: 700, letterSpacing: '0.04em', opacity: 0.6 }}>
                    {label}
                </span>
                {entries.map(entry => this.renderOutputCard(entry))}
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
                onContextMenu={event => this.openOutputContextMenu(event, entry)}
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
                            className={this.outputIcon(entry)}
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
                <button
                    type='button'
                    title={revealInFileManagerActionLabel(label)}
                    aria-label={revealInFileManagerActionLabel(label)}
                    data-akari-output-reveal={entry.relativePath}
                    onClick={event => {
                        event.stopPropagation();
                        void this.revealOutputInFileManager(entry);
                    }}
                    style={{
                        flex: 'none',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        opacity: 0.7,
                        padding: '2px 4px',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    <span className='codicon codicon-folder-opened' aria-hidden='true' />
                </button>
            </div>
        );
    }

    protected async revealOutputInFileManager(entry: OutputEntry): Promise<void> {
        await this.commandService.executeCommand(AKARI_REVEAL_IN_FILE_MANAGER.id, entry.uri);
    }

    /**
     * できたもの行の右クリックメニューを開く。`entry.kind`（data/plan/export/report）が
     * そのまま `MaterialContextMenuTarget` の対象種別になる（司令塔裁定1: 破壊操作と
     * エージェントに頼むは export のみ）。既存クリック挙動は変えない —
     * renderOutputCard へは onContextMenu の追加のみで配線する（受入5）。
     */
    protected openOutputContextMenu(event: React.MouseEvent<HTMLDivElement>, entry: OutputEntry): void {
        event.preventDefault();
        event.stopPropagation();
        openAkariContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: buildMaterialContextMenuItems(entry.kind, isOSX),
            onSelect: id => this.handleOutputContextMenuAction(id, entry)
        });
    }

    protected handleOutputContextMenuAction(id: string, entry: OutputEntry): void {
        switch (id) {
            case 'open':
                void this.openFile(entry.uri);
                break;
            case 'reveal':
                void this.revealInFileManagerCommand(entry.uri);
                break;
            case 'copy-file':
                void this.copyFileToClipboard(entry.uri);
                break;
            case 'copy-path':
                void this.copyPathToClipboard(entry.uri);
                break;
            case 'rename':
                void this.renameEntry(entry.uri, entry.name, entry.relativePath, false, () => this.loadOutputs());
                break;
            case 'delete':
                void this.deleteEntry(entry.uri, entry.name, entry.relativePath, false, () => this.loadOutputs());
                break;
            case 'ask-agent':
                void this.askAgentAboutOutput(entry);
                break;
            default:
                break;
        }
    }

    /**
     * 書き出し行（export）の「エージェントに頼む」（指示8）。素材カードの askAgent と同じ
     * quickInput 一問 → PARTNER_INJECT_PROMPT_COMMAND_ID 注入の流儀だが、文脈パケットは
     * 出力版 composer（composeOutputAskAgentPrompt）を使う。data/plan/report では
     * メニュー自体にこの項目が出ない（buildMaterialContextMenuItems）ため呼ばれない。
     */
    protected async askAgentAboutOutput(entry: OutputEntry): Promise<void> {
        const request = await this.quickInputService.input({
            placeHolder: 'このファイルについて何を頼みますか'
        });
        if (!request || !request.trim()) {
            return;
        }
        const packet = composeOutputAskAgentPrompt({ relativePath: entry.relativePath }, request);
        await this.commandService.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, packet);
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
