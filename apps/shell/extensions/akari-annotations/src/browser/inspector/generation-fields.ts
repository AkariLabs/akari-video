import { t } from '@akari-video/i18n';
import { describeNextDraft, type GenerationMetaV1 } from '@akari-video/edit-store';
import { videoSecondsLabel } from './ai-video-candidates-panel';

export interface GenerationReference {
    path: string;
    sha256?: string | null;
    source_id?: string | null;
    name?: string | null;
    role?: string | null;
    range_s?: [number, number] | null;
}

export interface GenerationDraft {
    modelId: string;
    inputs: Record<string, unknown>;
    output: Record<string, unknown>;
}

export type GenerationReferenceSlot = 'reference_images' | 'reference_videos' | 'reference_audios';
export interface GenerationReferenceCapability {
    max?: number | null;
    tag?: string;
    tag_joiner?: string;
    seconds_each?: number | null;
    seconds_total?: number | null;
}

export interface GenerationCatalogRow {
    id: string;
    kind: string;
    provider?: string;
    callable?: boolean;
    family?: string;
    inputs: {
        first_frame: 'required' | 'optional' | 'none';
        last_frame: 'required' | 'optional' | 'none';
        reference_images?: GenerationReferenceCapability;
        reference_videos?: GenerationReferenceCapability;
        reference_audios?: GenerationReferenceCapability;
        negative_prompt?: boolean;
        camera?: string;
        frames_and_refs_exclusive?: boolean;
    };
    duration: { kind: string; min?: number; max?: number; values?: number[] };
    resolutions?: string[] | null;
    audio_out?: boolean | 'always';
    seed?: boolean;
    price?: { by_resolution?: Record<string, number> } | null;
    as_of?: string | null;
}

export interface GenerationValidation {
    ok: boolean;
    normalized?: { inputs?: Record<string, unknown>; output?: Record<string, unknown> };
    send_side?: 'frames' | 'references' | null;
    references?: Partial<Record<GenerationReferenceSlot, {
        count: number; max: number | null; seconds_total: number; max_seconds_total: number | null;
    }>>;
    rounded?: { duration_s?: { from: number; to: number } } | null;
    messages?: Array<{ level: 'error' | 'warn' | 'info'; text: string }>;
    cost?: { estimate_usd?: number | null; as_of?: string | null; needs_explicit_confirm?: boolean };
}

export interface GenerationFieldDef<TSnapshot = unknown> {
    generationChildren?: GenerationFieldDef<TSnapshot>[];
    generationDetail?: boolean;
    generationFrame?: boolean;
    generationMode?: boolean;
    generationReferences?: {
        entries: Array<{ slot: GenerationReferenceSlot; reference: GenerationReference; index: number; badge: string; unsupported: boolean }>;
        kinds: Array<{ slot: GenerationReferenceSlot; label: string; kind: 'image' | 'video' | 'audio'; max: number | null }>;
        counter: string; notes: string[];
    };
    generationButtons?: boolean;
    generationCheckbox?: boolean;
    generationThumbnail?: () => Promise<string | undefined>;
    name?: string;
    label: string;
    getValue: (snapshot: TSnapshot) => string;
    getEditValue?: (snapshot: TSnapshot) => string;
    inputKind?: 'boolean-select' | 'select' | 'text' | 'media';
    options?: readonly string[];
    optionTitles?: Readonly<Record<string, string>>;
    disabled?: boolean;
    title?: string;
    className?: string;
    actionLabel?: string;
    action?: (snapshot: TSnapshot) => Promise<{ ok: boolean; message?: string }>;
    actions?: readonly {
        name: string; label: string; title: string; disabled?: boolean;
        action: (snapshot: TSnapshot) => Promise<{ ok: boolean; message?: string }>;
    }[];
    write?: (snapshot: TSnapshot, value: string) => Promise<{ ok: boolean; message?: string }>;
}

export interface GenerationFieldActions {
    update: (path: string, value: unknown) => Promise<{ ok: boolean; message?: string }>;
    copyAdjacent: () => Promise<{ ok: boolean; message?: string }>;
    generate: () => Promise<{ ok: boolean; message?: string }>;
    resume: () => Promise<{ ok: boolean; message?: string }>;
    retry: () => Promise<{ ok: boolean; message?: string }>;
    finalQuality?: () => Promise<{ ok: boolean; message?: string }>;
}

