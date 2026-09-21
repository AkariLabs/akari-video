import { classifyMaterialKind, MaterialKind } from './asset-group-media';

export const GENERATION_PICK_INTO_COMMAND_ID = 'akari.generation.pickInto';
export const GENERATION_CANCEL_PICK_COMMAND_ID = 'akari.generation.cancelPick';
// akari-annotations-widget.publishPrimaryPreviewSelection emits this window event;
// akari-preview-open-handler also consumes it. Mirror the literal without an extension dependency.
export const GENERATION_PICK_PRIMARY_SELECTED_EVENT = 'akari.timeline.primarySelected';
export type GenerationPickTimelineSelection = { kind: 'cut' | 'caption'; id: string } | null;

/** Compare identities, not event/object instances. Unobserved selections count as no selection. */
export function generationPickSelectionChanged(
    atStart: GenerationPickTimelineSelection | undefined,
    next: GenerationPickTimelineSelection
): boolean {
    return atStart?.kind !== next?.kind || atStart?.id !== next?.id;
}

export type GenerationPickKind = 'image' | 'video' | 'audio';
export interface GenerationPickRequest {
    slot: 'first_frame' | 'last_frame' | 'reference_images' | 'reference_videos' | 'reference_audios';
    label: string;
    accepts: GenerationPickKind[];
    multi: boolean;
    selected?: string[];
    max?: number | null;
}
export type GenerationPickResult = { status: 'picked'; paths: string[] } | { status: 'cancelled' };
export interface GenerationPickMaterial { relativePath: string; kind: MaterialKind }
export type GenerationPickCandidate = { kind: MaterialKind; unavailableReason?: string } & (
    { path: string; key?: never } | { key: string; path?: never }
);

/** Reject absolute paths, schemes and traversal; normalize only project-relative spelling. */
export function normalizeGenerationPickPath(value: string): string | undefined {
    if (typeof value !== 'string' || !value || (value.includes('\\') || [...value].some(char => char.charCodeAt(0) < 32))
        || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(value)) { return undefined; }
    const parts = value.split('/');
    if (parts.includes('..')) { return undefined; }
    return parts.filter(part => part && part !== '.').join('/') || undefined;
}

export function generationPickAccepts(request: GenerationPickRequest, kind: MaterialKind): boolean {
    return kind !== 'other' && request.accepts.includes(kind);
}

export function normalizeGenerationPickRequest(request: GenerationPickRequest): GenerationPickRequest {
    const slots = ['first_frame', 'last_frame', 'reference_images', 'reference_videos', 'reference_audios'];
    if (!request || !slots.includes(request.slot) || typeof request.label !== 'string'
        || !Array.isArray(request.accepts) || typeof request.multi !== 'boolean') {
        throw new TypeError('素材選択の要求が不正です。');
    }
    const accepts = [...new Set(request.accepts.filter(kind => ['image', 'video', 'audio'].includes(kind)))];
    const max = request.max == null ? null : Number.isFinite(request.max) ? Math.max(0, Math.floor(request.max)) : null;
    const normalized = { ...request, label: request.label.trim() || 'この枠', accepts, max };
    const selected = request.multi && Array.isArray(request.selected)
        ? [...new Set(request.selected.map(normalizeGenerationPickPath).filter((path): path is string =>
            !!path && generationPickAccepts(normalized, classifyMaterialKind(path))))] : [];
    return { ...normalized, selected: max === null ? selected : selected.slice(0, max) };
}

export function toggleGenerationPickPath(paths: readonly string[], path: string, max?: number | null): string[] {
    if (paths.includes(path)) { return paths.filter(selected => selected !== path); }
    return max != null && paths.length >= max ? [...paths] : [...paths, path];
}

export function generationPickBadge(paths: readonly string[], path: string): string | undefined {
    const index = paths.indexOf(path);
    const kind = classifyMaterialKind(path);
    if (index < 0 || kind === 'other') { return undefined; }
    const ordinal = paths.slice(0, index + 1).filter(selected => classifyMaterialKind(selected) === kind).length;
    return `@${{ image: '画像', video: '動画', audio: '音声' }[kind]}${ordinal}`;
}

