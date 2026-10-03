import { AkariOutputsPane, OutputsPaneHost } from './akari-outputs-pane';
import { AkariMaterialsPane, MaterialCardEntry, MaterialsPaneHost } from './akari-materials-pane';
import { AKARI_CATALOG_ROOT_PREFERENCE, AkariLibraryPane, LibraryPaneHost } from './akari-library-pane';
import { LibraryImportSheet } from './library-import-sheet';
import { LibraryImportResult } from '../common/library-import';
import { MaterialSwapRequest, SwapCandidates, rankSwapCandidates } from '../common/material-swap-candidates';
import {
    GENERATION_PICK_PRIMARY_SELECTED_EVENT, GenerationPickCandidate, GenerationPickController,
    GenerationPickRequest, GenerationPickResult, GenerationPickTimelineSelection, generationPickSelectionChanged
} from '../common/generation-pick';
import { AkariPreviewService } from 'akari-preview/lib/common/akari-preview-protocol';
import { CAPTION_FONT_FAMILY, captionFontFaceCss } from 'akari-preview/lib/common/caption-visual-contract';
import type { TranscriptState } from '../common/akari-project-protocol';
import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { OpenerService, QuickInputService, open } from '@theia/core/lib/browser';
import { ConfirmDialog, SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';
import { isOSX } from '@theia/core/lib/common/os';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { CAPTION_SAMPLE_TEXT, registerLibraryTextstylePresets, TRANSITION_VOCABULARY, TransitionType } from '@akari-video/edit-store';
import {
    AKARI_BORDER,
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
import { isEditDataFileName } from '../common/edit-data-file';
import {
    CatalogCategoryChip,
    CatalogItemMeta,
    CatalogViewMode,
    catalogItemCategoryChipKey,
    deriveCatalogCategoryChips,
    deriveCatalogFilteredEmptyKind,
    normalizeCatalogViewMode
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
import { AssetBinChildNode } from '../common/asset-bin-grouping';
import { canPlaceLibraryAsset, canPlaceOverlay, libraryDragKind, localLibraryAssetPlacementSource, plannedLibraryAssetMedia, resolveLibraryAssetMedia, RESOLVE_LIBRARY_MATERIAL_COMMAND_ID } from '../common/library-asset-placement';
import { classifyMaterialKind, MaterialKind } from '../common/asset-group-media';
import { CatalogPack } from '../common/catalog-packs';
import { filterPresetShowcaseItems, presetApplyPayload, presetShowcaseBottomPadding, textStylePlaceOptions } from '../common/preset-showcase';
import { defaultMyStyleParts, myStylePartLabel, type MyStyle } from '../common/my-style';
import { fitStyleSpecimen, libraryTextStyleSample } from '../common/library-shelf-visuals';
import { textAnimationSampleKeyframes } from '../common/text-animation-sample';
import { FontShelfCard, LibraryShelfVisualStyles, LutPreview, playTextAnimationSample, TransitionStrip } from './library-shelf-visuals-view';
import { LibraryTextFontRow } from './library-text-look-view';
import { LibraryTextTelopPage } from './library-text-telop-page';
import { catalogItemsWithoutShelvedTelops, textTelopItems } from '../common/library-telop-shelf';
import { libraryTextstyleApplyPayload } from '../common/library-textstyle-apply';
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
import { LIBRARY_TILE_ART, LIBRARY_TILE_SHARED_DEFS } from '../common/library-tile-art';
import { AKARI_REVEAL_IN_FILE_MANAGER } from './akari-reveal-commands';
import { buildMaterialContextMenuItems, MaterialContextMenuTarget } from '../common/material-context-menu-items';
import { openAkariContextMenu, OPEN_PREVIEW_IMAGE_ITEM } from './akari-context-menu';
import { ElectronAkariProjectApi } from '../electron-common/electron-api';
import { isOsFileDropInput } from '../common/delegated-drop';

try { require('../../src/browser/style/generation-pick.css'); } catch { /* node 単体テスト環境 */ }
try { require('../../src/browser/style/library-tiles.css'); } catch { /* node 単体テスト環境 */ }

// パートナー拡張の公開コマンド ID とミラー（extension 間の npm 依存を作らない。
// akari-partner-command-contribution.ts の AkariPartnerCommands.INJECT_PROMPT と同一）。
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';
// 姉妹拡張（タイムライン側、task 2026-08-10-timeline-clip-menu）の公開コマンド ID とミラー。
// 共有パッケージを作らず文字列を直書きする流儀（PARTNER_INJECT_PROMPT_COMMAND_ID と同じ）。
// 受け側が未合流でも executeCommand は失敗するだけなので本タスクは成立する（司令塔裁定2）。
const TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID = 'akari.timeline.addMaterialAtPlayhead';
// 図形を置くタイムライン側のコマンド（akari-annotations が登録。引数 `{ preset, t?, center?, transform? }`）。
const TIMELINE_ADD_SHAPE_AT_COMMAND_ID = 'akari.timeline.addShapeAt';

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

const AKARI_CATALOG_VIEW_MODE_STORAGE_KEY = 'akari.catalog.viewMode';
const AKARI_LIBRARY_DETAILS_STORAGE_KEY = 'akari.library.detailsOpen';
// 一般ユーザー向けの空状態文言（原因別。catalog-account-first-ux task.md §2）。
// どちらも `akari.catalog.root` という preference 名・「カタログの場所」という内部語を含まない
// — それらは開発者向け折りたたみ（renderDeveloperCatalogPanel）の中でのみ表記する。
const CATALOG_FETCH_FAILED_MESSAGE = '素材カタログを取得できませんでした。接続を確認して再試行してください。';
const CATALOG_EMPTY_MESSAGE = 'カタログに素材がまだありません。';
const EMPTY_PRESET_SHOWCASE: PresetShowcase = { lut: [], textanim: [], textstyle: [] };

// 320px 前後のパネルでも左右 padding 20px を差し引いた幅へ 3 列を保証する。
const CATALOG_GRID_GAP = '8px';
const CATALOG_GRID_COLUMNS =
    'repeat(auto-fill, minmax(min(96px, calc(33.333% - 6px)), 1fr))';

/**
 * 一度に DOM へ出すカタログ項目の上限。カードは 1 枚ごとに IntersectionObserver /
 * ResizeObserver を持ち、サムネイルが 1 枚焼き上がるたびに表示中の全カードが再描画される
 * （material-card-hover-preview.ts の listeners）。カタログが 7,600 件規模になってから
 * ライブラリ上のドラッグが目に見えて重くなったため、出す枚数そのものを絞る。
 * 続きは検索・カテゴリ・フォルダーの絞り込みで辿る。
 */
const CATALOG_RENDER_LIMIT = 240;

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
function StyleSpecimen(props: { style: React.CSSProperties; myStyle?: boolean }): React.ReactElement {
    const stage = React.useRef<HTMLSpanElement>(null);
    const sample = React.useRef<HTMLSpanElement>(null);
    const [scale, setScale] = React.useState(1);
    React.useLayoutEffect(() => {
        const fit = (): void => {
            if (!stage.current || !sample.current) return;
            const width = Math.max(1, sample.current.offsetWidth);
            const height = Math.max(1, sample.current.offsetHeight);
            setScale(fitStyleSpecimen(stage.current.clientWidth, stage.current.clientHeight, width, height));
        };
        fit();
        const observer = new ResizeObserver(fit);
        if (stage.current) observer.observe(stage.current);
        if (sample.current) observer.observe(sample.current);
        return () => observer.disconnect();
    }, [props.style]);
    return <span ref={stage} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', overflow: 'hidden' }}>
        <span ref={sample} draggable={false} data-akari-preset-sample-text={!props.myStyle || undefined}
            data-akari-my-style-preview={props.myStyle || undefined}
            style={{ ...props.style, display: 'inline-block', flex: '0 0 auto', whiteSpace: 'nowrap',
                lineHeight: 1.2, transform: `scale(${scale})` }}>{CAPTION_SAMPLE_TEXT}</span>
    </span>;
}

@injectable()
export class AkariRoleBucketsWidget extends ReactWidget {
    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        const input = this.searchInput?.isConnected ? this.searchInput : undefined;
        if (input) {
            // A focused input can outlive the shell's active-widget record. Re-focus through
            // our node so Lumino emits an activation event, without interrupting IME conversion.
            if (document.activeElement === input && !this.searchComposing) {
                this.node.tabIndex = -1;
                this.node.focus();
            }
            input.focus();
        }
        else {
            this.node.tabIndex = -1;
            this.node.focus();
        }
    }
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
        if (event.key === 'Escape' && this.topView === 'catalog' && this.libraryTextLookOpen
            && !this.generationPick.request && this.node.contains(event.target as Node)) {
            event.preventDefault();
            event.stopPropagation();
            this.showLibraryHome();
            return;
        }
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
    protected lintAvailable = false;
    protected lintCount?: number;
    protected lintRunning = false;
    protected outputsPane!: AkariOutputsPane;
    protected materialsPane!: AkariMaterialsPane;
    protected libraryPane!: AkariLibraryPane;


    /** カタログ面「1 ビュー」= resolver 合成 + ローカル catalog/ のマージ済み一覧。 */
    protected assetCatalogItems: AssetCatalogViewItem[] = [];
    protected materialSwap?: { request: MaterialSwapRequest; title: string; candidates: SwapCandidates; root: string };
    protected swapLoadGeneration = 0;

    async openMaterialSwap(request: MaterialSwapRequest): Promise<boolean> {
        const generation = ++this.swapLoadGeneration;
        const root = this.workflow.workspaceRoot;
        if (!root || !request?.itemId || !['audio', 'visual'].includes(request.kind)) return false;
        await this.loadAssetCatalogView('user');
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
        this.selectTopView('catalog', false);
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
    /** 検索欄が日本語入力の変換中かどうか。変換が終わるまで絞り込みを走らせない。 */
    protected searchComposing = false;
    /** 検索欄の実体。非制御なので、外から値を変えるときはここを直接合わせる。 */
    protected searchInput?: HTMLInputElement;
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
    protected libraryTextTab: 'style' | 'font' | 'telop' = 'style';
    protected libraryDetailsOpen = false;
    protected catalogCategory = 'all';
    protected catalogViewMode: CatalogViewMode = 'grid';
    protected readonly catalogBrokenThumbnails = new Set<string>();
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
        const widget = () => this;
        const host: OutputsPaneHost = {
            get workflow() { return widget().workflow; },
            get files() { return widget().files; },
            get projectService() { return widget().projectService; },
            get commandService() { return widget().commandService; },
            get quickInputService() { return widget().quickInputService; },
            update: () => widget().update(),
            classifyKind: name => widget().classifyKind(name),
            placeholderIcon: kind => widget().placeholderIcon(kind),
            openFile: uri => widget().openFile(uri),
            revealInFileManagerCommand: uri => widget().revealInFileManagerCommand(uri),
            copyFileToClipboard: uri => widget().copyFileToClipboard(uri),
            copyPathToClipboard: uri => widget().copyPathToClipboard(uri),
            renameEntry: (uri, name, relativePath, isDirectory, reload) => widget().renameEntry(uri, name, relativePath, isDirectory, reload),
            deleteEntry: (uri, name, relativePath, isDirectory, reload) => widget().deleteEntry(uri, name, relativePath, isDirectory, reload),
            get projectDataFiles() { return PROJECT_DATA_FILES; },
            get rootPlanFiles() { return ROOT_PLAN_FILES; },
            get rootReportFiles() { return ROOT_REPORT_FILES; }
        };
        this.outputsPane = new AkariOutputsPane(host);
        const materialsHost: MaterialsPaneHost = {
            get workflow() { return widget().workflow; },
            get files() { return widget().files; },
            get projectService() { return widget().projectService; },
            get messages() { return widget().messages; },
            get commandService() { return widget().commandService; },
            get materialPreviewService() { return widget().materialPreviewService; },
            get workspaceService() { return widget().workspaceService; },
            get quickInputService() { return widget().quickInputService; },
            update: () => widget().update(),
            classifyKind: name => widget().classifyKind(name),
            toAssetBinChildren: node => widget().toAssetBinChildren(node),
            placeholderIcon: kind => widget().placeholderIcon(kind),
            openFile: uri => widget().openFile(uri),
            openMaterialContextMenu: (event, entry) => widget().openMaterialContextMenu(event, entry),
            generationPickCardProps: candidate => widget().generationPickCardProps(candidate),
            renderGenerationPickBadge: candidate => widget().renderGenerationPickBadge(candidate),
            reportLibraryImportResult: result => widget().reportLibraryImportResult(result),
            loadAssetCatalogView: intent => widget().loadAssetCatalogView(intent),
            get materialQuery() { return widget().materialQuery; },
            get generationPick() { return widget().generationPick; },
            get assetCatalogItems() { return widget().assetCatalogItems; },
            get transcriptStateByPath() { return widget().transcriptStateByPath; },
            set transcriptStateByPath(value) { widget().transcriptStateByPath = value; },
        };
        this.materialsPane = new AkariMaterialsPane(materialsHost);
        const libraryHost: LibraryPaneHost = {
            get dialogs() { return widget().dialogs; },
            get preferences() { return widget().preferences; },
            get files() { return widget().files; },
            update: () => widget().update(),
            loadAssetCatalogView: intent => widget().loadAssetCatalogView(intent)
        };
        this.libraryPane = new AkariLibraryPane(libraryHost);
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
        this.toDispose.push({ dispose: () => this.materialsPane.referenceWatches.dispose() });
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
        this.node.setAttribute('data-akari-onboarding-target', 'assets');
        this.node.setAttribute('data-akari-ui-label', '素材パネル');
        this.storeConnectionFlow = new StoreConnectionFlowController(this.projectService, {
            openVerificationUrl: url => this.windowService.openNewWindow(url, { external: true }),
            onChange: state => {
                const wasConnected = this.storeConnection.connected;
                this.storeConnection = state.connection;
                this.update();
                if (!wasConnected && state.connection.connected) {
                    void this.loadAssetCatalogView('automatic');
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
        const refreshOnboardingProject = (): void => this.refresh();
        window.addEventListener('akari.onboarding.refreshProject', refreshOnboardingProject);
        this.toDispose.push({ dispose: () => {
            window.removeEventListener('drop', clearDropOverlay, true);
            window.removeEventListener('dragend', clearDropOverlay, true);
            window.removeEventListener('akari.onboarding.refreshProject', refreshOnboardingProject);
        } });
        this.toDispose.push(this.workflow.onDidChange(() => {
            if (this.materialSwap && this.materialSwap.root !== this.workflow.workspaceRoot?.toString()) this.closeMaterialSwap();
            if (this.generationPickRoot !== this.workflow.workspaceRoot?.toString()) {
                this.generationPick.cancel();
            }
            this.materialsPane.ensureMaterialsWatch();
            this.outputsPane.ensureOutputsWatch();
            this.refresh();
        }));
        this.materialsPane.ensureMaterialsWatch();
        this.outputsPane.ensureOutputsWatch();
        this.catalogViewMode = this.readCatalogViewMode();
        this.libraryDetailsOpen = this.readLibraryDetailsOpen();
        // カタログはワークスペース非依存（resolver 合成分・ローカル catalog/ 分ともに
        // アカウント/参照データなので）素材タブと違いプロジェクトを開く前でも読み込む。
        // 起動時の読み込みは automatic。OFF なら resolver は手元のキャッシュだけを返す。
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
                void this.loadAssetCatalogView('automatic');
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
        void this.outputsPane.loadOutputs();
        void this.refreshLint();
    }

    protected selectTopView(view: TopView, refreshCatalog = true): void {
        if (view !== 'catalog' && this.materialSwap) this.closeMaterialSwap();
        if (this.topView === 'catalog' && view !== 'catalog') {
            // 「← 素材にもどる」でカタログ面を離れるとき（task.md 指示3「離脱で停止」）。
            this.stopCatalogAudio();
        }
        this.topView = view;
        if (view === 'catalog') {
            // この入口はクリック・キーボード・明示コマンドからだけ呼ぶ。
            // レイアウト復元や初期化は通らないため、ここでは利用者操作として再取得する。
            if (refreshCatalog) void this.loadAssetCatalogView('user');
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

    protected transcriptStateByPath: Record<string, TranscriptState> = {};

    protected async loadMaterials(): Promise<void> {
        return this.materialsPane.loadMaterials();
    }

    protected toAssetBinChildren(node: FileStat): AssetBinChildNode[] {
        return (node.children ?? []).map(child => ({ name: child.resource.path.base, isDirectory: child.isDirectory }));
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
        if (isEditDataFileName(uri.path.base) && uri.parent.toString() === this.workflow.workspaceRoot?.toString()) {
            await this.commandService.executeCommand('akari.annotations.open', { editUri: uri.toString() });
        }
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
        const items = buildMaterialContextMenuItems(target, isOSX, {
            materialKind: entry.kind, assetGroup: !!entry.assetGroup,
            reference: !!entry.reference, missing: !!entry.missing
        });
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
                this.selectTopView('catalog');
                this.librarySourceFilter = 'all';
                this.libraryCategory = undefined;
                this.catalogCategory = 'all';
                this.libraryFolderFilter = undefined;
                this.catalogQuery = entry.name;
                this.update();
                break;
            case 'remove-reference':
                void this.materialsPane.removeMaterialReference(entry);
                break;
            case 'retry-reference':
                void this.materialsPane.retryMaterialReference(entry);
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
                void this.materialsPane.addMaterialToTimeline(entry);
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
                void this.materialsPane.showAssetInfo(entry.uri);
                break;
            case 'store-library':
                void this.materialsPane.storeMaterialInLibrary(entry);
                break;
            case 'rename': {
                const renameTarget = this.materialsPane.materialFileSystemTarget(entry);
                void this.renameEntry(renameTarget.uri, entry.name, entry.relativePath, renameTarget.isDirectory, () => this.loadMaterials());
                break;
            }
            case 'delete': {
                const deleteTarget = this.materialsPane.materialFileSystemTarget(entry);
                void this.deleteEntry(deleteTarget.uri, entry.name, entry.relativePath, deleteTarget.isDirectory, () => this.loadMaterials());
                break;
            }
            case 'ask-agent':
                void this.materialsPane.askAgent(entry);
                break;
            case 'move-to-assets':
                void this.materialsPane.moveToAssets(entry);
                break;
            default:
                break;
        }
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
        this.syncSearchInput();
        this.catalogCategory = 'all';
        await this.loadAssetCatalogView('user');
        this.update();
        requestAnimationFrame(() => this.node.querySelector('[data-recent-strip]')?.scrollIntoView({ block: 'start' }));
    }

    public async siteImportCompleted(result: LibraryImportResult): Promise<void> {
        await this.finishLibraryImport(result);
    }

    public showSiteLab(): void {
        this.selectTopView('catalog'); this.librarySourceFilter = 'lab';
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
        this.selectTopView('catalog');
        const paths = await this.pickLibraryImport('folders');
        if (paths.length) { this.libraryImportRequest = { paths }; this.update(); }
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
     * 名前を変更（指示5）。参照ありなら SingleTextInputDialog の前に ConfirmDialog で警告する。
     * 同一ディレクトリ内での `FileService.move`（overwrite: false）。衝突・失敗時は
     * messages.error。成功後は呼び出し側が渡した `reload` で再読込する。
     */
    protected async renameEntry(uri: URI, currentName: string, relativePath: string, isDirectory: boolean, reload: () => void): Promise<void> {
        const proceed = await this.materialsPane.confirmReferenceImpact(relativePath, isDirectory, '名前を変更');
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
        const referenceMessage = await this.materialsPane.buildDeleteReferenceMessage(relativePath, isDirectory);
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

    // --- カタログ ---------------------------------------------------------

    /**
     * カタログ面「1 ビュー」の読み込み。backend の getAssetCatalogView() が
     * resolver 合成分（無料 + 購入済み + 取得状態）とローカル catalog/（外部ソース系）を
     * 既にマージ済みで返すため、ここでは preference を渡して結果をそのまま保持するだけ。
     * 空配列（=完全に何も無い）のときだけ従来の「フォルダを選ぶ」空状態を出す。
     */
    public async loadAssetCatalogView(intent: 'automatic' | 'user' = 'automatic'): Promise<void> {
        this.catalogLoading = true;
        this.update();
        const preferenceRoot = this.preferences.get<string>(AKARI_CATALOG_ROOT_PREFERENCE, '');
        this.libraryPane.catalogPickError = undefined;
        const [view, presetShowcase, libraryTextstyles, usage, myStyles, favorites, transitionPreviews] = await Promise.all([
            this.projectService.getAssetCatalogView(preferenceRoot, intent),
            this.projectService.getPresetShowcase().catch(() => EMPTY_PRESET_SHOWCASE),
            this.projectService.getLibraryTextstylePresets().catch(() => []),
            this.projectService.getLibraryUsage().catch(() => ({} as Record<string, { count: number; lastUsedAt: string; projects: string[] }>)),
            this.projectService.listMyStyles().catch(() => [] as MyStyle[]),
            this.projectService.getLibraryFavorites().catch(() => [] as string[]),
            this.projectService.getTransitionPreviewUrls().catch(() => ({} as Record<string, { preview: string; strip: string }>))
        ]);
        this.libraryFavorites = new Set(favorites);
        this.assetCatalogItems = view.items.filter(item => item.category !== 'textstyle')
            .map(item => ({ ...item, favorite: this.libraryFavorites.has(item.key),
            usageCount: usage[item.key]?.count ?? 0, lastUsedAt: usage[item.key]?.lastUsedAt }));
        this.catalogPacks = view.packs;
        this.catalogResolver = view.resolver;
        this.catalogEntitlementsStatus = view.entitlementsStatus;
        this.presetShowcase = presetShowcase;
        registerLibraryTextstylePresets(libraryTextstyles);
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

    /**
     * 検索欄の入力を受ける。値は常に控えるが、再描画は `rerender` が真のときだけ行う。
     * 日本語入力の変換中に再描画すると、value が確定前の文字列で上書きされて変換が壊れる
     * （`update()` が非同期なため、打ち進めた分が巻き戻る）。値自体は毎回控えるので、
     * 変換が中断されて compositionend が来なくても入力不能にはならない。
     */
    protected applySearchQuery(value: string, rerender: boolean): void {
        if (this.topView === 'materials') this.materialQuery = value;
        else this.catalogQuery = value;
        if (rerender) this.update();
    }

    /** 非制御の検索欄に、外から変えた値を書き戻す（タブ切り替え・クリア・履歴からの指定）。 */
    protected syncSearchInput(): void {
        const input = this.searchInput;
        if (!input) return;
        const value = this.topView === 'materials' ? this.materialQuery : this.catalogQuery;
        if (input.value !== value) input.value = value;
    }

    protected setCatalogQuery(query: string): void {
        this.catalogQuery = query;
        this.syncSearchInput();
        this.update();
    }

    protected setMaterialQuery(query: string): void {
        this.materialQuery = query;
        this.syncSearchInput();
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

    /**
     * 取り寄せる前に置き先だけ返す（ネットワークにも実体にも触らない）。
     * 「先に置いて、届いたら塗り替える」配置の下ごしらえ。当てられない素材は
     * undefined を返し、呼び出し側は従来の resolveCatalogMaterial 経路へ落とす。
     */
    planCatalogMaterial(key: string): {
        relativePath: string; kind: MaterialKind; cached: boolean; thumb?: string; title?: string
    } | undefined {
        const item = this.assetCatalogItems.find(entry => entry.key === key);
        if (!item || isPremiumLocked(item)) return undefined;
        const planned = plannedLibraryAssetMedia(item);
        if (!planned) return undefined;
        return {
            relativePath: planned.relativePath, kind: planned.kind, cached: item.state === 'cached',
            ...(item.previewUrl ? { thumb: item.previewUrl } : {}),
            ...(item.title ? { title: item.title } : {})
        };
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
        if (!transfer || (!isOsFileDropInput(transfer.types)
            && !transfer.types.includes('application/x-akari-onboarding-sample'))) {
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

    protected async refreshLint(notify = false): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root) {
            this.lintAvailable = false;
            this.lintCount = undefined;
            this.lintRunning = false;
            this.update();
            return;
        }
        if (this.lintRunning) return;
        // 押しても画面が何も変わらない（件数が前回と同じなら尚更）状態を潰す
        // （2026-09-26 オーナー指示「リントを押しても反応がない」）: 実行中は
        // ボタン自身が「確認中…」になり、終わったら結果をトーストで必ず返す。
        this.lintRunning = notify;
        if (notify) this.update();
        try {
            const outcome = await this.projectService.runEditLint(root.toString());
            this.lintAvailable = outcome.available;
            this.lintCount = outcome.available ? outcome.issueCount : undefined;
            if (notify) {
                if (!outcome.available) this.messages.warn('編集内容のチェックはこのプロジェクトでは実行できません。');
                else if (outcome.issueCount) this.messages.warn(`編集内容のチェック: ${outcome.issueCount} 件の指摘があります。`);
                else this.messages.info('編集内容のチェック: 指摘はありません。');
            }
        } catch (error) {
            if (notify) this.messages.error(`編集内容をチェックできませんでした: ${this.errorMessage(error)}`);
        } finally {
            this.lintRunning = false;
            this.update();
        }
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
                        {this.outputsPane.renderOutputsPane()}
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
                <div style={{ flex: '1 1 auto', overflowY: 'auto', overflowX: 'hidden', minHeight: 0,
                    // 縦スクロールバーが出た瞬間に内容幅が変わって右端が切れる/ずれるのを止める
                    // （2026-09-26 オーナー指示「パネルの右側が見切れる」）。桁を常に確保しておけば、
                    // 素材が増えて溢れた前後でグリッドの列幅が動かない。
                    scrollbarGutter: 'stable',
                    paddingBottom: this.topView === 'catalog' && !this.materialSwap && this.playingCatalogAudioKey ? '56px' : undefined,
                    boxSizing: 'border-box' }}>
                    {this.topView === 'materials' ? this.renderMaterialsTab() : this.renderCatalogTab()}
                </div>
                {this.topView === 'catalog' && !this.materialSwap && this.renderCatalogAudioDock()}
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
                            // つまみはアクセントの「枠」ではなく**面**で示す（2026-09-26 オーナー指示
                            // 「オレンジの枠がいらない、ベースの色を変えるぐらいでいい」）。
                            // 線を足さずに面だけを一段持ち上げるので、カード内に外周より強い線を
                            // 置かない原則（akari-surface-tokens §2）とも噛み合う。
                            background: AKARI_SURFACE.elevated, border: AKARI_BORDER.ghost,
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
                        /*
                         * 非制御（defaultValue + ref）にしている。制御にすると、ライブラリの
                         * サムネイル読み込みなど「検索と無関係な再描画」のたびに value が
                         * state の値で上書きされ、日本語入力の変換が 1 文字ごとに巻き戻る。
                         * 外から空にする場合は syncSearchInput() で DOM 側も合わせる。
                         */
                        ref={element => { this.searchInput = element ?? undefined; }}
                        defaultValue={query}
                        /*
                         * 日本語入力の変換中（composition）は state を動かさない。動かすと
                         * update() で再描画が走り、value が確定前の文字列で上書きされて
                         * 変換が途中で壊れる（「にほんご」と打てない）。確定時にまとめて拾う。
                         */
                        onCompositionStart={() => { this.searchComposing = true; }}
                        onCompositionEnd={event => {
                            this.searchComposing = false;
                            this.applySearchQuery(event.currentTarget.value, true);
                        }}
                        /* 変換が中断されて compositionend が来なくても入力不能にならないよう、
                           フォーカスが外れたら必ず解除する。 */
                        onBlur={event => {
                            if (!this.searchComposing) return;
                            this.searchComposing = false;
                            this.applySearchQuery(event.currentTarget.value, true);
                        }}
                        onChange={event => this.applySearchQuery(event.target.value, !this.searchComposing)}
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
                    {this.topView === 'materials' && this.workflow.workspaceRoot && this.materialsPane.renderMaterialsMenuButton()}
                </div>
            </div>
        );
    }

    protected renderMaterialsTab(): React.ReactNode {
        return this.materialsPane.renderMaterialsTab();
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

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

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
        this.syncSearchInput();
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
                            {hits.slice(0, CATALOG_RENDER_LIMIT).map((hit, index) => {
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
                            {hits.length > CATALOG_RENDER_LIMIT && (
                                <p data-akari-library-search-limit={hits.length - CATALOG_RENDER_LIMIT}
                                    style={{ opacity: 0.7, fontSize: '0.78em', padding: '4px 2px 0', margin: 0 }}>
                                    ほかに {(hits.length - CATALOG_RENDER_LIMIT).toLocaleString()} 件あります。言葉を足して絞り込んでください。
                                </p>
                            )}
                        </div>
                        : <p style={{ opacity: 0.7, padding: '12px 6px' }}>条件に一致するライブラリ項目がありません。</p>}
                </div>
            );
        }
        return (
            <div data-akari-library-home style={{ padding: '2px 8px 12px' }}>
                {/*
                  * 段の見出し（「よく使う」「そざい」等）は置かない — 2026-09-27 オーナー指示
                  * 「名前を付けようとするたび不自然になるので、名前ごとやめて細い線で区切る」。
                  * 区切りは `startsGroup` を持つタイルの直前に 1 本だけ入れる。
                  */}
                <section style={{ marginTop: '10px' }} data-akari-library-primary-tiles>
                    {(LIBRARY_PRIMARY_TILES as readonly LibraryPrimaryTile[]).reduce<{ rows: React.ReactNode[]; group: React.ReactNode[] }>((acc, tile, index) => {
                        if (tile.startsGroup && acc.group.length) {
                            acc.rows.push(
                                <div key={`tiles-${acc.rows.length}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '4px' }}>{acc.group}</div>,
                                <div key={`rule-${acc.rows.length}`} data-akari-library-tile-rule className='akari-library-tile-rule' />
                            );
                            acc.group = [];
                        }
                        acc.group.push(this.renderLibraryPrimaryTile(tile));
                        if (index === LIBRARY_PRIMARY_TILES.length - 1) {
                            acc.rows.push(
                                <div key={`tiles-${acc.rows.length}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '4px' }}>{acc.group}</div>
                            );
                        }
                        return acc;
                    }, { rows: [], group: [] }).rows}
                </section>
                {this.renderRecentLibraryStrip()}
                <button type='button' data-akari-library-details-toggle aria-expanded={this.libraryDetailsOpen}
                    onClick={event => { event.stopPropagation(); this.toggleLibraryDetails(); }}
                    style={{
                        width: '100%', marginTop: '10px', padding: '7px 8px', textAlign: 'left', cursor: 'pointer',
                        borderRadius: `${AKARI_RADIUS.panel}px`, background: AKARI_SURFACE.raised,
                        color: AKARI_INK, border: AKARI_BORDER.ghost, fontSize: '0.75em'
                    }}>
                    {this.libraryDetailsOpen ? '▾ 詳細をたたむ' : '▸ 詳細（マイ）'}
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

    /**
     * 台座 1 枚ぶんの通し番号。絵の中のグラデ・フィルタ・クリップは id で参照するので、
     * 同じ絵を何枚並べても衝突しないよう `{I}` をここで置換する。
     */
    protected tilePlateSeq = 0;

    protected renderLibraryTilePlate(tile: LibraryPrimaryTile, face: 'front' | 'back'): React.ReactNode {
        const art = LIBRARY_TILE_ART[tile.art];
        const id = ++this.tilePlateSeq;
        const svg = '<svg viewBox="0 0 48 48" aria-hidden="true">'
            + (LIBRARY_TILE_SHARED_DEFS + (art ? art[face] : '')).replace(/\{I\}/g, String(id))
            + '</svg>';
        return (
            <span
                key={face}
                aria-hidden='true'
                draggable={false}
                className={`akari-library-tile-plate akari-tile-${face}`}
                style={{ ['--akari-tile-c1' as string]: tile.plate[0], ['--akari-tile-c2' as string]: tile.plate[1] }}
                // 絵は本ソース内のリテラル（library-tile-art.ts）だけ。外部入力は混ざらない。
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        );
    }

    /**
     * 主要タイル（2026-09-27 オーナー検収の 2 枚重ねカード）。
     * 表と裏で別の絵を重ね、ホバーで裏が右へ傾いて開く。動きは CSS
     * （`style/library-tiles.css`）が持ち、ここは構造と配線だけ。
     * hint は出さない — 9 枚すべてに「一覧から選ぶ」が並んで情報量が無かったため。
     */
    protected renderLibraryPrimaryTile(tile: LibraryPrimaryTile): React.ReactNode {
        const soon = tile.status === 'soon';
        return (
            <button key={tile.key} type='button' disabled={soon} aria-disabled={soon ? 'true' : undefined}
                className='akari-library-tile'
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
                    if (tile.key === 'text') {
                        this.libraryCategory = undefined;
                        this.catalogCategory = 'all';
                        this.libraryTextLookOpen = true;
                        this.node.tabIndex = -1;
                        this.node.focus();
                        this.update();
                    }
                    else this.selectLibraryCategory(tile.key);
                }}>
                <span className='akari-library-tile-art' draggable={false}>
                    {this.renderLibraryTilePlate(tile, 'back')}
                    {this.renderLibraryTilePlate(tile, 'front')}
                </span>
                <span draggable={tile.key === 'text' ? false : undefined}
                    className='akari-library-tile-label'>{tile.label}</span>
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
        this.ensureLibraryStyleFonts();
        const styleItems = this.filteredPresetShowcaseItems('textstyle');
        const motionItems = this.filteredPresetShowcaseItems('textanim');
        const fontItems = this.filteredCatalogItems().filter(item => item.category === 'font');
        const telopItems = textTelopItems(this.filteredCatalogItems());
        return <LibraryTextTelopPage onBack={() => this.showLibraryHome()} onPlace={() => { void this.placeLibraryText(); }}
            tab={this.libraryTextTab} onTabChange={tab => { this.libraryTextTab = tab; this.update(); }}
            styles={styleItems.map(item => this.renderPresetShowcaseCard(item))}
            myStyles={this.renderMyStyles()}
            motions={motionItems.map(item => this.renderPresetShowcaseCard(item))}
            telops={telopItems.map(item => <LibraryAssetCard key={item.key}
                {...this.libraryAssetCardProps(item, 'grid', {}, undefined, true)}
                onPreview={() => { if (!this.showPremiumPrompt(item.key)) void this.addCatalogAssetAtPlayhead(item); }} />)}
            fonts={fontItems.map(item => this.generationPick.request ? this.renderCatalogItem(item)
                : <LibraryTextFontRow key={item.key} item={item} faceFamily={this.libraryStyleFontFaces.get(item.id)}
                    card={this.renderCatalogItem(item) as React.ReactElement<React.ComponentProps<typeof FontShelfCard>>} />)} />;
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
        const filtered = catalogItemsWithoutShelvedTelops(this.filteredCatalogItems(), this.catalogCategory, this.catalogQuery);
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
            const shown = filtered.slice(0, CATALOG_RENDER_LIMIT);
            const hidden = filtered.length - shown.length;
            content = (
                <>
                    <div style={{ ...itemContainerStyle, paddingTop: '10px', paddingBottom: '10px' }}>
                        {shown.map(item => this.renderCatalogItem(item))}
                    </div>
                    {hidden > 0 && (
                        <p data-akari-catalog-render-limit={hidden}
                            style={{ opacity: 0.7, fontSize: '0.78em', padding: '0 10px 10px', margin: 0 }}>
                            ほかに {hidden.toLocaleString()} 件あります。検索やカテゴリーで絞り込んでください。
                        </p>
                    )}
                </>
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
                    {this.libraryPane.renderCatalogDeveloperLinkRow()}
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
                <div style={{ padding: '0 10px 10px' }}>{this.libraryPane.renderCatalogDeveloperLinkRow()}</div>
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
                <div style={{ marginTop: 'auto', padding: '8px 10px 10px' }}>{this.libraryPane.renderCatalogDeveloperLinkRow()}</div>
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
                        onClick={() => void this.loadAssetCatalogView('user')}
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
                payload: item.kind === 'textstyle' ? libraryTextstyleApplyPayload(item) : presetApplyPayload(item),
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
        const productId = (item as AssetCatalogViewItem & { product_id?: string }).product_id;
        this.windowService.openNewWindow(storeProductUrl(this.storeConnection.url, productId ?? item.id), { external: true });
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
                    this.syncSearchInput();
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
            await this.loadAssetCatalogView('user');
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

    protected libraryStyleFontsRequested = false;
    protected libraryStyleFontFaces = new Map<string, string>();

    protected ensureLibraryStyleFonts(): void {
        if (this.libraryStyleFontsRequested || !this.materialPreviewService) return;
        this.libraryStyleFontsRequested = true;
        void this.materialPreviewService.getOverlayRuntimeAssetUrls().then(assets => {
            this.libraryStyleFontFaces = new Map([...assets.bundledCaptionFontFaces,
                { id: 'noto-sans-jp', family: CAPTION_FONT_FAMILY }].map(face => [face.id, face.family]));
            const style = document.createElement('style');
            style.setAttribute('data-akari-library-style-fonts', '');
            style.textContent = [...assets.bundledCaptionFontFaces,
                { id: 'noto-sans-jp', family: CAPTION_FONT_FAMILY, weight: '100 900', url: assets.captionFontUrl }]
                .filter(face => face.id !== 'noto-sans-jp')
                .map(face => `@font-face{font-family:${JSON.stringify(face.family)};`
                    + `src:url(${JSON.stringify(face.url)}) format('truetype');`
                    + `font-weight:${face.id === 'noto-serif-jp' ? '200 900' : face.weight};font-display:swap}`)
                .join('\n') + '\n' + captionFontFaceCss(assets.captionFontUrl);
            document.head.append(style);
            this.toDispose.push({ dispose: () => style.remove() });
            void document.fonts.ready.then(() => this.update());
        }).catch(() => { this.libraryStyleFontsRequested = false; });
    }

    protected renderMyStyles(): React.ReactNode {
        this.ensureLibraryStyleFonts();
        const query = this.catalogQuery.trim().toLocaleLowerCase();
        const styles = this.myStyles.filter(style => (!query || `${style.name} ${style.when_to_use}`.toLocaleLowerCase().includes(query))
            && this.presetPassesLibraryFilter(`mystyle/${style.id}`, 'own'));
        return <section data-akari-my-style-shelf>
            <div style={{ padding: '7px 10px', fontSize: '0.76em', fontWeight: 700, borderBottom: AKARI_BORDER.hairline }}>マイスタイル</div>
            {styles.length === 0 && <p style={{ opacity: 0.7, padding: '8px 10px', fontSize: '0.78em' }}>保存したスタイルはまだありません。</p>}
            <div style={{ display: 'grid', gridTemplateColumns: CATALOG_GRID_COLUMNS, gap: CATALOG_GRID_GAP, padding: '8px 10px' }}>
                {styles.map(style => {
                    const look = style.parts.find(part => part.kind === 'look')?.text_style;
                    const sampleStyle = libraryTextStyleSample(
                        look && typeof look === 'object' && !Array.isArray(look) ? look as Record<string, unknown> : {}
                    ) as React.CSSProperties;
                    const key = `mystyle/${style.id}`;
                    const target: LibraryMenuTarget = { kind: 'mystyle', key };
                    const info = this.libraryInfo?.target;
                    return <LibrarySimpleCard key={style.id} cardKey={key} name={style.name} layout='grid' faceHeight='48px'
                        title={`${style.name} — ${style.when_to_use}`}
                        favorite={this.libraryFavorites.has(key)}
                        infoOpen={info?.kind === 'mystyle' && info.key === key}
                        attributes={{ 'data-akari-my-style-card': style.id, 'data-akari-style-card': `mystyle/${style.id}` }}
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
                        face={<StyleSpecimen style={sampleStyle} myStyle />} />;
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
        if (item.kind === 'textstyle') this.ensureLibraryStyleFonts();
        const key = `${item.kind}/${item.id}`;
        const target: LibraryMenuTarget = { kind: item.kind, key };
        const textstyle = item.kind === 'textstyle';
        const info = this.libraryInfo?.target;
        return <LibrarySimpleCard key={key} cardKey={key} name={item.name} layout={layout}
            faceHeight={textstyle && layout === 'grid' ? '48px' : undefined}
            title={this.presetShowcaseTitle(item)}
            favorite={this.libraryFavorites.has(key)}
            infoOpen={info?.kind === item.kind && info.key === key}
            attributes={{
                'data-akari-catalog-preset-item': key,
                'data-akari-catalog-item': textstyle ? `textstyle/${item.id}` : undefined,
                'data-akari-style-card': textstyle ? item.id : undefined,
                'data-akari-preset-origin': item.origin === 'library' ? 'library' : undefined,
                'data-akari-catalog-preset-list-row': layout === 'list' ? true : undefined
            }}
            badge={item.origin === 'library' ? 'ライブラリ' : undefined}
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
                : textstyle
                ? <StyleSpecimen style={libraryTextStyleSample(item.style ?? {}) as React.CSSProperties} />
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
            onThumbnailError: () => this.handleCatalogThumbnailError(item),
            onPreview: interactive ? () => { void this.previewCatalogItem(item); } : undefined
        };
    }

    /**
     * カード本体のクリック = 素材のプレビュー。素材タブのカード（openFile）と同じ感覚で
     * 開けるようにする。⋯ は情報カード、右クリックは操作メニューのまま。
     * 実体 URL（mediaUrl）があればそれを、無ければサムネイル（previewUrl）を開く。
     */
    protected async previewCatalogItem(item: AssetCatalogViewItem): Promise<void> {
        const source = item.mediaUrl ?? item.previewUrl;
        if (!source) {
            this.messages.info(`「${item.title}」はまだ手元に無いので開けません。⋯ から取り寄せてください。`);
            return;
        }
        try {
            await this.openFile(new URI(source));
        } catch (error) {
            this.messages.warn(`プレビューを開けませんでした: ${error instanceof Error ? error.message : String(error)}`);
        }
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

    protected renderLintBadge(): React.ReactNode {
        if (!this.lintAvailable) {
            return undefined;
        }
        const label = this.lintRunning ? '確認中…' : this.lintCount === undefined ? '未実行' : `${this.lintCount} 件`;
        return (
            <div style={{ flex: '0 0 auto', borderTop: AKARI_BORDER.hairline, padding: '6px' }}>
                <button
                    className='theia-button secondary'
                    data-akari-lint-running={this.lintRunning ? 'true' : undefined}
                    disabled={this.lintRunning}
                    title='クリックして再実行'
                    onClick={() => void this.refreshLint(true)}
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
