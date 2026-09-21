import URI from '@theia/core/lib/common/uri';
import type {
    CompanionDocumentState,
    CompanionProjectLocation,
    CompanionSelectionEntry,
    CompanionStateDocs,
    CompanionStateLight
} from '../common/akari-companion-protocol';

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const LIGHT_INTERVAL_MS = 100;

interface DisposableLike { dispose(): void; }
interface CollectorLocation { editUri: URI | undefined; captionsUri: URI; root: URI; }
interface FileChangeEventLike { contains(uri: URI): boolean; }
interface EventSourceLike {
    addEventListener(type: string, listener: EventListener): void;
    removeEventListener(type: string, listener: EventListener): void;
}

interface ParsedFsPath {
    root: string;
    segments: string[];
    caseInsensitive: boolean;
}

function normalizedSegments(parts: string[]): string[] {
    const result: string[] = [];
    for (const part of parts) {
        if (!part || part === '.') continue;
        if (part === '..') result.pop();
        else result.push(part);
    }
    return result;
}

function parseAbsoluteFsPath(value: string): ParsedFsPath | undefined {
    const windows = /^([A-Za-z]):[\\/]/.exec(value);
    if (windows) {
        return {
            root: `${windows[1].toLowerCase()}:`,
            segments: normalizedSegments(value.slice(3).split(/[\\/]+/)),
            caseInsensitive: true
        };
    }
    if (!value.startsWith('/')) return undefined;
    return { root: '/', segments: normalizedSegments(value.slice(1).split('/')), caseInsensitive: false };
}

function relativeFsPath(rootFsPath: string, targetFsPath: string): string | undefined {
    const root = parseAbsoluteFsPath(rootFsPath);
    const target = parseAbsoluteFsPath(targetFsPath);
    if (!root || !target || root.root !== target.root || root.caseInsensitive !== target.caseInsensitive) return undefined;
    let common = 0;
    while (common < root.segments.length && common < target.segments.length) {
        const rootPart = root.segments[common];
        const targetPart = target.segments[common];
        if (root.caseInsensitive ? rootPart.toLowerCase() !== targetPart.toLowerCase() : rootPart !== targetPart) break;
        common++;
    }
    const relative = [
        ...Array.from({ length: root.segments.length - common }, () => '..'),
        ...target.segments.slice(common)
    ].join('/');
    if (!relative || relative.split('/').includes('..') || relative.startsWith('/')
        || /^[A-Za-z]:[\\/]/.test(relative)) return undefined;
    return relative;
}

export interface CompanionStateCollectorDeps {
    events: EventSourceLike;
    shell: { widgets: ReadonlyArray<{ id: string }>; currentWidget?: { id: string } };
    files: {
        exists(uri: URI): Promise<boolean>;
        readFile(uri: URI): Promise<{ value: { buffer: Uint8Array } }>;
        onDidFilesChange(listener: (event: FileChangeEventLike) => void): DisposableLike;
        watch(uri: URI, options: { recursive: boolean; excludes: string[] }): DisposableLike;
    };
    currentLocation(): CollectorLocation | undefined;
    currentProjectLocation(): CompanionProjectLocation | undefined;
    currentProjectSessionId(): string | undefined;
    onLocationChanged(listener: () => void): DisposableLike;
    pushStateLight(state: CompanionStateLight): Promise<void>;
    pushStateDocs(state: CompanionStateDocs): Promise<void>;
    now?(): number;
    setTimeout?(fn: () => void, ms: number): unknown;
    clearTimeout?(handle: unknown): void;
    digest?(bytes: Uint8Array): Promise<string>;
}

export class CompanionStateCollector {
    protected seq = 0;
    protected selection: CompanionSelectionEntry[] = [];
    protected playhead: { seconds: number; playing: boolean } | undefined;
    protected docs: CompanionStateDocs | undefined;
    protected locationKey = '';
    protected refreshRevision = 0;
    protected pendingLight: CompanionStateLight | undefined;
    protected lightTimer: unknown;
    protected lightSending = false;
    protected lastLightSentAt = Number.NEGATIVE_INFINITY;
    protected watcher: DisposableLike | undefined;
    protected readonly disposables: DisposableLike[] = [];

    constructor(protected readonly deps: CompanionStateCollectorDeps) { }