interface PickSession {
    request: GenerationPickRequest;
    paths: string[];
    resolved: Map<string, string>;
    pendingKey?: string;
    error?: string;
    resolve: (result: GenerationPickResult) => void;
}

/** DOM-free state machine. Session identity prevents a late resolver from changing a newer request. */
export class GenerationPickController {
    private session?: PickSession;
    constructor(
        private readonly resolveMaterial: (key: string) => Promise<GenerationPickMaterial | undefined>,
        private readonly changed: () => void = () => undefined
    ) {}
    get request(): GenerationPickRequest | undefined { return this.session?.request; }
    get paths(): readonly string[] { return this.session?.paths ?? []; }
    get pendingKey(): string | undefined { return this.session?.pendingKey; }
    get error(): string | undefined { return this.session?.error; }

    start(request: GenerationPickRequest): Promise<GenerationPickResult> {
        const normalized = normalizeGenerationPickRequest(request);
        this.cancel();
        return new Promise(resolve => {
            this.session = { request: normalized, paths: [...normalized.selected], resolved: new Map(), resolve };
            this.changed();
        });
    }
    cancel(): void { this.settle({ status: 'cancelled' }); }
    complete(): void {
        if (this.session?.request.multi && !this.pendingKey) {
            this.settle({ status: 'picked', paths: [...this.paths] });
        }
    }
    private settle(result: GenerationPickResult): void {
        const session = this.session;
        if (!session) { return; }
        this.session = undefined;
        session.resolve(result);
        this.changed();
    }
    pathFor(candidate: GenerationPickCandidate): string | undefined {
        return candidate.key !== undefined ? this.session?.resolved.get(candidate.key) : normalizeGenerationPickPath(candidate.path);
    }
    badge(candidate: GenerationPickCandidate): string | undefined {
        const path = this.pathFor(candidate);
        return this.request?.multi && path ? generationPickBadge(this.paths, path) : undefined;
    }
    disabledReason(candidate: GenerationPickCandidate): string | undefined {
        const session = this.session;
        if (!session) { return undefined; }
        if (candidate.unavailableReason) { return candidate.unavailableReason; }
        if (!generationPickAccepts(session.request, candidate.kind)) { return 'この枠には選べない種類です。'; }
        if (candidate.path !== undefined && !normalizeGenerationPickPath(candidate.path)) { return 'プロジェクト内の素材を選んでください。'; }
        if (session.pendingKey) { return '素材を取得中です。'; }
        const path = this.pathFor(candidate);
        if (session.request.multi && path && session.paths.includes(path)) { return undefined; }
        if (session.request.max != null && session.paths.length >= session.request.max) { return '選べる数の上限です。'; }
        return undefined;
    }
    async pick(candidate: GenerationPickCandidate): Promise<void> {
        const session = this.session;
        if (!session || this.disabledReason(candidate)) { return; }
        session.error = undefined;
        let path = this.pathFor(candidate);
        if (!path && candidate.key !== undefined) {
            session.pendingKey = candidate.key;
            this.changed();
            try {
                const material = await this.resolveMaterial(candidate.key);
                if (this.session !== session) { return; }
                path = material && normalizeGenerationPickPath(material.relativePath);
                if (!path || !generationPickAccepts(session.request, material.kind)
                    || !generationPickAccepts(session.request, classifyMaterialKind(path))) {
                    throw new Error('素材を取得できませんでした。選び直すか、もう一度お試しください。');
                }
                session.resolved.set(candidate.key, path);
            } catch (error) {
                if (this.session === session) {
                    session.error = error instanceof Error ? error.message : String(error);
                }
                return;
            } finally {
                if (this.session === session) {
                    session.pendingKey = undefined;
                    this.changed();
                }
            }
        }
        if (this.session !== session || !path) { return; }
        if (!session.request.multi) { this.settle({ status: 'picked', paths: [path] }); }
        else {
            session.paths = toggleGenerationPickPath(session.paths, path, session.request.max);
            this.changed();
        }
    }
}
