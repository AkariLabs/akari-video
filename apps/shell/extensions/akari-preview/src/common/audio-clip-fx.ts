export interface AudioClipFx {
    speed?: number;
    pitch_semitones?: number;
    formant?: 'preserve' | 'shift';
    denoise?: { method: 'fft' | 'nlm'; strength: number };
    lowcut_hz?: number;
}

function finiteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

// Match preview-server's prepareHeavyWav adoption rules. Denoise validation is
// deliberately deferred to hasAudioClipFx and the sidecar service.
export function audioClipFxOf(raw: unknown, kind: 'sfx' | 'bgm' | 'narration'): AudioClipFx {
    if (!raw || typeof raw !== 'object') return {};
    const value = raw as Record<string, unknown>;
    return {
        ...(kind !== 'narration' && finiteNumber(value.speed) ? { speed: value.speed } : {}),
        ...(kind !== 'narration' && finiteNumber(value.pitch_semitones)
            ? { pitch_semitones: value.pitch_semitones } : {}),
        ...(kind !== 'narration' && (value.formant === 'preserve' || value.formant === 'shift')
            ? { formant: value.formant } : {}),
        ...(value.denoise && typeof value.denoise === 'object'
            ? { denoise: value.denoise as AudioClipFx['denoise'] } : {}),
        ...(finiteNumber(value.lowcut_hz) ? { lowcut_hz: value.lowcut_hz } : {})
    };
}

// Mirror media-bin's normalizeAudioClipFx / hasAudioClipFx without importing
// node-only code into the browser. Formant alone does not require a sidecar.
export function hasAudioClipFx(clipFx: AudioClipFx = {}): boolean {
    const speed = finiteNumber(clipFx?.speed) && clipFx.speed > 0 ? clipFx.speed : 1;
    const pitchSemitones = finiteNumber(clipFx?.pitch_semitones) ? clipFx.pitch_semitones : 0;
    const denoise = clipFx?.denoise && typeof clipFx.denoise === 'object'
        && (clipFx.denoise.method === 'fft' || clipFx.denoise.method === 'nlm')
        && finiteNumber(clipFx.denoise.strength) && clipFx.denoise.strength >= 0 && clipFx.denoise.strength <= 1
        ? clipFx.denoise : null;
    const lowcutHz = finiteNumber(clipFx?.lowcut_hz) && clipFx.lowcut_hz >= 0 ? clipFx.lowcut_hz : 0;
    return speed !== 1 || pitchSemitones !== 0 || denoise !== null || lowcutHz > 0;
}

export function previewAudioSidecarRequestFor(clipFx: AudioClipFx): { speed: number; clipFx?: AudioClipFx } {
    return {
        speed: clipFx.speed ?? 1,
        ...(hasAudioClipFx(clipFx) ? { clipFx } : {})
    };
}
