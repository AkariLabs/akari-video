import { GENERATION_CAMERA_MOVES, type GenerationDraft } from './generation-fields';

export interface ProvenanceRow { key: string; label: string; value: string; referencePath?: string }
export interface GenerationProvenance {
    kind: 'video' | 'image' | 'audio';
    modelId?: string;
    rows: ProvenanceRow[];
}

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any> : {};
const filled = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;
const amount = (value: unknown): string | undefined => typeof value === 'number' && Number.isFinite(value)
    ? String(value) : undefined;
const seconds = (value: unknown): string | undefined => amount(value) ? `${amount(value)} 秒` : undefined;
const fileName = (path: string): string => path.replace(/\\/gu, '/').split('/').pop() || path;

/** A sidecar is historical evidence. Ignore next and every non-done record. */
export function generationProvenance(meta: unknown, modelName?: (id: string) => string): GenerationProvenance | undefined {
    const source = record(meta);
    if (source.status !== 'done' || !['video', 'image', 'still', 'audio'].includes(source.kind)) return undefined;
    const kind = source.kind === 'still' ? 'image' : source.kind as GenerationProvenance['kind'];
    const inputs = record(source.inputs);
    const output = record(source.output);
    const result = record(source.result);
    const cost = record(source.cost);
    const job = record(source.job);
    const model = record(source.model);
    const provenance = record(source.provenance);
    const rows: ProvenanceRow[] = [];
    const add = (key: string, label: string, value: string | undefined, referencePath?: string): void => {
        if (value !== undefined) rows.push({ key, label, value, ...(referencePath ? { referencePath } : {}) });
    };
    const modelId = filled(model.id);
    add('model', '手段', modelId && (modelName?.(modelId) ?? modelId));
    add('prompt', kind === 'audio' ? '原稿' : '指示文', filled(inputs.prompt) ?? filled(inputs.script) ?? filled(inputs.text));
    add('negative-prompt', '入れたくないもの', filled(inputs.negative_prompt));
    const camera = filled(record(inputs.camera).value);
    add('camera', 'カメラの動き', camera && (GENERATION_CAMERA_MOVES.find(move =>
        move.bracket === camera || move.prose === camera)?.label ?? camera));
    for (const [key, label] of [['first_frame', '最初の絵'], ['last_frame', '最後の絵'],
        ['source_video', '元の動画']] as const) {
        const path = filled(record(inputs[key]).path);
        add(key, label, path && fileName(path), path);
    }
    for (const [key, label] of [['reference_images', '参照画像'], ['reference_videos', '参照動画'],
        ['reference_audios', '参照音声']] as const) {
        if (!Array.isArray(inputs[key])) continue;
        inputs[key].forEach((entry: unknown, index: number) => {
            const path = filled(record(entry).path);
            add(`${key}-${index}`, label, path && fileName(path), path);
        });
    }
    add('duration', '作った長さ', seconds(output.duration_s));
    add('actual-duration', '実尺', seconds(result.duration_s_actual));
    add('resolution', '解像度', filled(output.resolution)
        ?? (amount(result.width) && amount(result.height) ? `${result.width}×${result.height}` : undefined));
    add('audio-out', '音声', typeof result.has_audio === 'boolean' ? result.has_audio ? 'あり' : 'なし'
        : typeof output.audio_out === 'boolean' ? output.audio_out ? 'あり' : 'なし' : undefined);
    add('cost', '料金', amount(cost.estimate_usd) && `見積 $${Number(cost.estimate_usd).toFixed(2)}${filled(model.as_of) ? ` · as_of ${model.as_of}` : ''}`);
    add('created', '作った日時', filled(provenance.created_at) ?? filled(job.started_at));
    add('elapsed', '所要秒', seconds(result.elapsed_s ?? job.elapsed_s));
    add('voice', '声', filled(source.voice) ?? filled(inputs.voice) ?? filled(inputs.voice_id) ?? filled(inputs.voiceId));
    return { kind, modelId, rows };
}

export function generationDraftFromDone(meta: unknown): GenerationDraft | undefined {
    const source = record(meta);
    const modelId = filled(record(source.model).id);
    return source.kind === 'video' && source.status === 'done' && modelId
        ? { modelId, inputs: { ...record(source.inputs) }, output: { ...record(source.output) } } : undefined;
}