    start(): void {
        this.deps.events.addEventListener('akari.timeline.primarySelected', this.onPrimarySelected);
        this.deps.events.addEventListener('akari.timeline.overlaySelected', this.onOverlaySelected);
        this.deps.events.addEventListener('akari.timeline.layerSelected', this.onLayerSelected);
        this.deps.events.addEventListener('akari.preview.playbackTick', this.onPlaybackTick);
        this.disposables.push(this.deps.onLocationChanged(() => this.checkLocation()));
        this.disposables.push(this.deps.files.onDidFilesChange(event => {
            const location = this.deps.currentLocation();
            if (location && ((location.editUri && event.contains(location.editUri)) || event.contains(location.captionsUri))) {
                void this.refreshDocuments();
            }
        }));
        this.checkLocation();
        this.queueLight();
    }

    stop(): void {
        this.deps.events.removeEventListener('akari.timeline.primarySelected', this.onPrimarySelected);
        this.deps.events.removeEventListener('akari.timeline.overlaySelected', this.onOverlaySelected);
        this.deps.events.removeEventListener('akari.timeline.layerSelected', this.onLayerSelected);
        this.deps.events.removeEventListener('akari.preview.playbackTick', this.onPlaybackTick);
        for (const disposable of this.disposables.splice(0)) disposable.dispose();
        this.watcher?.dispose();
        this.watcher = undefined;
        if (this.lightTimer !== undefined) {
            if (this.deps.clearTimeout) this.deps.clearTimeout(this.lightTimer);
            else clearTimeout(this.lightTimer as ReturnType<typeof setTimeout>);
            this.lightTimer = undefined;
        }
    }

    snapshot(): unknown {
        const light = this.buildLight(false);
        return this.docs
            ? {
                ...light,
                edit: this.docs.edit,
                captions: this.docs.captions,
                ...(this.docs.location ? { location: { ...this.docs.location } } : {})
            }
            : light;
    }

    projectChanged(): void {
        this.checkLocation();
    }

    /**
     * つなぎ直した直後に呼ぶ。相手は前の接続で受け取った本文を持っていないので、
     * ハッシュが変わっていなくても docs を送り直す（送らないと相手は状態を待ったまま止まる）。
     */
    async resendDocuments(): Promise<void> {
        this.docs = undefined;
        this.queueLight();
        await this.refreshDocuments();
    }

    async refreshDocuments(): Promise<void> {
        const location = this.deps.currentLocation();
        const projectSessionId = this.deps.currentProjectSessionId();
        if (!location || !projectSessionId) {
            this.docs = undefined;
            this.queueLight();
            return;
        }
        const expectedLocationKey = this.locationKey;
        const revision = ++this.refreshRevision;
        const [editBytes, captionsBytes] = await Promise.all([
            this.readBytes(location.editUri), this.readBytes(location.captionsUri)
        ]);
        const [editSha256, captionsSha256] = await Promise.all([
            this.digest(editBytes), this.digest(captionsBytes)
        ]);
        if (revision !== this.refreshRevision || expectedLocationKey !== this.locationKey
            || projectSessionId !== this.deps.currentProjectSessionId()) return;
        if (this.docs?.projectSessionId === projectSessionId
            && this.docs.edit.sha256 === editSha256 && this.docs.captions.sha256 === captionsSha256) return;
        const state: CompanionStateDocs = {
            type: 'docs', seq: ++this.seq, projectSessionId,
            edit: this.documentState(editBytes, editSha256),
            captions: this.documentState(captionsBytes, captionsSha256)
        };
        const docsLocation = this.docsLocation(projectSessionId);
        if (docsLocation) state.location = docsLocation;
        this.docs = state;
        await this.deps.pushStateDocs(state);
        this.queueLight();
    }

    protected checkLocation(): void {
        const location = this.deps.currentLocation();
        const projectLocation = this.deps.currentProjectLocation();
        const projectSessionId = this.deps.currentProjectSessionId() ?? '';
        const projectLocationKey = projectLocation
            ? `\n${projectLocation.projectSessionId}\n${projectLocation.rootFsPath}`
                + `\n${projectLocation.editFsPath}\n${projectLocation.captionsFsPath}`
            : '\n';
        const key = location
            ? `${projectSessionId}\n${location.root.toString()}\n${location.editUri?.toString() ?? ''}`
                + `\n${location.captionsUri.toString()}${projectLocationKey}`
            : `${projectSessionId}${projectLocationKey}`;
        if (key === this.locationKey) return;
        this.locationKey = key;
        this.watcher?.dispose();
        this.watcher = location
            ? this.deps.files.watch(location.root, { recursive: true, excludes: [] }) : undefined;
        this.docs = undefined;
        void this.refreshDocuments();
        this.queueLight();
    }

