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

export interface GenerationCatalogRow {
    id: string;
    kind: string;
    family?: string;
    inputs: {
        first_frame: 'required' | 'optional' | 'none';
        last_frame: 'required' | 'optional' | 'none';
        reference_images?: { max?: number | null };
        reference_audios?: { max?: number | null };
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
    rounded?: { duration_s?: { from: number; to: number } } | null;
    messages?: Array<{ level: 'error' | 'warn' | 'info'; text: string }>;
    cost?: { estimate_usd?: number | null; as_of?: string | null; needs_explicit_confirm?: boolean };
}

export interface GenerationFieldDef<TSnapshot = unknown> {
    generationChildren?: GenerationFieldDef<TSnapshot>[];
    generationDetail?: boolean;
    generationFrame?: boolean;
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

const parsePaths = (value: string): GenerationReference[] => value.split(',')
    .map(path => path.trim()).filter(Boolean).map(path => ({ path }));

const pricePerSecond = (row: GenerationCatalogRow): number | null => {
    const prices = Object.values(row.price?.by_resolution ?? {}).filter(Number.isFinite);
    return prices.length ? Math.min(...prices) : null;
};

export function generationFactLabel(row: GenerationCatalogRow): string {
    const price = pricePerSecond(row);
    return `${row.family ?? row.id} · ${price === null ? '見積不可' : `$${price}/秒`} · as_of ${row.as_of ?? '不明'}（${row.id}）`;
}

function refField<T>(
    name: string, label: string, value: unknown, actions: GenerationFieldActions,
    options: { max?: number | null; note?: string; single?: boolean } = {}
): GenerationFieldDef<T> {
    const values = options.single
        ? (value && typeof value === 'object' && !Array.isArray(value) ? [value as GenerationReference] : [])
        : refs(value);
    const count = values.length;
    const counter = options.max === null || options.max === undefined ? '' : ` ${count} / ${options.max}`;
    return {
        name, label: `${label}${counter}`, inputKind: 'media', generationDetail: true,
        getValue: () => values.map(reference => reference.path).join(', '),
        getEditValue: () => values.map(reference => reference.path).join(', '), title: options.note,
        write: (_snapshot, next) => actions.update(
            `inputs.${name}`, options.single ? (parsePaths(next)[0] ?? null) : parsePaths(next)
        )
    };
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
    for (const [slot, name, label] of [
        ['first_frame', 'first-frame', '最初の絵'], ['last_frame', 'last_frame', '最後の絵']
    ] as const) {
        if (catalogRow.inputs[slot] === 'none') continue;
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
    const imageMax = catalogRow.inputs.reference_images?.max;
    if (imageMax === null || (typeof imageMax === 'number' && imageMax > 0)) {
        fields.push(refField('reference_images', '参照画像', inputs.reference_images, actions, { max: imageMax }));
    }
    const audioMax = catalogRow.inputs.reference_audios?.max;
    if (typeof audioMax === 'number' && audioMax > 0) {
        fields.push(refField('reference_audios', '参照音声', inputs.reference_audios, actions, {
            max: audioMax, note: '効き目は未較正'
        }));
    }
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
    cameraValue: generationCameraValue,
    cameraMoves: GENERATION_CAMERA_MOVES
});
