import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { DisposableCollection, MessageService } from '@theia/core/lib/common';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent, FileStat } from '@theia/filesystem/lib/common/files';
import { AkariProjectService, AssetBundleOutcome, AssetCatalogViewItem, ProjectAssetReference, TranscriptState } from '../common/akari-project-protocol';
import { AkariWorkflowService } from './akari-workflow-service';
import { shouldShowProjectPath } from '../common/project-tree-policy';
import { isUnorganizedRootEntry } from '../common/unorganized-materials';
import { isEditDataFileName } from '../common/edit-data-file';
import { AnalysisJson, deriveAnalysisDurationSeconds } from '../common/analysis-summary';
import { CatalogItemMeta, parseCatalogItemMeta } from '../common/catalog-reader';
import { AssetBinChildNode, isAssetBinGroupDirectory } from '../common/asset-bin-grouping';
import { MaterialKind, resolveAssetGroupMedia } from '../common/asset-group-media';
import { referencePresentation } from '../common/project-asset-reference';
import { resolveLibraryAssetMedia } from '../common/library-asset-placement';
import { assetGroupOpenTarget } from '../common/asset-group-open-target';
import { AKARI_BORDER, AKARI_INK, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';
import { MaterialContextMenuItem } from '../common/material-context-menu-items';
import { openAkariContextMenu } from './akari-context-menu';

export interface MaterialCardEntry {
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

/**
 * プロジェクト直下の契約ファイル（edit.json 等）・アトミック書き込みの一時ファイル・
 * .akari/ 配下は素材一覧に無関係（素材一覧は assets/ 配下しか見ない）。
 * これらの変更で素材パネルを再読込しない（task 2026-08-18-shell-panel-reload-spinner 指示1）。
 */
const MATERIALS_IRRELEVANT_ROOT_FILES = new Set(['edit.json', 'captions.json', 'analysis.json', '.akari']);
function isMaterialsIrrelevantRootFile(baseName: string): boolean {
    return isEditDataFileName(baseName) || MATERIALS_IRRELEVANT_ROOT_FILES.has(baseName) || baseName.endsWith('.tmp');
}

export interface MaterialsPaneHost {
    /** 現在のプロジェクトと相対パス。 */
    readonly workflow: Pick<AkariWorkflowService, 'workspaceRoot' | 'relativePath' | 'current'>;
    /** 素材一覧の読み込みと監視。 */
    readonly files: Pick<FileService, 'resolve' | 'readFile' | 'watch' | 'onDidFilesChange'>;
    /** 参照素材、クレジット、文字起こし状態とサムネイル。 */
    readonly projectService: Pick<AkariProjectService, 'listProjectAssetReferences' | 'projectCredits' | 'transcriptStates' | 'resolveMaterialThumbnail' | 'bundleProjectAssets'>;
    /** 素材操作の通知。 */
    readonly messages: Pick<MessageService, 'info' | 'error'>;
    /** widget の再描画。 */
    readonly update: () => void;
    /** ファイル名から素材種別を判定。 */
    readonly classifyKind: (name: string) => MaterialKind;
    /** 素材グループの子を取得。 */
    readonly toAssetBinChildren: (node: FileStat) => AssetBinChildNode[];
    /** カタログ素材の現在の一覧。 */
    readonly assetCatalogItems: AssetCatalogViewItem[];
    /** 素材ごとの文字起こし状態。 */
    transcriptStateByPath: Record<string, TranscriptState>;
}

export class AkariMaterialsPane {
    public materials: MaterialCardEntry[] = [];
    public unorganizedMaterials: MaterialCardEntry[] = [];
    public materialsLoading = false;
    public materialsLoadedOnce = false;
    protected materialsGeneration = 0;
    protected materialsWatch = new DisposableCollection();
    protected materialsWatchRootKey?: string;
    protected materialsWatchTimer?: ReturnType<typeof setTimeout>;
    public referenceWatches = new DisposableCollection();
    protected referenceWatchRoot = '';
    protected referenceWatchParents = new Set<string>();

    constructor(protected readonly host: MaterialsPaneHost) {}

    public async loadMaterials(): Promise<void> {
        const root = this.host.workflow.workspaceRoot;
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
        this.host.transcriptStateByPath = states;
        this.materials = materials;
        this.projectCreditLines = credits;
        this.unorganizedMaterials = unorganizedMaterials;
        this.materialsLoading = false;
        this.materialsLoadedOnce = true;
        this.host.update();
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
                    background: AKARI_SURFACE.raised, color: AKARI_INK, cursor: 'pointer'
                }}
            >
                <span className='codicon codicon-ellipsis' aria-hidden='true' />
            </button>
        );
    }
}
