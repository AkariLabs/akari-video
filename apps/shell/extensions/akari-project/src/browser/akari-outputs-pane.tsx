import { t } from '../common/project-text';
import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { CommandService, DisposableCollection } from '@theia/core/lib/common';
import { QuickInputService } from '@theia/core/lib/browser';
import { isOSX } from '@theia/core/lib/common/os';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent, FileStatWithMetadata } from '@theia/filesystem/lib/common/files';
import { AkariProjectService } from '../common/akari-project-protocol';
import { AkariWorkflowService } from './akari-workflow-service';
import { dataFileIcon, editVariantDataFileLabel, orderDataEntries } from '../common/output-data-order';
import { isEditDataFileName } from '../common/edit-data-file';
import { composeOutputAskAgentPrompt } from '../common/agent-context-packet';
import { AKARI_BORDER, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';
import { MaterialKind } from '../common/asset-group-media';
import { AKARI_REVEAL_IN_FILE_MANAGER, revealInFileManagerActionLabel } from './akari-reveal-commands';
import { buildMaterialContextMenuItems } from '../common/material-context-menu-items';
import { openAkariContextMenu } from './akari-context-menu';
import { formatOutputTimestamp } from '../common/output-timestamp';
import {
    clampExportBandHeight, dragExportBandHeight, EXPORT_BAND_DEFAULT_HEIGHT, EXPORT_BAND_HEIGHT_KEY,
    EXPORT_BAND_MIN_HEIGHT, formatExportTimestamp, parseExportBandHeight, projectPanelBands,
    recordGroupWindow, RecordKind, serializeExportBandHeight
} from '../common/project-panel-bands';

const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';

export type OutputEntryKind = 'data' | 'plan' | 'export' | 'report';

/** 左の記録・出力に現れるファイル。 */
export interface OutputEntry {
    uri: URI;
    relativePath: string;
    name: string;
    kind: OutputEntryKind;
    mtime: number;
    size: number;
    /**
     * ファイル名の代わりに出す見出し。report は HTML の <title>、plan は md の先頭 `#` 見出し、
     * data は編集データ・字幕・レビューの日本語ラベル。取れなければ未設定（ファイル名で表示）。
     */
    title?: string;
    /** export の動画/画像のみ: サムネキャッシュ。無ければアイコン表示。 */
    thumbnailUri?: URI;
}

const RECORD_GROUPS: readonly RecordKind[] = ['plan', 'data', 'report'];
const EXTRA_REPORT_FILES = ['analysis.json', 'decision-log.md', 'review.json'] as const;

export interface OutputsPaneHost {
    /** 現在のプロジェクトと相対パス。 */
    readonly workflow: Pick<AkariWorkflowService, 'workspaceRoot' | 'relativePath'>;
    /** 成果物の読み込みと監視。 */
    readonly files: Pick<FileService, 'resolve' | 'readFile' | 'watch' | 'onDidFilesChange'>;
    /** 成果物のサムネイル解決。 */
    readonly projectService: Pick<AkariProjectService, 'resolveMaterialThumbnail'>;
    /** ファイル操作とパートナーへのコマンド。 */
    readonly commandService: Pick<CommandService, 'executeCommand'>;
    /** エージェントへの依頼入力。 */
    readonly quickInputService: Pick<QuickInputService, 'input'>;
    /** widget の再描画。 */
    readonly update: () => void;
    /** ファイル名から素材種別を判定。 */
    readonly classifyKind: (name: string) => MaterialKind;
    /** 素材種別の代替アイコン。 */
    readonly placeholderIcon: (kind: MaterialKind) => string;
    /** ファイルをプレビューで開く。 */
    readonly openFile: (uri: URI) => Promise<void>;
    /** Finder でファイルを表示。 */
    readonly revealInFileManagerCommand: (uri: URI) => Promise<void>;
    /** ファイルをクリップボードへコピー。 */
    readonly copyFileToClipboard: (uri: URI) => Promise<void>;
    /** パスをクリップボードへコピー。 */
    readonly copyPathToClipboard: (uri: URI) => Promise<void>;
    /** 成果物の名前を変更。 */
    readonly renameEntry: (uri: URI, name: string, relativePath: string, isDirectory: boolean, reload: () => void) => Promise<void>;
    /** 成果物を削除。 */
    readonly deleteEntry: (uri: URI, name: string, relativePath: string, isDirectory: boolean, reload: () => void) => Promise<void>;
    /** ルート直下の編集データ。 */
    readonly projectDataFiles: ReadonlyArray<{ readonly name: string; readonly label: string }>;
    /** ルート直下の企画ファイル。 */
    readonly rootPlanFiles: ReadonlyArray<string>;
    /** ルート直下のレポート。 */
    readonly rootReportFiles: ReadonlyArray<string>;
}

export class AkariOutputsPane {
    protected outputs: OutputEntry[] = [];
    protected outputsLoading = false;
    protected outputsLoadedOnce = false;
    protected outputsGeneration = 0;
    protected outputsWatch = new DisposableCollection();
    protected outputsWatchRootKey?: string;
    protected outputsWatchTimer?: ReturnType<typeof setTimeout>;
    protected missingOutputNames?: string;
    protected readonly changedOutputUris = new Set<string>();
    protected foldedRecordGroups = new Set<RecordKind>();
    protected expandedRecordGroups = new Set<RecordKind>();
    protected stateRootKey?: string;
    protected exportBandHeight = EXPORT_BAND_DEFAULT_HEIGHT;
    protected exportBandPanelHeight = Number.POSITIVE_INFINITY;
    protected exportBandPanel?: HTMLDivElement;
    protected exportBandResizeObserver?: ResizeObserver;
    protected exportBandDrag?: { pointerId: number; startY: number; startHeight: number };

    constructor(protected readonly host: OutputsPaneHost) {
        try {
            this.exportBandHeight = parseExportBandHeight(window.localStorage.getItem(EXPORT_BAND_HEIGHT_KEY))
                ?? EXPORT_BAND_DEFAULT_HEIGHT;
        } catch { /* Session resizing still works. */ }
    }

    protected readonly attachExportBandPanel = (element: HTMLDivElement | null): void => {
        if (this.exportBandPanel === element) return;
        this.exportBandResizeObserver?.disconnect();
        this.exportBandPanel = element ?? undefined;
        if (!element) return;
        const updatePanelHeight = (): void => {
            const nextHeight = element.clientHeight;
            if (nextHeight === this.exportBandPanelHeight) return;
            const previousHeight = clampExportBandHeight(this.exportBandHeight, this.exportBandPanelHeight);
            this.exportBandPanelHeight = nextHeight;
            if (clampExportBandHeight(this.exportBandHeight, nextHeight) !== previousHeight) this.host.update();
        };
        updatePanelHeight();
        if (typeof ResizeObserver !== 'undefined') {
            this.exportBandResizeObserver = new ResizeObserver(updatePanelHeight);
            this.exportBandResizeObserver.observe(element);
        }
    };

    protected onExportBandPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
        if (event.button !== 0) return;
        event.preventDefault();
        this.exportBandPanelHeight = this.exportBandPanel?.clientHeight ?? this.exportBandPanelHeight;
        this.exportBandDrag = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: clampExportBandHeight(this.exportBandHeight, this.exportBandPanelHeight)
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    protected onExportBandPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
        const drag = this.exportBandDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const height = dragExportBandHeight(drag.startHeight, drag.startY, event.clientY, this.exportBandPanelHeight);
        if (height !== this.exportBandHeight) {
            this.exportBandHeight = height;
            this.host.update();
        }
    }

    protected onExportBandPointerEnd(event: React.PointerEvent<HTMLDivElement>): void {
        if (this.exportBandDrag?.pointerId !== event.pointerId) return;
        this.exportBandDrag = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        try { window.localStorage.setItem(EXPORT_BAND_HEIGHT_KEY, serializeExportBandHeight(this.exportBandHeight)); }
        catch { /* Session resizing still works. */ }
    }

    protected resetExportBandHeight(): void {
        this.exportBandHeight = EXPORT_BAND_DEFAULT_HEIGHT;
        try { window.localStorage.removeItem(EXPORT_BAND_HEIGHT_KEY); }
        catch { /* Session resizing still works. */ }
        this.host.update();
    }

    // --- できたもの（下段・read-only） -----------------------------------------

    /**
     * 下段の 4 グループをまとめて読み込む。グループ内は新しい順、グループ間の順序は
     * OUTPUT_GROUPS の並び（描画側で束ねる）。
     *
     * - 編集データ: ルート直下の edit.json / edit.<slug>.json と固定の字幕・レビューファイル
     * - 企画・メモ: `planning/` 配下の md（再帰）+ ルート直下の ROOT_PLAN_FILES
     * - 書き出し: `exports/` 直下（非再帰 — サブフォルダは対象外）
     * - レポート: ルート直下の ROOT_REPORT_FILES + `.akari/reports/` 直下の HTML
     *   （PNG 視認証跡は対象外）
     *
     * 素材（`assets/`）は上段の持ち物なのでここには出さない。`.akari/work/` `.akari/cache/`
     * `.akari/sidecars/` も出さない — project-structure-v0 §2-2 が「再生成可能・削除安全な
     * 中間物」と定義した層であり、非開発者ビューが隠す対象そのものだから。
     */
    public async loadOutputs(): Promise<void> {
        const root = this.host.workflow.workspaceRoot;
        if (this.stateRootKey !== root?.toString()) {
            this.stateRootKey = root?.toString();
            this.foldedRecordGroups.clear();
            this.expandedRecordGroups.clear();
            if (root) try {
                const folded = JSON.parse(window.localStorage.getItem(`akari.records.folded:${root.toString()}`) || '[]');
                if (Array.isArray(folded)) for (const kind of RECORD_GROUPS) if (folded.includes(kind)) this.foldedRecordGroups.add(kind);
            } catch { /* The current session still works. */ }
        }
        const generation = ++this.outputsGeneration;
        if (!root) {
            this.outputs = [];
            this.outputsLoadedOnce = false;
            this.host.update();
            return;
        }
        this.outputsLoading = true;
        this.host.update();
        const [dataFiles, planFiles, exportFiles, rootReportFiles, managedReportFiles, analysisFiles] = await Promise.all([
            this.collectTopLevelFiles(root).then(files => files.filter(file =>
                isEditDataFileName(file.resource.path.base)
                || (file.resource.path.base !== 'review.json'
                    && this.host.projectDataFiles.some(candidate => candidate.name === file.resource.path.base)))),
            this.collectPlanFiles(root),
            this.collectTopLevelFiles(root.resolve('exports')),
            this.collectRootFilesNamed(root, [...this.host.rootReportFiles, ...EXTRA_REPORT_FILES]),
            this.collectTopLevelFiles(root.resolve('.akari/reports')),
            this.collectSidecarAnalysisFiles(root.resolve('.akari/sidecars'))
        ]);
        const reportFiles = [...rootReportFiles,
            ...managedReportFiles.filter(file => /\.(?:html?|json|md)$/i.test(file.resource.path.base)), ...analysisFiles];
        const [dataEntries, planEntries, exportEntries, reportEntries] = await Promise.all([
            Promise.all(dataFiles.map(file => this.buildOutputEntry(root, file, 'data'))),
            Promise.all(planFiles.map(file => this.buildOutputEntry(root, file, 'plan'))),
            Promise.all(exportFiles.map(file => this.buildOutputEntry(root, file, 'export'))),
            Promise.all(
                reportFiles
                    // プロジェクトを作ったときの記録（scaffold の作成ログ）は「できたもの」に数えない
                    .filter(file => !/^create-project-report\.html?$/i.test(file.resource.path.base))
                    .map(file => this.buildOutputEntry(root, file, 'report'))
            )
        ]);
        if (generation !== this.outputsGeneration) {
            return; // A newer load superseded this one; discard stale results.
        }
        const merged = [...dataEntries, ...planEntries, ...exportEntries, ...reportEntries];
        merged.sort((left, right) => right.mtime - left.mtime);
        this.outputs = orderDataEntries(merged, this.host.projectDataFiles.map(file => file.name));
        this.outputsLoading = false;
        this.outputsLoadedOnce = true;
        this.host.update();
        void this.hydrateOutputThumbnails(root, generation, exportEntries);
    }

    /** ディレクトリ直下のファイルのみ（非再帰・ドットファイル除外）を size/mtime 付きで返す。 */
    protected async collectTopLevelFiles(dirUri: URI): Promise<FileStatWithMetadata[]> {
        let stat: FileStatWithMetadata;
        try {
            stat = await this.host.files.resolve(dirUri, { resolveMetadata: true });
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
            this.collectRootFilesNamed(root, this.host.rootPlanFiles)
        ]);
        return [...rootFiles.filter(file => file.resource.path.base !== 'decision-log.md'), ...planning];
    }

    protected async collectSidecarAnalysisFiles(dirUri: URI): Promise<FileStatWithMetadata[]> {
        const found: FileStatWithMetadata[] = [];
        const walk = async (uri: URI): Promise<void> => {
            let directory: FileStatWithMetadata;
            try { directory = await this.host.files.resolve(uri, { resolveMetadata: true }); } catch { return; }
            for (const child of directory.children ?? []) {
                if (child.isDirectory) await walk(child.resource);
                else if (child.resource.path.base === 'analysis.json') found.push(child);
            }
        };
        await walk(dirUri);
        return found;
    }

    /** ディレクトリ配下の md を再帰的に集める（ドット始まりのファイル/ディレクトリは除外）。 */
    protected async collectMarkdownRecursively(dirUri: URI): Promise<FileStatWithMetadata[]> {
        let stat: FileStatWithMetadata;
        try {
            stat = await this.host.files.resolve(dirUri, { resolveMetadata: true });
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
                    await walk(await this.host.files.resolve(child.resource, { resolveMetadata: true }));
                } catch {
                    continue; // Directory disappeared mid-walk; skip it.
                }
            }
        };
        await walk(stat);
        return found;
    }

    protected async buildOutputEntry(root: URI, file: FileStatWithMetadata, kind: OutputEntryKind): Promise<OutputEntry> {
        const relativePath = this.host.workflow.relativePath(file.resource) ?? file.resource.path.base;
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
            entry.title = relativePath.startsWith('.akari/sidecars/')
                ? t('project.workspace.bands.analysisForLabel', {
                    name: relativePath.replace(/^\.akari\/sidecars\//, '').replace(/\.analysis\/analysis\.json$/, '')
                })
                : /\.md$/i.test(name) ? await this.readMarkdownTitle(file.resource)
                    : /\.html?$/i.test(name) ? await this.readReportTitle(file.resource) : undefined;
        } else if (kind === 'plan') {
            entry.title = await this.readMarkdownTitle(file.resource);
        } else if (kind === 'data') {
            entry.title = this.host.projectDataFiles.find(candidate => candidate.name === name)?.label
                ?? editVariantDataFileLabel(name);
        }
        return entry;
    }

    /** report タイトル抽出。先頭 8KB のみ読む（埋め込み base64 等で巨大なレポートを丸読みしない）。 */
    protected async readReportTitle(uri: URI): Promise<string | undefined> {
        try {
            const content = await this.host.files.readFile(uri, { length: 8192 });
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
            const content = await this.host.files.readFile(uri, { length: 8192 });
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
            const kind = this.host.classifyKind(entry.name);
            return kind === 'video' || kind === 'image';
        });
        await Promise.all(candidates.map(async entry => {
            const kind = this.host.classifyKind(entry.name) as 'video' | 'image';
            let outcome;
            try {
                outcome = await this.host.projectService.resolveMaterialThumbnail(root.toString(), entry.relativePath, kind);
            } catch {
                return;
            }
            if (generation !== this.outputsGeneration || !outcome.available || !outcome.cacheRelativePath) {
                return;
            }
            entry.thumbnailUri = root.resolve(outcome.cacheRelativePath);
            this.host.update();
        }));
    }

    public ensureOutputsWatch(): void {
        const root = this.host.workflow.workspaceRoot;
        const rootKey = root?.toString();
        if (rootKey === this.outputsWatchRootKey) {
            return;
        }
        this.outputsWatch.dispose();
        this.outputsWatch = new DisposableCollection();
        this.outputsWatchRootKey = rootKey;
        this.missingOutputNames = undefined;
        this.changedOutputUris.clear();
        if (!root) {
            return;
        }
        const exportsUri = root.resolve('exports');
        const reportsUri = root.resolve('.akari/reports');
        const planningUri = root.resolve('planning');
        const sidecarsUri = root.resolve('.akari/sidecars');
        this.outputsWatch.push(this.host.files.watch(exportsUri, { recursive: true, excludes: [] }));
        this.outputsWatch.push(this.host.files.watch(reportsUri, { recursive: true, excludes: [] }));
        this.outputsWatch.push(this.host.files.watch(planningUri, { recursive: true, excludes: [] }));
        this.outputsWatch.push(this.host.files.watch(sidecarsUri, { recursive: true, excludes: [] }));
        this.outputsWatch.push(this.host.files.watch(root));
        this.outputsWatch.push(this.host.files.onDidFilesChange(event =>
            this.handleOutputsFileChange(root, { exportsUri, reportsUri, planningUri }, event)
        ));
    }

    protected handleOutputsFileChange(
        root: URI,
        watched: { exportsUri: URI; reportsUri: URI; planningUri: URI },
        event: FileChangesEvent
    ): void {
        const rootKey = root.toString();
        if (event.changes.some(change => root.resolve('.akari/sidecars').isEqualOrParent(change.resource)
            && change.resource.path.base === 'analysis.json')) {
            if (this.outputsWatchTimer) clearTimeout(this.outputsWatchTimer);
            this.outputsWatchTimer = setTimeout(() => {
                this.outputsWatchTimer = undefined;
                void this.loadOutputs();
            }, 900);
            return;
        }
        // ルート直下は名前で絞る。`.akari/cache/` の書き込みでも親（`.akari`）の変更として
        // ここに届くため、素通しにすると自分のサムネ生成で再読み込みループが回る。
        const watchedRootNames = new Set([
            ...this.host.projectDataFiles.map(file => file.name),
            ...this.host.rootPlanFiles,
            ...this.host.rootReportFiles,
            'analysis.json', 'decision-log.md', 'review.json'
        ]);
        const relevant = event.changes.some(change =>
            !/\.tmp(?:\.|$)/iu.test(change.resource.path.base) && (
            watched.exportsUri.isEqualOrParent(change.resource)
            || watched.reportsUri.isEqualOrParent(change.resource)
            || watched.planningUri.isEqualOrParent(change.resource)
            || (change.resource.parent.toString() === rootKey
                && (watchedRootNames.has(change.resource.path.base) || isEditDataFileName(change.resource.path.base)))
            )
        );
        if (!relevant) {
            return;
        }
        for (const change of event.changes) this.changedOutputUris.add(change.resource.toString());
        if (this.outputsWatchTimer) {
            clearTimeout(this.outputsWatchTimer);
        }
        this.outputsWatchTimer = setTimeout(() => {
            this.outputsWatchTimer = undefined;
            void this.reconcileOutputs(root);
        }, 900);
    }

    /** 保存時は名前の増減を確かめ、既存項目はその項目だけ更新する。 */
    protected async reconcileOutputs(root: URI): Promise<void> {
        if (!this.outputsLoadedOnce || this.host.workflow.workspaceRoot?.toString() !== root.toString()) return;
        const changedUris = new Set(this.changedOutputUris);
        for (const uri of changedUris) this.changedOutputUris.delete(uri);
        const exportsUri = root.resolve('exports');
        const reportsUri = root.resolve('.akari/reports');
        const planningUri = root.resolve('planning');
        const scopeOf = (uri: URI): 'root' | 'exports' | 'reports' | 'planning' | undefined => {
            if (exportsUri.isEqualOrParent(uri)) return 'exports';
            if (reportsUri.isEqualOrParent(uri)) return 'reports';
            if (planningUri.isEqualOrParent(uri)) return 'planning';
            if (uri.parent.isEqual(root)) return 'root';
            return undefined;
        };
        const scopes = new Set([...changedUris].map(value => scopeOf(new URI(value))).filter((scope): scope is NonNullable<typeof scope> => !!scope));
        const [rootFiles, planFiles, exportFiles, reportFiles] = await Promise.all([
            scopes.has('root') ? this.collectTopLevelFiles(root) : Promise.resolve([]),
            scopes.has('planning') ? this.collectPlanFiles(root) : Promise.resolve([]),
            scopes.has('exports') ? this.collectTopLevelFiles(exportsUri) : Promise.resolve([]),
            scopes.has('reports') ? this.collectTopLevelFiles(reportsUri) : Promise.resolve([])
        ]);
        if (this.host.workflow.workspaceRoot?.toString() !== root.toString()) return;
        const files = [
            ...rootFiles.filter(file => isEditDataFileName(file.resource.path.base)
                || this.host.projectDataFiles.some(candidate => candidate.name === file.resource.path.base)
                || this.host.rootPlanFiles.includes(file.resource.path.base)
                || this.host.rootReportFiles.includes(file.resource.path.base)
                || ['analysis.json', 'decision-log.md', 'review.json'].includes(file.resource.path.base)),
            ...planFiles.filter(file => planningUri.isEqualOrParent(file.resource)),
            ...exportFiles.filter(file => !/\.tmp(?:\.|$)/iu.test(file.resource.path.base)),
            ...reportFiles.filter(file => /\.(?:html?|json|md)$/iu.test(file.resource.path.base)
                && !/^create-project-report\.html?$/iu.test(file.resource.path.base))
        ];
        const byUri = new Map(files.map(file => [file.resource.toString(), file]));
        const oldUris = new Set(this.outputs.filter(entry => {
            const scope = scopeOf(entry.uri);
            return scope !== undefined && scopes.has(scope);
        })
            .map(entry => entry.uri.toString()));
        if (byUri.size !== oldUris.size || [...byUri.keys()].some(uri => !oldUris.has(uri))) {
            const signature = `${[...oldUris].sort().join('\0')}|${[...byUri.keys()].sort().join('\0')}`;
            if (this.missingOutputNames === signature) {
                this.missingOutputNames = undefined;
                await this.loadOutputs();
            } else {
                this.missingOutputNames = signature;
                for (const uri of changedUris) this.changedOutputUris.add(uri);
                if (this.outputsWatchTimer) clearTimeout(this.outputsWatchTimer);
                this.outputsWatchTimer = setTimeout(() => {
                    this.outputsWatchTimer = undefined;
                    void this.reconcileOutputs(root);
                }, 900);
            }
            return;
        }
        this.missingOutputNames = undefined;
        const touched = changedUris;
        let changed = false;
        const next = await Promise.all(this.outputs.map(async entry => {
            const scope = scopeOf(entry.uri);
            if (scope === undefined || !scopes.has(scope)) return entry;
            const file = byUri.get(entry.uri.toString());
            if (!file || (!touched.has(entry.uri.toString()) && entry.mtime === file.mtime && entry.size === file.size)) return entry;
            changed = true;
            const updated = await this.buildOutputEntry(root, file, entry.kind);
            return { ...updated, thumbnailUri: entry.thumbnailUri };
        }));
        if (changed) {
            this.outputs = next;
            this.host.update();
        }
    }

    protected formatOutputTimestamp(mtime: number): string {
        return formatOutputTimestamp(mtime);
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
            default: return this.host.placeholderIcon(this.host.classifyKind(entry.name));
        }
    }

    public renderOutputsPane(): React.ReactNode {
        const bands = projectPanelBands(this.outputs);
        return (
            <div ref={this.attachExportBandPanel} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                <div style={{
                    flex: '0 0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px 4px'
                }}>
                    <span style={{ fontSize: '0.78em', fontWeight: 700, letterSpacing: '0.04em', opacity: 0.75 }}>{t('project.workspace.bands.recordsLabel')}</span>
                    <button
                        type='button'
                        className='theia-button quiet small icon'
                        title={t('project.workspace.outputs.refreshOutputsAction')}
                        aria-label={t('project.workspace.outputs.refreshOutputsAction')}
                        data-akari-outputs-refresh
                        onClick={() => void this.loadOutputs()}
                    >
                        <span className='codicon codicon-refresh' aria-hidden='true' />
                    </button>
                </div>
                <div style={{ flex: '1 1 auto', overflow: 'auto', minHeight: 0 }}>
                    {this.renderOutputsBody()}
                </div>
                <div className='akari-export-band' data-akari-export-count={bands.exportAll.length}
                    data-akari-export-band-height={clampExportBandHeight(this.exportBandHeight, this.exportBandPanelHeight)}
                    style={{ height: `${clampExportBandHeight(this.exportBandHeight, this.exportBandPanelHeight)}px` }}>
                    <div className='akari-export-band-handle' data-akari-export-band-handle
                        role='separator' aria-orientation='horizontal' aria-label={t('project.workspace.bands.exportsLabel')}
                        aria-valuemin={EXPORT_BAND_MIN_HEIGHT}
                        aria-valuemax={Number.isFinite(this.exportBandPanelHeight)
                            ? Math.max(EXPORT_BAND_MIN_HEIGHT, Math.floor(this.exportBandPanelHeight * 0.7)) : undefined}
                        aria-valuenow={clampExportBandHeight(this.exportBandHeight, this.exportBandPanelHeight)}
                        onPointerDown={event => this.onExportBandPointerDown(event)}
                        onPointerMove={event => this.onExportBandPointerMove(event)}
                        onPointerUp={event => this.onExportBandPointerEnd(event)}
                        onPointerCancel={event => this.onExportBandPointerEnd(event)}
                        onDoubleClick={() => this.resetExportBandHeight()} />
                    <div className='akari-export-band-heading'>{t('project.workspace.bands.exportsLabel')} <small>exports/</small> <small>{bands.exportAll.length}</small></div>
                    <div className='akari-export-list'>
                        {bands.exportAll.length ? bands.exportAll.map(entry => this.renderExportRow(entry))
                            : <div className='akari-export-empty'>{t('project.workspace.bands.noExportsMessage')}</div>}
                    </div>
                </div>
            </div>
        );
    }

    protected renderOutputsBody(): React.ReactNode {
        if (!this.host.workflow.workspaceRoot) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>{t('project.materials.pane.openProjectAction')}</p>;
        }
        if (this.outputsLoading && !this.outputsLoadedOnce) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>{t('project.library.pane.loadingStatus')}</p>;
        }
        const bands = projectPanelBands(this.outputs);
        return (
            <div
                data-akari-records-count={RECORD_GROUPS.reduce((sum, kind) => sum + bands.records[kind].length, 0)}
                data-akari-outputs-count={this.outputs.length}
                style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 10px 10px' }}
            >
                {RECORD_GROUPS.map(kind => this.renderRecordGroup(kind, bands.records[kind]))}
            </div>
        );
    }

    protected renderRecordGroup(kind: RecordKind, entries: OutputEntry[]): React.ReactNode {
        const folded = this.foldedRecordGroups.has(kind);
        const expanded = this.expandedRecordGroups.has(kind);
        const windowed = recordGroupWindow(entries, expanded);
        const label = kind === 'plan' ? t('project.workspace.bands.planningLabel')
            : kind === 'data' ? t('project.workspace.bands.editDataLabel') : t('project.workspace.bands.reportsLabel');
        return (
            <div
                key={kind}
                data-akari-records-group={kind}
                data-akari-records-group-count={entries.length}
                data-akari-outputs-group={kind}
                data-akari-outputs-group-count={entries.length}
                style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
            >
                <button type='button' className='akari-record-group-heading' aria-expanded={!folded}
                    onClick={() => {
                        if (folded) this.foldedRecordGroups.delete(kind); else this.foldedRecordGroups.add(kind);
                        const root = this.host.workflow.workspaceRoot;
                        if (root) try { window.localStorage.setItem(`akari.records.folded:${root.toString()}`,
                            JSON.stringify([...this.foldedRecordGroups])); } catch { /* Session state still works. */ }
                        this.host.update();
                    }}><span className={`codicon codicon-chevron-${folded ? 'right' : 'down'}`} />{label} <small>{entries.length}</small></button>
                {!folded && windowed.rows.map(entry => this.renderOutputCard(entry))}
                {!folded && entries.length > 5 && <button type='button' className='akari-record-more'
                    onClick={() => {
                        if (expanded) this.expandedRecordGroups.delete(kind); else this.expandedRecordGroups.add(kind);
                        this.host.update();
                    }}>{expanded ? t('project.workspace.bands.showLessAction')
                        : t('project.workspace.bands.moreRecordsLabel', { count: windowed.remaining })}</button>}
            </div>
        );
    }

    protected renderExportRow(entry: OutputEntry): React.ReactNode {
        return <div key={entry.uri.toString()} className='akari-export-row' data-akari-export-path={entry.relativePath}
            data-akari-output-path={entry.relativePath} data-akari-output-kind='export'
            data-akari-onboarding-target='export-result'
            onClick={() => void this.host.openFile(entry.uri)} onContextMenu={event => this.openOutputContextMenu(event, entry)}
            title={entry.name}>
            {entry.thumbnailUri
                ? <img className='akari-export-icon' src={entry.thumbnailUri.toString()} alt='' />
                : <span className={`${this.outputIcon(entry)} akari-export-icon`} aria-hidden='true' />}
            <span className='akari-export-name'>{entry.name}</span>
            <small>{formatExportTimestamp(entry.mtime)}</small>
        </div>;
    }

    protected renderOutputCard(entry: OutputEntry): React.ReactNode {
        const label = entry.title ?? entry.name;
        const isEditData = entry.kind === 'data' && isEditDataFileName(entry.name);
        return (
            <div
                key={entry.uri.toString()}
                data-akari-output-path={entry.relativePath}
                data-akari-onboarding-target={entry.kind === 'export' ? 'export-result' : undefined}
                data-akari-output-kind={entry.kind}
                data-akari-output-emphasis={isEditData ? 'edit' : undefined}
                onClick={() => void this.host.openFile(entry.uri)}
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
                    className='theia-button quiet small icon'
                    title={revealInFileManagerActionLabel(label)}
                    aria-label={revealInFileManagerActionLabel(label)}
                    data-akari-output-reveal={entry.relativePath}
                    onClick={event => {
                        event.stopPropagation();
                        void this.revealOutputInFileManager(entry);
                    }}
                    style={{ flex: 'none' }}
                >
                    <span className='codicon codicon-folder-opened' aria-hidden='true' />
                </button>
            </div>
        );
    }

    protected async revealOutputInFileManager(entry: OutputEntry): Promise<void> {
        await this.host.commandService.executeCommand(AKARI_REVEAL_IN_FILE_MANAGER.id, entry.uri);
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
                void this.host.openFile(entry.uri);
                break;
            case 'reveal':
                void this.host.revealInFileManagerCommand(entry.uri);
                break;
            case 'copy-file':
                void this.host.copyFileToClipboard(entry.uri);
                break;
            case 'copy-path':
                void this.host.copyPathToClipboard(entry.uri);
                break;
            case 'rename':
                void this.host.renameEntry(entry.uri, entry.name, entry.relativePath, false, () => this.loadOutputs());
                break;
            case 'delete':
                void this.host.deleteEntry(entry.uri, entry.name, entry.relativePath, false, () => this.loadOutputs());
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
        const request = await this.host.quickInputService.input({
            placeHolder: t('project.workspace.outputs.whatWouldYouLikeAskAboutQuestion')
        });
        if (!request || !request.trim()) {
            return;
        }
        const packet = composeOutputAskAgentPrompt({ relativePath: entry.relativePath }, request);
        await this.host.commandService.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, packet);
    }
}