    protected docsLocation(projectSessionId: string): CompanionStateDocs['location'] {
        const location = this.deps.currentProjectLocation();
        if (!location || location.projectSessionId !== projectSessionId) return undefined;
        const editPath = relativeFsPath(location.rootFsPath, location.editFsPath);
        const captionsPath = relativeFsPath(location.rootFsPath, location.captionsFsPath);
        if (!editPath || !captionsPath) return undefined;
        return { rootFsPath: location.rootFsPath, editPath, captionsPath };
    }

    protected readonly onPrimarySelected: EventListener = event => {
        const detail = (event as CustomEvent<{ selection?: CompanionSelectionEntry | null }>).detail;
        this.selection = this.selection.filter(entry => entry.kind !== 'cut' && entry.kind !== 'caption');
        if (detail?.selection && typeof detail.selection.id === 'string' && typeof detail.selection.kind === 'string') {
            this.selection.unshift({ kind: detail.selection.kind, id: detail.selection.id });
        }
        this.queueLight();
    };

    protected readonly onOverlaySelected: EventListener = event => {
        const overlayId = (event as CustomEvent<{ overlayId?: string | null }>).detail?.overlayId;
        this.selection = this.selection.filter(entry => entry.kind !== 'overlay');
        if (typeof overlayId === 'string') this.selection.push({ kind: 'overlay', id: overlayId });
        this.queueLight();
    };

    protected readonly onLayerSelected: EventListener = event => {
        const layerId = (event as CustomEvent<{ layerId?: string | null }>).detail?.layerId;
        this.selection = this.selection.filter(entry => entry.kind !== 'layer');
        if (typeof layerId === 'string') this.selection.push({ kind: 'layer', id: layerId });
        this.queueLight();
    };

    protected readonly onPlaybackTick: EventListener = event => {
        const detail = (event as CustomEvent<{ time?: unknown; playing?: unknown }>).detail;
        if (!Number.isFinite(detail?.time) || typeof detail?.playing !== 'boolean') return;
        this.playhead = { seconds: detail.time as number, playing: detail.playing };
        this.queueLight();
    };

    protected documentState(bytes: Uint8Array, sha256: string): CompanionDocumentState {
        if (bytes.byteLength > MAX_DOCUMENT_BYTES) return { sha256, tooLarge: true };
        return { sha256, text: new TextDecoder().decode(bytes) };
    }

    protected async readBytes(uri: URI | undefined): Promise<Uint8Array> {
        if (!uri) return new Uint8Array();
        try {
            if (!await this.deps.files.exists(uri)) return new Uint8Array();
            const file = await this.deps.files.readFile(uri);
            return new Uint8Array(file.value.buffer);
        } catch {
            return new Uint8Array();
        }
    }

    protected async digest(bytes: Uint8Array): Promise<string> {
        if (this.deps.digest) return this.deps.digest(bytes);
        const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    protected buildLight(increment = true): CompanionStateLight {
        const state: CompanionStateLight = {
            type: 'light',
            seq: increment ? ++this.seq : this.seq,
            selection: this.selection.map(entry => ({ ...entry })),
            panels: this.deps.shell.widgets.map(widget => widget.id)
        };
        const projectSessionId = this.deps.currentProjectSessionId();
        if (projectSessionId) state.projectSessionId = projectSessionId;
        if (this.playhead) state.playhead = { ...this.playhead };
        if (this.deps.shell.currentWidget) state.focus = { panel: this.deps.shell.currentWidget.id };
        if (this.docs) {
            state.docs = {
                editSha256: this.docs.edit.sha256,
                captionsSha256: this.docs.captions.sha256
            };
        }
        return state;
    }

    protected queueLight(): void {
        this.pendingLight = this.buildLight();
        this.scheduleLight();
    }

    protected scheduleLight(): void {
        if (this.lightSending || this.lightTimer !== undefined || !this.pendingLight) return;
        const now = (this.deps.now ?? Date.now)();
        const delay = Math.max(0, LIGHT_INTERVAL_MS - (now - this.lastLightSentAt));
        if (delay === 0) {
            void this.flushLight();
            return;
        }
        this.lightTimer = (this.deps.setTimeout ?? setTimeout)(() => {
            this.lightTimer = undefined;
            void this.flushLight();
        }, delay);
    }

    protected async flushLight(): Promise<void> {
        const state = this.pendingLight;
        if (!state || this.lightSending) return;
        this.pendingLight = undefined;
        this.lightSending = true;
        try {
            await this.deps.pushStateLight(state);
            this.lastLightSentAt = (this.deps.now ?? Date.now)();
        } finally {
            this.lightSending = false;
            this.scheduleLight();
        }
    }
}