export interface GenerationFieldsOptions<TSnapshot> {
    snapshot: TSnapshot;
    catalogRow: GenerationCatalogRow;
    draft: GenerationDraft;
    validation?: GenerationValidation;
    defaults: {
        catalog: readonly GenerationCatalogRow[]; state?: string;
        compareMode?: boolean;
        cheapDraft?: boolean; finalQuality?: boolean; doneMeta?: unknown; originalNext?: unknown;
        currentImage?: string; previousImage?: string; nextImage?: string;
        thumbnail?: (path: string) => Promise<string | undefined>;
    };
    actions: GenerationFieldActions;
}

/** Catalog order is the existing resolution default; never substitute price rank #2. */
export function generationDefaultResolution(row: GenerationCatalogRow): string | null {
    return row.resolutions?.[0] ?? null;
}

export function generationDraftQuality(row: GenerationCatalogRow): { resolution: string; unitPrice: number } | undefined {
    const prices = Object.entries(row.price?.by_resolution ?? {})
        .filter(([resolution, price]) => !!resolution && Number.isFinite(price) && price >= 0);
    if (row.kind !== 'video' || new Set(prices.map(([, price]) => price)).size < 2) return undefined;
    const [resolution, unitPrice] = prices.reduce((lowest, entry) => entry[1] < lowest[1] ? entry : lowest);
    return { resolution, unitPrice };
}

export function generationIsDraftMeta(meta: unknown, row: GenerationCatalogRow): boolean {
    const value = meta as GenerationMetaV1 | undefined;
    const quality = generationDraftQuality(row);
    return !!quality && value?.kind === 'video' && value.status === 'done'
        && (value.model as { id?: string })?.id === row.id && (value.output as { resolution?: string })?.resolution === quality.resolution;
}

export function generationCanFinalize(meta: unknown, originalMeta: unknown, row: GenerationCatalogRow): boolean {
    return generationIsDraftMeta(meta, row) && generationDraftFromMeta(originalMeta)?.modelId === row.id;
}

export function generationToggleDraft(row: GenerationCatalogRow, output: Record<string, unknown>, enabled: boolean,
    previousResolution?: string | null): { output: Record<string, unknown>; previousResolution: string | null } {
    const quality = generationDraftQuality(row);
    if (!quality) return { output: { ...output }, previousResolution: previousResolution ?? null };
    const previous = enabled ? (typeof output.resolution === 'string' ? output.resolution : generationDefaultResolution(row))
        : previousResolution ?? generationDefaultResolution(row);
    return { output: { ...output, resolution: enabled ? quality.resolution
        : previous && row.resolutions?.includes(previous) ? previous : generationDefaultResolution(row) }, previousResolution: previous };
}

/** UI labels never become provider prompt text. */
export const GENERATION_CAMERA_MOVES = [
    { label: t('inspector.generationFields.label.zoom'), bracket: '[Push in]', prose: 'The camera pushes in.' },
    { label: t('inspector.generationFields.label.zoomOut'), bracket: '[Pull out]', prose: 'The camera pulls out.' },
    { label: t('inspector.generationFields.label.turnLeft'), bracket: '[Pan left]', prose: 'The camera pans left.' },
    { label: t('inspector.generationFields.label.goRight'), bracket: '[Pan right]', prose: 'The camera pans right.' },
    { label: t('inspector.generationFields.label.follow'), bracket: '[Tracking shot]', prose: 'The camera tracks the subject.' },
    { label: t('inspector.generationFields.label.fixed'), bracket: '[Static shot]', prose: 'The camera stays static.' }
] as const;

export function generationCameraValue(label: string, notation: string): Record<string, unknown> | null {
    const move = GENERATION_CAMERA_MOVES.find(entry => entry.label === label);
    if (!move) return null;
    const selected = notation === 'bracket' ? 'bracket' : 'prose';
    return { notation: selected, value: move[selected], from_annotation: null };
}

export function generationDraftFromMeta(meta: unknown): GenerationDraft | undefined {
    const next = (meta as GenerationMetaV1 | undefined)?.next;
    return next?.kind === 'video' && next.status === 'planned' && next.model?.id
        ? { modelId: next.model.id, inputs: { ...next.inputs }, output: { ...next.output } } : undefined;
}

