import { t } from '@akari-video/i18n';
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
const seconds = (value: unknown): string | undefined => amount(value) ? t('inspector.generationProvenance.label.seconds', { seconds: amount(value), n: amount(value) }) : undefined;
const elapsedSeconds = (value: unknown): string | undefined => typeof value === 'number' && Number.isFinite(value)
    ? value < 1 ? t('inspector.generationProvenance.label.lessThan1Second') : t('inspector.generationProvenance.label.seconds', { seconds: Math.round(value), n: Math.round(value) }) : undefined;
const localDateTime = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const pad = (part: number): string => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const fileName = (path: string): string => path.replace(/\\/gu, '/').split('/').pop() || path;

/** A sidecar is historical evidence. Ignore next and every non-done record. */
export function generationProvenance(meta: unknown, modelName?: (id: string) => string,
    voiceName?: (id: string, engineId: string | undefined) => string | undefined): GenerationProvenance | undefined {
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
    add('model', t('inspector.generationProvenance.label.method'), modelId && (modelName?.(modelId) ?? modelId));
    add('prompt', kind === 'audio' ? t('inspector.generationProvenance.label.script') : t('inspector.generationProvenance.label.prompt'), filled(inputs.prompt) ?? filled(inputs.script) ?? filled(inputs.text));
    add('negative-prompt', t('inspector.generationProvenance.label.whatDonTWantPut'), filled(inputs.negative_prompt));
    const camera = filled(record(inputs.camera).value);
    add('camera', t('inspector.generationProvenance.label.cameraMovement'), camera && (GENERATION_CAMERA_MOVES.find(move =>
        move.bracket === camera || move.prose === camera)?.label ?? camera));
    for (const [key, label] of [['first_frame', t('inspector.generationProvenance.label.firstPicture')], ['last_frame', t('inspector.generationProvenance.label.lastPicture')],
        ['source_video', t('inspector.generationProvenance.label.originalVideos')]] as const) {
        const path = filled(record(inputs[key]).path);
        add(key, label, path && fileName(path), path);
    }
    for (const [key, label] of [['reference_images', t('inspector.generationProvenance.label.referenceImage')], ['reference_videos', t('inspector.generationProvenance.label.referenceVideos')],
        ['reference_audios', t('inspector.generationProvenance.label.referenceAudio')]] as const) {
        if (!Array.isArray(inputs[key])) continue;
        inputs[key].forEach((entry: unknown, index: number) => {
            const path = filled(record(entry).path);
            add(`${key}-${index}`, label, path && fileName(path), path);
        });
    }
    add('duration', t('inspector.generationProvenance.label.length'), seconds(output.duration_s));
    add('actual-duration', t('inspector.generationProvenance.label.actualDuration'), seconds(result.duration_s_actual));
    add('resolution', t('inspector.generationProvenance.label.resolution'), filled(output.resolution)
        ?? (amount(result.width) && amount(result.height) ? `${result.width}×${result.height}` : undefined));
    add('audio-out', t('inspector.generationProvenance.label.audio'), typeof result.has_audio === 'boolean' ? result.has_audio ? t('inspector.generationProvenance.label.yes') : t('inspector.generationProvenance.label.none')
        : typeof output.audio_out === 'boolean' ? output.audio_out ? t('inspector.generationProvenance.label.yes') : t('inspector.generationProvenance.label.none') : undefined);
    add('cost', t('inspector.generationProvenance.label.price'), amount(cost.estimate_usd) && t('inspector.generationProvenance.estimate.withDate', { amount: Number(cost.estimate_usd).toFixed(2), dateNote: filled(model.as_of) ? ` · as_of ${model.as_of}` : '' }));
    add('created', t('inspector.generationProvenance.label.dateTime'), localDateTime(filled(provenance.created_at) ?? filled(job.started_at)));
    add('elapsed', t('inspector.generationProvenance.error.requiredSeconds'), elapsedSeconds(result.elapsed_s ?? job.elapsed_s));
    const voiceId = filled(source.voice) ?? filled(inputs.voice) ?? filled(inputs.voice_id) ?? filled(inputs.voiceId);
    const engineId = filled(source.route) ?? modelId?.replace(/:tts$/u, '');
    add('voice', t('inspector.generationProvenance.label.voice'), voiceId && (kind === 'audio' ? voiceName?.(voiceId, engineId) ?? voiceId : voiceId));
    return { kind, modelId, rows };
}

export function generationDraftFromDone(meta: unknown): GenerationDraft | undefined {
    const source = record(meta);
    const modelId = filled(record(source.model).id);
    return source.kind === 'video' && source.status === 'done' && modelId
        ? { modelId, inputs: { ...record(source.inputs) }, output: { ...record(source.output) } } : undefined;
}
