import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { CommandService, DisposableCollection, MessageService } from '@theia/core/lib/common';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { QuickInputService } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariPreviewService } from 'akari-preview/lib/common/akari-preview-protocol';
import { FileChangesEvent, FileStat } from '@theia/filesystem/lib/common/files';
import { AkariProjectService, AssetBundleOutcome, AssetCatalogViewItem, ProjectAssetReference, TranscriptState } from '../common/akari-project-protocol';
import { AkariWorkflowService } from './akari-workflow-service';
import { MaterialCardHoverPreview } from './material-card-hover-preview';
import { GenerationPickCandidate, GenerationPickController } from '../common/generation-pick';
import { shouldShowProjectPath } from '../common/project-tree-policy';
import { isUnorganizedRootEntry } from '../common/unorganized-materials';
import { isEditDataFileName } from '../common/edit-data-file';
import { nextCandidateAssetName } from '../common/asset-naming';
import { isTimelineEditFileName } from '../common/timeline-edit-file-name';
import { countReferences } from '../common/project-reference-check';
import { AnalysisJson, deriveAnalysisDurationSeconds, formatDurationBadge } from '../common/analysis-summary';
import { CatalogItemMeta, parseCatalogItemMeta } from '../common/catalog-reader';
import { AssetBinChildNode, isAssetBinGroupDirectory } from '../common/asset-bin-grouping';
import { MaterialKind, resolveAssetGroupMedia } from '../common/asset-group-media';
import { DEFAULT_MATERIALS_SORT, isMaterialsList, MATERIALS_KINDS, MATERIALS_SORT_OPTIONS, MaterialsMode, MaterialsSort, materialStripCells, visibleMaterials } from '../common/materials-view';
import { MaterialStrip } from './material-strip';
import { MaterialRangeHandles } from './material-range-handles';
import { MaterialRange } from '../common/material-range';
import { applyMaterialViewPatch, filterMaterials, MaterialViewKind, MaterialViewPatch, MaterialViewState, sortMaterials } from '../common/material-view';
import { referencePresentation } from '../common/project-asset-reference';
import { materialCardLayout, mergeMaterialCardMeta } from '../common/material-card-layout';
import { AKARI_MATERIAL_SELECTED_EVENT } from '../common/material-selected-event';
import { resolveLibraryAssetMedia } from '../common/library-asset-placement';
import { assetGroupOpenTarget } from '../common/asset-group-open-target';
import { AKARI_BORDER, AKARI_FAINT, AKARI_INK, AKARI_PROJECT_LINE, AKARI_PROJECT_SURFACE, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';
import { MaterialContextMenuItem } from '../common/material-context-menu-items';
import { LibraryImportResult } from '../common/library-import';
import { composeMaterialAskAgentPrompt } from '../common/agent-context-packet';
import { AKARI_SHOW_ASSET_INFO } from './akari-reveal-commands';
import { openAkariContextMenu } from './akari-context-menu';

const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';
const TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID = 'akari.timeline.addMaterialAtPlayhead';

export interface MaterialCardEntry {
    uri: URI;
    relativePath: string;
    /** グループの主メディア。ドラッグとタイムライン追加だけに使う。 */
    mediaRelativePath?: string;
    name: string;
    kind: MaterialKind;
    analyzed: boolean;
    durationSeconds?: number;
    createdAt?: string;
    importedAt?: string;
    thumbnailUri?: URI;
    stripUri?: URI;
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

/**
 * プロジェクト直下の契約ファイル（edit.json 等）・アトミック書き込みの一時ファイル・
 * .akari/ 配下は素材一覧に無関係（素材一覧は assets/ 配下しか見ない）。
 * これらの変更で素材パネルを再読込しない（task 2026-08-18-shell-panel-reload-spinner 指示1）。
 */
const MATERIALS_IRRELEVANT_ROOT_FILES = new Set(['edit.json', 'captions.json', 'analysis.json', '.akari']);
function isMaterialsIrrelevantRootFile(baseName: string): boolean {
    return isEditDataFileName(baseName) || MATERIALS_IRRELEVANT_ROOT_FILES.has(baseName) || baseName.endsWith('.tmp');
}

// 素材カード D&D（task 2026-08-10-material-dnd-timeline 司令塔裁定4）。mime 文字列・
// イベント名は受け側（akari-annotations-widget.ts）と独立にリテラル宣言する
// （PREVIEW_PLAYBACK_TICK_EVENT と同じ流儀 — 拡張間の npm 依存を作らない）。
const MATERIAL_DRAG_MIME = 'application/x-akari-material';
const MATERIAL_DRAG_START_EVENT = 'akari.material.dragStart';
const MATERIAL_DRAG_END_EVENT = 'akari.material.dragEnd';

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

export interface MaterialsPaneHost {
    /** 現在のプロジェクトと相対パス。 */
    readonly workflow: Pick<AkariWorkflowService, 'workspaceRoot' | 'relativePath' | 'current'>;
    /** 素材一覧の読み込みと監視。 */
    readonly files: FileService;
    /** 参照素材、クレジット、文字起こし状態とサムネイル。 */
    readonly projectService: Pick<AkariProjectService, 'listProjectAssetReferences' | 'projectCredits' | 'transcriptStates' | 'resolveMaterialThumbnail' | 'resolveMaterialStrip' | 'materialMeta' | 'readUiState' | 'readMaterialRanges' | 'bundleProjectAssets' | 'resolveAsset' | 'removeProjectAssetReference' | 'planLibraryImport' | 'applyLibraryImport' | 'transcribeMaterial'>;
    /** 素材操作の通知。 */
    readonly messages: Pick<MessageService, 'info' | 'warn' | 'error'>;
    /** 素材移動中の確認。 */
    readonly commandService: Pick<CommandService, 'executeCommand'>;
    /** 素材カードのホバープレビュー。 */
    readonly materialPreviewService: AkariPreviewService;
    readonly workspaceService: WorkspaceService;
    readonly quickInputService: Pick<QuickInputService, 'input'>;
    /** widget の再描画。 */
    readonly update: () => void;
    /** ファイル名から素材種別を判定。 */
    readonly classifyKind: (name: string) => MaterialKind;
    /** 素材グループの子を取得。 */
    readonly toAssetBinChildren: (node: FileStat) => AssetBinChildNode[];
    readonly placeholderIcon: (kind: MaterialKind) => string;
    readonly openFile: (uri: URI) => Promise<void>;
    readonly openMaterialContextMenu: (event: React.MouseEvent<HTMLDivElement>, entry: MaterialCardEntry) => void;
    readonly generationPickCardProps: (candidate: GenerationPickCandidate) => React.HTMLAttributes<HTMLDivElement>;
    readonly renderGenerationPickBadge: (candidate: GenerationPickCandidate) => React.ReactNode;
    readonly reportLibraryImportResult: (result: LibraryImportResult) => void;
    readonly loadAssetCatalogView: (intent?: 'automatic' | 'user') => Promise<void>;
    readonly materialQuery: string;
    readonly generationPick: GenerationPickController;
    /** カタログ素材の現在の一覧。 */
    readonly assetCatalogItems: AssetCatalogViewItem[];
}

export class AkariMaterialsPane {
    public materials: MaterialCardEntry[] = [];
    public unorganizedMaterials: MaterialCardEntry[] = [];
    public materialsLoading = false;
    public materialsLoadedOnce = false;
    protected materialsGeneration = 0;
    protected metaHydratedGeneration = 0;
    protected materialsWatch = new DisposableCollection();
    protected materialsWatchRootKey?: string;
    protected materialsWatchTimer?: ReturnType<typeof setTimeout>;
    public referenceWatches = new DisposableCollection();
    protected referenceWatchRoot = '';
    protected referenceWatchParents = new Set<string>();
    protected filter: string[] = [];
    protected sort: MaterialsSort = DEFAULT_MATERIALS_SORT;
    protected mode: MaterialsMode = 'grid';
    protected commandKinds?: readonly MaterialViewKind[];
    protected commandSort?: MaterialViewState['sort'];
    protected viewRootKey?: string;
    protected materialRanges: Record<string, MaterialRange> = {};
    protected rangeSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    protected rangeSavesInFlight = new Map<string, Promise<unknown>>();
    protected materialRangeRevision = 0;
    protected materialRangeRevisions = new Map<string, number>();
    protected readonly materialRangeSource = 'materials-pane';

    constructor(protected readonly host: MaterialsPaneHost) {
        window.addEventListener('akari.materials.range.changed', event => {
            const detail = (event as CustomEvent<{ relativePath: string; range: MaterialRange | null; source?: string }>).detail;
            if (!detail || typeof detail.relativePath !== 'string') return;
            if (detail.source === this.materialRangeSource) return;
            const current = this.materialRanges[detail.relativePath];
            const root = this.host.workflow.workspaceRoot;
            const timerKey = root ? `${root.toString()}\n${detail.relativePath}` : '';
            const pending = this.rangeSaveTimers.get(timerKey);
            if (pending) {
                clearTimeout(pending);
                this.rangeSaveTimers.delete(timerKey);
            }
            this.materialRangeRevisions.set(timerKey, ++this.materialRangeRevision);
            if (current?.in === detail.range?.in && current?.out === detail.range?.out) return;
            if (!current && !detail.range) return;
            if (detail.range) this.materialRanges[detail.relativePath] = detail.range;
            else delete this.materialRanges[detail.relativePath];
            this.host.update();
        });
    }

    protected rangePath(entry: MaterialCardEntry): string {
        return entry.mediaRelativePath ?? entry.relativePath;
    }

    protected changeMaterialRange(entry: MaterialCardEntry, range: MaterialRange | null): void {
        const root = this.host.workflow.workspaceRoot;
        if (!root) return;
        const relativePath = this.rangePath(entry);
        const timerKey = `${root.toString()}\n${relativePath}`;
        this.materialRangeRevisions.set(timerKey, ++this.materialRangeRevision);
        if (range) this.materialRanges[relativePath] = range;
        else delete this.materialRanges[relativePath];
        this.host.update();
        window.dispatchEvent(new CustomEvent('akari.materials.range.changed', {
            detail: { relativePath, range, source: this.materialRangeSource }
        }));
        const previous = this.rangeSaveTimers.get(timerKey);
        if (previous) clearTimeout(previous);
        this.rangeSaveTimers.set(timerKey, setTimeout(() => {
            this.rangeSaveTimers.delete(timerKey);
            const save = this.host.commandService.executeCommand('akari.materials.range.set', {
                projectUri: root.toString(), relativePath, range, source: this.materialRangeSource
            });
            this.rangeSavesInFlight.set(timerKey, save);
            void save.catch(error => this.host.messages.warn(`範囲を保存できませんでした: ${String(error)}`))
                .finally(() => {
                    if (this.rangeSavesInFlight.get(timerKey) === save) this.rangeSavesInFlight.delete(timerKey);
                });
        }, 150));
    }

    public hydrateVisibleMaterialStrips(): void {
        const root = this.host.workflow.workspaceRoot;
        if (root && isMaterialsList(this.mode) && this.metaHydratedGeneration === this.materialsGeneration)
            void this.hydrateMaterialStrips(root, this.materialsGeneration);
    }

    public setMaterialView(patch: { filter?: string[]; sort?: MaterialsSort; mode?: MaterialsMode }): void {
        if (patch.filter) this.commandKinds = undefined;
        if (patch.sort) this.commandSort = undefined;
        if (patch.filter) this.filter = MATERIALS_KINDS.filter(kind => patch.filter!.includes(kind));
        if (patch.sort && MATERIALS_SORT_OPTIONS.includes(patch.sort)) this.sort = patch.sort;
        if (patch.mode) this.mode = patch.mode;
        this.host.update();
        const root = this.host.workflow.workspaceRoot;
        if (root && isMaterialsList(this.mode) && this.metaHydratedGeneration === this.materialsGeneration) {
            void this.hydrateMaterialStrips(root, this.materialsGeneration);
        }
    }

    public getMaterialView(): { filter: string[]; sort: MaterialsSort; mode: MaterialsMode } {
        const sort = this.commandSort?.by === 'name' ? 'name'
            : this.commandSort?.by === 'duration' ? 'dur'
                : this.commandSort?.by === 'created' ? 'created' : this.sort;
        return { filter: [...this.filter], sort, mode: this.mode };
    }

    public getVoiceMaterialView(): MaterialViewState & { legacySort?: MaterialsSort; mode: MaterialsMode } {
        const sort = this.commandSort ?? (this.sort === 'name' ? { by: 'name', order: 'asc' } as const
            : this.sort === 'dur' ? { by: 'duration', order: 'desc' } as const
                : { by: 'created', order: this.sort === 'imported-asc' ? 'asc' : 'desc' } as const);
        return { kinds: [...(this.commandKinds ?? this.filter)] as MaterialViewKind[], sort: { ...sort },
            legacySort: this.commandSort ? undefined : this.sort, mode: this.mode };
    }

    public setVoiceMaterialView(patch: MaterialViewPatch) {
        const previous = this.getVoiceMaterialView();
        const result = applyMaterialViewPatch(previous, patch);
        if (patch.kinds) {
            this.commandKinds = result.applied.kinds;
            this.filter = [...result.applied.kinds];
        }
        if (patch.legacySort && MATERIALS_SORT_OPTIONS.includes(patch.legacySort as MaterialsSort)) {
            this.sort = patch.legacySort as MaterialsSort;
            this.commandSort = undefined;
        } else if (patch.sort) this.commandSort = result.applied.sort;
        if (patch.mode) this.mode = patch.mode;
        this.host.update();
        return { applied: this.getVoiceMaterialView(), previous };
    }

    public async loadMaterials(): Promise<void> {
        const root = this.host.workflow.workspaceRoot;
        const rootKey = root?.toString();
        if (rootKey !== this.viewRootKey) {
            this.materialRanges = {};
            this.viewRootKey = rootKey;
            this.filter = [];
            this.sort = DEFAULT_MATERIALS_SORT;
            this.commandKinds = undefined;
            this.commandSort = undefined;
            if (root) void this.host.projectService.readUiState(root.toString()).then(state => {
                if (this.viewRootKey !== rootKey) return;
                const pane = state.materialsPane;
                if (!pane || typeof pane !== 'object' || Array.isArray(pane)) return;
                const saved = pane as { filter?: unknown; sort?: unknown };
                this.setMaterialView({
                    filter: Array.isArray(saved.filter) ? saved.filter.filter((kind): kind is string => typeof kind === 'string') : [],
                    sort: typeof saved.sort === 'string' && MATERIALS_SORT_OPTIONS.includes(saved.sort as MaterialsSort)
                        ? saved.sort as MaterialsSort : DEFAULT_MATERIALS_SORT
                });
            }).catch(() => undefined);
        }
        const generation = ++this.materialsGeneration;
        if (!root) {
            this.referenceWatches.dispose();
            this.materials = [];
            this.projectCreditLines = [];
            this.unorganizedMaterials = [];
            this.materialsLoadedOnce = false;
            this.host.update();
            return;
        }
        this.materialsLoading = true;
        this.host.update();
        const rangeReadRevision = this.materialRangeRevision;
        const rangeReadProtectedKeys = new Set([...this.rangeSaveTimers.keys(), ...this.rangeSavesInFlight.keys()]);
        void this.host.projectService.readMaterialRanges(root.toString()).then(ranges => {
            if (generation !== this.materialsGeneration) return;
            const merged = { ...ranges };
            const prefix = `${root.toString()}\n`;
            for (const [key, revision] of this.materialRangeRevisions) {
                if (!key.startsWith(prefix) || (revision <= rangeReadRevision && !rangeReadProtectedKeys.has(key)
                    && !this.rangeSaveTimers.has(key) && !this.rangeSavesInFlight.has(key))) continue;
                const path = key.slice(prefix.length);
                if (Object.prototype.hasOwnProperty.call(this.materialRanges, path)) merged[path] = this.materialRanges[path];
                else delete merged[path];
            }
            this.materialRanges = merged;
            this.host.update();
        }).catch(() => undefined);
        const [assetEntries, rootFiles, references, credits] = await Promise.all([
            this.collectAssetEntries(root.resolve('assets')),
            this.collectUnorganizedRootFiles(root),
            this.host.projectService.listProjectAssetReferences(root.toString()),
            this.host.projectService.projectCredits(root.toString()).catch(() => [] as string[])
        ]);
        const [fileMaterials, groupMaterials, unorganizedMaterials] = await Promise.all([
            Promise.all(assetEntries.files.map(file => this.buildMaterialEntry(root, file, false))),
            Promise.all(assetEntries.assetGroups.map(dir => this.buildAssetGroupEntry(root, dir))),
            Promise.all(rootFiles.map(file => this.buildMaterialEntry(root, file, true)))
        ]);
        const states = await this.host.projectService.transcriptStates({
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
        for (const parent of libraryParents) this.referenceWatches.push(this.host.files.watch(new URI(parent), { recursive: true, excludes: [] }));
        this.referenceWatches.push(this.host.files.onDidFilesChange(event => {
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
        this.host.update();
        void this.hydrateCachedThumbnails(root, generation, [...materials, ...unorganizedMaterials]);
        void this.hydrateMaterialMeta(root, generation, [...materials, ...unorganizedMaterials]).then(() => {
            if (generation !== this.materialsGeneration) return;
            this.metaHydratedGeneration = generation;
            if (isMaterialsList(this.mode)) void this.hydrateMaterialStrips(root, generation);
        });
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
            stat = await this.host.files.resolve(assetsRoot);
        } catch {
            return { files: [], assetGroups: [] };
        }
        const files: FileStat[] = [];
        const assetGroups: FileStat[] = [];
        const walk = async (node: FileStat): Promise<void> => {
            for (const child of node.children ?? []) {
                const relative = this.host.workflow.relativePath(child.resource);
                if (!shouldShowProjectPath(relative, this.host.workflow.current.tree, false)) {
                    continue;
                }
                if (!child.isDirectory) {
                    files.push(child);
                    continue;
                }
                let resolvedChild: FileStat;
                try {
                    resolvedChild = await this.host.files.resolve(child.resource);
                } catch {
                    continue; // Directory disappeared mid-walk; skip it.
                }
                if (isAssetBinGroupDirectory(this.host.toAssetBinChildren(resolvedChild))) {
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

    /**
     * プロジェクトルート**直下**（非再帰）の未整理素材を集める。判定は
     * unorganized-materials.ts の純関数（project-tree-policy.ts の既存ノイズ判定 +
     * ルート直下契約 JSON の除外）に委ねる。
     */
    protected async collectUnorganizedRootFiles(root: URI): Promise<FileStat[]> {
        let stat: FileStat;
        try {
            stat = await this.host.files.resolve(root);
        } catch {
            return [];
        }
        const policy = this.host.workflow.current.tree;
        const result = (stat.children ?? []).filter(child =>
            isUnorganizedRootEntry({ name: child.resource.path.base, isDirectory: child.isDirectory }, policy)
        );
        result.sort((left, right) => left.resource.path.base.localeCompare(right.resource.path.base, 'ja'));
        return result;
    }

    protected async buildMaterialEntry(root: URI, file: FileStat, unorganized: boolean): Promise<MaterialCardEntry> {
        const relativePath = this.host.workflow.relativePath(file.resource) ?? file.resource.path.base;
        const kind = this.host.classifyKind(file.resource.path.base);
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
                const local = await this.host.files.resolve(root.resolve(state.relativePath));
                const files = this.host.toAssetBinChildren(local).filter(child => !child.isDirectory)
                    .map(child => ({ name: child.name, path: '', bytes: 0 }));
                if (!referencePresentation({ ...reference, files }).missing) continue;
            } catch { /* No local group: use the ledger. */ }
            let card: MaterialCardEntry | undefined;
            if (reference.libraryDir) {
                try {
                    const directory = await this.host.files.resolve(URI.fromFilePath(reference.libraryDir));
                    // Only expose files accepted by the node containment check.
                    const allowed = new Set(reference.files.filter(file => !file.name.includes('/')).map(file => file.name));
                    card = await this.buildAssetGroupEntry(root, { ...directory,
                        children: directory.children?.filter(child => !child.isDirectory && allowed.has(child.resource.path.base)) });
                }
                catch { /* A disappeared directory stays visible as a missing reference. */ }
            }
            const known = this.host.assetCatalogItems.find(item => item.key === `${reference.category}/${reference.id}`);
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
        const relativePath = this.host.workflow.relativePath(dirStat.resource) ?? dirStat.resource.path.base;
        const dirName = dirStat.resource.path.base;
        const meta = await this.readAssetGroupMeta(dirStat);
        const media = resolveAssetGroupMedia(meta?.category, this.host.toAssetBinChildren(dirStat));
        const children = dirStat.children ?? [];
        const previewChild = children.find(child => !child.isDirectory && child.resource.path.base === 'preview.png');
        const metaChild = children.find(child => !child.isDirectory && child.resource.path.base === 'meta.json');
        const openUri = dirStat.resource.resolve(assetGroupOpenTarget(this.host.toAssetBinChildren(dirStat), meta?.category)
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
            const content = await this.host.files.readFile(metaChild.resource);
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
                outcome = await this.host.projectService.resolveMaterialThumbnail(root.toString(), entry.relativePath, entry.kind as 'video' | 'image' | 'audio');
            } catch {
                return;
            }
            if (generation !== this.materialsGeneration || !outcome.available || !outcome.cacheRelativePath) {
                return;
            }
            entry.thumbnailUri = root.resolve(outcome.cacheRelativePath);
            this.host.update();
        }));
    }

    protected async hydrateMaterialMeta(root: URI, generation: number, entries: MaterialCardEntry[]): Promise<void> {
        const candidates = entries.filter(entry => !entry.assetGroup && !entry.reference);
        if (candidates.length === 0) return;
        for (let start = 0; start < candidates.length; start += 20) {
            if (generation !== this.materialsGeneration) return;
            const batch = candidates.slice(start, start + 20);
            try {
                const metadata = await this.host.projectService.materialMeta(root.toString(), batch.map(entry => entry.relativePath));
                if (generation !== this.materialsGeneration) return;
                for (const entry of batch) {
                    const meta = metadata[entry.relativePath];
                    if (meta) Object.assign(entry, mergeMaterialCardMeta(entry, meta));
                }
                this.host.update();
            } catch {
                // Metadata is supplemental; continue with later batches.
            }
        }
    }

    protected async hydrateMaterialStrips(root: URI, generation: number): Promise<void> {
        const candidates = [
            ...visibleMaterials(this.materials, this.filter, this.host.materialQuery, this.sort),
            ...visibleMaterials(this.unorganizedMaterials, this.filter, this.host.materialQuery, this.sort)
        ].filter(entry => !entry.stripUri && !entry.assetGroup && !entry.reference
            && (entry.kind === 'video' || entry.kind === 'audio'));
        for (let start = 0; start < candidates.length; start += 20) {
            if (generation !== this.materialsGeneration || !isMaterialsList(this.mode)) return;
            const batch = candidates.slice(start, start + 20);
            await Promise.all(batch.map(async entry => {
                try {
                    const outcome = await this.host.projectService.resolveMaterialStrip(root.toString(), entry.relativePath,
                        { cells: materialStripCells(entry.durationSeconds), cellWidth: 80 });
                    if (generation === this.materialsGeneration && isMaterialsList(this.mode)
                        && outcome.available && outcome.cacheRelativePath) {
                        entry.stripUri = root.resolve(outcome.cacheRelativePath);
                        this.host.update();
                    }
                } catch { /* Keep the first thumbnail when strip generation is unavailable. */ }
            }));
        }
    }

    // --- ライブ反映（assets/ とルート直下の watch） ---------------------------

    public ensureMaterialsWatch(): void {
        const root = this.host.workflow.workspaceRoot;
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
        this.materialsWatch.push(this.host.files.watch(root));
        this.materialsWatch.push(this.host.files.watch(root.resolve('.akari'), { recursive: true, excludes: [] }));
        this.materialsWatch.push(this.host.files.watch(assetsUri, { recursive: true, excludes: [] }));
        this.materialsWatch.push(this.host.files.onDidFilesChange(event => this.handleMaterialsFileChange(root, assetsUri, event)));
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

    protected async readAnalysis(analysisUri: URI): Promise<AnalysisJson | undefined> {
        try {
            const content = await this.host.files.readFile(analysisUri);
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

    protected bundleBusy = false;
    protected projectCreditLines: string[] = [];

    /**
     * 「素材をまとめる」の確認ダイアログ本文（2026-09-26 オーナー指示）。
     * 旧文面は件数と MB だけで「何を・どこから・どこへ」が分からなかった。ここでは
     * (1) 何が起きるか（ライブラリの実体をこのプロジェクトの assets/ へ複製する）
     * (2) 対象そのもの（小さなサムネ付きの一覧）
     * の 2 点を出す。`ConfirmDialog` は `msg` に HTMLElement を取れるので素の DOM で組む。
     */
    protected buildBundlePlanBody(plan: AssetBundleOutcome): HTMLElement {
        const body = document.createElement('div');
        Object.assign(body.style, { display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '420px' });

        const lead = document.createElement('p');
        lead.textContent = '次の素材はいまライブラリを「参照」しています。まとめると、実体をこのプロジェクトの'
            + ' assets/ へ複製します。以後はライブラリ側を消したり別のパソコンへ移しても、'
            + 'このプロジェクトだけで開けるようになります。';
        Object.assign(lead.style, { margin: '0', lineHeight: '1.6' });
        body.appendChild(lead);

        const list = document.createElement('ul');
        Object.assign(list.style, {
            listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column',
            gap: '1px', maxHeight: '228px', overflowY: 'auto',
            border: AKARI_BORDER.hairline, borderRadius: `${AKARI_RADIUS.panel}px`
        });
        for (const reference of plan.planned) {
            const row = document.createElement('li');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px',
                background: AKARI_SURFACE.raised
            });
            const preview = reference.files.find(file => file.name === 'preview.png');
            const thumb = document.createElement(preview ? 'img' : 'span');
            Object.assign(thumb.style, {
                width: '22px', height: '22px', flex: '0 0 auto', borderRadius: '3px',
                objectFit: 'cover', background: AKARI_SURFACE.elevated
            });
            if (preview && thumb instanceof HTMLImageElement) {
                thumb.alt = '';
                thumb.src = URI.fromFilePath(preview.path).toString();
                thumb.addEventListener('error', () => { thumb.style.visibility = 'hidden'; });
            }
            const text = document.createElement('div');
            Object.assign(text.style, { minWidth: '0', display: 'flex', flexDirection: 'column', lineHeight: '1.35' });
            const title = document.createElement('span');
            title.textContent = reference.title ?? reference.id;
            Object.assign(title.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
            const where = document.createElement('span');
            const bytes = reference.files.reduce((total, file) => total + (file.bytes || 0), 0);
            where.textContent = `${reference.category} · ${bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '容量不明'}`
                + ` → assets/${reference.category}/${reference.id}/`;
            Object.assign(where.style, { opacity: '0.62', fontSize: '0.82em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
            text.append(title, where);
            row.append(thumb, text);
            list.appendChild(row);
        }
        body.appendChild(list);

        const total = document.createElement('p');
        total.textContent = `合計 ${plan.planned.length} 件・${(plan.bytes / 1024 / 1024).toFixed(2)} MB`
            + (plan.unknownSizeCount ? `（容量不明 ${plan.unknownSizeCount} 件）` : '');
        Object.assign(total.style, { margin: '0', opacity: '0.72' });
        body.appendChild(total);

        if (plan.restrictedCount) {
            const warning = document.createElement('p');
            warning.textContent = `再配布できない素材が ${plan.restrictedCount} 件含まれます`;
            Object.assign(warning.style, { margin: '0', color: 'var(--theia-editorWarning-foreground)' });
            body.appendChild(warning);
        }
        return body;
    }

    protected async bundleMaterials(): Promise<void> {
        const root = this.host.workflow.workspaceRoot;
        if (!root || this.bundleBusy) return;
        this.bundleBusy = true;
        this.host.update();
        try {
            const plan = await this.host.projectService.bundleProjectAssets(root.toString(), true);
            if (this.host.workflow.workspaceRoot?.toString() !== root.toString()) return;
            if (!plan.planned.length) { this.host.messages.info('ライブラリを参照している素材はありません。まとめるものはありません。'); return; }
            const confirmed = await new ConfirmDialog({
                title: 'ライブラリの素材をプロジェクトへ複製する',
                msg: this.buildBundlePlanBody(plan), ok: '複製する', cancel: 'キャンセル'
            }).open();
            if (!confirmed) return;
            if (this.host.workflow.workspaceRoot?.toString() !== root.toString()) return;
            const result = await this.host.projectService.bundleProjectAssets(root.toString(), false);
            if (this.host.workflow.workspaceRoot?.toString() !== root.toString()) return;
            await this.loadMaterials();
            // 結果はパネルに貼り付けず、その場限りの通知で流す（2026-09-26 オーナー指示
            // 「3 件まとめましたが出続けるのが気になる」）。取りこぼしがあるときだけ、
            // 読み返せるようダイアログで残す。
            this.host.messages.info(`${result.materialized.length} 件をこのプロジェクトへ複製しました。`);
            if (result.failures.length) {
                await new ConfirmDialog({
                    title: '複製できなかった素材',
                    msg: `次の素材は参照のまま残っています。\n\n`
                        + result.failures.map(failure => `${failure.key}: ${failure.message}`).join('\n'),
                    ok: '閉じる'
                }).open();
            }
        } catch (error) { this.host.messages.error(`素材をまとめられませんでした: ${String(error)}`); }
        finally { this.bundleBusy = false; this.host.update(); }
    }

    /**
     * プロジェクト面のその他操作（2026-09-26 オーナー指示）。旧実装は「素材をまとめる」を
     * パネル下端の専用バー（上下にヘアライン）に常設していたが、下の「できたもの」と
     * 混ざって見えるうえ、めったに押さないボタンに面を割きすぎていた。丸い「…」だけを
     * 検索行に置き、中身はポップアップへ送る。
     */
    protected openMaterialsMenu(event: React.MouseEvent<HTMLButtonElement>): void {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const items: (MaterialContextMenuItem & { icon?: string; separator?: boolean })[] = [
            { id: 'bundle', label: this.bundleBusy ? 'まとめています…' : '素材をまとめる…', icon: 'archive' }
        ];
        if (this.projectCreditLines.length) {
            items.push({ id: 'copy-credits', label: 'クレジットをコピー', icon: 'copy' });
        }
        openAkariContextMenu({
            x: rect.right, y: rect.bottom + 4, items,
            onSelect: id => {
                if (id === 'bundle') { if (!this.bundleBusy) void this.bundleMaterials(); }
                else if (id === 'copy-credits') {
                    void navigator.clipboard.writeText(this.projectCreditLines.join('\n'))
                        .then(() => this.host.messages.info('クレジットをコピーしました'))
                        .catch(() => this.host.messages.error('クレジットをコピーできませんでした'));
                }
            }
        });
    }

    public renderMaterialsMenuButton(): React.ReactNode {
        return (
            <button
                type='button'
                data-akari-materials-menu='true'
                title='その他の操作'
                aria-label='その他の操作'
                aria-haspopup='menu'
                onClick={event => this.openMaterialsMenu(event)}
                style={{
                    flex: '0 0 auto', width: '26px', height: '26px', padding: 0, margin: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '999px', border: AKARI_BORDER.ghost,
                    background: AKARI_PROJECT_SURFACE.item, color: AKARI_INK, cursor: 'pointer'
                }}
            >
                <span className='codicon codicon-ellipsis' aria-hidden='true' />
            </button>
        );
    }

    // --- 未整理 → assets へ移動 ------------------------------------------------

    /**
     * 「assets へ移動」アクション。edit.json がルート相対パスでこのファイルを参照している
     * 場合に参照が壊れる可能性を移動前に警告し、承諾したときだけ FileService.move する。
     * edit.json 自体は書き換えない（契約ファイルへの書き込み禁止 — task.md 指定）。
     * 同名衝突時は recordDroppedAssets と同じ stem-index.ext 規約で連番回避し、上書きはしない。
     */
    public async moveToAssets(entry: MaterialCardEntry): Promise<void> {
        const root = this.host.workflow.workspaceRoot;
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
            await this.host.files.move(entry.uri, assetsUri.resolve(targetName), { overwrite: false });
        } catch {
            this.host.messages.error(`${entry.name} を移動できませんでした。`);
            return;
        }
        void this.loadMaterials();
    }

    protected async availableAssetName(assetsUri: URI, requestedName: string): Promise<string> {
        let candidate = requestedName;
        let index = 2;
        while (await this.host.files.exists(assetsUri.resolve(candidate))) {
            candidate = nextCandidateAssetName(requestedName, index++);
        }
        return candidate;
    }

    public async retryMaterialReference(entry: MaterialCardEntry): Promise<void> {
        if (await this.host.commandService?.executeCommand<boolean>('akari.library.isMoving')) { this.host.messages.warn('素材を移動しています。終わるまでお待ちください。'); return; }
        const root = this.host.workflow.workspaceRoot;
        if (!root || !entry.reference) return;
        try {
            const result = await this.host.projectService.resolveAsset(`${entry.reference.category}/${entry.reference.id}`, root.toString(), { force: true });
            if (result.success === false) this.host.messages.error(result.error);
            await this.loadMaterials();
        } catch (error) { this.host.messages.error(`素材を取得できませんでした: ${String(error)}`); }
    }

    public async removeMaterialReference(entry: MaterialCardEntry): Promise<void> {
        const root = this.host.workflow.workspaceRoot;
        if (!root || !entry.reference) return;
        try {
            if (!await this.confirmReferenceImpact(`${entry.relativePath}/`, false, 'このプロジェクトから外す')) return;
            if (this.host.workflow.workspaceRoot?.toString() !== root.toString()) return;
            await this.host.projectService.removeProjectAssetReference(root.toString(), entry.reference);
            await this.loadMaterials();
        } catch (error) { this.host.messages.error(String(error)); }
    }

    /**
     * `edit.json` / `captions.json` をプロジェクトルートから読む（無ければスキップ）。
     * どちらかの読み取りに失敗したときは `failed: true` を返し、呼び出し側は
     * 「参照を確認できませんでした」文面に切り替える（指示9）。書き込みは一切しない。
     */
    protected async readProjectReferenceDocuments(root: URI): Promise<{ documents: string[]; failed: boolean }> {
        const documents: string[] = [];
        let failed = false;
        let names: string[];
        try {
            const directory = await this.host.files.resolve(root);
            const files = (directory.children ?? []).filter(child => !child.isDirectory).map(child => child.resource.path.base);
            names = files.filter(name => isTimelineEditFileName(name)
                || name.startsWith('captions') && isTimelineEditFileName(`edit${name.slice('captions'.length)}`));
        } catch {
            return { documents, failed: true };
        }
        for (const name of names) {
            const uri = root.resolve(name);
            let exists: boolean;
            try {
                exists = await this.host.files.exists(uri);
            } catch {
                failed = true;
                continue;
            }
            if (!exists) {
                continue;
            }
            try {
                const content = await this.host.files.readFile(uri);
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
    public async confirmReferenceImpact(relativePath: string, isDirectory: boolean, actionLabel: string): Promise<boolean> {
        const root = this.host.workflow.workspaceRoot;
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
    public async buildDeleteReferenceMessage(relativePath: string, isDirectory: boolean): Promise<string> {
        const root = this.host.workflow.workspaceRoot;
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

    public renderMaterialsTab(): React.ReactNode {
        if (!this.host.workflow.workspaceRoot) {
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
        let materials = visibleMaterials(this.materials, this.filter, this.host.materialQuery, this.sort);
        let unorganizedMaterials = visibleMaterials(this.unorganizedMaterials, this.filter, this.host.materialQuery, this.sort);
        if (this.commandKinds !== undefined || this.commandSort) {
            const visibleFromCommand = (entries: readonly MaterialCardEntry[]): MaterialCardEntry[] => {
                const filtered = filterMaterials(entries, this.getVoiceMaterialView(), this.host.materialQuery);
                return this.commandSort ? sortMaterials(filtered, this.commandSort)
                    : visibleMaterials(filtered, [], '', this.sort);
            };
            materials = visibleFromCommand(this.materials);
            unorganizedMaterials = visibleFromCommand(this.unorganizedMaterials);
        }
        const total = this.materials.length + this.unorganizedMaterials.length;
        const visibleCount = materials.length + unorganizedMaterials.length;
        const isFiltered = this.filter.length > 0 || this.host.materialQuery.trim().length > 0;
        return (
            <div>
                {isFiltered && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 10px 0', fontSize: '0.78em', color: 'var(--akari-muted)' }}>
                    <span>{visibleCount} / {total} 件</span>
                </div>}
                {!visibleCount
                    ? <p data-akari-material-search-empty style={{ opacity: 0.7, padding: '16px' }}>条件に一致する素材がありません。</p>
                    : materials.length
                    ? <div style={isMaterialsList(this.mode)
                        ? { display: 'flex', flexDirection: 'column', gap: '4px', padding: MATERIAL_GRID_LAYOUT.gridPadding }
                        : { display: 'grid', gridTemplateColumns: MATERIAL_GRID_COLUMNS, gap: MATERIAL_GRID_GAP,
                            rowGap: '10px', padding: MATERIAL_GRID_LAYOUT.gridPadding }}>
                        {materials.map(entry => this.renderMaterialCard(entry))}
                    </div>
                    : <p style={{ opacity: 0.7, padding: '10px 16px 0' }}>assets/ にはまだ素材がありません。</p>}
                {unorganizedMaterials.length > 0 && this.renderUnorganizedSection(unorganizedMaterials)}
            </div>
        );
    }

    protected renderUnorganizedSection(entries: readonly MaterialCardEntry[]): React.ReactNode {
        return (
            <div style={{ borderTop: `1px solid ${AKARI_PROJECT_LINE}`, marginTop: '8px' }}>
                <div style={{ padding: '10px 10px 0', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '0.85em', fontWeight: 600 }}>未整理</span>
                    <span style={{ opacity: 0.7, fontSize: '0.78em' }}>
                        プロジェクトルート直下に置かれています。「assets へ移動」で整理できます。
                    </span>
                </div>
                <div
                    data-akari-unorganized-count={entries.length}
                    style={isMaterialsList(this.mode)
                        ? { display: 'flex', flexDirection: 'column', gap: '4px', padding: MATERIAL_GRID_LAYOUT.gridPadding }
                        : { display: 'grid', gridTemplateColumns: MATERIAL_GRID_COLUMNS, gap: MATERIAL_GRID_GAP,
                            rowGap: '10px', padding: MATERIAL_GRID_LAYOUT.gridPadding }}
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
        const known = entry.reference && this.host.assetCatalogItems.find(item =>
            item.key === `${entry.reference!.category}/${entry.reference!.id}`) as
            (AssetCatalogViewItem & { width?: number; height?: number }) | undefined;
        const range = this.materialRanges?.[entry.mediaRelativePath ?? entry.relativePath];
        const payload: { relativePath: string; kind: MaterialKind; durationSeconds?: number; in?: number; out?: number;
            name: string; thumb?: string; width?: number; height?: number } = {
            relativePath: entry.mediaRelativePath ?? entry.relativePath,
            kind: entry.kind,
            name: entry.name,
            ...(known && Number.isFinite(known.width) && (known.width ?? 0) > 0
                && Number.isFinite(known.height) && (known.height ?? 0) > 0
                ? { width: known.width, height: known.height } : {}),
            ...(entry.thumbnailUri ? { thumb: entry.thumbnailUri.toString() } : {}),
            ...(typeof entry.durationSeconds === 'number' ? { durationSeconds: entry.durationSeconds } : {}),
            ...(range ? { in: range.in, out: range.out } : {})
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
            void this.host.messages.info('未整理の素材は「assets へ移動」のあとで置けます');
        };
        const onMouseUp = (): void => cleanup();
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp, { once: true });
    }

    protected selectedMaterialPath?: string;

    protected renderMaterialCard(entry: MaterialCardEntry): React.ReactNode {
        const range = this.materialRanges?.[entry.mediaRelativePath ?? entry.relativePath];
        const pickCandidate: GenerationPickCandidate = { path: entry.mediaRelativePath ?? entry.relativePath, kind: entry.kind };
        const displayKind = entry.assetGroup ? 'other' : entry.kind;
        const layout = materialCardLayout({ kind: displayKind, name: entry.name, assetGroupCategory: entry.assetGroup?.category });
        const transcriptState = this.transcriptStateByPath[entry.relativePath] ?? 'none';
        const transcriptStatus = { none: '未', running: '実行中', done: '済' }[transcriptState];
        const transcriptLabel = `文字起こし ${transcriptStatus}`;
        const iconStyle: React.CSSProperties = { width: '14px', height: '14px', color: '#e5e5e5',
            background: 'rgba(0,0,0,.55)', borderRadius: '2px', flex: '0 0 14px' };
        const flags: React.ReactNode[] = [];
        if (!entry.assetGroup && (entry.kind === 'video' || entry.kind === 'audio')) flags.push(
            <svg key='transcript' data-akari-transcript-state={transcriptState} aria-label={transcriptLabel}
                viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.3' style={iconStyle}>
                <title>{transcriptLabel}</title>
                <path d='M3 1.5h6l2 2v9H3zM9 1.5v2h2M5 6h4M5 8h4M5 10h3' />
            </svg>);
        if (entry.reference) flags.push(<svg key='reference' data-akari-reference-badge
            aria-label='ライブラリを参照しています' viewBox='0 0 14 14' fill='none' stroke='currentColor'
            strokeWidth='1.3' style={iconStyle}><title>ライブラリを参照しています</title><path d='M5.5 4.5l1-1a3 3 0 014.2 4.2l-1.4 1.4M8.5 9.5l-1 1a3 3 0 01-4.2-4.2l1.4-1.4M5 9l4-4' /></svg>);
        if (entry.missing) flags.unshift(<svg key='missing' data-akari-reference-missing
            aria-label='見つかりません' viewBox='0 0 14 14' fill='none' stroke='#f85149' strokeWidth='1.3'
            style={iconStyle}><title>見つかりません</title><path d='M7 1.5l5.5 10h-11zM7 5v3M7 10v1' /></svg>);
        if (entry.unorganized) flags.unshift(<svg key='unorganized' aria-label='未整理'
            viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.3' strokeDasharray='2 1'
            style={iconStyle}><title>未整理</title><rect x='2' y='2' width='10' height='10' rx='1' /></svg>);
        if (entry.analyzed) flags.push(<span key='analyzed' title='分析済み' aria-label='分析済み'
            style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f97316', flex: '0 0 6px' }} />);
        // D&D 対象は video/audio/image かつ非未整理のみ（司令塔裁定1）。other・未整理カードは
        // draggable にしない（未整理は「assets へ移動」が先 — 既存の moveToAssets 導線を優先する）。
        const draggable = !entry.missing && !this.host.generationPick.request && !entry.unorganized
            && (entry.kind === 'video' || entry.kind === 'audio' || entry.kind === 'image');
        return (
            <div
                key={entry.uri.toString()}
                data-akari-material-path={entry.relativePath}
                data-akari-onboarding-target={entry.relativePath === 'assets/サンプル動画.mp4' ? 'sample-card' : undefined}
                data-akari-material-unorganized={entry.unorganized ? 'true' : 'false'}
                data-akari-material-reference={entry.reference ? 'true' : undefined}
                data-akari-material-missing={entry.missing ? 'true' : undefined}
                data-akari-material-asset-group={entry.assetGroup ? 'true' : 'false'}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    gridColumn: layout.gridColumn,
                    position: 'relative'
                }}
            >
                <div
                    // docs/contract-2026-08-11-review-session-ui-events.md #2: asset:<path> opt-in target.
                    data-akari-ui={`asset:${entry.relativePath}`}
                    data-akari-ui-label={entry.name}
                    draggable={draggable}
                    onDragStart={draggable ? event => this.handleMaterialDragStart(event, entry) : undefined}
                    onDragEnd={draggable ? () => this.handleMaterialDragEnd() : undefined}
                    onMouseDown={!this.host.generationPick.request && entry.unorganized ? event => this.handleUnorganizedMaterialMouseDown(event) : undefined}
                    onClickCapture={event => {
                        if (entry.missing || this.host.generationPick.request
                            || (typeof Element !== 'undefined' && event.target instanceof Element
                                && event.target.closest('button, [data-akari-material-range-handles]'))) return;
                        this.selectedMaterialPath = entry.relativePath;
                        this.host.update();
                        const root = this.host.workflow.workspaceRoot;
                        if (root) window.dispatchEvent(new CustomEvent(AKARI_MATERIAL_SELECTED_EVENT, {
                            detail: { projectRoot: root.toString(), relativePath: entry.mediaRelativePath ?? entry.relativePath,
                                kind: entry.assetGroup && !entry.mediaRelativePath ? 'other' : entry.kind, name: entry.name }
                        }));
                    }}
                    onClick={() => { if (!entry.missing) void this.host.openFile(entry.uri); }}
                    onDoubleClick={event => {
                        if (isMaterialsList(this.mode) && entry.durationSeconds && this.selectedMaterialPath === entry.relativePath) {
                            event.preventDefault(); event.stopPropagation(); this.changeMaterialRange(entry, null);
                        }
                    }}
                    onMouseEnter={event => { event.currentTarget.style.borderColor =
                        this.selectedMaterialPath === entry.relativePath ? '#f97316' : '#a3a3a3'; }}
                    onMouseLeave={event => { event.currentTarget.style.borderColor = this.selectedMaterialPath === entry.relativePath ? '#f97316' : AKARI_FAINT; }}
                    onContextMenu={event => this.host.openMaterialContextMenu(event, entry)}
                    title={entry.name}
                    {...this.host.generationPickCardProps(pickCandidate)}
                    style={{
                        position: 'relative',
                        aspectRatio: isMaterialsList(this.mode) ? undefined : layout.aspectRatio,
                        width: '100%',
                        height: isMaterialsList(this.mode) ? '46px' : undefined,
                        background: '#000',
                        border: `1px solid ${this.selectedMaterialPath === entry.relativePath ? '#f97316' : AKARI_FAINT}`,
                        boxShadow: this.selectedMaterialPath === entry.relativePath ? '0 0 0 1.5px #f97316' : undefined,
                        borderRadius: '4px',
                        boxSizing: 'border-box',
                        overflow: 'hidden',
                        cursor: draggable ? 'grab' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    {isMaterialsList(this.mode) && (entry.kind === 'video' || entry.kind === 'audio' || entry.kind === 'image')
                        ? <MaterialStrip entry={entry} width='100%' />
                        : entry.thumbnailUri
                        // position: absolute で img をフレックスの外に出す。flex 子のまま
                        // height:'100%' にすると、親の aspectRatio を無視して img 自身の
                        // 縦長比率で高さが決まってしまう。
                        ? <img
                            src={entry.thumbnailUri.toString()}
                            alt=''
                            draggable={false}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: layout.objectFit }}
                        />
                        : /\.html?$/i.test(entry.uri.path.base) || ['overlay', 'still'].includes(entry.assetGroup?.category ?? '')
                            ? <MaterialCardHoverPreview assetUri={entry.uri.toString()} service={this.host.materialPreviewService}
                                workspaceService={this.host.workspaceService}
                                files={this.host.files} icon={this.host.placeholderIcon(displayKind)} />
                            : <span className={this.host.placeholderIcon(displayKind)} aria-hidden='true' draggable={false}
                                style={{ fontSize: '1.8em', opacity: 0.5 }} />}
                    {isMaterialsList(this.mode) && this.selectedMaterialPath === entry.relativePath
                        && typeof entry.durationSeconds === 'number' && entry.durationSeconds > 0
                        && <MaterialRangeHandles durationSeconds={entry.durationSeconds} range={range}
                            onChange={next => this.changeMaterialRange(entry, next)} />}
                    {!isMaterialsList(this.mode) && <div style={{
                        position: 'absolute', top: '3px', left: '3px', maxWidth: 'calc(100% - 42px)',
                        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '2px'
                    }}>
                        {flags.slice(0, 3)}
                    </div>}
                    {entry.durationSeconds !== undefined &&
                        <span style={{ position: 'absolute', top: '3px', right: '4px', color: '#fff',
                            font: '600 10px/1 monospace', textShadow: '0 0 3px #000, 0 0 2px #000' }}>
                            {!isMaterialsList(this.mode) && range && <span style={{ marginRight: '3px' }}>✂</span>}
                            {formatDurationBadge(!isMaterialsList(this.mode) && range
                                ? range.out - range.in : entry.durationSeconds)}
                        </span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0,
                    padding: isMaterialsList(this.mode) ? 0 : '3px 1px 0', fontSize: '10px',
                    lineHeight: 1.3, color: '#737373', flex: isMaterialsList(this.mode) ? '1 1 auto' : undefined }}>
                    <span aria-hidden='true' style={{ width: '6px', height: '6px', flex: '0 0 6px', borderRadius: '2px',
                        background: { video: '#58a6ff', audio: '#3fb950', image: '#d2a8ff', other: '#e3b341' }[displayKind] }} />
                    <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.name}
                    </span>
                    {isMaterialsList(this.mode) && entry.missing && <span data-akari-reference-missing
                        style={{ flex: '0 0 auto', fontSize: '10px', color: '#737373' }}>見つかりません</span>}
                    {isMaterialsList(this.mode) && entry.unorganized && <span
                        style={{ flex: '0 0 auto', fontSize: '10px', color: '#737373' }}>未整理</span>}
                </div>
                {this.host.renderGenerationPickBadge(pickCandidate)}
                {entry.missing && entry.reference && (() => {
                    const known = this.host.assetCatalogItems.find(item => item.key === `${entry.reference.category}/${entry.reference.id}`);
                    const state = referencePresentation(entry.reference, known?.sourceKind === 'lab');
                    return state.lab
                        ? <button className='theia-button secondary small' onClick={event => { event.stopPropagation(); void this.retryMaterialReference(entry); }}>もう一度取得</button>
                        : <span>入れ直してください</span>;
                })()}
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
     * 素材カード「エージェントに頼む」アクション。ファイルパスも文脈説明も
     * ユーザーに書かせず、カードが知っている情報から文脈パケットを組み立てて
     * パートナーへ注入する（輸入リスト④）。入力キャンセル時は何もしない。
     */
    public async askAgent(entry: MaterialCardEntry): Promise<void> {
        const request = await this.host.quickInputService.input({
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
        await this.host.commandService.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, packet);
    }

    public async storeMaterialInLibrary(entry: MaterialCardEntry): Promise<void> {
        if (await this.host.commandService?.executeCommand<boolean>('akari.library.isMoving')) { this.host.messages.warn('素材を移動しています。終わるまでお待ちください。'); return; }
        if (entry.reference) return;
        try {
            const uri = entry.mediaRelativePath && this.host.workflow.workspaceRoot
                ? this.host.workflow.workspaceRoot.resolve(entry.mediaRelativePath) : entry.uri;
            const plan = await this.host.projectService.planLibraryImport([uri.path.fsPath()]);
            const result = await this.host.projectService.applyLibraryImport(plan);
            this.host.reportLibraryImportResult(result);
            await this.host.loadAssetCatalogView('user');
        } catch (error) { this.host.messages.error(`ライブラリに保管できませんでした: ${String(error)}`); }
    }

    /**
     * 「タイムラインに追加」（送信側のみ、task 2026-08-10-material-menu-r2 指示2）。
     * 受け側（姉妹タスク 2026-08-10-timeline-clip-menu）のコマンド未登録も含め、失敗は
     * 握って messages.error に落とす（司令塔裁定2 — 実機ではほぼ同時に合流するため雑でよい）。
     */
    public async addMaterialToTimeline(entry: MaterialCardEntry): Promise<void> {
        try {
            const relativePath = this.rangePath(entry);
            const root = this.host.workflow.workspaceRoot;
            const timerKey = root ? `${root.toString()}\n${relativePath}` : '';
            const timer = this.rangeSaveTimers.get(timerKey);
            if (timer) {
                clearTimeout(timer);
                this.rangeSaveTimers.delete(timerKey);
                const save = this.host.commandService.executeCommand('akari.materials.range.set', {
                    projectUri: root?.toString(), relativePath,
                    range: this.materialRanges[relativePath] ?? null, source: this.materialRangeSource
                });
                this.rangeSavesInFlight.set(timerKey, save);
                try { await save; } finally {
                    if (this.rangeSavesInFlight.get(timerKey) === save) this.rangeSavesInFlight.delete(timerKey);
                }
            } else {
                await this.rangeSavesInFlight.get(timerKey);
            }
            const range = this.materialRanges[relativePath];
            await this.host.commandService.executeCommand(TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID, {
                relativePath,
                kind: entry.kind,
                ...(typeof entry.durationSeconds === 'number' ? { durationSeconds: entry.durationSeconds } : {}),
                ...(range ? { in: range.in, out: range.out } : {})
            });
        } catch {
            this.host.messages.error('タイムライン機能の更新が必要です。');
        }
    }

    /**
     * 「素材の情報を表示」（task 2026-08-10-material-menu-r2 指示2・3）。実処理
     * （パネルの reveal/activate・showAsset）は `AkariProjectContribution#showAssetInfo`
     * に委ねる（司令塔裁定5 — ApplicationShell 経由の widget 操作は akari-project 側に集約）。
     */
    public async showAssetInfo(uri: URI): Promise<void> {
        await this.host.commandService.executeCommand(AKARI_SHOW_ASSET_INFO.id, uri);
    }

    /**
     * リネーム/削除の実操作対象を求める。素材グループ（`entry.assetGroup` あり）は
     * `entry.uri` がグループディレクトリ直下の preview.png / meta.json（`buildAssetGroupEntry`
     * 参照）のため、対象はその親ディレクトリになる（指示5「ディレクトリ名の変更になる」）。
     * それ以外（通常素材・未整理）は `entry.uri` 自身がファイル。
     */
    public materialFileSystemTarget(entry: MaterialCardEntry): { uri: URI; isDirectory: boolean } {
        return entry.assetGroup ? { uri: entry.uri.parent, isDirectory: true } : { uri: entry.uri, isDirectory: false };
    }

    protected transcriptStateByPath: Record<string, TranscriptState> = {};

    public async transcribeMaterial(entry: MaterialCardEntry): Promise<void> {
        const root = this.host.workflow.workspaceRoot;
        if (!root || entry.assetGroup) return;
        if (this.transcriptStateByPath[entry.relativePath] === 'running') return;
        try {
            const result = await this.host.commandService.executeCommand<string>('akari.transcribe.openDialog', {
                projectRoot: root.toString(), relativePath: entry.relativePath
            });
            if (result === 'running') void this.host.messages.info(`${entry.name}: 文字起こしを実行中です`);
            else if (result === 'cancelled') void this.host.messages.info(`${entry.name}: 文字起こしを中止しました`);
            await this.loadMaterials();
            return;
        } catch (error) {
            void this.host.messages.error(error instanceof Error ? error.message : String(error));
            return;
        }
    }
}