export function generationVariety(draft: GenerationDraft): string {
    const description = describeNextDraft({ next: {
        kind: 'video', status: 'planned', model: { id: draft.modelId }, inputs: draft.inputs, output: draft.output
    } } as GenerationMetaV1);
    return { prompt: t('inspector.generationFields.label.promptOnly'), first: t('inspector.generationFields.label.fromImage'), 'first-last': t('inspector.generationFields.label.firstLastSequence'), references: t('inspector.generationFields.label.fromReference') }[description!.variety];
}

const refs = (value: unknown): GenerationReference[] => Array.isArray(value)
    ? value.filter((entry): entry is GenerationReference => !!entry && typeof entry === 'object'
        && typeof (entry as GenerationReference).path === 'string') : [];

const referenceKinds = [
    { slot: 'reference_images', label: t('inspector.generationFields.label.image'), kind: 'image' },
    { slot: 'reference_videos', label: t('inspector.generationFields.label.video'), kind: 'video' },
    { slot: 'reference_audios', label: t('inspector.generationFields.label.voice'), kind: 'audio' }
] as const;

function modelSide(row: GenerationCatalogRow): 'frames' | 'references' | undefined {
    if (row.inputs.first_frame === 'none' && row.inputs.last_frame === 'none') return 'references';
    if (referenceKinds.every(({ slot }) => row.inputs[slot]?.max === 0)) return 'frames';
    return undefined;
}

function pairedModels(row: GenerationCatalogRow, catalog: readonly GenerationCatalogRow[]):
    { frames: GenerationCatalogRow; references: GenerationCatalogRow } | undefined {
    if (!row.family) return undefined;
    const family = catalog.filter(candidate => candidate.kind === 'video' && candidate.family === row.family);
    const frames = family.find(candidate => modelSide(candidate) === 'frames');
    const references = family.find(candidate => modelSide(candidate) === 'references');
    return frames && references ? { frames, references } : undefined;
}

// UI-only insertion order, scoped to the workspace/item and stored locally.
// No private UI metadata is added to the nine-slot provider contract.
const referenceOrder = new WeakMap<GenerationReference, number>();
const referenceOrderKeys = new WeakMap<Record<string, unknown>, string>();
let referenceSequence = 0;
function rememberReferences(inputs: Record<string, unknown>, previous?: Record<string, unknown>, key?: string): void {
    key ??= referenceOrderKeys.get(inputs) ?? (previous && referenceOrderKeys.get(previous));
    let storage: Storage | undefined;
    const storageKey = key && `akari-generation-reference-order:${key}`;
    if (key) {
        referenceOrderKeys.set(inputs, key);
        try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* In-memory order still works. */ }
    }
    if (storage && storageKey && !previous) {
        try {
            const saved: unknown = JSON.parse(storage.getItem(storageKey) ?? '[]');
            if (Array.isArray(saved)) for (const entry of saved) {
                const kind = referenceKinds.find(kind => kind.slot === entry?.slot);
                const ref = kind && refs(inputs[kind.slot]).find(ref => ref.path === entry.path);
                if (ref) referenceOrder.set(ref, referenceSequence++);
            }
        } catch { /* Ignore obsolete or unavailable local UI state. */ }
    }
    if (previous) {
        rememberReferences(previous);
        for (const { slot } of referenceKinds) for (const ref of refs(inputs[slot])) {
            const old = refs(previous[slot]).find(candidate => candidate.path === ref.path);
            if (old) referenceOrder.set(ref, referenceOrder.get(old)!);
        }
    }
    for (const { slot } of referenceKinds) {
        let last = -1;
        for (const ref of refs(inputs[slot])) {
            if (!referenceOrder.has(ref) || referenceOrder.get(ref)! <= last) referenceOrder.set(ref, referenceSequence++);
            last = referenceOrder.get(ref)!;
        }
    }
    if (storage && storageKey) {
        const ordered = referenceKinds.flatMap(({ slot }) => refs(inputs[slot]).map(ref => ({ slot, ref })))
            .sort((a, b) => referenceOrder.get(a.ref)! - referenceOrder.get(b.ref)!);
        try { storage.setItem(storageKey, JSON.stringify(ordered.map(({ slot, ref }) => ({ slot, path: ref.path })))); }
        catch { /* Storage quota/private browsing must not block draft editing. */ }
    }
}

