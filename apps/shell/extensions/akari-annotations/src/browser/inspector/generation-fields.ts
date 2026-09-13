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
    };
    duration: { kind: string; min?: number; max?: number; values?: number[] };
    resolutions?: string[] | null;
    audio_out?: boolean | 'always';
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
    defaults: { catalog: readonly GenerationCatalogRow[]; firstFrameLabel?: string; state?: string };
    actions: GenerationFieldActions;
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
        name, label: `${label}${counter}`, inputKind: 'media',
        getValue: () => values.map(reference => reference.path).join(', '),
        getEditValue: () => values.map(reference => reference.path).join(', '), title: options.note,
        write: (_snapshot, next) => actions.update(
            `inputs.${name}`, options.single ? (parsePaths(next)[0] ?? null) : parsePaths(next)
        )
    };
}

export function generationFields<TSnapshot>({
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
        name: 'prompt', label: 'prompt', inputKind: 'text',
        getValue: () => String(inputs.prompt ?? ''), getEditValue: () => String(inputs.prompt ?? ''),
        write: (_snapshot, value) => actions.update('inputs.prompt', value || null)
    }];

    if (catalogRow.inputs.negative_prompt === true) fields.push({
        name: 'negative-prompt', label: 'negative prompt', inputKind: 'text',
        getValue: () => String(inputs.negative_prompt ?? ''), getEditValue: () => String(inputs.negative_prompt ?? ''),
        write: (_snapshot, value) => actions.update('inputs.negative_prompt', value || null)
    });
    if (catalogRow.inputs.first_frame !== 'none') fields.push({
        name: 'first-frame', label: '最初のフレーム', disabled: true,
        getValue: () => defaults.firstFrameLabel ?? 'このクリップの静止画（変更不可）',
        title: 'このクリップの静止画・変更不可'
    });
    if (catalogRow.inputs.last_frame !== 'none') {
        fields.push(refField('last_frame', '最後のフレーム', inputs.last_frame, actions, { single: true }));
    }
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
    fields.push({
        name: 'camera', label: '動き', inputKind: 'text', title: '[Push in] のような記法で入力します',
        getValue: () => String((inputs.camera as { value?: unknown } | undefined)?.value ?? ''),
        getEditValue: () => String((inputs.camera as { value?: unknown } | undefined)?.value ?? ''),
        write: (_snapshot, value) => actions.update('inputs.camera', value
            ? { notation: value.trim().startsWith('[') ? 'bracket' : 'prose', value, from_annotation: null } : null)
    });
    const rounded = validation?.rounded?.duration_s;
    const duration = Number(output.duration_s ?? 0);
    const normalizedDuration = Number(validation?.normalized?.output?.duration_s);
    const normalizedChanged = Number.isFinite(duration) && Number.isFinite(normalizedDuration)
        && duration !== normalizedDuration
        ? { from: duration, to: normalizedDuration } : undefined;
    const durationChange = rounded ?? normalizedChanged;
    fields.push({
        name: 'generation-duration', label: '尺',
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
        getValue: () => '常に付く・既定 mute'
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
    if (state === 'failed') actionRows.push({ name: 'retry', label: '再試行', title: '同じ入力で再試行', action: actions.retry });
    fields.push({ name: 'generation-actions', label: '操作', getValue: () => '', actions: actionRows });
    return fields;
}
