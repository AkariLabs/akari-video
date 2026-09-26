import { LibraryImportSheet } from './library-import-sheet';
import { LibraryImportResult } from '../common/library-import';
import { referencePresentation } from '../common/project-asset-reference';
import { ProjectAssetReference, AssetBundleOutcome } from '../common/akari-project-protocol';
import { MaterialSwapRequest, SwapCandidates, rankSwapCandidates } from '../common/material-swap-candidates';
import {
    GENERATION_PICK_PRIMARY_SELECTED_EVENT, GenerationPickCandidate, GenerationPickController,
    GenerationPickRequest, GenerationPickResult, GenerationPickTimelineSelection, generationPickSelectionChanged
} from '../common/generation-pick';
import { AkariPreviewService } from 'akari-preview/lib/common/akari-preview-protocol';
import { MaterialCardHoverPreview } from './material-card-hover-preview';
import type { TranscriptState } from '../common/akari-project-protocol';
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
import { TRANSITION_VOCABULARY, TransitionType } from '@akari-video/edit-store';
import {
    AKARI_BORDER,
    AKARI_FAINT,
    AKARI_INK,
    AKARI_LINE,
    AKARI_RADIUS,
    AKARI_SURFACE
} from '../common/akari-surface-tokens';
import {
    AkariProjectService,
    AssetCatalogResolverStatus,
    AssetCatalogViewItem,
    AssetEntitlementsStatus,
    DroppedAsset,
    PresetShowcase,
    PresetShowcaseItem,
    PresetShowcaseKind,
    StoreConnectionStatus
} from '../common/akari-project-protocol';
import { StoreConnectionFlowController } from '../common/store-connection-flow';
import { AkariWorkflowService } from './akari-workflow-service';
import { shouldShowProjectPath } from '../common/project-tree-policy';
import { isUnorganizedRootEntry } from '../common/unorganized-materials';
import { nextCandidateAssetName } from '../common/asset-naming';
import { dataFileIcon, orderDataEntries } from '../common/output-data-order';
import { AnalysisJson, deriveAnalysisDurationSeconds, formatDurationBadge } from '../common/analysis-summary';
import { composeMaterialAskAgentPrompt, composeOutputAskAgentPrompt } from '../common/agent-context-packet';
import {
    CATALOG_CATEGORIES,
    CatalogCategoryChip,
    CatalogItemMeta,
    CatalogViewMode,
    catalogItemCategoryChipKey,
    deriveCatalogCategoryChips,
    deriveCatalogFilteredEmptyKind,
    normalizeCatalogViewMode,
    parseCatalogItemMeta
} from '../common/catalog-reader';
import { composeCatalogAskAgentPrompt, composeCatalogImportPrompt, composeCatalogPackImportPrompt } from '../common/catalog-context-packet';
import {
    catalogCardUiEventTarget,
    CatalogPackGroup,
    deriveCatalogEmptyStateKind,
    deriveCatalogResolverNotice,
    formatCatalogPackBreakdown,
    groupCatalogItemsByPack,
    storeProductUrl,
    summarizeCatalogPackDistribution
} from '../common/asset-catalog-view';
import {
    countLibraryCategory, filterLibraryCatalogItems,
    LibrarySourceFilter, recentLibraryEntries, RecentLibraryEntry, rankRecentLibraryItems
} from '../common/library-source-view';
import { libraryRemovalWarning } from '../common/library-card-context-menu-items';
import {
    EMPTY_LIBRARY_FILTER, filterLibraryItems, isLibraryItemCached, isPremiumLocked, LibraryFilterSectionKey, LibraryFilterState,
    presetMatchesLibraryFilter, toggleLibraryFilterOption
} from '../common/library-filter';
import {
    isPlaceableLibraryCategory, libraryAssetInfoCard, libraryCardMenuEntries, LibraryInfoCardModel, LibraryMenuActionId,
    LibraryMenuTarget, libraryMenuTargetKey, libraryPresetInfoCard, premiumPromptText
} from '../common/library-card-menu';
import { libraryCreditLine, LibraryLicenseSheet } from '../common/library-license';
import {
    LibraryAssetCard, LibraryCardStyles, LibraryDotsCorner, LibraryFilterButton, LibraryFilterPopover, LibraryInfoCard,
    LibraryLicenseDialog, LibraryPremiumSheet, LibrarySimpleCard
} from './library-card-view';
import { AssetBinChildNode, isAssetBinGroupDirectory } from '../common/asset-bin-grouping';
import { canPlaceLibraryAsset, canPlaceOverlay, libraryDragKind, localLibraryAssetPlacementSource, resolveLibraryAssetMedia, RESOLVE_LIBRARY_MATERIAL_COMMAND_ID } from '../common/library-asset-placement';
import { classifyMaterialKind, MaterialKind, resolveAssetGroupMedia } from '../common/asset-group-media';
import { materialCardLayout } from '../common/material-card-layout';
import { AKARI_MATERIAL_SELECTED_EVENT } from '../common/material-selected-event';
import { CatalogPack } from '../common/catalog-packs';
import { filterPresetShowcaseItems, presetApplyPayload, presetShowcaseBottomPadding, textStylePlaceOptions } from '../common/preset-showcase';
import { defaultMyStyleParts, myStylePartLabel, myStyleSamplePresentation, type MyStyle } from '../common/my-style';
import { textAnimationSampleKeyframes } from '../common/text-animation-sample';
import { FontShelfCard, LibraryShelfVisualStyles, LutPreview, playTextAnimationSample, TransitionStrip } from './library-shelf-visuals-view';
import { LibraryTextLookPage, LibraryTextLookRow } from './library-text-look-view';
import { LibraryShapeShelf } from './library-shape-shelf-view';
import { ShapeShelfService } from './shape-shelf-service';
import { shapeShelfDragPayload, ShapeShelfPreset } from '../common/shape-shelf';
import {
    LIBRARY_DETAIL_GROUPS,
    LIBRARY_GROUPS,
    LIBRARY_PRIMARY_TILES,
    LibraryCategoryDefinition,
    LibraryCategoryKey,
    LibraryCategoryStatus,
    LibraryGroupDefinition,
    LibraryPrimaryTile,
    resolveOpenableLibraryCategory,
    searchLibraryHome
} from '../common/library-home-view';
import { AKARI_REVEAL_IN_FILE_MANAGER, AKARI_SHOW_ASSET_INFO, revealInFileManagerActionLabel } from './akari-reveal-commands';
import { buildMaterialContextMenuItems, MaterialContextMenuTarget } from '../common/material-context-menu-items';
import { openAkariContextMenu, OPEN_PREVIEW_IMAGE_ITEM } from './akari-context-menu';
import { assetGroupOpenTarget } from '../common/asset-group-open-target';
import { countReferences } from '../common/project-reference-check';
import { ElectronAkariProjectApi } from '../electron-common/electron-api';
import { isOsFileDropInput } from '../common/delegated-drop';

try { require('../../src/browser/style/generation-pick.css'); } catch { /* node 単体テスト環境 */ }

// パートナー拡張の公開コマンド ID とミラー（extension 間の npm 依存を作らない。
// akari-partner-command-contribution.ts の AkariPartnerCommands.INJECT_PROMPT と同一）。
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';
// 姉妹拡張（タイムライン側、task 2026-08-10-timeline-clip-menu）の公開コマンド ID とミラー。
// 共有パッケージを作らず文字列を直書きする流儀（PARTNER_INJECT_PROMPT_COMMAND_ID と同じ）。
// 受け側が未合流でも executeCommand は失敗するだけなので本タスクは成立する（司令塔裁定2）。
const TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID = 'akari.timeline.addMaterialAtPlayhead';
// 図形を置くタイムライン側のコマンド（akari-annotations が登録。引数 `{ preset, t?, center?, transform? }`）。
const TIMELINE_ADD_SHAPE_AT_COMMAND_ID = 'akari.timeline.addShapeAt';

// 素材カード D&D（task 2026-08-10-material-dnd-timeline 司令塔裁定4）。mime 文字列・
// イベント名は受け側（akari-annotations-widget.ts）と独立にリテラル宣言する
// （PREVIEW_PLAYBACK_TICK_EVENT と同じ流儀 — 拡張間の npm 依存を作らない）。
const MATERIAL_DRAG_MIME = 'application/x-akari-material';
const MATERIAL_DRAG_START_EVENT = 'akari.material.dragStart';
const MATERIAL_DRAG_END_EVENT = 'akari.material.dragEnd';
// ライブラリ項目 D&D（トランジション送信側）。受け側と npm 依存を作らず文字列だけをミラーする。
const LIBRARY_DRAG_MIME = 'application/x-akari-library-item';
const LIBRARY_DRAG_START_EVENT = 'akari.library.dragStart';
const LIBRARY_DRAG_END_EVENT = 'akari.library.dragEnd';

const AKARI_CATALOG_FOCUS_PULSE_CLASS = 'akari-catalog-focus-pulse';
const AKARI_CATALOG_FOCUS_PULSE_STYLE_ID = 'akari-catalog-focus-pulse-style';
const AKARI_CATALOG_AUDIO_DOCK_STYLE_ID = 'akari-catalog-audio-dock-style';