/** Mirrors akari-project classifyMaterialKind; unknown extensions are never accepted. */
function referenceSlot(path: string): GenerationReferenceSlot | undefined {
    if (/\.(mp4|mov|m4v|webm|mkv|avi)$/iu.test(path)) return 'reference_videos';
    if (/\.(wav|mp3|m4a|aac|flac|ogg)$/iu.test(path)) return 'reference_audios';
    if (/\.(png|jpg|jpeg|gif|webp)$/iu.test(path)) return 'reference_images';
    return undefined;
}

const pricePerSecond = (row: GenerationCatalogRow): number | null => {
    const prices = Object.values(row.price?.by_resolution ?? {}).filter(Number.isFinite);
    return prices.length ? Math.min(...prices) : null;
};

export function generationFactLabel(row: GenerationCatalogRow): string {
    const price = pricePerSecond(row);
    return `${row.family ?? row.id} · ${price === null ? t('inspector.generationFields.label.noQuote') : t('inspector.generationFields.price.perSecond', { pricePerSecond: price })} · as_of ${row.as_of ?? t('inspector.generationFields.label.unknown')}（${row.id}）`;
}

export const generationFields = Object.assign(function generationFields<TSnapshot>({
    catalogRow, draft, validation, defaults, actions
}: GenerationFieldsOptions<TSnapshot>): GenerationFieldDef<TSnapshot>[] {
    const canFinalize = generationCanFinalize(defaults.doneMeta, defaults.originalNext, catalogRow);
    const doneVideo = defaults.state === 'done' && (defaults.doneMeta as GenerationMetaV1 | undefined)?.kind === 'video';
    const inputs = draft.inputs ?? {};
    const output = draft.output ?? {};
    const videoRows = defaults.catalog.filter(row => row.kind === 'video');
    const labels = videoRows.map(generationFactLabel);
    const byLabel = new Map(videoRows.map(row => [generationFactLabel(row), row.id]));
    const selectedLabel = generationFactLabel(catalogRow);
    const fields: GenerationFieldDef<TSnapshot>[] = defaults.compareMode ? [] : [{
        name: 'generation-model', label: t('inspector.generationFields.label.model'), inputKind: 'select', options: labels,
        optionTitles: Object.fromEntries(videoRows.map(row => [generationFactLabel(row), row.id])),
        getValue: () => selectedLabel, getEditValue: () => selectedLabel,
        className: 'akari-inspector-generation-facts',
        write: (_snapshot, value) => actions.update('modelId', byLabel.get(value) ?? value)
    }];
    if (doneVideo && !defaults.finalQuality) fields.unshift({
        name: 'generation-current-video', label: t('inspector.generationFields.label.nowVideos'), getValue: () => {
            const meta = defaults.doneMeta as { model?: { id?: string }; provenance?: { created_at?: string };
                job?: { started_at?: string } };
            const model = defaults.catalog.find(row => row.id === meta.model?.id);
            return `${model?.family ?? meta.model?.id ?? t('inspector.generationFields.label.unknown')} · ${meta.provenance?.created_at ?? meta.job?.started_at ?? t('inspector.generationFields.label.unknownDate')}`;
        }
    });
    fields.push({
        name: 'prompt', label: t('inspector.generationFields.label.scriptPrompt'), inputKind: 'text',
        getValue: () => String(inputs.prompt ?? ''), getEditValue: () => String(inputs.prompt ?? ''),
        write: (_snapshot, value) => actions.update('inputs.prompt', value || null)
    });

    if (catalogRow.inputs.negative_prompt === true) fields.push({
        name: 'negative-prompt', label: t('inspector.generationFields.label.negativePrompt'), generationDetail: true, inputKind: 'text',
        getValue: () => String(inputs.negative_prompt ?? ''), getEditValue: () => String(inputs.negative_prompt ?? ''),
        write: (_snapshot, value) => actions.update('inputs.negative_prompt', value || null)
    });
    const pair = pairedModels(catalogRow, defaults.catalog);
    const side = modelSide(catalogRow);
    const locked = ['generating', 'stale'].includes(defaults.state ?? '');
    if (pair) {
        fields.push({ name: 'generation-mode', label: '', generationButtons: true, generationMode: true,
            disabled: locked, options: [t('inspector.generationFields.label.firstLastPair'), t('inspector.generationFields.label.reference')],
            getValue: () => side === 'references' ? t('inspector.generationFields.label.reference') : t('inspector.generationFields.label.firstLastPair'),
            write: (_snapshot, value) => actions.update('inputs.frames_or_refs', value === t('inspector.generationFields.label.reference') ? 'references' : 'frames') });
        fields.push({ name: 'generation-mode-note', label: '',
            getValue: () => t('inspector.generationFields.message.notAvailableSameTimeEvenIfSwitch', { modelFamily: catalogRow.family }) });
    }
    for (const [slot, name, label] of [
        ['first_frame', 'first-frame', t('inspector.generationFields.label.firstPicture')], ['last_frame', 'last_frame', t('inspector.generationFields.label.lastPicture')]
    ] as const) {
        if (catalogRow.inputs[slot] === 'none' || (pair && side === 'references')) continue;
        const reference = inputs[slot] as GenerationReference | null;
        const path = reference?.path ?? '';
        const shortcuts: NonNullable<GenerationFieldDef<TSnapshot>['actions']>[number][] = [];
        const addShortcut = (name: string, label: string, image: string | undefined): void => {
            if (image) shortcuts.push({ name, label, title: label,
                action: () => actions.update(`inputs.${slot}`, { path: image }) });
        };
        if (slot === 'first_frame') {
            addShortcut('current', t('inspector.generationFields.label.picturesClip'), defaults.currentImage);
            addShortcut('previous', t('inspector.generationFields.label.lastCommasPreviousClip'), defaults.previousImage);
        } else addShortcut('next', t('inspector.generationFields.label.firstFollowingClip'), defaults.nextImage);
        if (path) shortcuts.push({ name: 'remove', label: t('inspector.generationFields.label.remove'), title: t('inspector.generationFields.title.remove', { label: label }),
            action: () => actions.update(`inputs.${slot}`, null) });
        fields.push({ name, label, generationFrame: true, getValue: () => path,
            generationThumbnail: path && defaults.thumbnail ? () => defaults.thumbnail!(path) : undefined,
            actions: shortcuts });
    }
    fields.push({ name: 'generation-variety', label: t('inspector.generationFields.label.type'), getValue: () => generationVariety(draft) });
    fields.push({ name: 'generation-material-note', label: '',
        getValue: () => t('inspector.generationFields.action.sendOriginalAssetImageWithoutColorSize') });
    rememberReferences(inputs);
    const entries = referenceKinds.flatMap(({ slot, label }) => refs(inputs[slot]).map((reference, index) => ({
        slot, reference, index, badge: `@${label}${index + 1}`, unsupported: catalogRow.inputs[slot]?.max === 0
    }))).sort((a, b) => referenceOrder.get(a.reference)! - referenceOrder.get(b.reference)!);
    const kinds = referenceKinds.filter(({ slot }) => catalogRow.inputs[slot]
        && catalogRow.inputs[slot]?.max !== 0).map(kind => ({ ...kind,
        max: validation?.references?.[kind.slot] ? validation.references[kind.slot]!.max : catalogRow.inputs[kind.slot]?.max ?? null }));
    const notes: string[] = [];
    if (side === 'references' && kinds.length > 0 && kinds.every(({ slot }) => !catalogRow.inputs[slot]?.tag)) {
        notes.push(t('inspector.generationFields.message.waySendReferencesModelNotYetAvailable'));
    }
    const counter = kinds.map(({ slot, label }) => {
        const stats = validation?.references?.[slot];
        if (!stats) return t('inspector.generationFields.status.checkingLabel', { label: label });
        if (stats.max === null) notes.push(t('inspector.generationFields.label.upperLimitNotListedModelSide', { label: label }));
        if (stats.max_seconds_total !== null) notes.push(t('inspector.generationFields.label.sec', { label: label, usedSeconds: stats.seconds_total, maxSeconds: stats.max_seconds_total, n: stats.max_seconds_total }));
        return `${label} ${stats.count}${stats.max === null ? '' : ` / ${stats.max}`}`;
    }).join(' · ');
    for (const { slot, label } of referenceKinds) if (entries.some(entry => entry.slot === slot && entry.unsupported)) {
        notes.push(t('inspector.generationFields.message.modelCanNotUseReferenceWillBe', { label: label }));
        if (validation?.send_side !== 'frames') notes.push(t('inspector.generationFields.error.resolveInputErrorsBeforeSending'));
    }
    if ((!pair || side === 'references') && (kinds.length || entries.length)) fields.push({
        name: 'generation-references', label: t('inspector.generationFields.label.reference'), disabled: locked, getValue: () => '',
        generationReferences: { entries, kinds, counter, notes },
        write: (_snapshot, value) => {
            const { slot, index } = JSON.parse(value) as { slot: GenerationReferenceSlot; index: number };
            return actions.update(`inputs.${slot}`, refs(inputs[slot]).filter((_ref, ordinal) => ordinal !== index));
        }
    });
    if (catalogRow.inputs.camera) fields.push({
        name: 'camera', label: t('inspector.generationFields.label.cameraMovement'), generationButtons: true,
        options: [t('inspector.generationFields.label.none'), ...GENERATION_CAMERA_MOVES.map(move => move.label)],
        getValue: () => GENERATION_CAMERA_MOVES.find(move =>
            move.bracket === (inputs.camera as { value?: string })?.value
            || move.prose === (inputs.camera as { value?: string })?.value)?.label ?? t('inspector.generationFields.label.none'),
        write: (_snapshot, value) => actions.update('inputs.camera', generationCameraValue(value, catalogRow.inputs.camera!))
    });
    fields.push({ name: 'seed', label: t('inspector.generationFields.label.seed'), inputKind: 'text', generationDetail: true,
        getValue: () => String(inputs.seed ?? ''),
        write: (_snapshot, value) => value.trim() && !Number.isInteger(Number(value))
            ? Promise.resolve({ ok: false, message: t('inspector.generationFields.message.specifySeedInteger') })
            : actions.update('inputs.seed', value.trim() ? Number(value) : null)
    });
    const rounded = validation?.rounded?.duration_s;
    const duration = Number(output.duration_s ?? 0);
    const normalizedDuration = Number(validation?.normalized?.output?.duration_s);
    const normalizedChanged = Number.isFinite(duration) && Number.isFinite(normalizedDuration)
        && duration !== normalizedDuration
        ? { from: duration, to: normalizedDuration } : undefined;
    const durationChange = rounded ?? normalizedChanged;
    fields.push({
        name: 'generation-duration', label: t('inspector.generationFields.label.length'),
        getValue: () => durationChange ? t('inspector.generationFields.label.secondsSeconds', { fromSeconds: videoSecondsLabel(durationChange.from), toSeconds: videoSecondsLabel(durationChange.to) })
            : t('inspector.generationFields.label.secCuts', { duration: videoSecondsLabel(duration) }),
        className: durationChange ? 'akari-inspector-generation-warning' : undefined
    });
    if (catalogRow.resolutions?.length) fields.push({
        name: 'generation-resolution', label: t('inspector.generationFields.label.resolution'), inputKind: 'select', options: catalogRow.resolutions,
        disabled: defaults.cheapDraft === true || locked,
        getValue: () => String(output.resolution ?? catalogRow.resolutions![0]),
        getEditValue: () => String(output.resolution ?? catalogRow.resolutions![0]),
        write: (_snapshot, value) => actions.update('output.resolution', value)
    });
    const quality = generationDraftQuality(catalogRow);
    if (quality && !defaults.finalQuality) fields.push({
        name: 'generation-cheap-draft', label: t('inspector.generationFields.label.draftLowerCost', { pricePerSecond: quality.unitPrice }),
        generationCheckbox: true, disabled: locked,
        getValue: () => String(defaults.cheapDraft === true),
        write: (_snapshot, value) => actions.update('cheapDraft', value === 'true')
    });
    if (catalogRow.audio_out === true) fields.push({
        name: 'generation-audio', label: t('inspector.generationFields.label.voice'), inputKind: 'boolean-select',
        getValue: () => String(output.audio_out !== false), getEditValue: () => String(output.audio_out !== false),
        write: (_snapshot, value) => actions.update('output.audio_out', value === 'true')
    });
    if (catalogRow.audio_out === 'always') fields.push({
        name: 'generation-audio-always', label: t('inspector.generationFields.label.voice'), disabled: true,
        getValue: () => t('inspector.generationFields.label.alwaysStick')
    });

    const estimate = validation?.cost?.estimate_usd;
    if (!defaults.compareMode) fields.push({
        name: 'generation-estimate', label: t('inspector.generationFields.label.estimate'), className: 'akari-inspector-generation-estimate',
        getValue: () => typeof estimate === 'number'
            ? `$${estimate.toFixed(2)}（as_of ${validation?.cost?.as_of ?? catalogRow.as_of ?? t('inspector.generationFields.label.unknown')}）`
            : t('inspector.generationFields.status.estimateUnavailableConfirmContinue')
    });
    const error = validation?.messages?.find(message => message.level === 'error');
    const notice = error ?? validation?.messages?.find(message => message.level === 'warn')
        ?? validation?.messages?.find(message => message.level === 'info');
    if (notice) fields.push({
        name: 'generation-message', label: notice.level === 'error' ? t('inspector.generationFields.label.error') : t('inspector.generationFields.label.note'),
        className: notice.level === 'error' ? 'akari-inspector-generation-error' : 'akari-inspector-generation-note',
        getValue: () => notice.text
    });

    const state = defaults.state;
    const generating = state === 'generating';
    const runLabel = generating ? t('inspector.generationFields.status.generatingTimelinePreview')
        : doneVideo ? t('inspector.generationFields.label.regenerate') : t('inspector.generationFields.label.videos');
    const actionRows: Array<NonNullable<GenerationFieldDef<TSnapshot>['actions']>[number]> = [{
        name: 'copy-adjacent', label: t('inspector.generationFields.label.takeFromNextDoor'), title: t('inspector.generationFields.title.copyImageItemUnderwritingNext'),
        action: actions.copyAdjacent
    }, ...defaults.compareMode ? [] : [{
        name: 'generate', label: runLabel, title: runLabel,
        disabled: generating || validation?.ok === false || (defaults.finalQuality === true
            && (!quality || Number(catalogRow.price?.by_resolution?.[String(output.resolution)]) <= quality.unitPrice)), action: actions.generate
    }]];
    if (!defaults.compareMode && state === 'stale') actionRows.push({ name: 'resume', label: t('inspector.generationFields.label.reAcquire'), title: t('inspector.generationFields.title.reAcquiresResult'), action: actions.resume });
    if (!defaults.compareMode && (state === 'failed' || state === 'stale')) actionRows.push({ name: 'retry', label: t('inspector.generationFields.label.againSameInput'), title: t('inspector.generationFields.label.againSameInput'), action: actions.retry });
    if (doneVideo && canFinalize && !defaults.finalQuality && !defaults.compareMode && actions.finalQuality) actionRows.push({
        name: 'final-quality', label: t('inspector.generationFields.label.makeBestPictureQuality'), title: t('inspector.generationFields.label.makeBestPictureQuality'),
        action: actions.finalQuality
    });
    if (doneVideo && canFinalize && !defaults.finalQuality && !defaults.compareMode) fields.push({
        name: 'generation-final-note', label: '',
        getValue: () => t('inspector.generationFields.label.createHighQualityImageAgainSameInput')
    });
    if (defaults.finalQuality) fields.push({ name: 'generation-final-note', label: '',
        getValue: () => t('inspector.generationFields.label.chooseResolutionCreateHighResolutionAgainSame') });
    fields.push({ name: 'generation-actions', label: t('inspector.generationFields.label.action'), getValue: () => '', actions: actionRows });
    const details = fields.filter(field => field.generationDetail);
    const visible = fields.filter(field => !field.generationDetail);
    visible.splice(visible.findIndex(field => field.name === 'generation-estimate'), 0, ...details);
    return visible;
}, {
    fromMeta: generationDraftFromMeta,
    draftQuality: generationDraftQuality, isDraftMeta: generationIsDraftMeta, canFinalize: generationCanFinalize,
    toggleDraft: generationToggleDraft, defaultResolution: generationDefaultResolution,
    modelSide, pairedModels, referenceSlot, rememberReferences,
    cameraValue: generationCameraValue,
    cameraMoves: GENERATION_CAMERA_MOVES
});
