import URI from '@theia/core/lib/common/uri';
import { DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import {
    ApplicationShell,
    FrontendApplication,
    FrontendApplicationContribution,
    NavigatableWidget,
    OpenerService,
    Title,
    Widget,
    WidgetManager,
    WidgetOpenerOptions,
    open
} from '@theia/core/lib/browser';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChange, FileChangeType, FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';

const DEFAULT_ARTIFACT_GLOBS = [
    'planning/**/*.md',
    'planning/**/*.html',
    'exports/*.mp4'
];
const DEFAULT_SIDECAR_SUFFIXES = ['.meta.json', '.decisions.json', '.analysis.json'];
const DECISIONS_SUFFIX = '.decisions.json';
const EDITING_RECENCY_MS = 2000;

interface RootConfiguration {
    root: URI;
    workflow: URI;
    artifactGlobs: string[];
    artifactMatchers: RegExp[];
    sidecarSuffixes: string[];
}

type BadgeState =
    | { kind: 'neutral' }
    | { kind: 'editing' }
    | { kind: 'pending'; count: number }
    | { kind: 'complete' };

@injectable()
export class AkariTabsContribution implements FrontendApplicationContribution, TabBarDecorator {
    readonly id = 'akari-tabs-decorator';

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(OpenerService)
    protected readonly openerService!: OpenerService;

    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    protected readonly onDidChangeDecorationsEmitter = new Emitter<void>();
    readonly onDidChangeDecorations: Event<void> = this.onDidChangeDecorationsEmitter.event;

    protected readonly toDispose = new DisposableCollection(this.onDidChangeDecorationsEmitter);
    protected rootWatchers = new DisposableCollection();
    protected rootConfigurations: RootConfiguration[] = [];
    protected rootGeneration = 0;
    protected readonly badgeStates = new Map<string, BadgeState>();
    protected readonly badgeLoads = new Set<string>();
    protected readonly badgeRevisions = new Map<string, number>();
    protected readonly editingTimers = new Map<string, number>();
    protected readonly opening = new Map<string, Promise<void>>();

    async onStart(_app: FrontendApplication): Promise<void> {
        this.toDispose.pushAll([
            this.fileService.onDidFilesChange(event => void this.processChanges(event.changes)),
            this.workspaceService.onWorkspaceChanged(roots => void this.configureRoots(roots)),
            this.shell.onDidAddWidget(widget => {
                const uri = this.resourceUri(widget);
                if (uri && this.configurationForArtifact(uri)) {
                    this.ensureBadgeState(uri);
                }
            })
        ]);
        await this.workspaceService.ready;
        await this.configureRoots(await this.workspaceService.roots);
    }

    onStop(): void {
        this.rootWatchers.dispose();
        this.toDispose.dispose();
        for (const key of this.editingTimers.keys()) {
            this.clearEditingTimer(key);
        }
    }

    decorate(title: Title<Widget>): WidgetDecoration.Data[] {
        const artifact = this.resourceUri(title.owner);
        if (!artifact || !this.configurationForArtifact(artifact)) {
            return [];
        }
        const key = this.uriKey(artifact);
        this.ensureBadgeState(artifact);
        const state = this.badgeStates.get(key);
        if (!state || state.kind === 'neutral') {
            return [];
        }
        if (state.kind === 'editing') {
            return [{
                priority: 100,
                tailDecorations: [{
                    data: '●',
                    // 青全廃（v2 T1）: charts-blue ではなく AKARI アクセントのオレンジを使う。
                    fontData: { color: 'var(--theia-charts-orange)' },
                    tooltip: '決定を編集中'
                }],
                tooltip: '決定を編集中'
            }];
        }
        if (state.kind === 'pending') {
            return [{
                priority: 90,
                badge: state.count,
                tooltip: `未回答の決定 ${state.count} 件`
            }];
        }
        return [{
            priority: 80,
            tailDecorations: [{
                data: '✓',
                fontData: { color: 'var(--theia-charts-green)' },
                tooltip: 'すべての決定に回答済み'
            }],
            tooltip: 'すべての決定に回答済み'
        }];
    }

    protected async configureRoots(roots: FileStat[]): Promise<void> {
        const generation = ++this.rootGeneration;
        const configurations = await Promise.all(roots.map(root => this.loadRootConfiguration(root.resource)));
        if (generation !== this.rootGeneration) {
            return;
        }

        this.rootWatchers.dispose();
        this.rootWatchers = new DisposableCollection();
        this.rootConfigurations = configurations.sort((left, right) =>
            right.root.path.toString().length - left.root.path.toString().length
        );
        for (const configuration of this.rootConfigurations) {
            this.rootWatchers.push(this.fileService.watch(configuration.root, { recursive: true, excludes: [] }));
        }
        this.clearBadgeStates();
    }

    protected async loadRootConfiguration(root: URI): Promise<RootConfiguration> {
        const workflow = root.resolve('.akari/workflow.json');
        let artifactGlobs = DEFAULT_ARTIFACT_GLOBS;
        let sidecarSuffixes = DEFAULT_SIDECAR_SUFFIXES;
        try {
            const content = await this.fileService.readFile(workflow);
            const parsed = JSON.parse(content.value.toString());
            const declaredGlobs = collectArtifactGlobs(parsed);
            if (declaredGlobs.length > 0) {
                artifactGlobs = declaredGlobs;
            }
            const declaredSuffixes = stringArray(parsed?.tree?.sidecarSuffixes);
            if (declaredSuffixes.length > 0) {
                sidecarSuffixes = declaredSuffixes;
            }
        } catch {
            // Missing or malformed workflow data deliberately uses the product defaults.
        }
        const expandedGlobs = unique(artifactGlobs.flatMap(expandBraces).map(normalizePattern).filter(Boolean));
        return {
            root,
            workflow,
            artifactGlobs: expandedGlobs,
            artifactMatchers: expandedGlobs.map(globToRegExp),
            sidecarSuffixes: unique(sidecarSuffixes)
        };
    }

    protected async processChanges(changes: readonly FileChange[]): Promise<void> {
        const workflows = unique(changes
            .map(change => this.rootConfigurations.find(configuration => configuration.workflow.isEqual(change.resource)))
            .filter((configuration): configuration is RootConfiguration => !!configuration)
            .map(configuration => this.uriKey(configuration.root)));
        for (const rootKey of workflows) {
            await this.refreshRootConfiguration(rootKey);
        }

        for (const change of changes) {
            const artifactFromSidecar = this.artifactFromDecisionsSidecar(change.resource);
            if (artifactFromSidecar && this.configurationForArtifact(artifactFromSidecar)) {
                void this.refreshBadgeState(artifactFromSidecar);
                continue;
            }
            if (change.type === FileChangeType.ADDED && this.configurationForArtifact(change.resource)) {
                void this.openArtifact(change.resource);
            }
        }
    }

    protected async refreshRootConfiguration(rootKey: string): Promise<void> {
        const index = this.rootConfigurations.findIndex(configuration => this.uriKey(configuration.root) === rootKey);
        if (index < 0) {
            return;
        }
        const current = this.rootConfigurations[index];
        this.rootConfigurations[index] = await this.loadRootConfiguration(current.root);
        this.clearBadgeStates();
    }

    protected async openArtifact(uri: URI): Promise<void> {
        const key = this.uriKey(uri);
        const activeOpen = this.opening.get(key);
        if (activeOpen) {
            return activeOpen;
        }
        const operation = this.doOpenArtifact(uri)
            .catch(error => console.warn(`[akari-tabs] unable to open new artifact ${uri.toString()}`, error))
            .finally(() => this.opening.delete(key));
        this.opening.set(key, operation);
        return operation;
    }

    protected async doOpenArtifact(uri: URI): Promise<void> {
        const existing = await this.findOpenWidget(uri);
        if (existing) {
            await this.shell.activateWidget(existing.id);
            this.ensureBadgeState(uri);
            return;
        }
        const options: WidgetOpenerOptions = { mode: 'activate', widgetOptions: { area: 'main' } };
        await open(this.openerService, uri, options);
        this.ensureBadgeState(uri);
    }

    protected async findOpenWidget(uri: URI): Promise<Widget | undefined> {
        const editor = await this.editorManager.getByUri(uri);
        if (editor?.isAttached) {
            return editor;
        }
        for (const widget of this.widgetManager.getWidgets(WebviewWidget.FACTORY_ID)) {
            if (widget instanceof WebviewWidget && widget.identifier.viewId) {
                const viewUri = this.safeUri(widget.identifier.viewId);
                if (viewUri && this.sameResource(viewUri, uri) && widget.isAttached) {
                    return widget;
                }
            }
        }
        return this.shell.widgets.find(widget => {
            const resource = this.resourceUri(widget);
            return !!resource && this.sameResource(resource, uri) && widget.isAttached;
        });
    }

    protected configurationForArtifact(uri: URI): RootConfiguration | undefined {
        const configuration = this.rootConfigurations.find(candidate => candidate.root.isEqualOrParent(uri));
        if (!configuration) {
            return undefined;
        }
        const relative = configuration.root.relative(uri)?.toString().replace(/\\/g, '/');
        if (!relative || configuration.sidecarSuffixes.some(suffix => relative.endsWith(suffix))) {
            return undefined;
        }
        return configuration.artifactMatchers.some(matcher => matcher.test(relative)) ? configuration : undefined;
    }

    protected artifactFromDecisionsSidecar(uri: URI): URI | undefined {
        const path = uri.path.toString();
        if (!path.endsWith(DECISIONS_SUFFIX)) {
            return undefined;
        }
        return uri.withPath(path.slice(0, -DECISIONS_SUFFIX.length)).withoutQuery().withoutFragment();
    }

    protected decisionsSidecar(artifact: URI): URI {
        return artifact.withPath(`${artifact.path.toString()}${DECISIONS_SUFFIX}`).withoutQuery().withoutFragment();
    }

    protected ensureBadgeState(artifact: URI): void {
        const key = this.uriKey(artifact);
        if (!this.badgeStates.has(key) && !this.badgeLoads.has(key)) {
            void this.refreshBadgeState(artifact);
        }
    }

    protected async refreshBadgeState(artifact: URI): Promise<void> {
        const key = this.uriKey(artifact);
        const revision = (this.badgeRevisions.get(key) ?? 0) + 1;
        this.badgeRevisions.set(key, revision);
        this.badgeLoads.add(key);
        const state = await this.readBadgeState(artifact);
        if (this.badgeRevisions.get(key) === revision) {
            this.badgeLoads.delete(key);
            this.setBadgeState(key, state);
        }
    }

    protected async readBadgeState(artifact: URI): Promise<BadgeState> {
        const key = this.uriKey(artifact);
        const sidecar = this.decisionsSidecar(artifact);
        this.clearEditingTimer(key);
        try {
            const content = await this.fileService.readFile(sidecar);
            const parsed = JSON.parse(content.value.toString());
            const decisions = Array.isArray(parsed?.decisions) ? parsed.decisions : [];
            const age = Date.now() - content.mtime;
            if (age < EDITING_RECENCY_MS) {
                const delay = Math.max(1, EDITING_RECENCY_MS - age + 25);
                this.editingTimers.set(key, window.setTimeout(() => {
                    this.editingTimers.delete(key);
                    if (this.configurationForArtifact(artifact)) {
                        void this.refreshBadgeState(artifact);
                    }
                }, delay));
                return { kind: 'editing' };
            }
            if (decisions.length === 0) {
                return { kind: 'neutral' };
            }
            const unanswered = decisions.filter((decision: any) =>
                decision?.answer == null || decision?.answeredAt == null
            ).length;
            return unanswered > 0 ? { kind: 'pending', count: unanswered } : { kind: 'complete' };
        } catch {
            return { kind: 'neutral' };
        }
    }

    protected setBadgeState(key: string, state: BadgeState): void {
        const previous = this.badgeStates.get(key);
        this.badgeStates.set(key, state);
        if (!previous || previous.kind !== state.kind
            || (previous.kind === 'pending' && state.kind === 'pending' && previous.count !== state.count)) {
            this.onDidChangeDecorationsEmitter.fire(undefined);
        }
    }

    protected clearBadgeStates(): void {
        for (const key of this.editingTimers.keys()) {
            this.clearEditingTimer(key);
        }
        this.badgeStates.clear();
        this.badgeLoads.clear();
        this.badgeRevisions.clear();
        this.onDidChangeDecorationsEmitter.fire(undefined);
    }

    protected clearEditingTimer(key: string): void {
        const timer = this.editingTimers.get(key);
        if (timer !== undefined) {
            window.clearTimeout(timer);
            this.editingTimers.delete(key);
        }
    }

    protected resourceUri(widget: Widget): URI | undefined {
        const navigatable = NavigatableWidget.getUri(widget);
        if (navigatable) {
            return navigatable.withoutQuery().withoutFragment();
        }
        if (widget instanceof WebviewWidget && widget.identifier.viewId) {
            return this.safeUri(widget.identifier.viewId);
        }
        return undefined;
    }

    protected safeUri(value: string): URI | undefined {
        try {
            return new URI(value).withoutQuery().withoutFragment();
        } catch {
            return undefined;
        }
    }

    protected sameResource(left: URI, right: URI): boolean {
        return this.uriKey(left) === this.uriKey(right);
    }

    protected uriKey(uri: URI): string {
        return uri.withoutQuery().withoutFragment().normalizePath().toString();
    }
}

function collectArtifactGlobs(workflow: any): string[] {
    const result: string[] = [];
    for (const stage of objectValues(workflow?.stages)) {
        collectGlobDeclaration(stage?.artifacts, result);
    }
    for (const role of objectValues(workflow?.roles)) {
        collectGlobDeclaration(role?.globs, result);
    }
    return unique(result.map(normalizePattern).filter(Boolean));
}

function collectGlobDeclaration(value: any, result: string[]): void {
    if (typeof value === 'string') {
        if (value.trim()) {
            result.push(value);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(entry => collectGlobDeclaration(entry, result));
        return;
    }
    if (value && typeof value === 'object') {
        for (const key of ['glob', 'globs', 'pattern', 'patterns', 'path']) {
            if (key in value) {
                collectGlobDeclaration(value[key], result);
            }
        }
    }
}

function objectValues(value: any): any[] {
    if (Array.isArray(value)) {
        return value;
    }
    return value && typeof value === 'object' ? Object.values(value) : [];
}

function stringArray(value: any): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        : [];
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function normalizePattern(pattern: string): string {
    return pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function expandBraces(pattern: string): string[] {
    const open = pattern.indexOf('{');
    if (open < 0) {
        return [pattern];
    }
    const close = pattern.indexOf('}', open + 1);
    if (close < 0) {
        return [pattern];
    }
    const alternatives = pattern.slice(open + 1, close).split(',');
    if (alternatives.length < 2) {
        return [pattern];
    }
    return alternatives.flatMap(alternative =>
        expandBraces(`${pattern.slice(0, open)}${alternative}${pattern.slice(close + 1)}`)
    );
}

function globToRegExp(glob: string): RegExp {
    let source = '^';
    for (let index = 0; index < glob.length; index++) {
        const character = glob[index];
        if (character === '*' && glob[index + 1] === '*') {
            index++;
            if (glob[index + 1] === '/') {
                index++;
                source += '(?:.*/)?';
            } else {
                source += '.*';
            }
        } else if (character === '*') {
            source += '[^/]*';
        } else {
            source += escapeRegExp(character);
        }
    }
    return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
    return /[\\^$.*+?()[\]{}|]/.test(value) ? `\\${value}` : value;
}
