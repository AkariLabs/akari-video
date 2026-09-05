import type { InspectorWriteRequest, TimelineAudioSelection } from '../timeline-selection-model';
import {
    EditV2Document,
    findAudioItemIdByRole,
    updateAudioNarrationPreferV2,
    updateAudioSfxPreferV2,
    updateItem as updateV2Item
} from '../../common/edit-v2-mutations';

export type AudioClipFxWriteRequest = Extract<InspectorWriteRequest, { kind: 'audio-clip-fx' }>;
export type AudioClipFxField = AudioClipFxWriteRequest['field'];
export type AudioClipFxRow = Exclude<AudioClipFxField, 'denoise'> | 'denoise-method' | 'denoise-strength';

export const AUDIO_CLIP_FX_RANGES = {
    speed: { min: 0.25, max: 4, exclusiveMin: true, default: 1 },
    pitch_semitones: { min: -24, max: 24, default: 0 },
    formant: { values: ['preserve', 'shift'], default: 'preserve' },
    denoise: { methods: ['fft', 'nlm'], default: null },
    strength: { min: 0, max: 1, default: 0.5 },
    lowcut_hz: { min: 0, max: 400, default: 0 }
} as const;

export function assertAudioClipFxValue(field: AudioClipFxField | 'strength', value: unknown): void {
    if (value === null) return;
    if (field === 'formant') {
        if (value !== 'preserve' && value !== 'shift') {
            throw new Error('フォルマントは preserve / shift で指定してください。');
        }
        return;
    }
    if (field === 'denoise') {
        if (value === 'off') return;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('ノイズ除去は method と strength を対で指定してください。');
        }
        const denoise = value as Record<string, unknown>;
        if ((denoise.method !== 'fft' && denoise.method !== 'nlm')
            || typeof denoise.strength !== 'number'
            || Object.keys(denoise).some(key => key !== 'method' && key !== 'strength')) {
            throw new Error('ノイズ除去は method（fft / nlm）と strength を対で指定してください。');
        }
        assertAudioClipFxValue('strength', denoise.strength);
        return;
    }
    const range = AUDIO_CLIP_FX_RANGES[field];
    const label = field === 'speed' ? '速度' : field === 'pitch_semitones' ? 'ピッチ'
        : field === 'strength' ? 'ノイズ除去の強さ' : 'ローカット';
    if (typeof value !== 'number' || !Number.isFinite(value) || value > range.max
        || (field === 'speed' ? value <= range.min : value < range.min)) {
        const bounds = field === 'speed' ? '0.25 より大きく 4 以下' : `${range.min}〜${range.max}`;
        throw new Error(`${label}は ${bounds} の範囲で入力してください。`);
    }
}

export function buildAudioClipFxPatch(
    audioKind: TimelineAudioSelection['audioKind'],
    field: AudioClipFxField,
    value: AudioClipFxWriteRequest['value']
): { itemPatch: Record<string, unknown>; legacyPatch: Record<string, unknown> } {
    const sourceField = field === 'speed' || field === 'pitch_semitones' || field === 'formant';
    if (audioKind === 'narration' && sourceField) {
        throw new Error('ナレーションの速度・ピッチは TTS 側で調整します');
    }
    assertAudioClipFxValue(field, value);
    const normalized = value === AUDIO_CLIP_FX_RANGES[field].default
        || (field === 'denoise' && value === 'off') ? null : value;
    return {
        itemPatch: sourceField ? { source: { [field]: normalized } } : { [field]: normalized },
        legacyPatch: { [field]: normalized }
    };
}

/** 数値行からは displayScale 適用後の内部値を受け取る。 */
export function createAudioClipFxWriteRequest(
    snapshot: TimelineAudioSelection,
    row: AudioClipFxRow,
    input: string | number | null
): AudioClipFxWriteRequest {
    let field: AudioClipFxField;
    let value: AudioClipFxWriteRequest['value'];
    if (row === 'denoise-method') {
        field = 'denoise';
        const method = input === 'FFT' ? 'fft' : input === 'NLM' ? 'nlm' : input;
        value = method === null || method === 'オフ' || method === 'off' ? null : {
            method: method as 'fft' | 'nlm',
            strength: snapshot.denoise?.strength ?? AUDIO_CLIP_FX_RANGES.strength.default
        };
    } else if (row === 'denoise-strength') {
        field = 'denoise';
        value = {
            method: snapshot.denoise?.method ?? 'fft',
            strength: input === null ? AUDIO_CLIP_FX_RANGES.strength.default : Number(input)
        };
    } else {
        field = row;
        value = input === null ? null : row === 'formant'
            ? input === '保持' ? 'preserve' : input === '移動' ? 'shift' : String(input)
            : Number(input);
    }
    buildAudioClipFxPatch(snapshot.audioKind, field, value);
    return { kind: 'audio-clip-fx', id: snapshot.id, audioKind: snapshot.audioKind, field, value };
}

export function audioClipFxFieldsForSnapshot(value: {
    speed?: number;
    pitch_semitones?: number;
    formant?: TimelineAudioSelection['formant'];
    denoise?: TimelineAudioSelection['denoise'];
    lowcut_hz?: number;
}): Pick<TimelineAudioSelection, 'speed' | 'pitchSemitones' | 'formant' | 'denoise' | 'lowcutHz'> {
    return {
        ...(value.speed !== undefined ? { speed: value.speed } : {}),
        ...(value.pitch_semitones !== undefined ? { pitchSemitones: value.pitch_semitones } : {}),
        ...(value.formant !== undefined ? { formant: value.formant } : {}),
        ...(value.denoise !== undefined ? { denoise: { ...value.denoise } } : {}),
        ...(value.lowcut_hz !== undefined ? { lowcutHz: value.lowcut_hz } : {})
    };
}

export function updateAudioClipFxDocument(doc: EditV2Document, request: AudioClipFxWriteRequest): EditV2Document {
    const { itemPatch, legacyPatch } = buildAudioClipFxPatch(request.audioKind, request.field, request.value);
    if (request.audioKind === 'sfx') {
        return updateAudioSfxPreferV2(doc, { sfxId: request.id, itemPatch, legacyPatch });
    }
    if (request.audioKind === 'narration') {
        return updateAudioNarrationPreferV2(doc, { narrationId: request.id, itemPatch, legacyPatch });
    }
    // role 検索で実在する v2 item の id を得た場合だけ updateItem へ渡す。
    const itemId = Array.isArray(doc.tracks) ? findAudioItemIdByRole(doc, 'bgm') : undefined;
    if (itemId !== undefined) return updateV2Item(doc, { itemId, patch: itemPatch });
    if (!doc.audio || typeof doc.audio !== 'object' || Array.isArray(doc.audio)) {
        throw new Error('edit.json.audio.bgm が見つかりません。');
    }
    const audio = doc.audio as Record<string, unknown>;
    if (!audio.bgm || typeof audio.bgm !== 'object' || Array.isArray(audio.bgm)) {
        throw new Error('edit.json.audio.bgm が見つかりません。');
    }
    const bgm = { ...audio.bgm as Record<string, unknown> };
    for (const [key, next] of Object.entries(legacyPatch)) {
        if (next === null) delete bgm[key];
        else bgm[key] = next;
    }
    return { ...doc, audio: { ...audio, bgm } };
}
