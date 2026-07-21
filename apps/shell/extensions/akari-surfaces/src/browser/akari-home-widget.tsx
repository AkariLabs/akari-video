import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { OpenerService, WidgetManager, open } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';

interface WorkflowStage {
    id: string;
    label: string;
    status: string;
    nextAction: string;
}

interface WorkflowRole {
    path: string;
    label: string;
    kind: string;
}

interface EntryCard {
    id: string;
    label: string;
    hint: string;
    icon: string;
    open: () => Promise<void>;
}

/** ドロップ／ダイアログで取り込める素材の拡張子。動画と写真のみ（音声・その他は対象外）。 */
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.tiff', '.bmp'];
const IMPORTABLE_EXTENSIONS = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS];

// workflow.json の roles に該当 kind が無いときの既定パス。
const DEFAULT_ASSETS_ROLE_PATH = 'assets';
const DEFAULT_PLANNING_ROLE_PATH = 'planning';
const DEFAULT_EXPORTS_ROLE_PATH = 'exports';

const OPEN_TIMELINE_COMMAND = 'akari.annotations.open';

@injectable()
export class AkariHomeWidget extends ReactWidget {
    static readonly ID = 'akari-home-widget';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileDialogService)
    protected readonly fileDialogs: FileDialogService;

    @inject(CommandService)
    protected readonly commands: CommandService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(WidgetManager)
    protected readonly widgets: WidgetManager;

    protected stages: WorkflowStage[] = [];
    protected guide = 'プロジェクトを開くと、ここに進み具合と次の一手が表示されます。';
    protected workflowUri: URI | undefined;
    protected watching = false;

    protected projectRoot: URI | undefined;
    protected assetsRolePath = DEFAULT_ASSETS_ROLE_PATH;
    protected planningRolePath = DEFAULT_PLANNING_ROLE_PATH;
    protected exportsRolePath = DEFAULT_EXPORTS_ROLE_PATH;

    protected hasAssets = false;
    protected entryCards: EntryCard[] = [];
    protected importing = false;
    protected importedNotice: string | undefined;
    protected dragActive = false;

    @postConstruct()
    protected init(): void {
        this.id = AkariHomeWidget.ID;
        this.title.label = 'ホーム';
        this.title.caption = 'AKARI プロジェクトホーム';
        this.title.iconClass = 'codicon codicon-home';
        this.title.closable = false;
        this.update();
    }

    async start(): Promise<void> {
        await this.loadWorkflow();
        if (this.watching) {
            return;
        }
        this.watching = true;
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (this.workflowUri && event.contains(this.workflowUri)) {
                void this.loadWorkflow();
            } else if (this.overviewWatchTargets().some(uri => event.contains(uri))) {
                void this.refreshOverview();
            }
        }));
        if (this.workflowUri) {
            try {
                this.toDispose.push(await this.fileService.watch(this.workflowUri.parent));
            } catch {
                try {
                    // `.akari` がまだ無い空プロジェクトではルートを監視し、
                    // workflow.json が後から作られた時にも追従する。
                    this.toDispose.push(await this.fileService.watch(this.workflowUri.parent.parent));
                } catch (error) {
                    console.info('[akari-surfaces] workflow watch unavailable:', error);
                }
            }
        }
        for (const target of this.overviewWatchTargets()) {
            try {
                this.toDispose.push(await this.fileService.watch(target));
            } catch (error) {
                console.info('[akari-surfaces] overview watch unavailable:', error);
            }
        }
    }

    protected overviewWatchTargets(): URI[] {
        if (!this.projectRoot) {
            return [];
        }
        const root = this.projectRoot;
        return [
            root.resolve(this.assetsRolePath),
            root.resolve(this.planningRolePath),
            root.resolve(this.exportsRolePath)
        ];
    }

    protected async loadWorkflow(): Promise<void> {
        const roots = await this.workspaceService.roots;
        const root = roots[0]?.resource;
        this.projectRoot = root;
        if (!root) {
            this.stages = [];
            this.guide = 'プロジェクトを開くと、ここに進み具合と次の一手が表示されます。';
            this.hasAssets = false;
            this.entryCards = [];
            this.update();
            return;
        }
        this.workflowUri = root.resolve('.akari/workflow.json');
        let roles: WorkflowRole[] = [];
        try {
            const content = await this.fileService.readFile(this.workflowUri);
            const parsed = JSON.parse(content.value.toString());
            this.stages = this.normalizeStages(parsed);
            roles = this.normalizeRoles(parsed);
            this.guide = this.stages.length === 0
                ? 'workflow.json にステージを追加すると、プロジェクト全体をここホームで見渡せます。'
                : '';
        } catch (error) {
            this.stages = [];
            this.guide = '進行データをまだ読めません。.akari/workflow.json を作成または修復すると自動で更新されます。';
            console.info('[akari-surfaces] workflow empty or invalid:', error);
        }
        // フォルダ名 "assets" 等のハードコードは workflow.json に role が無いときの fallback に留める。
        this.assetsRolePath = this.roleForKind(roles, 'assets') ?? DEFAULT_ASSETS_ROLE_PATH;
        this.planningRolePath = this.roleForKind(roles, 'planning') ?? DEFAULT_PLANNING_ROLE_PATH;
        this.exportsRolePath = this.roleForKind(roles, 'exports') ?? DEFAULT_EXPORTS_ROLE_PATH;
        await this.refreshOverview();
    }

    protected async refreshOverview(): Promise<void> {
        const root = this.projectRoot;
        if (!root) {
            this.hasAssets = false;
            this.entryCards = [];
            this.update();
            return;
        }
        this.hasAssets = await this.directoryHasVisibleFiles(root.resolve(this.assetsRolePath));

        const cards: EntryCard[] = [];
        const latestReport = await this.findLatestFile(root.resolve(this.planningRolePath), ['.md', '.html']);
        if (latestReport) {
            cards.push({
                id: 'report',
                label: '最新のレポートを開く',
                hint: latestReport.path.base,
                icon: 'codicon-preview',
                open: () => open(this.openerService, latestReport, { mode: 'activate' }).then(() => undefined)
            });
        }
        const latestExport = await this.findLatestFile(root.resolve(this.exportsRolePath), ['.mp4']);
        if (latestExport) {
            cards.push({
                id: 'export',
                label: '最新の書き出しを開く',
                hint: latestExport.path.base,
                icon: 'codicon-file-media',
                open: () => open(this.openerService, latestExport, { mode: 'activate' }).then(() => undefined)
            });
        }
        if (this.hasAssets) {
            cards.push({
                id: 'timeline',
                label: 'タイムラインを開く',
                hint: '注釈・テロップを編集',
                icon: 'codicon-list-tree',
                open: () => this.commands.executeCommand(OPEN_TIMELINE_COMMAND).then(() => undefined)
            });
        }
        this.entryCards = cards;
        this.update();
    }

    protected normalizeStages(workflow: any): WorkflowStage[] {
        const source = workflow?.stages ?? workflow?.steps ?? workflow?.workflow ?? [];
        const entries: Array<[string, any]> = Array.isArray(source)
            ? source.map((value: any, index: number) => [String(value?.id ?? index + 1), value])
            : source && typeof source === 'object'
                ? Object.entries(source)
                : [];
        return entries.map(([id, value]) => {
            const item = value && typeof value === 'object' ? value : { status: value };
            return {
                id,
                label: String(item.label ?? item.name ?? item.title ?? id),
                status: String(item.status ?? item.state ?? '未着手'),
                nextAction: String(item.nextAction ?? item.next_action ?? item.action ?? item.next ?? '次の一手を確認')
            };
        });
    }

    protected normalizeRoles(workflow: any): WorkflowRole[] {
        const source = Array.isArray(workflow?.roles) ? workflow.roles : [];
        return source
            .filter((entry: any) => entry && typeof entry.path === 'string')
            .map((entry: any) => ({
                path: entry.path,
                label: String(entry.label ?? entry.path),
                kind: String(entry.kind ?? '')
            }));
    }

    protected roleForKind(roles: WorkflowRole[], kind: string): string | undefined {
        return roles.find(role => role.kind === kind)?.path;
    }

    protected async directoryHasVisibleFiles(uri: URI): Promise<boolean> {
        try {
            const stat = await this.fileService.resolve(uri);
            return !!stat.children?.some(child => !child.isDirectory && this.isVisibleEntry(child.name));
        } catch {
            return false;
        }
    }

    protected async findLatestFile(uri: URI, extensions: string[]): Promise<URI | undefined> {
        try {
            const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
            const candidates = (stat.children ?? [])
                .filter(child => !child.isDirectory && this.isVisibleEntry(child.name) && extensions.includes(this.extensionOf(child.name)));
            if (!candidates.length) {
                return undefined;
            }
            candidates.sort((left, right) => (right.mtime ?? 0) - (left.mtime ?? 0));
            return candidates[0].resource;
        } catch {
            return undefined;
        }
    }

    protected isVisibleEntry(name: string): boolean {
        return name !== '.gitkeep' && !name.startsWith('.');
    }

    protected extensionOf(name: string): string {
        const match = name.match(/\.[^./\\]+$/);
        return match ? match[0].toLowerCase() : '';
    }

    protected statusColor(status: string): string {
        if (/完了|done|complete/i.test(status)) {
            return 'var(--theia-charts-green)';
        }
        if (/進行|作業|active|doing|progress/i.test(status)) {
            // 青全廃（v2 T1）: charts-blue ではなく AKARI アクセントのオレンジを使う。
            return 'var(--theia-charts-orange)';
        }
        if (/停止|blocked|error|失敗/i.test(status)) {
            return 'var(--theia-charts-red)';
        }
        return 'var(--theia-descriptionForeground)';
    }

    // --- 素材の取り込み（プラスボタン / ドラッグ＆ドロップ、どちらも実コピー） ---

    protected async pickFiles(): Promise<void> {
        if (this.importing) {
            return;
        }
        const root = this.projectRoot;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            return;
        }
        const selection = await this.fileDialogs.showOpenDialog({
            title: '取り込む動画・写真を選ぶ',
            openLabel: '取り込む',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: { '動画・写真': IMPORTABLE_EXTENSIONS.map(extension => extension.slice(1)) }
        });
        if (!selection) {
            return;
        }
        const uris = Array.isArray(selection) ? selection : [selection];
        await this.importSources(uris, root);
    }

    protected handleDragOver = (event: React.DragEvent): void => {
        if (!this.hasImportableDrag(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        if (!this.dragActive) {
            this.dragActive = true;
            this.update();
        }
    };

    protected handleDragLeave = (event: React.DragEvent): void => {
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) {
            return;
        }
        if (this.dragActive) {
            this.dragActive = false;
            this.update();
        }
    };

    protected handleDrop = (event: React.DragEvent): void => {
        if (!this.hasImportableDrag(event.dataTransfer)) {
            return;
        }
        // ここに来たドロップはこのドロップゾーンが引き取る
        // （akari-project 側のグローバルなドロップ処理は data-akari-dropzone を見て道を譲る）。
        event.preventDefault();
        event.stopPropagation();
        this.dragActive = false;
        const sources = this.resolveDroppedSources(event.dataTransfer);
        if (!sources.length) {
            this.messages.warn('動画または写真のファイルをドロップしてください。');
            this.update();
            return;
        }
        const root = this.projectRoot;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            this.update();
            return;
        }
        void this.importSources(sources, root);
    };

    protected handleDropzoneKeyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void this.pickFiles();
        }
    };

    protected hasImportableDrag(transfer: DataTransfer | null): boolean {
        return !!transfer && (transfer.types.includes('Files') || transfer.types.includes('text/uri-list'));
    }

    /**
     * ドロップされた実ファイルの絶対パスを解決する。Electron の preload ブリッジ
     * （`electronTheiaCore.getPathForFile`）を優先し、無い環境では `File#path` に
     * フォールバックする（akari-project の動画ドロップ実装と同じ経路）。
     */
    protected resolveDroppedSources(transfer: DataTransfer | null): URI[] {
        if (!transfer) {
            return [];
        }
        const fromFiles = Array.from(transfer.files)
            .filter(file => IMPORTABLE_EXTENSIONS.includes(this.extensionOf(file.name)))
            .map(file => {
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
                sourcePath ||= (file as File & { path?: string }).path;
                return sourcePath ? URI.fromFilePath(sourcePath) : undefined;
            })
            .filter((uri): uri is URI => !!uri);
        if (fromFiles.length) {
            return fromFiles;
        }
        const uriList = transfer.getData('text/uri-list');
        return uriList.split(/\r?\n/)
            .filter(line => line.startsWith('file:') && IMPORTABLE_EXTENSIONS.includes(this.extensionOf(line)))
            .map(line => new URI(line));
    }

    protected async importSources(sources: URI[], root: URI): Promise<void> {
        const supported = sources.filter(uri => IMPORTABLE_EXTENSIONS.includes(this.extensionOf(uri.path.base)));
        if (!supported.length) {
            this.messages.warn('動画または写真のファイルを選んでください。');
            return;
        }
        this.importing = true;
        this.update();
        const assetsUri = root.resolve(this.assetsRolePath);
        let imported = 0;
        let failed = 0;
        for (const source of supported) {
            try {
                // FileService.copy は同名ファイルがあると例外になる（自動リネームはしない）。
                // 同じ素材の再ドロップを失敗にしないため、空いている名前を探してからコピーする。
                const target = await this.availableTarget(assetsUri, this.safeFileName(source.path.base));
                await this.fileService.copy(source, target, { fromUserGesture: true });
                imported++;
            } catch (error) {
                failed++;
                console.error('[akari-surfaces] failed to import asset', error);
            }
        }
        this.importing = false;
        if (imported) {
            this.importedNotice = failed
                ? `${imported} 件を取り込みました（${failed} 件は失敗）。分析やプラン作成に進めます。`
                : '素材を取り込みました。分析やプラン作成に進めます。';
            this.messages.info(this.importedNotice);
            await this.refreshExplorer();
        } else {
            this.messages.error('取り込めませんでした。Finder からもう一度お試しください。');
        }
        await this.refreshOverview();
    }

    protected async refreshExplorer(): Promise<void> {
        try {
            const navigator = await this.widgets.getOrCreateWidget('files') as any;
            await navigator.model?.refresh?.();
        } catch {
            // Explorer がまだ無い場合はワークスペースの監視側で追従する。
        }
    }

    protected safeFileName(name: string): string {
        return name.replace(/[\\/]/g, '_').replace(/[^\p{L}\p{N}._ -]/gu, '_');
    }

    /** 同名ファイルが既にあるときは `name-2.ext` 形式で空きを探す（上書きしない）。 */
    protected async availableTarget(directory: URI, name: string): Promise<URI> {
        const extension = this.extensionOf(name);
        const stem = extension ? name.slice(0, -extension.length) : name;
        let candidate = directory.resolve(name);
        for (let index = 2; await this.fileService.exists(candidate); index++) {
            candidate = directory.resolve(`${stem}-${index}${extension}`);
        }
        return candidate;
    }

    // --- レンダリング ---

    protected override render(): React.ReactNode {
        return (
            <div className='akari-home-surface' style={{ height: '100%', overflow: 'auto', padding: '24px 26px', boxSizing: 'border-box' }}>
                <header style={{ marginBottom: 22 }}>
                    <div style={{ fontSize: 12, letterSpacing: '0.12em', opacity: 0.65 }}>AKARI VIDEO</div>
                    <h1 style={{ margin: '6px 0 4px', fontSize: 26 }}>ホーム</h1>
                    <p style={{ margin: 0, opacity: 0.7 }}>いまどこにいて、次に何をするかを一望できます。</p>
                </header>
                {this.hasAssets ? this.renderProjectOverview() : this.renderDropzone('hero')}
            </div>
        );
    }

    protected renderProjectOverview(): React.ReactNode {
        return (
            <>
                {this.importedNotice && (
                    <div role='status' style={{
                        marginBottom: 16, padding: '10px 14px', borderRadius: 8,
                        border: '1px solid var(--theia-widget-border)', background: 'var(--theia-editorWidget-background)'
                    }}>
                        {this.importedNotice}
                    </div>
                )}
                {this.stages.length > 0 ? (
                    <div style={{
                        display: 'grid', gridTemplateColumns: `repeat(${Math.min(this.stages.length, 4)}, minmax(190px, 1fr))`,
                        gap: 12, marginBottom: 20
                    }}>
                        {this.stages.map((stage, index) => (
                            <section key={stage.id} style={{
                                border: '1px solid var(--theia-widget-border)', borderRadius: 10,
                                padding: 16, background: 'var(--theia-sideBar-background)', minHeight: 150
                            }}>
                                <div style={{ opacity: 0.55, fontSize: 12 }}>STAGE {index + 1}</div>
                                <h2 style={{ margin: '8px 0 12px', fontSize: 18 }}>{stage.label}</h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 16 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: this.statusColor(stage.status) }} />
                                    <span>{stage.status}</span>
                                </div>
                                <div style={{ borderTop: '1px solid var(--theia-widget-border)', paddingTop: 11 }}>
                                    <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 4 }}>次の一手</div>
                                    <strong>{stage.nextAction}</strong>
                                </div>
                            </section>
                        ))}
                    </div>
                ) : (
                    this.guide && <p style={{ opacity: 0.7, marginBottom: 20 }}>{this.guide}</p>
                )}
                {this.entryCards.length > 0 && (
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: 12, marginBottom: 24
                    }}>
                        {this.entryCards.map(card => (
                            <button key={card.id} type='button' className='theia-button secondary'
                                onClick={() => void card.open()}
                                style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
                                    padding: '14px 16px', borderRadius: 10, textAlign: 'left', height: 'auto'
                                }}>
                                <span className={`codicon ${card.icon}`} aria-hidden='true' style={{ fontSize: 18 }} />
                                <strong>{card.label}</strong>
                                <small style={{ opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                                    {card.hint}
                                </small>
                            </button>
                        ))}
                    </div>
                )}
                {this.renderDropzone('inline')}
            </>
        );
    }

    protected renderDropzone(variant: 'hero' | 'inline'): React.ReactNode {
        const isHero = variant === 'hero';
        return (
            <div
                role='button'
                tabIndex={0}
                aria-label='動画や写真を取り込む'
                data-akari-dropzone='true'
                onDragOver={this.handleDragOver}
                onDragLeave={this.handleDragLeave}
                onDrop={this.handleDrop}
                onClick={() => void this.pickFiles()}
                onKeyDown={this.handleDropzoneKeyDown}
                style={{
                    display: 'flex',
                    flexDirection: isHero ? 'column' : 'row',
                    alignItems: 'center',
                    justifyContent: isHero ? 'center' : 'flex-start',
                    gap: isHero ? 14 : 12,
                    minHeight: isHero ? 320 : 64,
                    padding: isHero ? 32 : '14px 18px',
                    borderRadius: 14,
                    cursor: 'pointer',
                    border: `2px dashed ${this.dragActive ? 'var(--theia-focusBorder)' : 'var(--theia-widget-border)'}`,
                    background: this.dragActive ? 'var(--theia-list-dropBackground)' : 'var(--theia-sideBar-background)',
                    textAlign: isHero ? 'center' : 'left'
                }}
            >
                <button type='button' className='theia-button' aria-label='ファイルを選ぶ'
                    onClick={event => { event.stopPropagation(); void this.pickFiles(); }}
                    style={{
                        width: isHero ? 56 : 36, height: isHero ? 56 : 36, borderRadius: '50%',
                        fontSize: isHero ? 28 : 18, lineHeight: 1, padding: 0, flex: '0 0 auto'
                    }}>
                    +
                </button>
                <div>
                    {isHero ? (
                        <>
                            <h2 style={{ margin: 0 }}>ここに動画や写真を入れると始まります</h2>
                            <p style={{ margin: '6px 0 0', opacity: 0.75, maxWidth: 420 }}>
                                ドラッグ＆ドロップするか、＋ボタンから選んでください。
                            </p>
                        </>
                    ) : (
                        <>
                            <strong>素材を追加</strong>
                            <div style={{ opacity: 0.7, fontSize: 12 }}>ドラッグ＆ドロップ、または＋で選択</div>
                        </>
                    )}
                    {this.importing && <div role='status' style={{ marginTop: 6, fontSize: 12 }}>取り込み中…</div>}
                </div>
            </div>
        );
    }
}
