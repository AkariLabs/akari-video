import type {
    AudioMasterWriteRequest,
    TimelineAudioMasterSnapshot
} from '../timeline-selection-model';

export const AUDIO_MASTER_DEFAULT_LOUDNORM = -14;
export const AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP = -1.5;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readAudioMasterSnapshot(document: unknown): TimelineAudioMasterSnapshot {
    if (!isPlainObject(document) || !isPlainObject(document.audio)
        || !isPlainObject(document.audio.master)) {
        return { enabled: false };
    }
    const master = document.audio.master;
    const denoise = master.denoise === 'off' || master.denoise === 'std' || master.denoise === 'strong'
        ? master.denoise : undefined;
    const loudnorm = typeof master.loudnorm === 'number' && Number.isFinite(master.loudnorm)
        ? master.loudnorm : undefined;
    const truePeakDbtp = typeof master.true_peak_dbtp === 'number' && Number.isFinite(master.true_peak_dbtp)
        ? master.true_peak_dbtp : undefined;
    return {
        enabled: true,
        ...(denoise === undefined ? {} : { denoise }),
        ...(loudnorm === undefined ? {} : { loudnorm }),
        ...(truePeakDbtp === undefined ? {} : { truePeakDbtp })
    };
}

function assertMasterNumber(
    kind: 'audio-master-loudnorm' | 'audio-master-true-peak',
    value: number | null
): void {
    if (value === null) return;
    const [minimum, maximum, label] = kind === 'audio-master-loudnorm'
        ? [-70, 0, 'ラウドネス目標'] as const
        : [-9, 0, 'True Peak 上限'] as const;
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${label}は ${minimum}〜${maximum} の範囲で入力してください。`);
    }
}

/** audio.master だけを更新し、audio と master にある未知キーを保持する。 */
export function updateAudioMasterDocument(
    document: unknown,
    request: AudioMasterWriteRequest
): Record<string, unknown> {
    if (!isPlainObject(document)) {
        throw new Error('edit.json のトップレベルは object である必要があります。');
    }
    const rawAudio = document.audio;
    if (rawAudio !== undefined && !isPlainObject(rawAudio)) {
        throw new Error('audio は object である必要があります。');
    }
    const audio = { ...(isPlainObject(rawAudio) ? rawAudio : {}) };

    if (request.kind === 'audio-master-enabled') {
        if (!request.value) {
            if (rawAudio === undefined) return { ...document };
            delete audio.master;
        } else if (!isPlainObject(audio.master)) {
            audio.master = {};
        }
        return { ...document, audio };
    }

    if (!isPlainObject(audio.master)) {
        throw new Error('マスタリングがオフのため変更できません。');
    }
    const master = { ...audio.master };
    if (request.kind === 'audio-master-denoise') {
        if (request.value === null || request.value === 'off') delete master.denoise;
        else if (request.value === 'std' || request.value === 'strong') master.denoise = request.value;
        else throw new Error('ノイズ除去は off/std/strong のいずれかで入力してください。');
    } else {
        assertMasterNumber(request.kind, request.value);
        const field = request.kind === 'audio-master-loudnorm' ? 'loudnorm' : 'true_peak_dbtp';
        if (request.value === null) delete master[field];
        else master[field] = request.value;
    }
    audio.master = master;
    return { ...document, audio };
}
