import { describeNextDraft, type GenerationMetaV1 } from '@akari-video/edit-store';

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
}

export interface GenerationFieldsOptions<TSnapshot> {
    snapshot: TSnapshot;
    catalogRow: GenerationCatalogRow;
    draft: GenerationDraft;
    validation?: GenerationValidation;
    defaults: {
        catalog: readonly GenerationCatalogRow[]; state?: string;
        currentImage?: string; previousImage?: string; nextImage?: string;
        thumbnail?: (path: string) => Promise<string | undefined>;
    };
    actions: GenerationFieldActions;
}

/** UI labels never become provider prompt text. */
export const GENERATION_CAMERA_MOVES = [
    { label: '寄る', bracket: '[Push in]', prose: 'The camera pushes in.' },
    { label: '引く', bracket: '[Pull out]', prose: 'The camera pulls out.' },
    { label: '左へ振る', bracket: '[Pan left]', prose: 'The camera pans left.' },
    { label: '右へ振る', bracket: '[Pan right]', prose: 'The camera pans right.' },
    { label: '追いかける', bracket: '[Tracking shot]', prose: 'The camera tracks the subject.' },
    { label: '固定', bracket: '[Static shot]', prose: 'The camera stays static.' }
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
    return { prompt: 'プロンプトだけ', first: '画像から', 'first-last': '最初→最後', references: '参照から' }[description!.variety];
}

const refs = (value: unknown): GenerationReference[] => Array.isArray(value)
    ? value.filter((entry): entry is GenerationReference => !!entry && typeof entry === 'object'
        && typeof (entry as GenerationReference).path === 'string') : [];

const referenceKinds = [
    { slot: 'reference_images', label: '画像', kind: 'image' },
    { slot: 'reference_videos', label: '動画', kind: 'video' },
    { slot: 'reference_audios', label: '音声', kind: 'audio' }
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
    return `${row.family ?? row.id} · ${price === null ? '見積不可' : `$${price}/秒`} · as_of ${row.as_of ?? '不明'}（${row.id}）`;
}