function installCatalogFocusPulseStyle(): void {
    if (document.getElementById(AKARI_CATALOG_FOCUS_PULSE_STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = AKARI_CATALOG_FOCUS_PULSE_STYLE_ID;
    style.textContent = `
.${AKARI_CATALOG_FOCUS_PULSE_CLASS} {
    animation: akari-catalog-focus-pulse 1.6s ease-out 1;
}
@keyframes akari-catalog-focus-pulse {
    0%, 100% { box-shadow: 0 0 0 0 transparent; }
    15%, 55% { box-shadow: 0 0 0 3px var(--akari-focus-pulse, var(--akari-accent)); }
}
`;
    document.head.appendChild(style);
}

function installCatalogAudioDockStyle(): void {
    if (document.getElementById(AKARI_CATALOG_AUDIO_DOCK_STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = AKARI_CATALOG_AUDIO_DOCK_STYLE_ID;
    style.textContent = `
[data-akari-catalog-audio-dock] {
    animation: akari-catalog-audio-dock-enter 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes akari-catalog-audio-dock-enter {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
    [data-akari-catalog-audio-dock] { animation: none; }
}
`;
    document.head.appendChild(style);
}

const AKARI_CATALOG_ROOT_PREFERENCE = 'akari.catalog.root';
const AKARI_CATALOG_VIEW_MODE_STORAGE_KEY = 'akari.catalog.viewMode';
const AKARI_LIBRARY_DETAILS_STORAGE_KEY = 'akari.library.detailsOpen';
// 一般ユーザー向けの空状態文言（原因別。catalog-account-first-ux task.md §2）。
// どちらも `akari.catalog.root` という preference 名・「カタログの場所」という内部語を含まない
// — それらは開発者向け折りたたみ（renderDeveloperCatalogPanel）の中でのみ表記する。
const CATALOG_FETCH_FAILED_MESSAGE = '素材カタログを取得できませんでした。接続を確認して再試行してください。';
const CATALOG_EMPTY_MESSAGE = 'カタログに素材がまだありません。';
const EMPTY_PRESET_SHOWCASE: PresetShowcase = { lut: [], textanim: [], textstyle: [] };

// 素材グリッド（renderMaterialsTab）専用。カタログ側 renderCatalogCard の 150px グリッドとは無関係
// — 「波及するなら素材グリッドだけに閉じる」（task.md「調べること」2）ため意図的に分けて定義する。
// gap はグリッドの gap と一致させること（calc(50% - gap/2) で最低 2 列を数式保証する）。
// 余白・間隔・カードの目標幅の正本は materialCardLayout（較正値の維持理由も同関数に記載）。
const MATERIAL_GRID_LAYOUT = materialCardLayout({ kind: 'other' });
const MATERIAL_GRID_GAP = MATERIAL_GRID_LAYOUT.gridGap;
// auto-fill なので「カード 1 枚の目標幅」であって列数の指定ではない: パネルが広いほど
// 列が増え、狭いと減る。ただし `min(…, calc(50% - gap/2))` の項が効くので **1 列には落ちない**。
const MATERIAL_GRID_CARD_MIN_WIDTH = MATERIAL_GRID_LAYOUT.cardMinWidth;
const MATERIAL_GRID_COLUMNS =
    `repeat(auto-fill, minmax(min(${MATERIAL_GRID_CARD_MIN_WIDTH}, calc(50% - ${MATERIAL_GRID_GAP} / 2)), 1fr))`;

// 320px 前後のパネルでも左右 padding 20px を差し引いた幅へ 3 列を保証する。
const CATALOG_GRID_GAP = '8px';
const CATALOG_GRID_COLUMNS =
    'repeat(auto-fill, minmax(min(96px, calc(33.333% - 6px)), 1fr))';

/** 上段（素材）の内部遷移先。タブではなく widget 内遷移 — U6 裁定。 */
type TopView = 'materials' | 'catalog';

/** `akari.catalog.open` の引数。外から「このタブ・このカテゴリ・この言葉で開く」ための契約。 */
export interface AkariCatalogFocusOptions {
    /** 省略時・'project' 以外の値は 'library' 扱い。 */
    readonly tab?: 'project' | 'library';
    /** tab='library' のときだけ効く。未知/soon のキーは無視してホームを開く。tab='project' では無視する。 */
    readonly category?: string;
    /** 省略時は空文字（前回の検索語を引きずらない）。 */
    readonly query?: string;
    /** 見つかったカードまでスクロールする。形は §1 の表のとおり。 */
    readonly assetId?: string;
    /** true のとき assetId のカードを約 1.6 秒発光させる。 */
    readonly pulse?: boolean;
}

/** `akari.catalog.listCategories` の戻り値 1 件。 */
export interface AkariCatalogCategorySummary {
    readonly key: string;
    readonly label: string;
    readonly status: LibraryCategoryStatus;
    /** status='soon' のときは undefined。 */
    readonly count?: number;
}

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
const ROOT_PLAN_FILES: ReadonlyArray<string> = ['README.md', 'decision-log.md'];

/** 「レポート」グループに出すルート直下の契約ファイル。 */
const ROOT_REPORT_FILES: ReadonlyArray<string> = ['analysis-report.html'];

/**
 * プロジェクト直下の契約ファイル（edit.json 等）・アトミック書き込みの一時ファイル・
 * .akari/ 配下は素材一覧に無関係（素材一覧は assets/ 配下しか見ない）。
 * これらの変更で素材パネルを再読込しない（task 2026-08-18-shell-panel-reload-spinner 指示1）。
 */
const MATERIALS_IRRELEVANT_ROOT_FILES = new Set(['edit.json', 'captions.json', 'analysis.json', '.akari']);
function isMaterialsIrrelevantRootFile(baseName: string): boolean {
    return MATERIALS_IRRELEVANT_ROOT_FILES.has(baseName) || baseName.endsWith('.tmp');
}

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
    /** グループの主メディア。ドラッグとタイムライン追加だけに使う。 */
    mediaRelativePath?: string;
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
    reference?: ProjectAssetReference;
    missing?: boolean;
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
 * 標準 Explorer ツリーの代わりにドメインビューを見せる
 * （U6 裁定 2026-08-03、正本: internal `planning/notes-2026-08-03-owner-feedback-shell-v013.md`）:
 * - 最上部の固定セグメントで「プロジェクト」/「ライブラリ」を切り替える（タブではない —
 *   `topView` で表示先を切り替えるだけで、両者は同じ widget インスタンスの状態）
 * - 「プロジェクト」面は上下 2 分割。上段「素材」: assets/ カード + 未整理セクション + D&D
 * - 「ライブラリ」面はパネル全体を使う 1 面（2026-09-03 オーナー指示）。共有の棚であって
 *   プロジェクトの成果物とは別系統なので「できたもの」とは同居させない
 * - 下段「できたもの」（プロジェクト面のみ）: プロジェクトの成果物を 4 グループ（編集データ / 企画・メモ /
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
    @inject(ShapeShelfService)
    protected readonly shapeShelf!: ShapeShelfService;
    /** 図形の棚の「すべて表示」で開いている行。undefined = 棚。 */
    protected shapeShelfView: string | undefined;

    protected readonly generationPick = new GenerationPickController(
        key => this.resolveCatalogMaterial(key), () => this.update()
    );
    protected generationPickRoot?: string;
    protected readonly generationTimelineSelections = new Map<string, GenerationPickTimelineSelection>();
    protected generationPickSelectionsAtStart = new Map<string, GenerationPickTimelineSelection>();

    /** UI-internal command entry; library and project segments remain available. */
    pickInto(request: GenerationPickRequest): Promise<GenerationPickResult> {
        if (this.isDisposed) { return Promise.resolve({ status: 'cancelled' }); }
        if (this.materialSwap) this.closeMaterialSwap();
        else ++this.swapLoadGeneration; // Invalidate a shelf that is still loading.
        this.generationPickRoot = this.workflow.workspaceRoot?.toString();
        this.generationPickSelectionsAtStart = new Map(this.generationTimelineSelections);
        const result = this.generationPick.start(request);
        this.node.tabIndex = -1;
        this.node.focus();
        return result;
    }

    cancelPick(): void {
        this.generationPick.cancel();
    }

    protected readonly handleGenerationPrimarySelected = (event: Event): void => {
        const detail = (event as CustomEvent<{ editUri?: string; selection?: GenerationPickTimelineSelection }>).detail;
        if (typeof detail?.editUri !== 'string' || !detail.editUri) { return; }
        const selection = detail.selection;
        if (selection !== null && (!selection || !['cut', 'caption'].includes(selection.kind)
            || typeof selection.id !== 'string' || !selection.id)) { return; }
        let editUri: string;
        try { editUri = new URI(detail.editUri).normalizePath().toString(); } catch { return; }
        // Copy the payload so neither a producer nor later events can mutate the start snapshot.
        this.generationTimelineSelections.set(editUri, selection ? { kind: selection.kind, id: selection.id } : null);
        if (this.generationPick.request
            && generationPickSelectionChanged(this.generationPickSelectionsAtStart.get(editUri), selection)) {
            this.generationPick.cancel();
        }
    };

    protected readonly handleGenerationPickKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.generationPick.request) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.generationPick.cancel();
        }
    };

    protected override onBeforeDetach(msg: Message): void {
        this.generationPick.cancel();
        super.onBeforeDetach(msg);
    }

    protected override onCloseRequest(msg: Message): void {
        this.generationPick.cancel();
        super.onCloseRequest(msg);
    }

    protected generationCatalogCandidate(item: AssetCatalogViewItem): GenerationPickCandidate {
        return {
            key: item.key,
            kind: item.category === 'still' ? 'image' : item.category === 'broll' ? 'video' : item.category === 'audio' ? 'audio' : 'other',
            unavailableReason: canPlaceLibraryAsset(item) ? undefined
                : item.origin === 'local' ? 'この素材は直接取り込めません。'
                    : item.state === 'locked' ? '未購入の素材は選べません。' : 'この種類の素材は選べません。'
        };
    }

    /** Capture before nested audition/import/open controls; normal handlers remain untouched outside pick mode. */
    protected generationPickCardProps(candidate: GenerationPickCandidate): React.HTMLAttributes<HTMLDivElement> {
        if (!this.generationPick.request) { return {}; }
        const reason = this.generationPick.disabledReason(candidate);
        return {
            className: 'akari-gen-pick-card',
            role: 'button', tabIndex: reason ? -1 : 0,
            'aria-disabled': !!reason,
            'aria-pressed': !!this.generationPick.badge(candidate),
            'aria-busy': candidate.key !== undefined && this.generationPick.pendingKey === candidate.key,
            ...(reason ? { title: reason } : {}),
            onClickCapture: event => {
                event.preventDefault(); event.stopPropagation();
                void this.generationPick.pick(candidate);
            },
            onKeyDown: event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault(); event.stopPropagation();
                    void this.generationPick.pick(candidate);
                }
            },
            onDragStartCapture: event => { event.preventDefault(); event.stopPropagation(); },
            onContextMenuCapture: event => { event.preventDefault(); event.stopPropagation(); }
        };
    }

    protected renderGenerationPickBadge(candidate: GenerationPickCandidate): React.ReactNode {
        const badge = this.generationPick.badge(candidate);
        const pending = candidate.key !== undefined && this.generationPick.pendingKey === candidate.key;
        return badge || pending ? <span className='akari-gen-pick-badge' role='status'>{pending ? '取得中…' : badge}</span> : null;
    }

    protected renderGenerationPickBand(): React.ReactNode {
        const request = this.generationPick.request;
        if (!request) { return null; }
        return <div className='akari-gen-pick-band'>
            <strong>{request.label} に入れる素材を選ぶ</strong>
            <div className='akari-gen-pick-actions'>
                <button type='button' className='akari-gen-pick-cancel' onClick={() => this.generationPick.cancel()}>やめる</button>
                {request.multi && <button type='button' className='akari-gen-pick-complete'
                    disabled={!!this.generationPick.pendingKey} onClick={() => this.generationPick.complete()}>
                    完了（{this.generationPick.paths.length}）
                </button>}
            </div>
            {this.generationPick.error && <div className='akari-gen-pick-error' role='alert'>{this.generationPick.error}</div>}
        </div>;
    }

    protected topView: TopView = 'materials';
    /** ファイルをドラッグ中か（取り込み可能であることを枠で見せる。renderDropOverlay 参照）。 */
    protected dragActive = false;
    protected materials: MaterialCardEntry[] = [];
    protected unorganizedMaterials: MaterialCardEntry[] = [];
    protected materialsLoading = false;
    protected materialsLoadedOnce = false;
    protected materialsGeneration = 0;
    protected materialsWatch = new DisposableCollection();
    protected materialsWatchRootKey?: string;
    protected materialsWatchTimer?: ReturnType<typeof setTimeout>;
    protected lintAvailable = false;
    protected lintCount?: number;

    protected outputs: OutputEntry[] = [];
    protected outputsLoading = false;
    protected outputsLoadedOnce = false;
    protected outputsGeneration = 0;
    protected outputsWatch = new DisposableCollection();
    protected outputsWatchRootKey?: string;
    protected outputsWatchTimer?: ReturnType<typeof setTimeout>;

    /** カタログ面「1 ビュー」= resolver 合成 + ローカル catalog/ のマージ済み一覧。 */
    protected assetCatalogItems: AssetCatalogViewItem[] = [];
    protected materialSwap?: { request: MaterialSwapRequest; title: string; candidates: SwapCandidates; root: string };
    protected swapLoadGeneration = 0;

    async openMaterialSwap(request: MaterialSwapRequest): Promise<boolean> {
        const generation = ++this.swapLoadGeneration;
        const root = this.workflow.workspaceRoot;
        if (!root || !request?.itemId || !['audio', 'visual'].includes(request.kind)) return false;
        await this.loadAssetCatalogView();
        const match = request.currentRelativePath.match(/^assets\/([^/]+)\/([^/]+)\//);
        let current: { id: string; tags: string[]; title?: string } | undefined;
        if (match) {
            const catalog = this.assetCatalogItems.find(item => item.key === `${match[1]}/${match[2]}`);
            if (catalog) current = { id: catalog.id, tags: catalog.tags, title: catalog.title };
            try {
                const meta = JSON.parse((await this.files.readFile(root.resolve(`assets/${match[1]}/${match[2]}/meta.json`))).value.toString());
                current = { id: match[2], tags: Array.isArray(meta.tags) ? meta.tags : catalog?.tags ?? [], title: meta.title ?? catalog?.title };
            } catch { /* AKARI Sounds は meta.json を持たないためカタログの情報を使う。 */ }
        }
        if (!await this.commandService.executeCommand('akari.timeline.isMaterialSwapActive', request)) return false;
        if (generation !== this.swapLoadGeneration || this.workflow.workspaceRoot?.toString() !== root.toString()) return false;
        this.generationPick?.cancel();
        if (this.playingCatalogAudioKey) this.stopCatalogAudio();
        this.materialSwap = { request, title: current?.title ?? request.currentRelativePath.split('/').pop(),
            candidates: rankSwapCandidates(this.assetCatalogItems, request.kind, current, request.currentRelativePath), root: root.toString() };
        this.selectTopView('catalog');
        return true;
    }

    clearMaterialSwap(): void {
        ++this.swapLoadGeneration;
        this.materialSwap = undefined;
        this.update();
    }

    protected closeMaterialSwap(): void {
        this.clearMaterialSwap();
        void this.commandService.executeCommand('akari.timeline.finishMaterialSwap', false);
    }

    protected renderMaterialSwap(): React.ReactNode {
        const shelf = this.materialSwap;
        if (!shelf) return undefined;
        const section = (label: string, rows: SwapCandidates['rest']): React.ReactNode => <section>
            <h4 style={{ margin: '12px 0 6px' }}>{label}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
                {rows.map(({ item, canTry }) => <div key={item.key} data-akari-swap-candidate={item.key}
                    role={canTry ? 'button' : undefined} tabIndex={canTry ? 0 : undefined} aria-disabled={!canTry}
                    onClick={event => {
                        if (!canTry || (event.target as HTMLElement).closest('button,a')) return;
                        void this.commandService.executeCommand('akari.timeline.tryMaterialSwap', { key: item.key, title: item.title, originalTitle: shelf.title });
                    }} onKeyDown={event => {
                        if (canTry && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault();
                            void this.commandService.executeCommand('akari.timeline.tryMaterialSwap', { key: item.key, title: item.title, originalTitle: shelf.title });
                        }
                    }}>{this.renderCatalogCard(item)}</div>)}
            </div>
        </section>;
        return <div data-akari-swap-shelf style={{ padding: '8px 10px' }}>
            <div style={{ borderBottom: AKARI_BORDER.hairline, paddingBottom: '8px' }}>
                <strong>⇄ 入れ替え候補</strong><div>{shelf.title}</div>
                <button className='theia-button secondary' onClick={() => this.closeMaterialSwap()}>通常のライブラリに戻る ✕</button>
            </div>
            {shelf.candidates.near !== undefined && section('近い系統', shelf.candidates.near)}
            {section(`それ以外の${shelf.request.kind === 'audio' ? '音源' : '画像・B-roll'}`, shelf.candidates.rest)}
        </div>;
    }

    /** 素材カタログとは別系統で読む、テロップ / LUT の読み取り専用参照表。 */
    protected presetShowcase: PresetShowcase = EMPTY_PRESET_SHOWCASE;
    protected transitionPreviewUrls: Record<string, { preview: string; strip: string }> = {};
    protected myStyles: MyStyle[] = [];
    protected closeMyStyleApplyPopover?: () => void;
    /** `catalog/packs.json`（無ければ空）。パック棚のグループ化はフロント側で行う。 */
    protected catalogPacks: CatalogPack[] = [];
    /**
     * resolver（アカウントの素材）の取得状態。初回読み込み前は undefined —
     * このときは空状態の原因分岐・見出し付近の件数/再試行表示のどちらも出さない
     * （読み込み中は renderCatalogBody 側の「読み込み中…」が先に出る）。
     */
    protected catalogResolver?: AssetCatalogResolverStatus;
    protected catalogEntitlementsStatus: AssetEntitlementsStatus = 'ok';
    protected catalogLoading = false;
    protected libraryImportRequest?: { paths: string[] };
    protected catalogQuery = '';
    /** 出どころ（フィルターの 1 節目）。他の 3 節は libraryFilterRest。 */
    protected librarySourceFilter: LibrarySourceFilter = 'all';
    protected libraryFilterRest: Omit<LibraryFilterState, 'source'> = { price: [], license: [], status: [] };
    protected libraryFilterAnchor?: DOMRect;
    /** ★ お気に入りの key（利用者ごと。AKARI_HOME/library-favorites.json）。 */
    protected libraryFavorites = new Set<string>();
    /** ⋯ = 情報カード。anchor は押したカードの矩形（周りを暗くして、このカードだけ残す）。 */
    protected libraryInfo?: { target: LibraryMenuTarget; anchor: DOMRect; keywordsExpanded: boolean };
    protected libraryLicense?: { sheet: LibraryLicenseSheet; credit?: string };
    /** 未購入のプレミアムを使おうとしたときの促しのシート（素材の key）。 */
    protected libraryPremiumPrompt?: string;
    protected libraryFolderFilter: string | undefined;
    /** プロジェクト面の素材名フィルタ。catalogQuery とは面ごとに独立して保持する。 */
    protected materialQuery = '';
    /** undefined = ライブラリホーム。値あり = フラット一覧から開いたカテゴリページ。 */
    protected libraryCategory?: LibraryCategoryKey;
    protected libraryTextLookOpen = false;
    protected libraryDetailsOpen = false;
    protected catalogCategory = 'all';
    protected catalogViewMode: CatalogViewMode = 'grid';
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
    protected storeConnectionFlow: StoreConnectionFlowController;
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
     * （検索・カテゴリでカードが一覧から消えてもドックの表示名は失われない —
     * assetCatalogItems から都度引き直す設計だと、フィルタで消えた瞬間に参照できなくなる）。
     */
    protected playingCatalogAudioTitle?: string;
    /** 直近の再生失敗カードの key。カード上へ短いエラー表示するために使う。 */
    protected catalogAudioErrorKey?: string;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.shapeShelf.onDidChange(() => this.update()));
        const saveMyStyle = (event: Event): void => {
            const detail = (event as CustomEvent<{ style: MyStyle; resolve: () => void; reject: (error: unknown) => void }>).detail;
            void this.projectService.saveMyStyle(detail.style).then(async () => {
                this.myStyles = await this.projectService.listMyStyles();
                this.update();
                detail.resolve();
            }, detail.reject);
        };
        window.addEventListener('akari.mystyle.save', saveMyStyle);
        this.toDispose.push({ dispose: () => window.removeEventListener('akari.mystyle.save', saveMyStyle) });
        const resolveMyStyleAsset = (event: Event): void => {
            const detail = (event as CustomEvent<{ projectUri: string; category: string; id: string; file: string;
                handled?: boolean; resolve: () => void; reject: (error: unknown) => void }>).detail;
            detail.handled = true;
            void (async () => {
                let references = await this.projectService.listProjectAssetReferences(detail.projectUri);
                let reference = references.find(item => item.category === detail.category && item.id === detail.id);
                if (!reference) {
                    const outcome = await this.projectService.resolveAsset(detail.id, detail.projectUri);
                    if (outcome.success === false) throw new Error(outcome.error);
                    references = await this.projectService.listProjectAssetReferences(detail.projectUri);
                    reference = references.find(item => item.category === detail.category && item.id === detail.id);
                }
                if (!reference?.files.some(file => file.name === detail.file || file.name.endsWith(`/${detail.file}`))) {
                    throw new Error('素材ファイルを参照台帳で確認できません。');
                }
                detail.resolve();
            })().catch(detail.reject);
        };
        window.addEventListener('akari.mystyle.resolve-asset', resolveMyStyleAsset);
        this.toDispose.push({ dispose: () => window.removeEventListener('akari.mystyle.resolve-asset', resolveMyStyleAsset) });
        const changeLibraryLocation = (): void => { void this.commandService.executeCommand('akari.library.changeLocation'); };
        this.node.addEventListener('akari.library.changeLocation', changeLibraryLocation);
        this.toDispose.push({ dispose: () => this.node.removeEventListener('akari.library.changeLocation', changeLibraryLocation) });
        this.toDispose.push({ dispose: () => this.referenceWatches.dispose() });
        installCatalogFocusPulseStyle();
        installCatalogAudioDockStyle();
        window.addEventListener('keydown', this.handleGenerationPickKey, true);
        window.addEventListener(GENERATION_PICK_PRIMARY_SELECTED_EVENT, this.handleGenerationPrimarySelected);
        this.toDispose.push({ dispose: () => {
            window.removeEventListener('keydown', this.handleGenerationPickKey, true);
            window.removeEventListener(GENERATION_PICK_PRIMARY_SELECTED_EVENT, this.handleGenerationPrimarySelected);
            this.generationTimelineSelections.clear();
            this.generationPickSelectionsAtStart.clear();
            this.generationPick.cancel();
        } });
        this.id = AkariRoleBucketsWidget.ID;
        this.title.label = '素材';
        this.title.caption = 'ドメインオブジェクトのカード棚';
        this.title.iconClass = 'codicon codicon-files';
        this.title.closable = false;
        // 俯瞰の取り込みドロップゾーンと同じ流儀: このパネルへのドロップは
        // akari-project-contribution.ts のグローバルハンドラ（isDelegatedDropzone）
        // に割り込まれず、このウィジェット自身が最後まで処理する。
        this.node.setAttribute('data-akari-dropzone', 'true');
        // task 2026-09-23-finder-drop-frame: Files だけの dragover をグローバルから受け取る。
        this.node.setAttribute('data-akari-os-file-drop-target', 'true');
        // docs/contract-2026-08-11-review-session-ui-events.md #2: panel:<id> opt-in target.
        this.node.setAttribute('data-akari-ui', 'panel:assets');
        this.node.setAttribute('data-akari-ui-label', '素材パネル');
        this.storeConnectionFlow = new StoreConnectionFlowController(this.projectService, {
            openVerificationUrl: url => this.windowService.openNewWindow(url, { external: true }),
            onChange: state => {
                const wasConnected = this.storeConnection.connected;
                this.storeConnection = state.connection;
                this.update();
                if (!wasConnected && state.connection.connected) {
                    void this.loadAssetCatalogView();
                }
            }
        });
        this.toDispose.push({ dispose: () => this.storeConnectionFlow.dispose() });
        // Theia 本体（frontend-application.ts）が document の **バブル段階**で
        // `dataTransfer.dropEffect = 'none'` を無条件に入れている（ウィンドウへのファイル
        // ドロップでブラウザ既定の遷移が起きるのを止めるため）。dropEffect が none のまま
        // dragover が終わるとブラウザはドロップを拒否し、**drop イベントが一度も発火しない** —
        // preventDefault だけでは足りない。実機計測（2026-08-09・CDP）: 素材パネル上で
        // dragover 19 回・types に Files・defaultPrevented true・dropEffect none・drop 0 回。
        // よって自前で copy を宣言し、Theia の document ハンドラまで到達させない
        // （ホームの取り込みゾーン akari-home-widget#handleDragOver が既にこの 3 点セットで
        //   動いており、本パネルだけが dragover を持たず取り残されていた）。
        // task 2026-09-23-finder-drop-frame: 最初の dragenter から取り込み枠を出す。
        this.node.addEventListener('dragenter', event => this.handleDragOver(event));
        this.node.addEventListener('dragover', event => this.handleDragOver(event));
        this.node.addEventListener('dragleave', event => this.handleDragLeave(event));
        this.node.addEventListener('drop', event => this.handleDrop(event));
        // task 2026-09-23-finder-drop-frame: 動画は document capture の drop が先に
        // stopPropagation するため、window capture で枠だけ消す。取り込み経路は変えない。
        const clearDropOverlay = (): void => this.setDragActive(false);
        window.addEventListener('drop', clearDropOverlay, true);
        window.addEventListener('dragend', clearDropOverlay, true);
        this.toDispose.push({ dispose: () => {
            window.removeEventListener('drop', clearDropOverlay, true);
            window.removeEventListener('dragend', clearDropOverlay, true);
        } });
        this.toDispose.push(this.workflow.onDidChange(() => {
            if (this.materialSwap && this.materialSwap.root !== this.workflow.workspaceRoot?.toString()) this.closeMaterialSwap();
            if (this.generationPickRoot !== this.workflow.workspaceRoot?.toString()) {
                this.generationPick.cancel();
            }
            this.ensureMaterialsWatch();
            this.ensureOutputsWatch();
            this.refresh();
        }));
        this.ensureMaterialsWatch();
        this.ensureOutputsWatch();
        this.catalogViewMode = this.readCatalogViewMode();
        this.libraryDetailsOpen = this.readLibraryDetailsOpen();
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
        this.generationPick.cancel();
        super.onAfterHide(msg);
        this.stopCatalogAudio();
    }

    protected refresh(): void {
        void this.loadMaterials();
        void this.loadOutputs();
        void this.refreshLint();
    }

    protected selectTopView(view: TopView): void {
        if (view !== 'catalog' && this.materialSwap) this.closeMaterialSwap();
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
    async openCatalogView(options?: AkariCatalogFocusOptions): Promise<boolean> {
        if (!options) {
            this.selectTopView('catalog');
            return true;
        }
        const tab: TopView = options.tab === 'project' ? 'materials' : 'catalog';
        this.selectTopView(tab);
        let matched = true;
        if (tab === 'materials') {
            // プロジェクト面には「役割のバケツ」的なカテゴリ絞り込みが無い（検索のみ、司令塔への問い参照）。
            if (options.category) {
                matched = false;
            }
            this.setMaterialQuery(options.query ?? '');
        } else {
            const resolved = resolveOpenableLibraryCategory(options.category);
            if (options.category && !resolved) {
                matched = false;
            }
            if (resolved) {
                this.selectLibraryCategory(resolved);
            } else {
                this.showLibraryHome();
            }
            this.setCatalogQuery(options.query ?? '');
        }
        if (options.assetId) {
            const focused = await this.focusAssetCard(tab, options.assetId, options.pulse === true);
            matched = matched && focused;
        }
        return matched;
    }

    // --- 素材カード ---------------------------------------------------------

    protected referenceWatches = new DisposableCollection();
    protected referenceWatchRoot = '';
    protected referenceWatchParents = new Set<string>();

    protected transcriptStateByPath: Record<string, TranscriptState> = {};

    protected async loadMaterials(): Promise<void> {
        const root = this.workflow.workspaceRoot;
        const generation = ++this.materialsGeneration;
        if (!root) {
            this.referenceWatches.dispose();
            this.materials = [];
            this.projectCreditLines = [];
            this.unorganizedMaterials = [];
            this.materialsLoadedOnce = false;
            this.update();
            return;
        }
        this.materialsLoading = true;
        this.update();
        const [assetEntries, rootFiles, references, credits] = await Promise.all([
            this.collectAssetEntries(root.resolve('assets')),
            this.collectUnorganizedRootFiles(root),
            this.projectService.listProjectAssetReferences(root.toString()),
            this.projectService.projectCredits(root.toString()).catch(() => [] as string[])
        ]);
        const [fileMaterials, groupMaterials, unorganizedMaterials] = await Promise.all([
            Promise.all(assetEntries.files.map(file => this.buildMaterialEntry(root, file, false))),
            Promise.all(assetEntries.assetGroups.map(dir => this.buildAssetGroupEntry(root, dir))),
            Promise.all(rootFiles.map(file => this.buildMaterialEntry(root, file, true)))
        ]);
        const states = await this.projectService.transcriptStates({
            projectRoot: root.toString(),
            relativePaths: [...fileMaterials, ...groupMaterials, ...unorganizedMaterials]
                .filter(entry => !entry.assetGroup && (entry.kind === 'video' || entry.kind === 'audio')).map(entry => entry.relativePath)
        });
        if (generation !== this.materialsGeneration) {
            return; // A newer load superseded this one (e.g. rapid watch events); discard stale results.
        }
        this.referenceWatches.dispose();
        this.referenceWatches = new DisposableCollection();
        if (this.referenceWatchRoot !== root.toString()) this.referenceWatchParents.clear();
        this.referenceWatchRoot = root.toString();
        for (const ref of references) if (ref.libraryDir) this.referenceWatchParents.add(URI.fromFilePath(ref.libraryDir).parent.toString());
        const libraryParents = [...this.referenceWatchParents];
        for (const parent of libraryParents) this.referenceWatches.push(this.files.watch(new URI(parent), { recursive: true, excludes: [] }));
        this.referenceWatches.push(this.files.onDidFilesChange(event => {
            if (libraryParents.some(parent => event.changes.some(change => new URI(parent).isEqualOrParent(change.resource)))) void this.loadMaterials();
        }));
        const referenceMaterials = await this.buildReferenceMaterials(root, references);
        if (generation !== this.materialsGeneration) return;
        const referencedDirectories = new Set(referenceMaterials.map(entry => entry.relativePath));
        const materials = [...fileMaterials.filter(entry => !referenceMaterials.some(ref => entry.relativePath.startsWith(`${ref.relativePath}/`))),
            ...groupMaterials.filter(entry => !referencedDirectories.has(entry.relativePath)), ...referenceMaterials];
        materials.sort((left, right) => left.name.localeCompare(right.name, 'ja'));
        this.transcriptStateByPath = states;
        this.materials = materials;
        this.projectCreditLines = credits;
        this.unorganizedMaterials = unorganizedMaterials;
        this.materialsLoading = false;
        this.materialsLoadedOnce = true;
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
    protected async buildReferenceMaterials(root: URI, references: ProjectAssetReference[]): Promise<MaterialCardEntry[]> {
        const result: MaterialCardEntry[] = [];
        for (const reference of references) {
            const state = referencePresentation(reference);
            // Old copy-era groups keep their cards and actions unchanged.
            try {
                const local = await this.files.resolve(root.resolve(state.relativePath));
                const files = this.toAssetBinChildren(local).filter(child => !child.isDirectory)
                    .map(child => ({ name: child.name, path: '', bytes: 0 }));
                if (!referencePresentation({ ...reference, files }).missing) continue;
            } catch { /* No local group: use the ledger. */ }
            let card: MaterialCardEntry | undefined;
            if (reference.libraryDir) {
                try {
                    const directory = await this.files.resolve(URI.fromFilePath(reference.libraryDir));
                    // Only expose files accepted by the node containment check.
                    const allowed = new Set(reference.files.filter(file => !file.name.includes('/')).map(file => file.name));
                    card = await this.buildAssetGroupEntry(root, { ...directory,
                        children: directory.children?.filter(child => !child.isDirectory && allowed.has(child.resource.path.base)) });
                }
                catch { /* A disappeared directory stays visible as a missing reference. */ }
            }
            const known = this.assetCatalogItems.find(item => item.key === `${reference.category}/${reference.id}`);
            const media = resolveLibraryAssetMedia(known ?? { category: reference.category },
                reference.files.filter(file => !file.name.includes('/')).map(file => ({ name: file.name, isDirectory: false })));
            const openName = media.mediaName ?? assetGroupOpenTarget(
                reference.files.map(file => ({ name: file.name, isDirectory: false })), reference.category);
            const openFile = reference.files.find(file => file.name === openName);
            const preview = reference.files.find(file => file.name === 'preview.png');
            result.push({
                ...(card ?? { uri: root.resolve(`${state.relativePath}/meta.json`), kind: 'other', analyzed: false, unorganized: false }),
                ...(openFile ? { uri: URI.fromFilePath(openFile.path) } : {}),
                thumbnailUri: preview ? URI.fromFilePath(preview.path) : undefined,
                name: reference.title ?? known?.title ?? reference.id,
                relativePath: state.relativePath,
                mediaRelativePath: media.mediaName ? `${state.relativePath}/${media.mediaName}` : undefined,
                kind: media.kind === 'other' ? card?.kind ?? 'other' : media.kind,
                assetGroup: { category: reference.category }, reference,
                missing: state.missing
            });
        }
        return result;
    }

    protected async buildAssetGroupEntry(root: URI, dirStat: FileStat): Promise<MaterialCardEntry> {
        const relativePath = this.workflow.relativePath(dirStat.resource) ?? dirStat.resource.path.base;
        const dirName = dirStat.resource.path.base;
        const meta = await this.readAssetGroupMeta(dirStat);
        const media = resolveAssetGroupMedia(meta?.category, this.toAssetBinChildren(dirStat));
        const children = dirStat.children ?? [];
        const previewChild = children.find(child => !child.isDirectory && child.resource.path.base === 'preview.png');
        const metaChild = children.find(child => !child.isDirectory && child.resource.path.base === 'meta.json');
        const openUri = dirStat.resource.resolve(assetGroupOpenTarget(this.toAssetBinChildren(dirStat), meta?.category)
            ?? metaChild?.resource.path.base ?? 'meta.json');
        return {
            uri: openUri,
            relativePath,
            mediaRelativePath: media.mediaName ? `${relativePath}/${media.mediaName}` : undefined,
            name: meta?.title || dirName,
            kind: media.kind,
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
     * 分析済みでない動画/画像/音声素材について、`.akari/cache/thumbnails/` のサムネキャッシュを
     * バックエンドへ問い合わせる（優先順位: analysis keyframe > cache > プレースホルダ）。
     * 音声は波形を生成し、分析済みは対象外。generation が古くなっていれば結果を捨てる（stale ガード）。
     */
    protected async hydrateCachedThumbnails(root: URI, generation: number, entries: MaterialCardEntry[]): Promise<void> {
        const candidates = entries.filter(entry => !entry.assetGroup && !entry.analyzed
            && (entry.kind === 'video' || entry.kind === 'image' || entry.kind === 'audio'));
        await Promise.all(candidates.map(async entry => {
            let outcome;
            try {
                outcome = await this.projectService.resolveMaterialThumbnail(root.toString(), entry.relativePath, entry.kind as 'video' | 'image' | 'audio');
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
        this.materialsWatch.push(this.files.watch(root.resolve('.akari'), { recursive: true, excludes: [] }));
        this.materialsWatch.push(this.files.watch(assetsUri, { recursive: true, excludes: [] }));
        this.materialsWatch.push(this.files.onDidFilesChange(event => this.handleMaterialsFileChange(root, assetsUri, event)));
    }

    protected handleMaterialsFileChange(root: URI, assetsUri: URI, event: FileChangesEvent): void {
        const rootKey = root.toString();
        const relevant = event.changes.some(change => {
            if (change.resource.toString() === root.resolve('.akari/asset-references.json').toString()
                || root.resolve('.akari/sidecars').isEqualOrParent(change.resource)
                || root.resolve('.akari/events').isEqualOrParent(change.resource)) return true;
            if (assetsUri.isEqualOrParent(change.resource)) {
                return true;
            }
            return change.resource.parent.toString() === rootKey && !isMaterialsIrrelevantRootFile(change.resource.path.base);
        });
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
        return classifyMaterialKind(name);
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
        const items = buildMaterialContextMenuItems(target, isOSX, { materialKind: entry.kind, assetGroup: !!entry.assetGroup, reference: !!entry.reference });
        if (!entry.reference && entry.assetGroup && entry.thumbnailUri) {
            items.push(OPEN_PREVIEW_IMAGE_ITEM);
        }
        openAkariContextMenu({
            x: event.clientX,
            y: event.clientY,
            items,
            onSelect: id => this.handleMaterialContextMenuAction(id, entry)
        });
    }

    protected handleMaterialContextMenuAction(id: string, entry: MaterialCardEntry): void {
        switch (id) {
            case 'view-library':
                this.topView = 'catalog';
                this.librarySourceFilter = 'all';
                this.libraryCategory = undefined;
                this.catalogCategory = 'all';
                this.libraryFolderFilter = undefined;
                this.catalogQuery = entry.name;
                this.update();
                break;
            case 'remove-reference':
                void this.removeMaterialReference(entry);
                break;
            case 'open-preview-image':
                if (entry.assetGroup && entry.thumbnailUri) {
                    void this.openFile(entry.thumbnailUri);
                }
                break;
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
            case 'transcribe':
                void this.transcribeMaterial(entry);
                break;
            case 'show-info':
                void this.showAssetInfo(entry.uri);
                break;
            case 'store-library':
                void this.storeMaterialInLibrary(entry);
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

    protected async storeMaterialInLibrary(entry: MaterialCardEntry): Promise<void> {
        if (await this.commandService?.executeCommand<boolean>('akari.library.isMoving')) { this.messages.warn('素材を移動しています。終わるまでお待ちください。'); return; }
        if (entry.reference) return;
        try {
            const uri = entry.mediaRelativePath && this.workflow.workspaceRoot
                ? this.workflow.workspaceRoot.resolve(entry.mediaRelativePath) : entry.uri;
            const plan = await this.projectService.planLibraryImport([uri.path.fsPath()]);
            const result = await this.projectService.applyLibraryImport(plan);
            this.reportLibraryImportResult(result);
            await this.loadAssetCatalogView();
        } catch (error) { this.messages.error(`ライブラリに保管できませんでした: ${String(error)}`); }
    }

    protected reportLibraryImportResult(result: LibraryImportResult): void {
        if (result.added.length) this.messages.info(`${result.added.length} 件を取り込みました`);
        for (const item of result.failures) this.messages.warn(`${item.path || ''}: ${item.reason}`);
    }

    protected async finishLibraryImport(result: LibraryImportResult): Promise<void> {
        this.reportLibraryImportResult(result);
        this.topView = 'catalog';
        this.libraryCategory = undefined;
        this.librarySourceFilter = 'all';
        this.libraryFolderFilter = undefined;
        this.catalogQuery = '';
        this.catalogCategory = 'all';
        await this.loadAssetCatalogView();
        this.update();
        requestAnimationFrame(() => this.node.querySelector('[data-recent-strip]')?.scrollIntoView({ block: 'start' }));
    }

    public async siteImportCompleted(result: LibraryImportResult): Promise<void> {
        await this.finishLibraryImport(result);
    }

    public showSiteLab(): void {
        this.topView = 'catalog'; this.librarySourceFilter = 'lab';
        this.showLibraryHome();
    }

    protected async pickLibraryImport(mode: 'both' | 'files' | 'folders'): Promise<string[]> {
        if (await this.commandService?.executeCommand<boolean>('akari.library.isMoving')) { this.messages.warn('素材を移動しています。終わるまでお待ちください。'); return []; }
        const selected = await this.dialogs.showOpenDialog({
            title: 'ローカルから取り込む', canSelectMany: true, canSelectFiles: mode !== 'folders', canSelectFolders: mode !== 'files'
        });
        return selected ? (Array.isArray(selected) ? selected : [selected]).map(uri => uri.path.fsPath()) : [];
    }

    /** Registered by the always present catalog CommandContribution. */
    async openLibraryImportFromFolder(): Promise<void> {
        if (this.isDisposed) return;
        this.topView = 'catalog';
        const paths = await this.pickLibraryImport('folders');
        if (paths.length) { this.libraryImportRequest = { paths }; this.update(); }
    }

    protected async retryMaterialReference(entry: MaterialCardEntry): Promise<void> {
        if (await this.commandService?.executeCommand<boolean>('akari.library.isMoving')) { this.messages.warn('素材を移動しています。終わるまでお待ちください。'); return; }
        const root = this.workflow.workspaceRoot;
        if (!root || !entry.reference) return;
        try {
            const result = await this.projectService.resolveAsset(entry.reference.id, root.toString(), { force: true });
            if (result.success === false) this.messages.error(result.error);
            await this.loadMaterials();
        } catch (error) { this.messages.error(`素材を取得できませんでした: ${String(error)}`); }
    }

    protected async removeMaterialReference(entry: MaterialCardEntry): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root || !entry.reference) return;
        try {
            if (!await this.confirmReferenceImpact(`${entry.relativePath}/`, false, 'このプロジェクトから外す')) return;
            if (this.workflow.workspaceRoot?.toString() !== root.toString()) return;
            await this.projectService.removeProjectAssetReference(root.toString(), entry.reference);
            await this.loadMaterials();
        } catch (error) { this.messages.error(String(error)); }
    }

    protected bundleBusy = false;
    protected projectCreditLines: string[] = [];
    protected bundleResult?: AssetBundleOutcome;

    protected async bundleMaterials(): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root || this.bundleBusy) return;
        this.bundleBusy = true;
        this.bundleResult = undefined;
        this.update();
        try {
            const plan = await this.projectService.bundleProjectAssets(root.toString(), true);
            const msg = `${plan.planned.length} 件・${(plan.bytes / 1024 / 1024).toFixed(2)} MB を集めます。`
                + (plan.unknownSizeCount ? `（容量不明 ${plan.unknownSizeCount} 件）` : '')
                + (plan.restrictedCount ? `\n再配布できない素材が ${plan.restrictedCount} 件含まれます` : '');
            if (this.workflow.workspaceRoot?.toString() !== root.toString()) return;
            if (!plan.planned.length) { this.messages.info('実体化する参照はありません'); return; }
            if (!await new ConfirmDialog({ title: '素材をまとめる', msg, ok: 'まとめる', cancel: 'キャンセル' }).open()) return;
            if (this.workflow.workspaceRoot?.toString() !== root.toString()) return;
            const result = await this.projectService.bundleProjectAssets(root.toString(), false);
            if (this.workflow.workspaceRoot?.toString() !== root.toString()) return;
            this.bundleResult = result;
            await this.loadMaterials();
        } catch (error) { this.messages.error(`素材をまとめられませんでした: ${String(error)}`); }
        finally { this.bundleBusy = false; this.update(); }
    }

    protected renderBundleMaterials(): React.ReactNode {
        return <div style={{ padding: '8px 12px', borderTop: AKARI_BORDER.hairline }}>
            <button disabled={this.bundleBusy} onClick={() => void this.bundleMaterials()}>素材をまとめる</button>
            {(this.projectCreditLines?.length ?? 0) > 0 && <button onClick={() => void navigator.clipboard.writeText(this.projectCreditLines.join('\n'))
                .then(() => this.messages.info('クレジットをコピーしました'))
                .catch(() => this.messages.error('クレジットをコピーできませんでした'))}>クレジットをコピー</button>}
            {this.bundleResult && <div role='status' style={{ maxHeight: '180px', overflow: 'auto' }}>
                <p>{this.bundleResult.materialized.length} 件をまとめました。</p>
                {this.bundleResult.materialized.length > 0 && <ul>{this.bundleResult.materialized.map(key => <li key={key}>{key}</li>)}</ul>}
                {this.bundleResult.failures.length > 0 && <><p>次の素材は参照のまま残っています。</p><ul>
                    {this.bundleResult.failures.map(failure => <li key={failure.key}>{failure.key}: {failure.message}</li>)}
                </ul></>}
            </div>}
        </div>;
    }

    /**
     * 「タイムラインに追加」（送信側のみ、task 2026-08-10-material-menu-r2 指示2）。
     * 受け側（姉妹タスク 2026-08-10-timeline-clip-menu）のコマンド未登録も含め、失敗は
     * 握って messages.error に落とす（司令塔裁定2 — 実機ではほぼ同時に合流するため雑でよい）。
     */
    protected async addMaterialToTimeline(entry: MaterialCardEntry): Promise<void> {
        try {
            await this.commandService.executeCommand(TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID, {
                relativePath: entry.mediaRelativePath ?? entry.relativePath,
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
     * - レポート: ルート直下の ROOT_REPORT_FILES + `.akari/reports/` 直下の HTML
     *   （PNG 視認証跡は対象外）
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
            this.outputsLoadedOnce = false;
            this.update();
            return;
        }
        this.outputsLoading = true;
        this.update();
        const [dataFiles, planFiles, exportFiles, rootReportFiles, managedReportFiles] = await Promise.all([
            this.collectRootFilesNamed(root, PROJECT_DATA_FILES.map(file => file.name)),
            this.collectPlanFiles(root),
            this.collectTopLevelFiles(root.resolve('exports')),
            this.collectRootFilesNamed(root, ROOT_REPORT_FILES),
            this.collectTopLevelFiles(root.resolve('.akari/reports'))
        ]);
        const reportFiles = [...rootReportFiles, ...managedReportFiles];
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
        this.outputs = orderDataEntries(merged, PROJECT_DATA_FILES.map(file => file.name));
        this.outputsLoading = false;
        this.outputsLoadedOnce = true;
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
        const watchedRootNames = new Set([
            ...PROJECT_DATA_FILES.map(file => file.name),
            ...ROOT_PLAN_FILES,
            ...ROOT_REPORT_FILES
        ]);
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
            case 'data': return dataFileIcon(entry.name);
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
    public async loadAssetCatalogView(): Promise<void> {
        this.catalogLoading = true;
        this.update();
        const preferenceRoot = this.preferences.get<string>(AKARI_CATALOG_ROOT_PREFERENCE, '');
        this.catalogPickError = undefined;
        const [view, presetShowcase, usage, myStyles, favorites, transitionPreviews] = await Promise.all([
            this.projectService.getAssetCatalogView(preferenceRoot),
            this.projectService.getPresetShowcase().catch(() => EMPTY_PRESET_SHOWCASE),
            this.projectService.getLibraryUsage().catch(() => ({} as Record<string, { count: number; lastUsedAt: string; projects: string[] }>)),
            this.projectService.listMyStyles().catch(() => [] as MyStyle[]),
            this.projectService.getLibraryFavorites().catch(() => [] as string[]),
            this.projectService.getTransitionPreviewUrls().catch(() => ({} as Record<string, { preview: string; strip: string }>))
        ]);
        this.libraryFavorites = new Set(favorites);
        this.assetCatalogItems = view.items.map(item => ({ ...item, favorite: this.libraryFavorites.has(item.key),
            usageCount: usage[item.key]?.count ?? 0, lastUsedAt: usage[item.key]?.lastUsedAt }));
        this.catalogPacks = view.packs;
        this.catalogResolver = view.resolver;
        this.catalogEntitlementsStatus = view.entitlementsStatus;
        this.presetShowcase = presetShowcase;
        this.transitionPreviewUrls = transitionPreviews;
        this.myStyles = myStyles;
        this.catalogLoading = false;
        this.update();
    }

    /** 促しのシートをコマンドから開くとき、一覧をまだ読んでいなければ読む。 */
    public assetCatalogLoaded(): boolean {
        return this.assetCatalogItems.length > 0;
    }

    public async refreshStoreConnectionStatus(): Promise<void> {
        await this.storeConnectionFlow.refreshStatus();
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
        return rankRecentLibraryItems(this.applyLibraryFilter(filterLibraryCatalogItems(this.assetCatalogItems, this.librarySourceFilter, this.catalogQuery, this.catalogCategory, this.libraryFolderFilter)),
            item => this.catalogQuery && item.title.toLocaleLowerCase().includes(this.catalogQuery.toLocaleLowerCase()) ? 1 : 0);
    }

    /** 検索の右のフィルター（4 節）の今の状態。出どころは librarySourceFilter を正とする。 */
    protected libraryFilter(): LibraryFilterState {
        return { source: this.librarySourceFilter, ...this.libraryFilterRest };
    }

    protected applyLibraryFilter(items: readonly AssetCatalogViewItem[]): AssetCatalogViewItem[] {
        return filterLibraryItems(items, this.libraryFilter(), this.libraryFavorites);
    }

    protected presetPassesLibraryFilter(key: string, source: 'lab' | 'own' = 'lab'): boolean {
        return presetMatchesLibraryFilter(key, this.libraryFilter(), this.libraryFavorites, source);
    }

    protected toggleLibraryFilterOption(section: LibraryFilterSectionKey, option: string): void {
        const next = toggleLibraryFilterOption(this.libraryFilter(), section, option);
        this.librarySourceFilter = next.source;
        this.libraryFilterRest = { price: next.price, license: next.license, status: next.status };
        this.update();
    }

    protected clearLibraryFilter(): void {
        this.librarySourceFilter = EMPTY_LIBRARY_FILTER.source;
        this.libraryFilterRest = { price: [], license: [], status: [] };
        this.update();
    }

    protected catalogCategoryChips(): CatalogCategoryChip[] {
        return deriveCatalogCategoryChips(this.assetCatalogItems);
    }

    protected selectedPresetKind(): PresetShowcaseKind | undefined {
        const kind = this.catalogCategory.startsWith('preset:')
            ? this.catalogCategory.slice('preset:'.length)
            : undefined;
        return kind === 'lut' || kind === 'textanim' || kind === 'textstyle'
            ? kind
            : undefined;
    }

    protected filteredPresetShowcaseItems(kind: PresetShowcaseKind): PresetShowcaseItem[] {
        return filterPresetShowcaseItems(this.presetShowcase[kind], this.catalogQuery)
            .filter(item => this.presetPassesLibraryFilter(`${kind}/${item.id}`));
    }

    protected setCatalogQuery(query: string): void {
        this.catalogQuery = query;
        this.update();
    }

    protected setMaterialQuery(query: string): void {
        this.materialQuery = query;
        this.update();
    }

    protected libraryCategoryDefinition(key: LibraryCategoryKey): LibraryCategoryDefinition {
        for (const group of LIBRARY_GROUPS as readonly LibraryGroupDefinition[]) {
            const category = group.categories.find(candidate => candidate.key === key);
            if (category) {
                return category;
            }
        }
        throw new Error(`未知のライブラリカテゴリです: ${key}`);
    }

    protected selectLibraryCategory(key: LibraryCategoryKey): void {
        const category = this.libraryCategoryDefinition(key);
        if (category.status !== 'live') {
            return;
        }
        this.libraryFolderFilter = undefined;
        this.libraryCategory = key;
        this.libraryTextLookOpen = false;
        this.shapeShelfView = undefined;
        this.catalogCategory = category.chipKey ?? 'all';
        this.update();
    }

    protected showLibraryHome(): void {
        this.stopCatalogAudio();
        this.libraryFolderFilter = undefined;
        this.libraryCategory = undefined;
        this.libraryTextLookOpen = false;
        this.shapeShelfView = undefined;
        this.catalogCategory = 'all';
        this.update();
    }

    protected libraryCategoryCount(category: LibraryCategoryDefinition): number | undefined {
        if (category.key === 'shapes') return this.shapeShelf.presets.length;
        return countLibraryCategory(category, this.librarySourceFilter, this.applyLibraryFilter(this.assetCatalogItems),
            this.presetShowcase, TRANSITION_VOCABULARY.length, this.catalogPacks, key => this.presetPassesLibraryFilter(key),
            TRANSITION_VOCABULARY.map(transition => transition.id));
    }

    /** `akari.catalog.listCategories` の実体。UI 状態は変えない読み取り専用メソッド。 */
    public catalogCategorySummaries(): AkariCatalogCategorySummary[] {
        return LIBRARY_GROUPS.flatMap(group => group.categories.map(category => ({
            key: category.key,
            label: category.label,
            status: category.status,
            count: this.libraryCategoryCount(category)
        })));
    }

    /**
     * assetId に一致するカードまでスクロールし、pulse なら発光させる。this.update() は
     * Lumino 経由で非同期に反映されるため、React の再描画完了を 2 回連続の
     * requestAnimationFrame で待つ（packages/edit-store 配下 visual-thumbnail.ts:96 と同型）。
     */
    protected async focusAssetCard(tab: TopView, assetId: string, pulse: boolean): Promise<boolean> {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const escaped = CSS.escape(assetId);
        const target = this.node.querySelector<HTMLElement>(
            tab === 'materials'
                ? `[data-akari-material-path="${escaped}"]`
                : `[data-akari-catalog-item="${escaped}"], [data-akari-catalog-preset-item="${escaped}"], `
                  + `[data-akari-library-transition="${escaped}"], [data-akari-catalog-pack="${escaped}"]`
        );
        if (!target) {
            return false;
        }
        target.scrollIntoView({ block: 'nearest' });
        if (pulse) {
            target.classList.remove(AKARI_CATALOG_FOCUS_PULSE_CLASS);
            void target.offsetWidth; // 連続で光らせ直せるように reflow を挟む
            target.classList.add(AKARI_CATALOG_FOCUS_PULSE_CLASS);
            target.addEventListener('animationend', () => target.classList.remove(AKARI_CATALOG_FOCUS_PULSE_CLASS), { once: true });
        }
        return true;
    }

    protected readCatalogViewMode(): CatalogViewMode {
        try {
            return normalizeCatalogViewMode(window.localStorage.getItem(AKARI_CATALOG_VIEW_MODE_STORAGE_KEY));
        } catch {
            return 'grid';
        }
    }

    protected setCatalogViewMode(mode: CatalogViewMode): void {
        this.catalogViewMode = mode;
        try {
            window.localStorage.setItem(AKARI_CATALOG_VIEW_MODE_STORAGE_KEY, mode);
        } catch {
            // localStorage が利用できない webview でも、当該セッション内の切替は維持する。
        }
        this.update();
    }

    protected readLibraryDetailsOpen(): boolean {
        try {
            return window.localStorage.getItem(AKARI_LIBRARY_DETAILS_STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    }

    protected toggleLibraryDetails(): void {
        this.libraryDetailsOpen = !this.libraryDetailsOpen;
        try {
            window.localStorage.setItem(AKARI_LIBRARY_DETAILS_STORAGE_KEY, String(this.libraryDetailsOpen));
        } catch {
            // localStorage が利用できない場合も、当該セッション内の開閉は維持する。
        }
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
     * カタログ試聴の唯一の停止経路。ドックの停止ボタン・面外クリック・面からの離脱・
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
        if (await this.commandService?.executeCommand<boolean>('akari.library.isMoving')) { this.messages.warn('素材を移動しています。終わるまでお待ちください。'); return; }
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
            const localSource = localLibraryAssetPlacementSource(item);
            const outcome = localSource
                ? await this.projectService.placeLibraryAsset(localSource, root.toString())
                : await this.projectService.resolveAsset(item.id, root.toString());
            // tsconfig の strict:false（strictNullChecks off）下では `!outcome.success` /
            // if-else の判別共用体絞り込みが効かない（実測で確認済み）。`=== false` の
            // 明示比較だけが確実に絞り込めるため、これを使う。
            if (outcome.success === false) {
                this.messages.error(`素材を取得できませんでした: ${outcome.error}`);
                return;
            }
            this.assetCatalogItems = this.assetCatalogItems.map(entry => entry.key === item.key
                ? { ...entry, usageCount: (entry.usageCount ?? 0) + 1, lastUsedAt: new Date().toISOString() } : entry);
            this.refreshAfterAssetCatalogImport(item.key);
        } catch {
            this.messages.error('素材を取得できませんでした。ネットワーク環境をご確認ください。');
        } finally {
            this.resolvingAssetKeys.delete(item.key);
            this.update();
        }
    }

    public refreshAfterAssetCatalogImport(itemKey: string): void {
        this.assetCatalogItems = this.assetCatalogItems.map(entry =>
            entry.key === itemKey ? { ...entry, state: 'cached' } : entry
        );
        void this.loadMaterials();
    }

    async resolveCatalogOverlay(key: string): Promise<{ relativePath: string; meta: unknown; fragment: string } | undefined> {
        if (this.showPremiumPrompt(key)) return undefined;
        const root = this.workflow.workspaceRoot;
        const item = this.assetCatalogItems.find(entry => entry.key === key);
        if (!root || !item || !canPlaceOverlay(item)) {
            this.messages.warn('このオーバーレイは置けません。');
            return undefined;
        }
        if (this.resolvingAssetKeys.has(key)) return undefined;
        this.resolvingAssetKeys.add(key);
        this.update();
        try {
            const localSource = localLibraryAssetPlacementSource(item);
            const outcome = localSource
                ? await this.projectService.placeLibraryAsset(localSource, root.toString())
                : await this.projectService.resolveAsset(item.id, root.toString());
            if (outcome.success === false) throw new Error(outcome.error);
            const directory = URI.fromFilePath(outcome.reference && outcome.libraryDir
                ? outcome.libraryDir : outcome.projectAssetPath);
            const listing = await this.files.resolve(directory);
            const names = (listing.children ?? []).filter(child => !child.isDirectory)
                .map(child => child.resource.path.base);
            const file = item.mediaFile && names.includes(item.mediaFile) && /\.html?$/i.test(item.mediaFile)
                ? item.mediaFile : names.includes('fragment.html') ? 'fragment.html'
                    : names.filter(name => /\.html?$/i.test(name)).sort()[0];
            if (!file || !names.includes('meta.json')) throw new Error('HTML または meta.json が見つかりません');
            const [metaSource, fragment] = await Promise.all([
                this.files.readFile(directory.resolve('meta.json')),
                this.files.readFile(directory.resolve(file))
            ]);
            if (this.workflow.workspaceRoot?.toString() !== root.toString()) return undefined;
            if (outcome.reference && outcome.libraryDir) {
                this.assetCatalogItems = this.assetCatalogItems.map(entry => entry.key === key
                    ? { ...entry, libraryDir: outcome.libraryDir } : entry);
            }
            this.refreshAfterAssetCatalogImport(key);
            return { relativePath: `assets/overlay/${item.id}/${file}`,
                meta: JSON.parse(metaSource.value.toString()), fragment: fragment.value.toString() };
        } catch (error) {
            this.messages.warn(`オーバーレイを使えませんでした: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        } finally {
            this.resolvingAssetKeys.delete(key);
            this.update();
        }
    }

    async readCatalogOverlayMeta(key: string): Promise<unknown | undefined> {
        const item = this.assetCatalogItems.find(entry => entry.key === key);
        if (!item || item.category !== 'overlay' || !item.libraryDir) return undefined;
        try {
            const file = await this.files.readFile(URI.fromFilePath(item.libraryDir).resolve('meta.json'));
            return JSON.parse(file.value.toString());
        } catch { return undefined; }
    }

    /** カタログ key を既存 resolver で取り込み、配置可能な主メディアだけ返す。 */
    async resolveCatalogMaterial(key: string, options?: { preferExisting?: boolean }): Promise<{ relativePath: string; kind: MaterialKind; cached?: boolean } | undefined> {
        // 未購入のプレミアム: 置かずに促しのシート（Lab で見る）を出す。
        if (this.showPremiumPrompt(key)) return undefined;
        if (await this.commandService?.executeCommand<boolean>('akari.library.isMoving')) { this.messages.warn('素材を移動しています。終わるまでお待ちください。'); return undefined; }
        const root = this.workflow.workspaceRoot;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            return undefined;
        }
        const item = this.assetCatalogItems.find(entry => entry.key === key);
        if (!item || !canPlaceLibraryAsset(item)) {
            this.messages.warn('この素材は直接置けません');
            return undefined;
        }
        if (this.resolvingAssetKeys.has(key)) {
            this.messages.warn('素材を取得中です。完了してからもう一度追加してください。');
            return undefined;
        }
        this.resolvingAssetKeys.add(key);
        this.update();
        try {
            if (options?.preferExisting && key === `${item.category}/${item.id}`
                && item.id !== '.' && item.id !== '..' && !/[\\/]/.test(item.id)) {
                try {
                    const directory = root.resolve(`assets/${item.category}/${item.id}`);
                    const stat = await this.files.resolve(directory);
                    const media = resolveLibraryAssetMedia(item, this.toAssetBinChildren(stat));
                    if (media.kind !== 'other' && media.mediaName) {
                        const file = directory.resolve(media.mediaName);
                        const actual = await this.files.resolve(file);
                        const relativePath = root.relative(file)?.toString();
                        if (!actual.isDirectory && relativePath && this.workflow.workspaceRoot?.toString() === root.toString()) {
                            void Promise.resolve().then(() => this.projectService.recordLibraryUsage(item.category, item.id, root.toString()))
                                .then(() => {
                                    if (this.workflow.workspaceRoot?.toString() !== root.toString()) return;
                                    this.assetCatalogItems = this.assetCatalogItems.map(entry => entry.key === key
                                        ? { ...entry, usageCount: (entry.usageCount ?? 0) + 1, lastUsedAt: new Date().toISOString() } : entry);
                                    this.update();
                                })
                                .catch(error => console.warn('ライブラリの使用記録を書けませんでした', error));
                            return { relativePath, kind: media.kind, cached: true };
                        }
                    }
                } catch { /* 未取得・不完全な配置は従来の resolver へ委譲する。 */ }
                if (this.workflow.workspaceRoot?.toString() !== root.toString()) return undefined;
            }
            const localSource = localLibraryAssetPlacementSource(item);
            const outcome = localSource
                ? await this.projectService.placeLibraryAsset(localSource, root.toString())
                : await this.projectService.resolveAsset(item.id, root.toString());
            if (outcome.success === false) {
                this.messages.error(`素材を取得できませんでした: ${outcome.error}`);
                return undefined;
            }
            this.assetCatalogItems = this.assetCatalogItems.map(entry => entry.key === key
                ? { ...entry, usageCount: (entry.usageCount ?? 0) + 1, lastUsedAt: new Date().toISOString() } : entry);
            if (this.workflow.workspaceRoot?.toString() !== root.toString()) {
                this.messages.warn('プロジェクトが切り替わったため、素材を追加しませんでした。');
                return undefined;
            }
            const directory = URI.fromFilePath(outcome.reference ? outcome.libraryDir : outcome.projectAssetPath);
            const stat = await this.files.resolve(directory);
            const media = resolveLibraryAssetMedia(item, this.toAssetBinChildren(stat));
            this.assetCatalogItems = this.assetCatalogItems.map(entry =>
                entry.key === key ? { ...entry, state: 'cached' } : entry
            );
            void this.loadMaterials();
            if (media.kind === 'other' || !media.mediaName) {
                this.messages.warn('この素材は直接置けません');
                return undefined;
            }
            const relativePath = outcome.reference
                ? `assets/${item.category}/${item.id}/${media.mediaName}`
                : root.relative(directory.resolve(media.mediaName))?.toString();
            if (!relativePath) {
                this.messages.error('素材のプロジェクト内パスを解決できませんでした。');
                return undefined;
            }
            return { relativePath, kind: media.kind, ...(options?.preferExisting ? { cached: false } : {}) };
        } catch (error) {
            this.messages.error(`素材を取得できませんでした: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        } finally {
            this.resolvingAssetKeys.delete(key);
            this.update();
        }
    }

    /** 未購入のプレミアムもドラッグできる（payload に locked を載せ、受け口が促しのシートへ分岐する）。 */
    protected canDragCatalogAsset(item: AssetCatalogViewItem): boolean {
        return this.libraryCategory !== 'pack' && (canPlaceLibraryAsset(item) || canPlaceOverlay(item)
            || (item.origin === 'resolver' && item.category === 'scene3d')
            || (isPremiumLocked(item) && isPlaceableLibraryCategory(item)));
    }

    protected handleCatalogAssetDragStart(event: React.DragEvent<HTMLElement>, item: AssetCatalogViewItem): void {
        if (item.category !== 'font' && !this.canDragCatalogAsset(item)) {
            event.preventDefault();
            return;
        }
        const { key, id, category, title } = item;
        if (category === 'font') {
            const payload = { kind: 'font', id, fontFamily: title.replace(/（.*$/, '').trim(), key,
                ...(isPremiumLocked(item) || item.state === 'locked' ? { locked: true } : {}) };
            event.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(payload));
            event.dataTransfer.effectAllowed = 'copy';
            window.dispatchEvent(new CustomEvent(LIBRARY_DRAG_START_EVENT, { detail: payload }));
            return;
        }
        const size = item as AssetCatalogViewItem & { width?: number; height?: number; durationSeconds?: number; locked?: boolean };
        const payload = { kind: libraryDragKind(item), key, id, category, title,
            ...(typeof size.width === 'number' ? { width: size.width } : {}),
            ...(typeof size.height === 'number' ? { height: size.height } : {}),
            ...(item.previewUrl ? { thumb: item.previewUrl } : {}),
            ...(typeof size.durationSeconds === 'number' ? { durationSeconds: size.durationSeconds } : {}),
            ...(isPremiumLocked(item) || size.locked || item.state === 'locked' ? { locked: true } : {}),
            ...(isPremiumLocked(item) && item.price ? { price: item.price } : {}) };
        event.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
        window.dispatchEvent(new CustomEvent(LIBRARY_DRAG_START_EVENT, { detail: payload }));
    }

    protected async addCatalogAssetAtPlayhead(item: AssetCatalogViewItem): Promise<void> {
        try {
            if (item.category === 'scene3d') { this.messages.info('3D は近日対応します。'); return; }
            if (item.category === 'overlay') {
                await this.commandService.executeCommand('akari.timeline.addOverlayAtOutputPoint', { key: item.key });
                return;
            }
            const material = await this.commandService.executeCommand<{ relativePath: string; kind: MaterialKind } | undefined>(
                RESOLVE_LIBRARY_MATERIAL_COMMAND_ID, item.key
            );
            if (material) await this.commandService.executeCommand(TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID, material);
        } catch (error) {
            this.messages.error(`素材を追加できません: ${error instanceof Error ? error.message : String(error)}`);
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
        if (!transfer || !isOsFileDropInput(transfer.types)) {
            this.setDragActive(false);
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
        if (!transfer || !isOsFileDropInput(transfer.types)) {
            return;
        }
        if (this.topView === 'catalog') {
            const paths = Array.from(transfer.files).map(file => this.resolveDroppedFilePath(file)).filter((path): path is string => !!path);
            if (!transfer.files.length) for (const line of transfer.getData('text/uri-list').split(/\r?\n/)) {
                if (line.startsWith('file:')) paths.push(new URI(line).path.fsPath());
            }
            if (paths.length) { this.libraryImportRequest = { paths }; this.update(); }
            else this.messages.warn('ファイルの場所を読み取れませんでした。＋ から選び直してください。');
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
     * プロジェクト面は上下 2 分割（U6）。上 = 素材 / 下 = できたもの。モック比率
     * （上がやや広い）に合わせ flex-grow 1.2 : 1 を割り当てる
     * （`planning/attachments/2026-08-03-owner-feedback-shell-v013/shell-home-mock.html`
     * の `.lp-top { flex: 1.2 }` / `.lp-bottom { flex: 1 }` と同値）。
     *
     * ライブラリ面は 1 面（パネル全体）— 2026-09-03 オーナー指示「ライブラリ特化タブに
     * した方がいい」。ライブラリはプロジェクトの外にある共有の棚で、プロジェクトの成果物
     * （できたもの）とは別系統なので、同じ画面に並べる必然がない。プロジェクト面へ
     * 戻せば「できたもの」も戻る（できたもの自体は撤去しない）。
     */
    protected override render(): React.ReactNode {
        const libraryOnly = this.topView === 'catalog';
        return (
            <div
                style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}
                data-akari-left-panel-layout={libraryOnly ? 'library-only' : 'split'}
            >
                <div style={{
                    flex: libraryOnly ? '1 1 0%' : '1.2 1 0%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    borderBottom: libraryOnly ? undefined : AKARI_BORDER.hairline
                }}>
                    {this.renderMaterialsPane()}
                </div>
                {!libraryOnly && (
                    <div style={{ flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        {this.renderOutputsPane()}
                    </div>
                )}
                {libraryOnly && <LibraryImportSheet service={this.projectService} isOSX={isOSX}
                    overlayHost={this.node}
                    projectUri={this.workflow.workspaceRoot?.toString()}
                    revealLibraryPath={path => void this.revealInFileManagerCommand(URI.fromFilePath(path))}
                    siteCategory={this.libraryCategory}
                    openSite={id => this.commandService.executeCommand('akari.assetSite.open', id)}
                    askSiteAgent={prompt => this.commandService.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, prompt)}
                    openLab={() => this.showSiteLab()}
                    request={this.libraryImportRequest} consumed={() => { this.libraryImportRequest = undefined; }} pick={mode => this.pickLibraryImport(mode)}
                    imported={result => this.finishLibraryImport(result)} stopAudio={() => this.stopCatalogAudio()} />}
                {this.renderLintBadge()}
                {this.renderLibraryOverlays()}
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
                    color: AKARI_INK, textAlign: 'center', padding: '0 8px'
                }}
            >
                <span className='codicon codicon-cloud-upload' aria-hidden='true' style={{ fontSize: 22 }} />
                <strong style={{ fontSize: 12.5, lineHeight: 1.4 }}>{this.topView === 'catalog' ? 'ここに落とすとライブラリへ取り込みます' : 'ここに落とすと素材に取り込みます'}</strong>
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
                {this.renderGenerationPickBand()}
                {this.renderTopControls()}
                <div style={{ flex: '1 1 auto', overflow: 'auto', minHeight: 0,
                    paddingBottom: this.topView === 'catalog' && !this.materialSwap && this.playingCatalogAudioKey ? '56px' : undefined,
                    boxSizing: 'border-box' }}>
                    {this.topView === 'materials' ? this.renderMaterialsTab() : this.renderCatalogTab()}
                </div>
                {this.topView === 'catalog' && !this.materialSwap && this.renderCatalogAudioDock()}
                {this.topView === 'materials' && this.workflow.workspaceRoot && this.renderBundleMaterials()}
            </div>
        );
    }

    protected disposePanelSegmentMotion?: () => void;
    /** Stable ref: reset motion on every DOM mount, including panel recreation. */
    protected readonly mountPanelSegmentTrack = (node: HTMLDivElement | null): void => {
        this.disposePanelSegmentMotion?.();
        this.disposePanelSegmentMotion = undefined;
        if (!node) { return; }
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        let painted = false;
        const syncMotion = (): void => {
            const animate = painted && !media.matches;
            node.style.setProperty('--akari-panel-segment-transition', animate
                ? 'transform 280ms cubic-bezier(0.32, 0.72, 0, 1)' : 'none');
            node.style.setProperty('--akari-panel-label-transition', animate
                ? 'color 160ms ease, font-weight 160ms ease, opacity 160ms ease' : 'none');
        };
        let frame: number | undefined;
        // Resize (including reopening a hidden panel) changes percentage transforms.
        // Paint the new position before allowing tab-switch motion again.
        const resetMotion = (): void => {
            if (frame !== undefined) { window.cancelAnimationFrame(frame); }
            painted = false;
            syncMotion();
            frame = window.requestAnimationFrame(() => {
                frame = window.requestAnimationFrame(() => {
                    frame = undefined;
                    painted = true;
                    syncMotion();
                });
            });
        };
        resetMotion();
        media.addEventListener('change', syncMotion);
        const observer = typeof window.ResizeObserver === 'function'
            ? new window.ResizeObserver(resetMotion) : undefined;
        observer?.observe(node);
        this.disposePanelSegmentMotion = () => {
            observer?.disconnect();
            if (frame !== undefined) { window.cancelAnimationFrame(frame); }
            media.removeEventListener('change', syncMotion);
        };
    };

    protected renderTopControls(): React.ReactNode {
        const query = this.topView === 'materials' ? this.materialQuery : this.catalogQuery;
        return (
            <div
                data-akari-catalog-controls={this.topView === 'catalog' ? 'true' : undefined}
                style={{ flex: '0 0 auto', padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: '7px', borderBottom: AKARI_BORDER.hairline }}
            >
                <div
                    role='tablist'
                    aria-label='素材パネルの表示'
                    ref={this.mountPanelSegmentTrack}
                    onKeyDown={event => {
                        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') { return; }
                        event.preventDefault();
                        const view = this.topView === 'materials' ? 'catalog' : 'materials';
                        this.selectTopView(view);
                        event.currentTarget.querySelector<HTMLButtonElement>(`[data-akari-panel-segment="${view}"]`)?.focus();
                    }}
                    style={{
                        display: 'flex', position: 'relative', gap: 0, padding: '2px',
                        background: AKARI_SURFACE.raised, border: AKARI_BORDER.ghost, borderRadius: '999px'
                    }}
                >
                    <div
                        aria-hidden='true'
                        data-akari-panel-segment-thumb='true'
                        style={{
                            position: 'absolute', left: '2px', top: '2px', bottom: '2px',
                            width: 'calc((100% - 4px) / 2)', boxSizing: 'border-box',
                            background: AKARI_SURFACE.elevated, border: AKARI_BORDER.accent,
                            borderRadius: '999px', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
                            pointerEvents: 'none',
                            transform: this.topView === 'materials' ? 'translateX(0)' : 'translateX(100%)',
                            transition: 'var(--akari-panel-segment-transition, none)'
                        }}
                    />
                    {([
                        { view: 'materials' as const, label: 'プロジェクト' },
                        { view: 'catalog' as const, label: 'ライブラリ' }
                    ]).map(item => {
                        const active = this.topView === item.view;
                        return (
                            <button
                                key={item.view}
                                type='button'
                                role='tab'
                                aria-selected={active}
                                data-akari-panel-segment={item.view}
                                data-akari-open-catalog={item.view === 'catalog' ? 'true' : undefined}
                                data-akari-back-to-materials={item.view === 'materials' ? 'true' : undefined}
                                tabIndex={active ? 0 : -1}
                                onClick={() => this.selectTopView(item.view)}
                                onFocus={event => {
                                    event.currentTarget.style.outline = event.currentTarget.matches(':focus-visible')
                                        ? `2px solid ${AKARI_LINE.accent}` : 'none';
                                }}
                                onBlur={event => { event.currentTarget.style.outline = 'none'; }}
                                // theia-button の面・文字色 !important と margin-left: 12px を避ける。
                                // パネル幅 164px でも「プロジェクト」が 2 行に折れないよう詰める。
                                style={{
                                    flex: '1 1 0',
                                    minWidth: 0,
                                    position: 'relative',
                                    zIndex: 1,
                                    margin: 0,
                                    padding: '4px 2px',
                                    fontFamily: 'inherit',
                                    fontSize: '0.75em',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    borderRadius: '999px',
                                    fontWeight: active ? 700 : 400,
                                    opacity: active ? 1 : 0.66,
                                    border: 'none',
                                    background: 'transparent',
                                    color: AKARI_INK,
                                    cursor: 'pointer',
                                    outlineOffset: '-2px',
                                    transition: 'var(--akari-panel-label-transition, none)'
                                }}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                    <input
                        type='search'
                        value={query}
                        onChange={event => this.topView === 'materials'
                            ? this.setMaterialQuery(event.target.value)
                            : this.setCatalogQuery(event.target.value)}
                        onClick={event => event.stopPropagation()}
                        placeholder={this.topView === 'materials' ? 'プロジェクト内を検索' : 'ライブラリを検索'}
                        aria-label={this.topView === 'materials' ? 'プロジェクト内の素材を検索' : 'ライブラリを検索'}
                        data-akari-panel-search={this.topView}
                        style={{
                            flex: '1 1 auto',
                            minWidth: 0,
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '5px 8px',
                            background: AKARI_SURFACE.raised,
                            color: AKARI_INK,
                            border: AKARI_BORDER.hairline,
                            borderRadius: `${AKARI_RADIUS.panel}px`
                        }}
                    />
                    {this.topView === 'catalog' && !this.materialSwap && <LibraryFilterButton filter={this.libraryFilter()}
                        open={!!this.libraryFilterAnchor}
                        onToggle={() => this.toggleLibraryFilterPopover()} />}
                </div>
            </div>
        );
    }

    protected renderMaterialsTab(): React.ReactNode {
        if (!this.workflow.workspaceRoot) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>プロジェクトを開いてください。</p>;
        }
        if (this.materialsLoading && !this.materialsLoadedOnce) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>読み込み中…</p>;
        }
        if (!this.materials.length && !this.unorganizedMaterials.length) {
            return (
                <p style={{ opacity: 0.7, padding: '16px' }}>
                    ここにはまだ素材がありません。動画・音声・画像をこのパネルへドラッグすると取り込めます。
                </p>
            );
        }
        const normalizedQuery = this.materialQuery.trim().toLowerCase();
        const materials = normalizedQuery
            ? this.materials.filter(entry => entry.name.toLowerCase().includes(normalizedQuery))
            : this.materials;
        const unorganizedMaterials = normalizedQuery
            ? this.unorganizedMaterials.filter(entry => entry.name.toLowerCase().includes(normalizedQuery))
            : this.unorganizedMaterials;
        if (!materials.length && !unorganizedMaterials.length) {
            return <p data-akari-material-search-empty style={{ opacity: 0.7, padding: '16px' }}>条件に一致する素材がありません。</p>;
        }
        return (
            <div>
                {materials.length
                    ? <div style={{ display: 'grid', gridTemplateColumns: MATERIAL_GRID_COLUMNS, gap: MATERIAL_GRID_GAP, padding: MATERIAL_GRID_LAYOUT.gridPadding }}>
                        {materials.map(entry => this.renderMaterialCard(entry))}
                    </div>
                    : <p style={{ opacity: 0.7, padding: '10px 16px 0' }}>assets/ にはまだ素材がありません。</p>}
                {unorganizedMaterials.length > 0 && this.renderUnorganizedSection(unorganizedMaterials)}
            </div>
        );
    }

    protected renderUnorganizedSection(entries: readonly MaterialCardEntry[]): React.ReactNode {
        return (
            <div style={{ borderTop: AKARI_BORDER.hairline, marginTop: '8px' }}>
                <div style={{ padding: '10px 10px 0', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '0.85em', fontWeight: 600 }}>未整理</span>
                    <span style={{ opacity: 0.7, fontSize: '0.78em' }}>
                        プロジェクトルート直下に置かれています。「assets へ移動」で整理できます。
                    </span>
                </div>
                <div
                    data-akari-unorganized-count={entries.length}
                    style={{ display: 'grid', gridTemplateColumns: MATERIAL_GRID_COLUMNS, gap: MATERIAL_GRID_GAP, padding: MATERIAL_GRID_LAYOUT.gridPadding }}
                >
                    {entries.map(entry => this.renderMaterialCard(entry))}
                </div>
            </div>
        );
    }

    /**
     * 素材カード D&D の送信側（task 2026-08-10-material-dnd-timeline 指示1）。DataTransfer
     * setData を正としつつ、HTML5 DnD は dragover 中に getData できないため window
     * CustomEvent もミラー送信する（受け側のゴースト計算・実尺プローブ用、司令塔裁定4）。
     */
    protected handleMaterialDragStart(event: React.DragEvent<HTMLDivElement>, entry: MaterialCardEntry): void {
        const payload: { relativePath: string; kind: MaterialKind; durationSeconds?: number; name: string; thumb?: string } = {
            relativePath: entry.mediaRelativePath ?? entry.relativePath,
            kind: entry.kind,
            name: entry.name,
            ...(entry.thumbnailUri ? { thumb: entry.thumbnailUri.toString() } : {}),
            ...(typeof entry.durationSeconds === 'number' ? { durationSeconds: entry.durationSeconds } : {})
        };
        event.dataTransfer.setData(MATERIAL_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
        window.dispatchEvent(new CustomEvent(MATERIAL_DRAG_START_EVENT, { detail: payload }));
    }

    protected handleMaterialDragEnd(): void {
        window.dispatchEvent(new CustomEvent(MATERIAL_DRAG_END_EVENT));
    }

    protected handleUnorganizedMaterialMouseDown(event: React.MouseEvent<HTMLDivElement>): void {
        if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) {
            return;
        }
        const startX = event.clientX;
        const startY = event.clientY;
        const cleanup = (): void => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        const onMouseMove = (moveEvent: MouseEvent): void => {
            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) {
                return;
            }
            cleanup();
            void this.messages.info('未整理の素材は「assets へ移動」のあとで置けます');
        };
        const onMouseUp = (): void => cleanup();
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp, { once: true });
    }

    protected async transcribeMaterial(entry: MaterialCardEntry): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root || entry.assetGroup || (entry.kind !== 'video' && entry.kind !== 'audio')) return;
        if (this.transcriptStateByPath[entry.relativePath] === 'running') return;
        try {
            const result = await this.commandService.executeCommand<string>('akari.transcribe.openDialog', {
                projectRoot: root.toString(), relativePath: entry.relativePath
            });
            if (result === 'running') void this.messages.info(`${entry.name}: 文字起こしを実行中です`);
            else if (result === 'cancelled') void this.messages.info(`${entry.name}: 文字起こしを中止しました`);
            await this.loadMaterials();
            return;
        } catch (error) {
            if (!(error instanceof Error && (error as Error & { code?: string }).code === 'NO_ACTIVE_HANDLER')) {
                void this.messages.error(error instanceof Error ? error.message : String(error));
                return;
            }
        }
        this.transcriptStateByPath[entry.relativePath] = 'running';
        this.update();
        void this.messages.info(`${entry.name}: 文字起こしを実行中です`);
        try {
            await this.projectService.transcribeMaterial({ projectRoot: root.toString(), relativePath: entry.relativePath });
            void this.messages.info(`${entry.name}: 文字起こしが完了しました`);
        } catch (error) {
            void this.messages.error(error instanceof Error ? error.message : String(error));
        } finally {
            await this.loadMaterials();
        }
    }

    @inject(AkariPreviewService)
    protected readonly materialPreviewService!: AkariPreviewService;

    protected selectedMaterialPath?: string;

    protected renderMaterialCard(entry: MaterialCardEntry): React.ReactNode {
        const pickCandidate: GenerationPickCandidate = { path: entry.mediaRelativePath ?? entry.relativePath, kind: entry.kind };
        const displayKind = entry.assetGroup ? 'other' : entry.kind;
        const layout = materialCardLayout({ kind: displayKind, name: entry.name, assetGroupCategory: entry.assetGroup?.category });
        const transcriptState = this.transcriptStateByPath[entry.relativePath] ?? 'none';
        const transcriptStatus = { none: '未', running: '実行中', done: '済' }[transcriptState];
        const transcriptLabel = `文字起こし ${transcriptStatus}`;
        // D&D 対象は video/audio/image かつ非未整理のみ（司令塔裁定1）。other・未整理カードは
        // draggable にしない（未整理は「assets へ移動」が先 — 既存の moveToAssets 導線を優先する）。
        const draggable = !entry.missing && !this.generationPick.request && !entry.unorganized
            && (entry.kind === 'video' || entry.kind === 'audio' || entry.kind === 'image');
        return (
            <div
                key={entry.uri.toString()}
                data-akari-material-path={entry.relativePath}
                data-akari-material-unorganized={entry.unorganized ? 'true' : 'false'}
                data-akari-material-reference={entry.reference ? 'true' : undefined}
                data-akari-material-missing={entry.missing ? 'true' : undefined}
                data-akari-material-asset-group={entry.assetGroup ? 'true' : 'false'}
                // docs/contract-2026-08-11-review-session-ui-events.md #2: asset:<path> opt-in target.
                data-akari-ui={`asset:${entry.relativePath}`}
                data-akari-ui-label={entry.name}
                draggable={draggable}
                onDragStart={draggable ? event => this.handleMaterialDragStart(event, entry) : undefined}
                onDragEnd={draggable ? () => this.handleMaterialDragEnd() : undefined}
                onMouseDown={!this.generationPick.request && entry.unorganized ? event => this.handleUnorganizedMaterialMouseDown(event) : undefined}
                onClickCapture={event => {
                    if (entry.missing || this.generationPick.request
                        || (typeof Element !== 'undefined' && event.target instanceof Element && event.target.closest('button'))) return;
                    this.selectedMaterialPath = entry.relativePath;
                    this.update();
                    const root = this.workflow.workspaceRoot;
                    if (root) window.dispatchEvent(new CustomEvent(AKARI_MATERIAL_SELECTED_EVENT, {
                        detail: { projectRoot: root.toString(), relativePath: entry.mediaRelativePath ?? entry.relativePath,
                            kind: entry.assetGroup && !entry.mediaRelativePath ? 'other' : entry.kind, name: entry.name }
                    }));
                }}
                onClick={() => { if (!entry.missing) void this.openFile(entry.uri); }}
                onContextMenu={event => this.openMaterialContextMenu(event, entry)}
                title={entry.name}
                {...this.generationPickCardProps(pickCandidate)}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    gridColumn: layout.gridColumn,
                    cursor: 'pointer',
                    borderRadius: `${AKARI_RADIUS.panel}px`,
                    overflow: 'hidden',
                    background: AKARI_SURFACE.raised,
                    border: this.selectedMaterialPath === entry.relativePath ? AKARI_BORDER.accent : AKARI_BORDER.ghost
                }}
            >
                {entry.missing && entry.reference && (() => {
                    const known = this.assetCatalogItems.find(item => item.key === `${entry.reference.category}/${entry.reference.id}`);
                    const state = referencePresentation(entry.reference, known?.sourceKind === 'lab');
                    return state.lab
                        ? <button onClick={event => { event.stopPropagation(); void this.retryMaterialReference(entry); }}>もう一度取得</button>
                        : <span>入れ直してください</span>;
                })()}
                <div
                    style={{
                        position: 'relative',
                        aspectRatio: layout.aspectRatio,
                        background: AKARI_SURFACE.card,
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
                            draggable={false}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: layout.objectFit }}
                        />
                        : /\.html?$/i.test(entry.uri.path.base) || ['overlay', 'still'].includes(entry.assetGroup?.category ?? '')
                            ? <MaterialCardHoverPreview assetUri={entry.uri.toString()} service={this.materialPreviewService}
                                files={this.files} icon={this.placeholderIcon(displayKind)} />
                            : <span className={this.placeholderIcon(displayKind)} aria-hidden='true' draggable={false}
                                style={{ fontSize: '1.8em', opacity: 0.5 }} />}
                    {!entry.assetGroup && (entry.kind === 'video' || entry.kind === 'audio') && (
                        <span data-akari-transcript-state={transcriptState}
                            title={transcriptLabel} aria-label={transcriptLabel}
                            style={{ position: 'absolute', bottom: '28px', right: '4px', padding: '0 6px',
                                display: 'inline-flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap',
                                maxWidth: 'calc(100% - 30px)', boxSizing: 'border-box',
                                borderRadius: `${AKARI_RADIUS.chip}px`, fontSize: '0.68em', lineHeight: '16px',
                                background: 'var(--theia-badge-background)', color: 'var(--theia-badge-foreground)' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>文字起こし</span>{' '}
                            <span style={{ flexShrink: 0 }}>{transcriptStatus}</span>
                        </span>
                    )}
                    <div style={{
                        position: 'absolute', top: '4px', left: '4px', maxWidth: 'calc(100% - 21px)',
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px'
                    }}>
                        <span
                            title={`種別: ${entry.assetGroup ? entry.assetGroup.category || '不明' : layout.kindLabel}`}
                            aria-label={`種別: ${entry.assetGroup ? entry.assetGroup.category || '不明' : layout.kindLabel}`}
                            data-akari-asset-group-category={entry.assetGroup?.category}
                            style={{
                                maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 6px',
                                borderRadius: `${AKARI_RADIUS.chip}px`, fontSize: '0.68em', lineHeight: '16px',
                                background: 'var(--theia-badge-background)', color: 'var(--theia-badge-foreground)'
                            }}
                        >
                            {layout.kindLabel}
                        </span>
                        {entry.reference && <span data-akari-reference-badge>参照</span>}
                        {entry.missing && <span data-akari-reference-missing>見つかりません</span>}
                        {entry.unorganized && (
                            <span
                                title='未整理'
                                aria-label='未整理'
                                style={{
                                    padding: '0 6px', borderRadius: `${AKARI_RADIUS.chip}px`,
                                    fontSize: '0.68em', lineHeight: '16px', whiteSpace: 'nowrap',
                                    background: 'var(--theia-editorWarning-foreground)',
                                    color: 'var(--theia-editor-background)'
                                }}
                            >
                                未整理
                            </span>
                        )}
                    </div>
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
                            // 未分析の灰点は「まだ何もしていない」印。カードより目立つと
                            // 面の階層が壊れるので、分析済み（アクセント）だけを前に出す。
                            opacity: entry.analyzed ? 1 : 0.45,
                            background: entry.analyzed ? 'var(--theia-badge-background)' : AKARI_FAINT
                        }}
                    />
                    <button
                        type='button'
                        title='エージェントに頼む'
                        aria-label={`${entry.name} についてエージェントに頼む`}
                        onClick={event => { event.stopPropagation(); void this.askAgent(entry); }}
                        style={{
                            position: 'absolute',
                            bottom: '28px',
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
                    <div style={{
                        position: 'absolute', left: 0, right: 0, bottom: 0,
                        display: 'flex', alignItems: 'baseline', gap: '4px', padding: '8px 4px 3px',
                        background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))',
                        color: '#fff', lineHeight: '16px', pointerEvents: 'none'
                    }}>
                        <span style={{
                            flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', fontSize: '0.78em'
                        }}>
                            {entry.name}
                        </span>
                        <span style={{ flex: '0 0 auto', fontSize: '0.68em', whiteSpace: 'nowrap' }}>
                            {entry.analyzed ? formatDurationBadge(entry.durationSeconds ?? 0) : '--:--'}
                        </span>
                    </div>
                </div>
                {this.renderGenerationPickBadge(pickCandidate)}
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

    /** widget 内遷移したライブラリ面。セグメントと検索は親側で固定表示する。 */
    protected renderCatalogTab(): React.ReactNode {
        if (this.materialSwap) return this.renderMaterialSwap();
        return (
            <div
                style={{ minHeight: '100%' }}
                onClick={() => this.stopCatalogAudio()}
            >
                {this.libraryTextLookOpen ? this.renderTextLookPage()
                    : this.libraryCategory ? this.renderLibraryCategoryPage(this.libraryCategory) : this.renderLibraryHome()}
            </div>
        );
    }

    protected openRecentLibraryEntry(entry: RecentLibraryEntry): void {
        this.catalogQuery = '';
        this.selectLibraryCategory(entry.category);
        this.libraryFolderFilter = entry.folder;
        this.update();
        if (!entry.folder) { void this.focusAssetCard('catalog', entry.itemKey, true); }
    }

    protected renderRecentLibraryStrip(): React.ReactNode {
        const entries = recentLibraryEntries(this.applyLibraryFilter(this.assetCatalogItems), 'all');
        if (!entries.length) { return undefined; }
        return (
            <section data-recent-strip style={{ paddingTop: '8px' }}>
                <div style={{ fontSize: '0.75em', fontWeight: 700, paddingBottom: '6px' }}>最近入れた・よく使う</div>
                <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                    {entries.map(entry => (
                        <button
                            key={entry.key} type='button' data-recent-key={entry.key}
                            onClick={() => this.openRecentLibraryEntry(entry)}
                            title={entry.label}
                            style={{
                                flex: '0 0 100px', minWidth: 0, padding: '7px', textAlign: 'left', cursor: 'pointer',
                                border: AKARI_BORDER.ghost, borderRadius: `${AKARI_RADIUS.panel}px`,
                                background: AKARI_SURFACE.raised, color: AKARI_INK
                            }}
                        >
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78em' }}>{entry.label}</div>
                            <div style={{ fontSize: '0.68em', opacity: 0.65, paddingTop: '3px' }}>
                                {this.assetCatalogItems.find(item => item.key === entry.itemKey)?.sourceKind === 'site' ? '素材サイト · ' : ''}
                                {this.libraryCategoryDefinition(entry.category).label}{entry.folder ? ` · ${entry.count} 件` : ''}
                            </div>
                            {this.assetCatalogItems.some(item => item.key === entry.itemKey && this.isSiteSubscription(item)) &&
                                <span data-akari-site-subscription style={{ fontSize: '0.68em' }}>サブスク</span>}
                        </button>
                    ))}
                </div>
            </section>
        );
    }

    protected renderLibraryHome(): React.ReactNode {
        const query = this.catalogQuery.trim();
        if (query) {
            const presets = (kind: PresetShowcaseKind): PresetShowcaseItem[] =>
                this.presetShowcase[kind].filter(item => this.presetPassesLibraryFilter(`${kind}/${item.id}`));
            const hits = searchLibraryHome(query, {
                catalogItems: this.applyLibraryFilter(this.assetCatalogItems),
                presetShowcase: { textstyle: presets('textstyle'), textanim: presets('textanim'), lut: presets('lut') },
                transitions: TRANSITION_VOCABULARY.filter(transition => this.presetPassesLibraryFilter(`transition/${transition.id}`)),
                shapes: this.shapeShelf?.presets
            });
            return (
                <div data-akari-library-home data-akari-library-search-results={hits.length} style={{ padding: '8px 10px 12px' }}>
                    <div style={{ fontSize: '0.78em', fontWeight: 700, opacity: 0.7, padding: '4px 0 8px' }}>ライブラリ全体の検索結果</div>
                    {hits.length
                        ? <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {hits.map((hit, index) => {
                                const category = this.libraryCategoryDefinition(hit.categoryKey);
                                return (
                                    <button
                                        key={`${hit.kind}/${hit.categoryKey}/${hit.label}/${index}`}
                                        type='button'
                                        data-akari-library-search-kind={hit.kind}
                                        data-akari-library-category={hit.categoryKey}
                                        onClick={event => { event.stopPropagation(); this.selectLibraryCategory(hit.categoryKey); }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '7px 9px',
                                            textAlign: 'left', cursor: 'pointer', borderRadius: `${AKARI_RADIUS.panel}px`,
                                            background: AKARI_SURFACE.raised, color: AKARI_INK,
                                            border: AKARI_BORDER.ghost
                                        }}
                                    >
                                        <span style={{ width: '24px', textAlign: 'center', color: 'var(--theia-button-background)', fontWeight: 700 }}>{category.icon}</span>
                                        <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.label}</span>
                                        <span style={{ flex: '0 0 auto', opacity: 0.6, fontSize: '0.72em' }}>{category.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                        : <p style={{ opacity: 0.7, padding: '12px 6px' }}>条件に一致するライブラリ項目がありません。</p>}
                </div>
            );
        }
        return (
            <div data-akari-library-home style={{ padding: '2px 8px 12px' }}>
                <section style={{ marginTop: '10px' }}>
                    <div style={{
                        position: 'sticky', top: 0, zIndex: 4, margin: '0 -8px 6px', padding: '6px 8px 4px',
                        background: AKARI_SURFACE.card, fontSize: '0.75em', fontWeight: 700,
                        letterSpacing: '0.08em', opacity: 0.78
                    }}>よく使う</div>
                    <div data-akari-library-primary-tiles style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                        {LIBRARY_PRIMARY_TILES.map(tile => this.renderLibraryPrimaryTile(tile))}
                    </div>
                </section>
                {this.renderRecentLibraryStrip()}
                <button type='button' data-akari-library-details-toggle aria-expanded={this.libraryDetailsOpen}
                    onClick={event => { event.stopPropagation(); this.toggleLibraryDetails(); }}
                    style={{
                        width: '100%', marginTop: '10px', padding: '7px 8px', textAlign: 'left', cursor: 'pointer',
                        borderRadius: `${AKARI_RADIUS.panel}px`, background: AKARI_SURFACE.raised,
                        color: AKARI_INK, border: AKARI_BORDER.ghost, fontSize: '0.75em'
                    }}>
                    {this.libraryDetailsOpen ? '▾ 詳細をたたむ' : '▸ 詳細（文字の見た目・仕上げ・パック・マイ）'}
                </button>
                {this.libraryDetailsOpen && <div data-akari-library-details>
                {LIBRARY_DETAIL_GROUPS.map(group => (
                    <section key={group.label} style={{ marginTop: '10px' }}>
                        <div style={{
                            position: 'sticky', top: 0, zIndex: 4, margin: '0 -8px 6px', padding: '6px 8px 4px',
                            background: AKARI_SURFACE.card, fontSize: '0.75em', fontWeight: 700,
                            letterSpacing: '0.08em', opacity: 0.78
                        }}>
                            {group.label}
                        </div>
                        {group.label === 'マイ'
                            ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                                {group.categories.map(category => this.renderLibraryMyCategory(category))}
                            </div>
                            : group.label === '文字の見た目'
                                ? <LibraryTextLookRow counts={[this.presetShowcase.textstyle.length + this.myStyles.length,
                                    this.presetShowcase.textanim.length, this.assetCatalogItems.filter(item => item.category === 'font').length]}
                                    onOpen={() => { this.libraryCategory = undefined; this.catalogCategory = 'all';
                                        this.libraryTextLookOpen = true; this.update(); }} />
                                : <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {group.categories.map(category => this.renderLibraryCategoryRow(category))}
                                </div>}
                    </section>
                ))}
                </div>}
            </div>
        );
    }

    protected async placeLibraryText(): Promise<void> {
        try {
            await this.commandService.executeCommand('akari.caption.placeText');
        } catch (error) {
            this.messages.error(`文字を置けません: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** 図形の棚（描画は library-shape-shelf-view.tsx）。押す = プレイヘッドの時刻・出力の中央へ置く。 */
    protected renderShapeShelfPage(): React.ReactNode {
        return <LibraryShapeShelf presets={this.shapeShelf.presets} recent={this.shapeShelf.recent}
            loaded={this.shapeShelf.isLoaded} query={this.catalogQuery} view={this.shapeShelfView}
            onBack={() => this.showLibraryHome()}
            onShowAll={key => { this.shapeShelfView = key; this.update(); }}
            onPlace={preset => void this.placeLibraryShape(preset)}
            onDragStart={(event, preset) => this.handleShapeDragStart(event, preset)}
            onDragEnd={() => this.handleLibraryTransitionDragEnd()} />;
    }

    protected async placeLibraryShape(preset: ShapeShelfPreset): Promise<void> {
        try {
            // 書き込み・undo・選択・最近使用はタイムライン側（akari.timeline.addShapeAt）が持つ。
            await this.commandService.executeCommand(TIMELINE_ADD_SHAPE_AT_COMMAND_ID, { preset: preset.id });
        } catch (error) {
            this.messages.error(`図形を置けません: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected handleShapeDragStart(event: React.DragEvent<HTMLElement>, preset: ShapeShelfPreset): void {
        const payload = shapeShelfDragPayload(preset);
        event.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
        window.dispatchEvent(new CustomEvent(LIBRARY_DRAG_START_EVENT, { detail: payload }));
    }

    protected renderLibraryPrimaryTile(tile: LibraryPrimaryTile): React.ReactNode {
        const soon = tile.status === 'soon';
        return (
            <button key={tile.key} type='button' disabled={soon} aria-disabled={soon ? 'true' : undefined}
                data-akari-library-primary-tile={tile.key} data-akari-library-tile-kind={tile.kind}
                data-akari-library-category={tile.key === 'text' ? undefined : tile.key}
                data-akari-library-soon={soon ? 'true' : undefined}
                draggable={tile.key === 'text' ? true : undefined}
                onDragStart={tile.key === 'text' ? event => {
                    const payload = { kind: 'text' };
                    event.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(payload));
                    event.dataTransfer.effectAllowed = 'copy';
                    window.dispatchEvent(new CustomEvent(LIBRARY_DRAG_START_EVENT, { detail: payload }));
                } : undefined}
                onDragEnd={tile.key === 'text' ? () => this.handleLibraryTransitionDragEnd() : undefined}
                title={`${tile.label} — ${tile.hint}`}
                onClick={soon ? undefined : event => {
                    event.stopPropagation();
                    if (tile.key === 'text') void this.placeLibraryText();
                    else this.selectLibraryCategory(tile.key);
                }}
                style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', minWidth: 0,
                    padding: '7px 4px', borderRadius: `${AKARI_RADIUS.panel}px`, opacity: soon ? 0.48 : 1,
                    background: AKARI_SURFACE.raised, color: AKARI_INK, cursor: soon ? 'default' : 'pointer',
                    border: AKARI_BORDER.ghost
                }}>
                <span draggable={tile.key === 'text' ? false : undefined} style={{ fontSize: '1.15em' }}>{tile.icon}</span>
                <span draggable={tile.key === 'text' ? false : undefined} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.7em' }}>{tile.label}</span>
                <span draggable={tile.key === 'text' ? false : undefined} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.62em' }}>{tile.hint}</span>
            </button>
        );
    }

    protected renderLibraryMyCategory(category: LibraryCategoryDefinition): React.ReactNode {
        return (
            <button
                key={category.key}
                type='button'
                disabled
                aria-disabled='true'
                data-akari-library-category={category.key}
                data-akari-library-soon
                title={`${category.label} — ${category.hint}`}
                style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', minWidth: 0,
                    padding: '7px 4px', borderRadius: `${AKARI_RADIUS.panel}px`, opacity: 0.48,
                    background: AKARI_SURFACE.raised, color: AKARI_INK,
                    border: AKARI_BORDER.ghost
                }}
            >
                <span style={{ fontSize: '1.15em' }}>{category.icon}</span>
                <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.7em' }}>{category.label}</span>
                <span style={{ fontSize: '0.62em' }}>近日</span>
            </button>
        );
    }

    protected renderLibraryCategoryRow(category: LibraryCategoryDefinition): React.ReactNode {
        const soon = category.status === 'soon';
        const count = this.libraryCategoryCount(category);
        return (
            <button
                key={category.key}
                type='button'
                disabled={soon}
                aria-disabled={soon ? 'true' : undefined}
                data-akari-library-category={category.key}
                data-category={category.key}
                data-count={count}
                data-akari-library-soon={soon ? 'true' : undefined}
                onClick={soon ? undefined : event => { event.stopPropagation(); this.selectLibraryCategory(category.key as LibraryCategoryKey); }}
                style={{
                    display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', alignItems: 'center', gap: '7px',
                    width: '100%', padding: '6px 10px 6px 6px', textAlign: 'left', borderRadius: `${AKARI_RADIUS.panel}px`,
                    cursor: soon ? 'default' : 'pointer', opacity: soon || count === 0 ? 0.46 : 1,
                    background: AKARI_SURFACE.raised, color: AKARI_INK,
                    border: AKARI_BORDER.ghost
                }}
            >
                <span style={{ gridColumn: '1', gridRow: '1 / span 2', textAlign: 'center', color: soon ? 'inherit' : 'var(--theia-button-background)', fontSize: '1.35em', fontWeight: 700 }}>{category.icon}</span>
                <span style={{ gridColumn: '2', gridRow: '1', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.95em', fontWeight: 700 }}>{category.label}</span>
                <span style={{ gridColumn: '2', gridRow: '2', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.68em', opacity: 0.62 }}>{category.hint}</span>
                <span style={{ gridColumn: '3', gridRow: '1 / span 2', justifySelf: 'end', fontVariantNumeric: 'tabular-nums', fontSize: '0.72em', opacity: 0.65 }}>{soon ? '近日' : count}</span>
            </button>
        );
    }

    protected renderTextLookPage(): React.ReactNode {
        const styleItems = this.filteredPresetShowcaseItems('textstyle');
        const motionItems = this.filteredPresetShowcaseItems('textanim');
        const fontItems = this.filteredCatalogItems().filter(item => item.category === 'font');
        return <LibraryTextLookPage onBack={() => this.showLibraryHome()}
            styles={styleItems.map(item => this.renderPresetShowcaseCard(item))}
            myStyles={this.renderMyStyles()}
            motions={motionItems.map(item => this.renderPresetShowcaseCard(item))}
            fonts={fontItems.map(item => this.renderCatalogItem(item))} />;
    }

    protected renderLibraryCategoryPage(key: LibraryCategoryKey): React.ReactNode {
        if (key === 'shapes') return this.renderShapeShelfPage();
        const category = this.libraryCategoryDefinition(key);
        const count = this.libraryCategoryCount(category) ?? 0;
        return (
            <div data-akari-library-category={key} style={{ minHeight: '100%' }}>
                <div style={{
                    position: 'sticky', top: 0, zIndex: 6, padding: '8px 10px 7px',
                    background: AKARI_SURFACE.card, borderBottom: AKARI_BORDER.hairline,
                    boxShadow: '0 8px 14px -12px var(--theia-widget-shadow)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <button
                            type='button'
                            data-akari-library-back
                            onClick={event => { event.stopPropagation(); this.showLibraryHome(); }}
                            style={{ padding: 0, border: 'none', background: 'transparent', color: 'var(--theia-textLink-foreground)', cursor: 'pointer', fontSize: '0.8em' }}
                        >
                            ← ライブラリ
                        </button>
                        <strong style={{ flex: '1 1 auto', minWidth: 0, fontSize: '0.86em' }}>{category.label}</strong>
                        <span data-akari-library-category-count={count} style={{ opacity: 0.6, fontSize: '0.72em' }}>{count}</span>
                        {key !== 'transition' && (
                            <button
                                type='button'
                                data-akari-catalog-view-toggle
                                data-akari-catalog-view-mode={this.catalogViewMode}
                                title={this.catalogViewMode === 'grid' ? 'リスト表示に切り替え' : 'カード表示に切り替え'}
                                aria-label={this.catalogViewMode === 'grid' ? 'リスト表示に切り替え' : 'カード表示に切り替え'}
                                onClick={event => {
                                    event.stopPropagation();
                                    this.setCatalogViewMode(this.catalogViewMode === 'grid' ? 'list' : 'grid');
                                }}
                                style={{ padding: '2px 5px', border: AKARI_BORDER.hairline, borderRadius: `${AKARI_RADIUS.chip}px`, background: 'transparent', color: 'inherit', cursor: 'pointer' }}
                            >
                                <span className={this.catalogViewMode === 'grid' ? 'codicon codicon-list-flat' : 'codicon codicon-layout'} aria-hidden='true' />
                            </button>
                        )}
                    </div>
                    <div style={{ paddingTop: '5px', fontSize: '0.7em', lineHeight: 1.45, opacity: 0.64 }}>{category.hint}</div>
                </div>
                {this.libraryFolderFilter !== undefined && (
                    <div data-library-folder-filter={this.libraryFolderFilter} style={{ padding: '7px 10px', fontSize: '0.78em' }}>
                        フォルダ: {this.libraryFolderFilter}
                        <button type='button' aria-label='フォルダの絞り込みを解除' onClick={() => { this.libraryFolderFilter = undefined; this.update(); }}>×</button>
                    </div>
                )}
                {this.renderLibraryCategoryBody(key)}
            </div>
        );
    }

    protected renderLibraryCategoryBody(key: LibraryCategoryKey): React.ReactNode {
        if (key === 'transition') {
            return this.renderTransitionLibrary();
        }
        if (key === 'pack') {
            return this.renderLibraryPackBody();
        }
        if (key === 'textstyle') {
            return this.renderPresetLibraryBody(['textstyle']);
        }
        if (key === 'textanim' || key === 'lut') {
            return this.renderPresetLibraryBody([key]);
        }
        return this.renderCatalogBody();
    }

    protected renderCatalogBody(): React.ReactNode {
        const filtered = this.filteredCatalogItems();
        let content: React.ReactNode;
        if (this.catalogLoading) {
            content = <p style={{ opacity: 0.7, padding: '16px' }}>読み込み中…</p>;
        } else if (!this.assetCatalogItems.length) {
            content = this.renderCatalogEmptyState();
        } else if (!filtered.length) {
            const emptyKind = deriveCatalogFilteredEmptyKind(this.assetCatalogItems, this.catalogCategory);
            content = (
                <p data-akari-catalog-filter-empty={emptyKind} style={{ opacity: 0.7, padding: '16px' }}>
                    {emptyKind === 'category-empty'
                        ? 'この種類の素材はまだカタログにありません'
                        : '条件に一致するカタログ項目がありません。'}
                </p>
            );
        } else {
            const itemContainerStyle: React.CSSProperties = this.catalogViewMode === 'grid'
                ? { display: 'grid', gridTemplateColumns: CATALOG_GRID_COLUMNS, gap: CATALOG_GRID_GAP, padding: '0 10px' }
                : { display: 'flex', flexDirection: 'column', gap: '6px', padding: '0 10px' };
            content = (
                <div style={{ ...itemContainerStyle, paddingTop: '10px', paddingBottom: '10px' }}>
                    {filtered.map(item => this.renderCatalogItem(item))}
                </div>
            );
        }
        return (
            <div
                style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
                data-akari-catalog-item-count={this.assetCatalogItems.length}
                data-akari-catalog-view-mode={this.catalogViewMode}
            >
                {this.renderCatalogResolverRetry()}
                {content}
                <div style={{ marginTop: 'auto', padding: '8px 10px 10px' }}>
                    {this.renderCatalogDeveloperLinkRow()}
                </div>
            </div>
        );
    }

    protected renderPresetLibraryBody(kinds: readonly PresetShowcaseKind[]): React.ReactNode {
        if (this.catalogLoading) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>読み込み中…</p>;
        }
        const labels: Readonly<Record<PresetShowcaseKind, string>> = {
            lut: 'LUT',
            textanim: 'テキストアニメ',
            textstyle: 'テキストスタイル'
        };
        return (
            <div data-akari-library-preset-sections={kinds.length}>
                {kinds.includes('textstyle') && this.renderMyStyles()}
                {kinds.map((kind, index) => (
                    <section key={kind} data-akari-library-preset-section={kind}>
                        {(kinds.length > 1 || index > 0) && (
                            <div style={{
                                position: 'sticky', top: '62px', zIndex: 4, padding: '7px 10px 5px',
                                background: AKARI_SURFACE.card, borderBottom: AKARI_BORDER.hairline,
                                fontSize: '0.76em', fontWeight: 700, letterSpacing: '0.04em'
                            }}>
                                {labels[kind]}
                            </div>
                        )}
                        {this.renderPresetShowcase(kind)}
                    </section>
                ))}
                <div style={{ padding: '0 10px 10px' }}>{this.renderCatalogDeveloperLinkRow()}</div>
            </div>
        );
    }

    protected renderLibraryPackBody(): React.ReactNode {
        const filtered = rankRecentLibraryItems(this.applyLibraryFilter(filterLibraryCatalogItems(this.assetCatalogItems, this.librarySourceFilter, this.catalogQuery, 'all')));
        const { groups } = groupCatalogItemsByPack(filtered, this.catalogPacks);
        const totalGroups = groupCatalogItemsByPack(this.assetCatalogItems, this.catalogPacks).groups.length;
        return (
            <div data-akari-catalog-pack-count={totalGroups} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
                {this.renderCatalogResolverRetry()}
                {this.catalogLoading
                    ? <p style={{ opacity: 0.7, padding: '16px' }}>読み込み中…</p>
                    : groups.length
                        ? <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 0' }}>
                            {groups.map(group => this.renderCatalogPackSection(group))}
                        </div>
                        : <p style={{ opacity: 0.7, padding: '16px' }}>条件に一致するパックがありません。</p>}
                <div style={{ marginTop: 'auto', padding: '8px 10px 10px' }}>{this.renderCatalogDeveloperLinkRow()}</div>
            </div>
        );
    }

    protected handleLibraryTransitionDragStart(
        event: React.DragEvent<HTMLElement>,
        transition: { readonly id: TransitionType; readonly labelJa: string }
    ): void {
        const payload: { kind: 'transition'; id: TransitionType; name: string } = {
            kind: 'transition',
            id: transition.id,
            name: transition.labelJa
        };
        event.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
        window.dispatchEvent(new CustomEvent(LIBRARY_DRAG_START_EVENT, { detail: payload }));
    }

    protected handleLibraryTransitionDragEnd(): void {
        window.dispatchEvent(new CustomEvent(LIBRARY_DRAG_END_EVENT));
    }

    protected renderTransitionLibrary(): React.ReactNode {
        const normalizedQuery = this.catalogQuery.trim().toLowerCase();
        const filtered = TRANSITION_VOCABULARY.filter(transition => this.presetPassesLibraryFilter(`transition/${transition.id}`) && (!normalizedQuery
            || [transition.labelJa, transition.id, transition.category].join(' ').toLowerCase().includes(normalizedQuery)));
        const categories = Array.from(new Set(TRANSITION_VOCABULARY.map(transition => transition.category)));
        return (
            <div
                data-akari-transition-count={TRANSITION_VOCABULARY.length}
                data-akari-transition-visible-count={filtered.length}
                data-akari-transition-category-count={categories.length}
                style={{ padding: '2px 10px 12px' }}
            >
                {categories.map(category => {
                    const transitions = filtered.filter(transition => transition.category === category);
                    if (!transitions.length) {
                        return undefined;
                    }
                    return (
                        <section key={category} style={{ marginTop: '10px' }}>
                            <div style={{ padding: '4px 0 6px', fontSize: '0.74em', fontWeight: 700, letterSpacing: '0.05em', opacity: 0.7 }}>
                                {category}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: CATALOG_GRID_COLUMNS, gap: CATALOG_GRID_GAP }}>
                                {transitions.map(transition => (
                                    <div
                                        key={transition.id}
                                        role='button'
                                        tabIndex={0}
                                        draggable
                                        data-akari-library-transition={transition.id}
                                        data-akari-library-category='transition'
                                        data-akari-library-card='grid'
                                        data-akari-favorite={this.libraryFavorites.has(`transition/${transition.id}`) ? 'true' : undefined}
                                        title={`${transition.labelJa} — カット境界へドラッグ`}
                                        onDragStart={event => this.handleLibraryTransitionDragStart(event, transition)}
                                        onDragEnd={() => this.handleLibraryTransitionDragEnd()}
                                        onContextMenu={event => this.openLibraryMenuAt(event, { kind: 'transition', key: `transition/${transition.id}` })}
                                        style={{
                                            position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', minWidth: 0,
                                            padding: '9px 5px 7px', cursor: 'grab', borderRadius: `${AKARI_RADIUS.panel}px`,
                                            background: AKARI_SURFACE.raised, border: AKARI_BORDER.ghost
                                        }}
                                    >
                                        <LibraryDotsCorner label={transition.labelJa}
                                            onOpen={anchor => this.openLibraryInfo({ kind: 'transition', key: `transition/${transition.id}` }, anchor)} />
                                        <span aria-hidden='true' style={{ display: 'block', width: '100%', aspectRatio: '16 / 9',
                                            overflow: 'hidden', borderRadius: `${AKARI_RADIUS.chip}px` }}>
                                            <TransitionStrip url={this.transitionPreviewUrls[transition.id]?.preview}
                                                stripUrl={this.transitionPreviewUrls[transition.id]?.strip} />
                                        </span>
                                        <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.69em' }}>
                                            {transition.labelJa}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    );
                })}
                {!filtered.length && <p style={{ opacity: 0.7, padding: '16px 6px' }}>条件に一致するトランジションがありません。</p>}
            </div>
        );
    }

    protected renderCatalogResolverRetry(): React.ReactNode {
        const notice = deriveCatalogResolverNotice(
            this.catalogResolver?.status ?? 'ok',
            this.catalogEntitlementsStatus
        );
        if (!notice) {
            return undefined;
        }
        return (
            <div
                data-akari-catalog-retry-row
                data-akari-catalog-entitlements-status={this.catalogEntitlementsStatus}
                data-akari-catalog-entitlements-unauthorized={notice.kind === 'unauthorized' ? 'true' : undefined}
                style={{ padding: '6px 10px 0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78em', opacity: 0.8 }}
            >
                <span>{notice.message}</span>
                {notice.retry && (
                    <button
                        type='button'
                        className='theia-button secondary'
                        data-akari-catalog-retry
                        data-akari-catalog-retry-inline
                        disabled={this.catalogLoading}
                        style={{ padding: '1px 8px', fontSize: 'inherit' }}
                        onClick={() => void this.loadAssetCatalogView()}
                    >
                        再試行
                    </button>
                )}
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
                style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 10px 10px', borderBottom: AKARI_BORDER.hairline }}
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
                <div style={this.catalogViewMode === 'grid'
                    ? { display: 'grid', gridTemplateColumns: CATALOG_GRID_COLUMNS, gap: CATALOG_GRID_GAP }
                    : { display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {rankRecentLibraryItems(group.items).map(item => this.renderCatalogItem(item))}
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
            </div>
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

    /** 一覧のスクロール領域の外へ置く共有試聴ドック。 */
    protected renderCatalogAudioDock(): React.ReactNode {
        if (!this.playingCatalogAudioKey) {
            return undefined;
        }
        return (
            <div
                data-akari-catalog-audio-dock
                data-akari-catalog-audio-bar
                onClick={event => event.stopPropagation()}
                style={{
                    position: 'absolute',
                    left: '8px',
                    right: '8px',
                    bottom: '8px',
                    zIndex: 8,
                    padding: '6px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    borderRadius: `${AKARI_RADIUS.panel}px`,
                    border: AKARI_BORDER.hairline,
                    background: AKARI_SURFACE.raised,
                    fontSize: '0.8em'
                }}
            >
                <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                <button
                    type='button'
                    aria-label='試聴ドックを閉じる'
                    title='閉じる'
                    data-akari-catalog-audio-dock-close
                    onClick={event => { event.stopPropagation(); this.stopCatalogAudio(); }}
                    style={{ flex: '0 0 auto', padding: '0 3px', border: 'none', background: 'transparent', color: AKARI_INK, cursor: 'pointer', fontSize: '1.2em' }}
                >×</button>
            </div>
        );
    }

    protected isSiteSubscription(item: AssetCatalogViewItem): boolean {
        return item.tags.includes('license:subscription') || item.machineTags?.includes('license:subscription') === true;
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

    protected renderCatalogItem(item: AssetCatalogViewItem): React.ReactNode {
        if (item.category === 'font' && !this.generationPick.request) {
            return <FontShelfCard key={item.key} item={item} layout={this.catalogViewMode}
                favorite={this.libraryFavorites.has(item.key)} onApply={() => { void this.applyFontItem(item); }}
                onDragStart={event => this.handleCatalogAssetDragStart(event, item)}
                onDragEnd={() => this.handleLibraryTransitionDragEnd()}
                onContextMenu={event => this.openLibraryMenuAt(event, { kind: 'asset', item })}
                onInfo={anchor => this.openLibraryInfo({ kind: 'asset', item }, anchor)} />;
        }
        return this.catalogViewMode === 'list' ? this.renderCatalogListRow(item) : this.renderCatalogCard(item);
    }

    protected selectedLibraryCaption(): { kind: 'caption'; id: string } | undefined {
        const root = this.workflow.workspaceRoot;
        const editUri = root?.resolve('edit.json').normalizePath().toString();
        const selection = editUri ? this.generationTimelineSelections.get(editUri) : undefined;
        return selection?.kind === 'caption' ? { kind: 'caption', id: selection.id } : undefined;
    }

    protected async applyFontItem(item: AssetCatalogViewItem): Promise<void> {
        if (isPremiumLocked(item) || item.state === 'locked') { this.showPremiumPrompt(item.key); return; }
        await this.commandService.executeCommand('akari.timeline.applyLibraryItem', {
            payload: { kind: 'font', id: item.id, fontFamily: item.title.replace(/（.*$/, '').trim() },
            editUri: this.workflow.workspaceRoot?.resolve('edit.json').normalizePath().toString()
        });
    }

    protected async applyPresetToSelectedCaption(item: PresetShowcaseItem): Promise<void> {
        try {
            await this.commandService.executeCommand('akari.timeline.applyLibraryItem', {
                payload: presetApplyPayload(item),
                editUri: this.workflow.workspaceRoot?.resolve('edit.json').normalizePath().toString()
            });
        } catch (error) {
            this.messages.warn(`当てられませんでした: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // --- ライブラリのカード: 右クリック = 操作のメニュー / ⋯ = 情報カード / ★ / 促しのシート ----------

    protected libraryMenuTargetItem(target: LibraryMenuTarget): { preset?: PresetShowcaseItem; style?: MyStyle } {
        if (target.kind === 'textstyle' || target.kind === 'textanim' || target.kind === 'lut') {
            const id = target.key.slice(target.kind.length + 1);
            return { preset: this.presetShowcase[target.kind]?.find(item => item.id === id) };
        }
        if (target.kind === 'mystyle') return { style: this.myStyles.find(style => `mystyle/${style.id}` === target.key) };
        return {};
    }

    /** 右クリック。どの棚のカードにも同じ形のメニュー（library-card-menu.ts）。 */
    protected openLibraryMenuAt(event: React.MouseEvent<HTMLElement>, target: LibraryMenuTarget): void {
        event.preventDefault();
        event.stopPropagation();
        const card = (event.currentTarget.closest('[data-akari-library-card]') as HTMLElement | null) ?? event.currentTarget;
        const entries = libraryCardMenuEntries(target, this.libraryFavorites.has(libraryMenuTargetKey(target)));
        if (!entries.length) return;
        openAkariContextMenu({ x: event.clientX, y: event.clientY, items: entries,
            onSelect: id => void this.runLibraryAction(target, id as LibraryMenuActionId, card) });
    }

    protected libraryInfoModel(target: LibraryMenuTarget): LibraryInfoCardModel | undefined {
        const favorite = this.libraryFavorites.has(libraryMenuTargetKey(target));
        if (target.kind === 'asset') {
            const chip = catalogItemCategoryChipKey(target.item);
            const category = (LIBRARY_GROUPS as readonly LibraryGroupDefinition[]).flatMap(group => group.categories)
                .find(candidate => candidate.chipKey === chip);
            const item = this.assetCatalogItems.find(entry => entry.key === target.item.key) ?? target.item;
            return libraryAssetInfoCard(item, category?.label ?? item.category, favorite);
        }
        if (target.kind === 'transition') {
            const transition = TRANSITION_VOCABULARY.find(entry => `transition/${entry.id}` === target.key);
            return transition && libraryPresetInfoCard({ key: target.key, kind: 'transition', name: transition.labelJa,
                categoryLabel: 'トランジション', tags: [transition.category] }, favorite);
        }
        const { preset, style } = this.libraryMenuTargetItem(target);
        if (preset) {
            return libraryPresetInfoCard({ key: target.key, kind: preset.kind, name: preset.name,
                categoryLabel: this.libraryCategoryDefinition(preset.kind).label, tags: [preset.category, ...preset.tags].filter(Boolean) as string[] }, favorite);
        }
        if (style) {
            return libraryPresetInfoCard({ key: target.key, kind: 'mystyle', name: style.name, categoryLabel: 'マイスタイル',
                tags: [style.when_to_use, ...style.parts.map(part => myStylePartLabel(part.kind))], author: style.author }, favorite);
        }
        return undefined;
    }

    /** ⋯ = 情報カード。押したカードだけを残して周りを暗くし、横に情報カードを出す。 */
    protected openLibraryInfo(target: LibraryMenuTarget, anchor: HTMLElement): void {
        this.stopCatalogAudio();
        this.libraryFilterAnchor = undefined;
        this.libraryInfo = { target, anchor: anchor.getBoundingClientRect(), keywordsExpanded: false };
        this.update();
    }

    protected closeLibraryInfo = (): void => {
        if (!this.libraryInfo) return;
        this.libraryInfo = undefined;
        this.update();
    };

    protected async runLibraryAction(target: LibraryMenuTarget, id: LibraryMenuActionId, anchor?: HTMLElement): Promise<void> {
        const key = libraryMenuTargetKey(target);
        if (id === 'favorite') { await this.toggleLibraryFavorite(key); return; }
        if (id === 'info') { if (anchor) this.openLibraryInfo(target, anchor); return; }
        if (target.kind === 'asset') {
            const item = this.assetCatalogItems.find(entry => entry.key === key) ?? target.item;
            if (id === 'apply' && item.category === 'font') { await this.applyFontItem(item); return; }
            if (id === 'lab') this.openLibraryLab(item);
            else if (id === 'place') {
                if (isPremiumLocked(item)) this.showPremiumPrompt(item.key);
                else await this.addCatalogAssetAtPlayhead(item);
            } else if (id === 'import') await this.useAssetCatalogItem(item);
            else if (id === 'agent-import') await this.importCatalogItem(item);
            else if (id === 'ask') await this.askAgentAboutCatalogItem(item);
            else if (id === 'reveal' && item.libraryDir) await this.revealInFileManagerCommand(URI.fromFilePath(item.libraryDir));
            else if (id === 'remove-library') await this.removeLibraryItem(item);
            return;
        }
        const { preset, style } = this.libraryMenuTargetItem(target);
        if (target.kind === 'lut' && id === 'apply') {
            const lutId = target.key.startsWith('lut/') ? target.key.slice('lut/'.length) : '';
            if (!lutId) { this.messages.info('LUT が見つかりません。'); return; }
            await this.applyPresetToSelectedCaption(preset ?? { kind: 'lut', id: lutId, name: lutId, tags: [] });
            return;
        }
        if (preset && id === 'apply') await this.applyPresetToSelectedCaption(preset);
        else if (!preset && id === 'apply' && (target.kind === 'textstyle' || target.kind === 'textanim')) {
            this.messages.info('カードを読み取れませんでした。');
        }
        if (preset && id === 'place-text') await this.addTextStyleAtPlayhead(preset);
        if (style) {
            if (id === 'apply') void this.commandService.executeCommand('akari.timeline.applyLibraryItem', {
                payload: { kind: 'mystyle', style },
                editUri: this.workflow.workspaceRoot?.resolve('edit.json').normalizePath().toString()
            });
            else if (id === 'place-text') await this.addMyStyleAtPlayhead(style);
            else if (id === 'rename') await this.renameMyStyle(style);
            else if (id === 'delete') await this.deleteMyStyle(style);
        }
    }

    /** ★ を付ける / 外す（利用者ごとに保存。edit.json には入れない）。 */
    protected async toggleLibraryFavorite(key: string): Promise<void> {
        const favorite = !this.libraryFavorites.has(key);
        try {
            this.libraryFavorites = new Set(await this.projectService.setLibraryFavorite(key, favorite));
            this.assetCatalogItems = this.assetCatalogItems.map(entry => entry.key === key ? { ...entry, favorite } : entry);
            this.update();
        } catch (error) {
            this.messages.error(`お気に入りを保存できませんでした: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected openLibraryLab(item: AssetCatalogViewItem): void {
        this.windowService.openNewWindow(storeProductUrl(this.storeConnection.url, item.id), { external: true });
    }

    /**
     * プレミアムの促しのシート（コマンド `akari.library.showPremiumPrompt`）。未購入の素材を
     * 置こう・使おうとした時点で出す。置かない。
     */
    public showPremiumPrompt(key: string): boolean {
        const item = this.assetCatalogItems.find(entry => entry.key === key);
        if (!item || !isPremiumLocked(item)) return false;
        this.libraryInfo = undefined;
        this.libraryPremiumPrompt = key;
        this.update();
        return true;
    }

    protected openLibraryLicense(model: LibraryInfoCardModel, target: LibraryMenuTarget): void {
        const item = target.kind === 'asset' ? this.assetCatalogItems.find(entry => entry.key === target.item.key) ?? target.item : undefined;
        this.libraryLicense = { sheet: model.license, credit: item && model.license.credit ? libraryCreditLine(item) : undefined };
        this.update();
    }

    protected async copyLibraryCredit(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
            this.messages.info('クレジットをコピーしました');
        } catch (error) {
            this.messages.error(`クレジットをコピーできませんでした: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected toggleLibraryFilterPopover(): void {
        if (this.libraryFilterAnchor) {
            this.libraryFilterAnchor = undefined;
        } else {
            const button = this.node.querySelector<HTMLElement>('[data-akari-library-filter-button]');
            this.libraryFilterAnchor = button?.getBoundingClientRect();
        }
        this.update();
    }

    /** 浮く部品（情報カード・ライセンスの窓・フィルター・促しのシート）。document.body へ出す。 */
    protected renderLibraryOverlays(): React.ReactNode {
        const info = this.libraryInfo;
        const model = info && this.libraryInfoModel(info.target);
        const premium = this.libraryPremiumPrompt ? this.assetCatalogItems.find(entry => entry.key === this.libraryPremiumPrompt) : undefined;
        const prompt = premium && premiumPromptText(premium);
        return <>
            <LibraryCardStyles />
            <LibraryShelfVisualStyles />
            {this.libraryFilterAnchor && this.topView === 'catalog' && <LibraryFilterPopover filter={this.libraryFilter()} anchor={this.libraryFilterAnchor}
                onToggleOption={(section, option) => this.toggleLibraryFilterOption(section, option)}
                onClear={() => this.clearLibraryFilter()}
                onClose={() => { this.libraryFilterAnchor = undefined; this.update(); }} />}
            {info && model && <LibraryInfoCard model={model} anchor={info.anchor} keywordsExpanded={info.keywordsExpanded}
                favorite={this.libraryFavorites.has(model.key)}
                onToggleKeywords={() => { this.libraryInfo = { ...info, keywordsExpanded: !info.keywordsExpanded }; this.update(); }}
                onAction={id => {
                    if (id !== 'favorite') this.closeLibraryInfo();
                    void this.runLibraryAction(info.target, id);
                }}
                onOpenLicense={() => this.openLibraryLicense(model, info.target)}
                onCreator={model.creatorSource ? () => {
                    this.librarySourceFilter = model.creatorSource!;
                    this.catalogQuery = '';
                    this.closeLibraryInfo();
                } : undefined}
                onClose={this.closeLibraryInfo} />}
            {this.libraryLicense && <LibraryLicenseDialog sheet={this.libraryLicense.sheet}
                onCopyCredit={this.libraryLicense.credit ? () => void this.copyLibraryCredit(this.libraryLicense!.credit!) : undefined}
                onMore={url => this.windowService.openNewWindow(url, { external: true })}
                onClose={() => { this.libraryLicense = undefined; this.update(); }} />}
            {premium && prompt && <LibraryPremiumSheet title={prompt.title} body={prompt.body} actionLabel={prompt.action}
                onLab={() => { this.libraryPremiumPrompt = undefined; this.update(); this.openLibraryLab(premium); }}
                onClose={() => { this.libraryPremiumPrompt = undefined; this.update(); }} />}
        </>;
    }

    protected async removeLibraryItem(item: AssetCatalogViewItem): Promise<void> {
        if (!item.libraryDir) return;
        try {
            const usage = await this.projectService.getLibraryUsage();
            const warning = libraryRemovalWarning(item, usage[item.key]?.projects ?? []);
            const confirmed = await new ConfirmDialog({
                title: `${item.title} をライブラリから消しますか？`, msg: warning,
                ok: 'ゴミ箱へ移す', cancel: 'キャンセル'
            }).open();
            if (!confirmed) return;
            await this.files.delete(URI.fromFilePath(item.libraryDir), { recursive: true, useTrash: true });
            await this.loadAssetCatalogView();
        } catch (error) { this.messages.error(`ライブラリから消せませんでした: ${String(error)}`); }
    }

    protected renderPresetShowcase(kind: PresetShowcaseKind): React.ReactNode {
        const items = this.filteredPresetShowcaseItems(kind);
        if (!items.length) {
            return (
                <div data-akari-catalog-preset-kind={kind} data-akari-catalog-preset-count={this.presetShowcase[kind].length} data-akari-catalog-preset-visible-count={0}>
                    <p data-akari-catalog-preset-empty style={{ opacity: 0.7, padding: '16px' }}>
                        条件に一致するプリセットがありません
                    </p>
                </div>
            );
        }
        const style: React.CSSProperties = this.catalogViewMode === 'grid'
            ? { display: 'grid', gridTemplateColumns: CATALOG_GRID_COLUMNS, gap: CATALOG_GRID_GAP, padding: '10px' }
            : { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px' };
        const bottomPadding = presetShowcaseBottomPadding(kind);
        if (bottomPadding !== undefined) style.paddingBottom = `${bottomPadding}px`;
        return (
            <div
                style={style}
                data-akari-catalog-preset-kind={kind}
                data-akari-catalog-preset-count={this.presetShowcase[kind].length}
                data-akari-catalog-preset-visible-count={items.length}
            >
                {items.map(item => this.renderPresetShowcaseItem(item))}
            </div>
        );
    }

    protected renderPresetShowcaseItem(item: PresetShowcaseItem): React.ReactNode {
        return this.catalogViewMode === 'list'
            ? this.renderPresetShowcaseListRow(item)
            : this.renderPresetShowcaseCard(item);
    }

    protected renderMyStyles(): React.ReactNode {
        const query = this.catalogQuery.trim().toLocaleLowerCase();
        const styles = this.myStyles.filter(style => (!query || `${style.name} ${style.when_to_use}`.toLocaleLowerCase().includes(query))
            && this.presetPassesLibraryFilter(`mystyle/${style.id}`, 'own'));
        return <section data-akari-my-style-shelf>
            <div style={{ padding: '7px 10px', fontSize: '0.76em', fontWeight: 700, borderBottom: AKARI_BORDER.hairline }}>マイスタイル</div>
            {styles.length === 0 && <p style={{ opacity: 0.7, padding: '8px 10px', fontSize: '0.78em' }}>保存したスタイルはまだありません。</p>}
            <div style={{ display: 'grid', gridTemplateColumns: CATALOG_GRID_COLUMNS, gap: CATALOG_GRID_GAP, padding: '8px 10px' }}>
                {styles.map(style => {
                    const sampleStyle = myStyleSamplePresentation(style) as React.CSSProperties;
                    const key = `mystyle/${style.id}`;
                    const target: LibraryMenuTarget = { kind: 'mystyle', key };
                    const info = this.libraryInfo?.target;
                    return <LibrarySimpleCard key={style.id} cardKey={key} name={style.name} layout='grid' faceHeight='48px'
                        title={`${style.name} — ${style.when_to_use}`}
                        favorite={this.libraryFavorites.has(key)}
                        infoOpen={info?.kind === 'mystyle' && info.key === key}
                        attributes={{ 'data-akari-my-style-card': style.id }}
                        draggable
                        onMouseEnter={event => this.playMyStyleSample(event.currentTarget as HTMLDivElement, style)}
                        onMouseLeave={event => event.currentTarget.querySelector('[data-akari-my-style-preview]')?.getAnimations().forEach(animation => animation.cancel())}
                        onDragStart={event => {
                            const payload = { kind: 'mystyle', style };
                            event.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(payload));
                            event.dataTransfer.effectAllowed = 'copy';
                            window.dispatchEvent(new CustomEvent(LIBRARY_DRAG_START_EVENT, { detail: payload }));
                        }}
                        onDragEnd={() => this.handleLibraryTransitionDragEnd()}
                        onContextMenu={event => this.openLibraryMenuAt(event, target)}
                        onInfo={anchor => this.openLibraryInfo(target, anchor)}
                        face={<span data-akari-my-style-preview style={{ ...sampleStyle, maxWidth: '86%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {style.sample_text || style.name}
                        </span>} />;
                })}
            </div>
        </section>;
    }

    protected openMyStyleApply(style: MyStyle, button: HTMLElement): void {
        this.closeMyStyleApplyPopover?.();
        const supported = defaultMyStyleParts(style.parts);
        const apply = (selectedParts: string[]): void => {
            window.dispatchEvent(new CustomEvent('akari.mystyle.apply', { detail: { style, selectedParts } }));
        };
        if (supported.length <= 1) { apply(supported); return; }
        const key = `akari.mystyle.parts.${style.uid}`;
        let previous: string[] | undefined;
        try {
            const stored = window.localStorage.getItem(key);
            if (stored) {
                const parsed: unknown = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) previous = parsed;
            }
        } catch { /* Empty preferences use all supported parts. */ }
        const selected = defaultMyStyleParts(style.parts, previous);
        const popover = document.createElement('div');
        popover.setAttribute('data-akari-my-style-apply-popover', '');
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', '当てる部品を選ぶ');
        Object.assign(popover.style, { position: 'fixed', zIndex: '100000', width: '190px', padding: '10px',
            background: 'var(--theia-editor-background)', color: 'var(--theia-foreground)',
            border: '1px solid var(--theia-widget-border)', borderRadius: '7px', boxShadow: '0 8px 24px #0008' });
        const title = document.createElement('strong');
        title.textContent = '当てる部品';
        popover.appendChild(title);
        for (const part of style.parts) {
            const applicable = defaultMyStyleParts([part]).length > 0;
            const label = document.createElement('label');
            label.style.display = 'block';
            label.style.marginTop = '6px';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = part.kind;
            input.checked = applicable && selected.includes(part.kind);
            input.disabled = !applicable;
            label.append(input, document.createTextNode(` ${myStylePartLabel(part.kind)}${input.disabled ? '（当てない）' : ''}`));
            popover.appendChild(label);
        }
        const actions = document.createElement('div');
        Object.assign(actions.style, { display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '10px' });
        const confirm = document.createElement('button');
        confirm.type = 'button'; confirm.className = 'theia-button main'; confirm.textContent = '当てる';
        const refreshConfirm = (): void => {
            confirm.disabled = !popover.querySelector('input:checked:not(:disabled)');
        };
        popover.addEventListener('change', refreshConfirm);
        refreshConfirm();
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.className = 'theia-button secondary'; cancel.textContent = 'キャンセル';
        actions.append(cancel, confirm);
        popover.appendChild(actions);
        const close = (): void => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onOutside, true);
            popover.remove();
            if (this.closeMyStyleApplyPopover === close) this.closeMyStyleApplyPopover = undefined;
        };
        this.closeMyStyleApplyPopover = close;
        const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
        const onOutside = (event: PointerEvent): void => { if (!popover.contains(event.target as Node)) close(); };
        cancel.addEventListener('click', close);
        confirm.addEventListener('click', () => {
            const chosen = Array.from(popover.querySelectorAll<HTMLInputElement>('input:checked:not(:disabled)')).map(input => input.value);
            if (!chosen.length) return;
            try { window.localStorage.setItem(key, JSON.stringify(chosen)); } catch { /* Applying still works. */ }
            close(); apply(chosen);
        });
        const rect = button.getBoundingClientRect();
        document.body.appendChild(popover);
        popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8))}px`;
        popover.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - popover.offsetHeight - 8))}px`;
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onOutside, true);
        confirm.focus();
    }

    protected playMyStyleSample(container: HTMLDivElement, style: MyStyle): void {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const animation = style.parts.find(part => part.kind === 'motion')?.animation as Record<string, unknown> | undefined;
        const slot = (animation?.in ?? animation?.loop ?? animation?.out) as Record<string, unknown> | undefined;
        const target = container.querySelector<HTMLElement>('[data-akari-my-style-preview]');
        if (!slot || !target) return;
        target.getAnimations().forEach(item => item.cancel());
        const id = typeof slot.id === 'string' ? slot.id : '';
        const sample = textAnimationSampleKeyframes(id, animation?.in ? 'in' : animation?.loop ? 'loop' : 'out',
            typeof slot.amp === 'number' ? slot.amp : undefined,
            typeof slot.duration_sec === 'number' ? slot.duration_sec : undefined);
        target.animate(sample.keyframes, { duration: sample.durationMs, iterations: 1, easing: 'ease-out' });
    }

    protected async addMyStyleAtPlayhead(style: MyStyle): Promise<void> {
        await this.commandService.executeCommand('akari.caption.placeText', { myStyle: style });
    }

    protected async renameMyStyle(style: MyStyle): Promise<void> {
        class MyStyleRenameDialog extends SingleTextInputDialog {
            constructor(name: string) {
                super({ title: 'マイスタイルの名前を変更', initialValue: name, confirmButtonLabel: '変更' });
                this.appendCloseButton('キャンセル');
            }
        }
        const name = await new MyStyleRenameDialog(style.name).open();
        if (name === undefined || !name.trim()) return;
        try { await this.projectService.renameMyStyle(style.id, name); this.myStyles = await this.projectService.listMyStyles(); this.update(); }
        catch (error) { this.messages.error(`名前を変更できません: ${String(error)}`); }
    }

    protected async deleteMyStyle(style: MyStyle): Promise<void> {
        const confirmed = await new ConfirmDialog({ title: 'マイスタイルを削除', msg: `${style.name} を削除しますか？`, ok: '削除', cancel: 'キャンセル' }).open();
        if (!confirmed) return;
        try { await this.projectService.deleteMyStyle(style.id); this.myStyles = await this.projectService.listMyStyles(); this.update(); }
        catch (error) { this.messages.error(`削除できません: ${String(error)}`); }
    }

    protected presetShowcaseTitle(item: PresetShowcaseItem): string {
        if (item.kind === 'lut') {
            return [item.description, item.whenToUse].filter(Boolean).join('\n');
        }
        return [item.name, item.category, item.description, item.sampleText].filter(Boolean).join('\n');
    }

    protected presetShowcaseIcon(item: PresetShowcaseItem): string {
        if (item.kind === 'lut') {
            return 'codicon codicon-color-mode';
        }
        if (item.kind === 'textanim') {
            return 'codicon codicon-play';
        }
        return 'codicon codicon-symbol-text';
    }

    protected handleTextStyleDragStart(event: React.DragEvent<HTMLElement>, item: PresetShowcaseItem): void {
        const payload = { kind: item.kind, id: item.id, style: item.style, slot: item.tags[0] };
        event.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
        window.dispatchEvent(new CustomEvent(LIBRARY_DRAG_START_EVENT, { detail: payload }));
    }

    protected async addTextStyleAtPlayhead(item: PresetShowcaseItem): Promise<void> {
        const options = textStylePlaceOptions(item);
        if (!options) return;
        try {
            await this.commandService.executeCommand('akari.caption.placeText', options);
        } catch (error) {
            this.messages.error(`文字を置けません: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected renderPresetShowcaseListRow(item: PresetShowcaseItem): React.ReactNode {
        return this.renderPresetLibraryCard(item, 'list');
    }

    protected renderPresetShowcaseCard(item: PresetShowcaseItem): React.ReactNode {
        return this.renderPresetLibraryCard(item, 'grid');
    }

    /** プリセットのカード = 見本 + 名前 + ⋯（タグ・説明・＋は情報カードと右クリックへ）。 */
    protected renderPresetLibraryCard(item: PresetShowcaseItem, layout: 'grid' | 'list'): React.ReactNode {
        const key = `${item.kind}/${item.id}`;
        const target: LibraryMenuTarget = { kind: item.kind, key };
        const textstyle = item.kind === 'textstyle';
        const info = this.libraryInfo?.target;
        return <LibrarySimpleCard key={key} cardKey={key} name={item.name} layout={layout}
            title={this.presetShowcaseTitle(item)}
            favorite={this.libraryFavorites.has(key)}
            infoOpen={info?.kind === item.kind && info.key === key}
            attributes={{
                'data-akari-catalog-preset-item': key,
                'data-akari-catalog-item': textstyle ? `textstyle/${item.id}` : undefined,
                'data-akari-catalog-preset-list-row': layout === 'list' ? true : undefined
            }}
            draggable
            onDragStart={event => this.handleTextStyleDragStart(event, item)}
            onDragEnd={() => this.handleLibraryTransitionDragEnd()}
            onMouseEnter={item.kind === 'textanim' ? event => playTextAnimationSample(event.currentTarget, item.id,
                item.tags[0] === 'out' ? 'out' : item.tags[0] === 'loop' ? 'loop' : 'in') : undefined}
            onContextMenu={event => this.openLibraryMenuAt(event, target)}
            onClick={item.kind === 'textstyle' || item.kind === 'textanim' ? () => this.applyPresetToSelectedCaption(item) : undefined}
            onInfo={anchor => this.openLibraryInfo(target, anchor)}
            face={item.kind === 'lut'
                ? <LutPreview url={item.previewUrl} />
                : item.sampleText
                ? <span draggable={false} data-akari-preset-sample-text data-akari-textanim-sample={item.kind === 'textanim' ? true : undefined}
                    style={{ maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    padding: '0 4px', fontSize: layout === 'list' ? '0.69em' : '0.86em', fontWeight: 800 }}>{item.sampleText}</span>
                : <span draggable={false} className={this.presetShowcaseIcon(item)} aria-hidden='true' style={{ fontSize: layout === 'list' ? '1em' : '1.45em', opacity: 0.5 }} />} />;
    }

    protected renderCatalogListRow(item: AssetCatalogViewItem): React.ReactNode {
        const pickCandidate = this.generationCatalogCandidate(item);
        return <LibraryAssetCard key={item.key} {...this.libraryAssetCardProps(item, 'list',
            this.generationPickCardProps(pickCandidate), this.renderGenerationPickBadge(pickCandidate), !this.generationPick.request)} />;
    }

    /**
     * カード = 顔 + 名前 + ⋯（描画は library-card-view.tsx）。ライセンス・タグ・カテゴリ・使用回数・＋・使う・
     * 価格はカードに出さない（情報カード・右クリック・フィルター・書き出しの門へ移した）。
     */
    protected renderCatalogCard(item: AssetCatalogViewItem): React.ReactNode {
        const pickCandidate = this.generationCatalogCandidate(item);
        return <LibraryAssetCard key={item.key} {...this.libraryAssetCardProps(item, 'grid',
            this.generationPickCardProps(pickCandidate), this.renderGenerationPickBadge(pickCandidate), !this.generationPick.request)} />;
    }

    protected libraryAssetCardProps(item: AssetCatalogViewItem, layout: 'grid' | 'list',
        pickProps: React.HTMLAttributes<HTMLDivElement>, pickBadge: React.ReactNode, interactive: boolean): React.ComponentProps<typeof LibraryAssetCard> {
        const info = this.libraryInfo?.target;
        return {
            item, layout, pickProps, pickBadge, interactive,
            premium: isPremiumLocked(item),
            cached: isLibraryItemCached(item),
            favorite: this.libraryFavorites.has(item.key),
            thumbnailBroken: this.catalogBrokenThumbnails.has(item.key),
            placeholderIcon: this.catalogPlaceholderIcon(item.category),
            draggable: interactive && this.canDragCatalogAsset(item),
            infoOpen: info?.kind === 'asset' && info.item.key === item.key,
            audioControl: layout === 'grid' ? this.renderCatalogAudioControl(item) : this.renderCatalogAudioListControl(item),
            audioError: this.renderCatalogAudioError(item),
            uiTarget: catalogCardUiEventTarget(item),
            onDragStart: event => this.handleCatalogAssetDragStart(event, item),
            onDragEnd: () => this.handleLibraryTransitionDragEnd(),
            onContextMenu: event => {
                if (this.generationPick.request) return;
                this.openLibraryMenuAt(event, { kind: 'asset', item });
            },
            onInfo: anchor => this.openLibraryInfo({ kind: 'asset', item }, anchor),
            onThumbnailError: () => this.handleCatalogThumbnailError(item)
        };
    }

    protected renderCatalogAudioListControl(item: AssetCatalogViewItem): React.ReactNode {
        if (item.category !== 'audio' || !item.mediaUrl) return undefined;
        const playing = this.playingCatalogAudioKey === item.key;
        return (
            <button type='button' title={playing ? '停止' : '試聴する'}
                aria-label={playing ? `${item.title} の再生を停止` : `${item.title} を試聴`}
                data-akari-catalog-audio-toggle data-akari-catalog-audio-playing={playing ? 'true' : 'false'}
                onClick={event => { event.stopPropagation(); this.toggleCatalogAudio(item); }}
                style={{
                    flex: '0 0 auto', width: '24px', height: '24px', padding: 0, margin: 0, borderRadius: '50%', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--theia-button-background)', color: 'var(--theia-button-foreground)', cursor: 'pointer'
                }}>
                <span className={playing ? 'codicon codicon-debug-stop' : 'codicon codicon-play'} aria-hidden='true' style={{ fontSize: '12px' }} />
            </button>
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
        if (this.outputsLoading && !this.outputsLoadedOnce) {
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
        const isEditData = entry.kind === 'data' && entry.name === 'edit.json';
        return (
            <div
                key={entry.uri.toString()}
                data-akari-output-path={entry.relativePath}
                data-akari-output-kind={entry.kind}
                data-akari-output-emphasis={isEditData ? 'edit' : undefined}
                onClick={() => void this.openFile(entry.uri)}
                onContextMenu={event => this.openOutputContextMenu(event, entry)}
                title={label}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    borderRadius: `${AKARI_RADIUS.panel}px`,
                    padding: '6px 8px',
                    background: isEditData ? 'var(--theia-akariTheme-accentTint)' : AKARI_SURFACE.raised,
                    border: AKARI_BORDER.ghost
                }}
            >
                <div style={{
                    width: '34px',
                    height: '22px',
                    flex: 'none',
                    borderRadius: `${AKARI_RADIUS.chip}px`,
                    overflow: 'hidden',
                    background: AKARI_SURFACE.card,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    {entry.thumbnailUri
                        ? <img src={entry.thumbnailUri.toString()} alt='' style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span
                            className={this.outputIcon(entry)}
                            aria-hidden='true'
                            style={{ fontSize: '1.1em', opacity: isEditData ? 0.85 : 0.55 }}
                        />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85em', fontWeight: isEditData ? 600 : undefined }}>
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
            <div style={{ flex: '0 0 auto', borderTop: AKARI_BORDER.hairline, padding: '6px' }}>
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