export const generationFields = Object.assign(function generationFields<TSnapshot>({
    catalogRow, draft, validation, defaults, actions
}: GenerationFieldsOptions<TSnapshot>): GenerationFieldDef<TSnapshot>[] {
    const inputs = draft.inputs ?? {};
    const output = draft.output ?? {};
    const videoRows = defaults.catalog.filter(row => row.kind === 'video');
    const labels = videoRows.map(generationFactLabel);
    const byLabel = new Map(videoRows.map(row => [generationFactLabel(row), row.id]));
    const selectedLabel = generationFactLabel(catalogRow);
    const fields: GenerationFieldDef<TSnapshot>[] = [{
        name: 'generation-model', label: 'モデル', inputKind: 'select', options: labels,
        optionTitles: Object.fromEntries(videoRows.map(row => [generationFactLabel(row), row.id])),
        getValue: () => selectedLabel, getEditValue: () => selectedLabel,
        className: 'akari-inspector-generation-facts',
        write: (_snapshot, value) => actions.update('modelId', byLabel.get(value) ?? value)
    }, {
        name: 'prompt', label: '指示文（prompt）', inputKind: 'text',
        getValue: () => String(inputs.prompt ?? ''), getEditValue: () => String(inputs.prompt ?? ''),
        write: (_snapshot, value) => actions.update('inputs.prompt', value || null)
    }];

    if (catalogRow.inputs.negative_prompt === true) fields.push({
        name: 'negative-prompt', label: '入れたくないもの（negative prompt）', generationDetail: true, inputKind: 'text',
        getValue: () => String(inputs.negative_prompt ?? ''), getEditValue: () => String(inputs.negative_prompt ?? ''),
        write: (_snapshot, value) => actions.update('inputs.negative_prompt', value || null)
    });
    const pair = pairedModels(catalogRow, defaults.catalog);
    const side = modelSide(catalogRow);
    const locked = ['generating', 'stale'].includes(defaults.state ?? '');
    if (pair) {
        fields.push({ name: 'generation-mode', label: '', generationButtons: true, generationMode: true,
            disabled: locked, options: ['最初 / 最後', '参照'],
            getValue: () => side === 'references' ? '参照' : '最初 / 最後',
            write: (_snapshot, value) => actions.update('inputs.frames_or_refs', value === '参照' ? 'references' : 'frames') });
        fields.push({ name: 'generation-mode-note', label: '',
            getValue: () => `${catalogRow.family} は同時に使えません。切り替えても中身は残り、送るのは選んだ方だけです。` });
    }
    for (const [slot, name, label] of [
        ['first_frame', 'first-frame', '最初の絵'], ['last_frame', 'last_frame', '最後の絵']
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
            addShortcut('current', 'このクリップの絵', defaults.currentImage);
            addShortcut('previous', '前のクリップの最後のコマ', defaults.previousImage);
        } else addShortcut('next', '次のクリップの最初', defaults.nextImage);
        if (path) shortcuts.push({ name: 'remove', label: '外す', title: `${label}を外す`,
            action: () => actions.update(`inputs.${slot}`, null) });
        fields.push({ name, label, generationFrame: true, getValue: () => path,
            generationThumbnail: path && defaults.thumbnail ? () => defaults.thumbnail!(path) : undefined,
            actions: shortcuts });
    }
    fields.push({ name: 'generation-variety', label: '種類', getValue: () => generationVariety(draft) });
    fields.push({ name: 'generation-material-note', label: '',
        getValue: () => '送る絵は素材のまま（色・サイズは送りません）' });
    rememberReferences(inputs);
    const entries = referenceKinds.flatMap(({ slot, label }) => refs(inputs[slot]).map((reference, index) => ({
        slot, reference, index, badge: `@${label}${index + 1}`, unsupported: catalogRow.inputs[slot]?.max === 0
    }))).sort((a, b) => referenceOrder.get(a.reference)! - referenceOrder.get(b.reference)!);
    const kinds = referenceKinds.filter(({ slot }) => catalogRow.inputs[slot]
        && catalogRow.inputs[slot]?.max !== 0).map(kind => ({ ...kind,
        max: validation?.references?.[kind.slot] ? validation.references[kind.slot]!.max : catalogRow.inputs[kind.slot]?.max ?? null }));
    const notes: string[] = [];
    if (side === 'references' && kinds.length > 0 && kinds.every(({ slot }) => !catalogRow.inputs[slot]?.tag)) {
        notes.push('このモデルの参照の送り方はまだ用意されていません。送ると止まります。');
    }
    const counter = kinds.map(({ slot, label }) => {
        const stats = validation?.references?.[slot];
        if (!stats) return `${label} 確認中`;
        if (stats.max === null) notes.push(`${label}: 上限はモデル側に記載なし`);
        if (stats.max_seconds_total !== null) notes.push(`${label} ${stats.seconds_total} / ${stats.max_seconds_total} 秒`);
        return `${label} ${stats.count}${stats.max === null ? '' : ` / ${stats.max}`}`;
    }).join(' · ');
    for (const { slot, label } of referenceKinds) if (entries.some(entry => entry.slot === slot && entry.unsupported)) {
        notes.push(`このモデルは${label}の参照を使えません。送るときは外します（中身は残す）。`);
        if (validation?.send_side !== 'frames') notes.push('入力エラーを解消するまで送信できません。');
    }
    if ((!pair || side === 'references') && (kinds.length || entries.length)) fields.push({
        name: 'generation-references', label: '参照', disabled: locked, getValue: () => '',
        generationReferences: { entries, kinds, counter, notes },
        write: (_snapshot, value) => {
            const { slot, index } = JSON.parse(value) as { slot: GenerationReferenceSlot; index: number };
            return actions.update(`inputs.${slot}`, refs(inputs[slot]).filter((_ref, ordinal) => ordinal !== index));
        }
    });
    if (catalogRow.inputs.camera) fields.push({
        name: 'camera', label: 'カメラの動き', generationButtons: true,
        options: ['なし', ...GENERATION_CAMERA_MOVES.map(move => move.label)],
        getValue: () => GENERATION_CAMERA_MOVES.find(move =>
            move.bracket === (inputs.camera as { value?: string })?.value
            || move.prose === (inputs.camera as { value?: string })?.value)?.label ?? 'なし',
        write: (_snapshot, value) => actions.update('inputs.camera', generationCameraValue(value, catalogRow.inputs.camera!))
    });
    fields.push({ name: 'seed', label: 'シード（seed）', inputKind: 'text', generationDetail: true,
        getValue: () => String(inputs.seed ?? ''),
        write: (_snapshot, value) => value.trim() && !Number.isInteger(Number(value))
            ? Promise.resolve({ ok: false, message: 'シードは整数で指定してください。' })
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
        name: 'generation-duration', label: '長さ',
        getValue: () => durationChange ? `${durationChange.from} 秒 → ${durationChange.to} 秒` : `${duration} 秒（cuts）`,
        className: durationChange ? 'akari-inspector-generation-warning' : undefined
    });
    if (catalogRow.resolutions?.length) fields.push({
        name: 'generation-resolution', label: '解像度', inputKind: 'select', options: catalogRow.resolutions,
        getValue: () => String(output.resolution ?? catalogRow.resolutions![0]),
        getEditValue: () => String(output.resolution ?? catalogRow.resolutions![0]),
        write: (_snapshot, value) => actions.update('output.resolution', value)
    });
    if (catalogRow.audio_out === true) fields.push({
        name: 'generation-audio', label: '音声', inputKind: 'boolean-select',
        getValue: () => String(output.audio_out !== false), getEditValue: () => String(output.audio_out !== false),
        write: (_snapshot, value) => actions.update('output.audio_out', value === 'true')
    });
    if (catalogRow.audio_out === 'always') fields.push({
        name: 'generation-audio-always', label: '音声', disabled: true,
        getValue: () => '常に付く・既定は消音'
    });

    const estimate = validation?.cost?.estimate_usd;
    fields.push({
        name: 'generation-estimate', label: '見積', className: 'akari-inspector-generation-estimate',
        getValue: () => typeof estimate === 'number'
            ? `$${estimate.toFixed(2)}（as_of ${validation?.cost?.as_of ?? catalogRow.as_of ?? '不明'}）`
            : '見積不可（明示確認で実行）'
    });
    const error = validation?.messages?.find(message => message.level === 'error');
    const notice = error ?? validation?.messages?.find(message => message.level === 'warn')
        ?? validation?.messages?.find(message => message.level === 'info');
    if (notice) fields.push({
        name: 'generation-message', label: notice.level === 'error' ? 'エラー' : '注記',
        className: notice.level === 'error' ? 'akari-inspector-generation-error' : 'akari-inspector-generation-note',
        getValue: () => notice.text
    });

    const state = defaults.state;
    const generating = state === 'generating';
    const runLabel = generating ? '生成中…（タイムラインとプレビューに進捗）' : '動画にする';
    const actionRows: Array<NonNullable<GenerationFieldDef<TSnapshot>['actions']>[number]> = [{
        name: 'copy-adjacent', label: '隣から取る', title: '隣の映像 item の下書きを写す',
        action: actions.copyAdjacent
    }, {
        name: 'generate', label: runLabel, title: runLabel,
        disabled: generating || validation?.ok === false, action: actions.generate
    }];
    if (state === 'stale') actionRows.push({ name: 'resume', label: '再取得', title: '生成結果を再取得', action: actions.resume });
    if (state === 'failed' || state === 'stale') actionRows.push({ name: 'retry', label: '同じ入力でもう一度', title: '同じ入力でもう一度', action: actions.retry });
    fields.push({ name: 'generation-actions', label: '操作', getValue: () => '', actions: actionRows });
    const details = fields.filter(field => field.generationDetail);
    const visible = fields.filter(field => !field.generationDetail);
    visible.splice(visible.findIndex(field => field.name === 'generation-estimate'), 0, ...details);
    return visible;
}, {
    fromMeta: generationDraftFromMeta,
    modelSide, pairedModels, referenceSlot, rememberReferences,
    cameraValue: generationCameraValue,
    cameraMoves: GENERATION_CAMERA_MOVES
});
