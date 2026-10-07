export interface VoiceAudioOptions {
    in?: number;
    denoise?: { method: 'fft' | 'nlm'; strength: number };
    script?: string;
    captionRef?: string;
    provenance?: Record<string, unknown>;
}

/** v2 音声項目だけに書く札。legacy sfx の形には変換しない。 */
export function voiceAudioPatch(audio: VoiceAudioOptions, durationSeconds: number, fps: number): Record<string, unknown> {
    const lead = typeof audio.in === 'number' && Number.isFinite(audio.in) && audio.in > 0
        ? Math.min(audio.in, Math.max(0, durationSeconds - 1 / fps)) : 0;
    return {
        ...(lead > 0 ? { source: { in: lead }, duration: Math.max(1, Math.round((durationSeconds - lead) * fps)) } : {}),
        ...(audio.denoise ? { denoise: audio.denoise } : {}),
        ...(audio.script !== undefined ? { script: audio.script } : {}),
        ...(audio.captionRef !== undefined ? { caption_ref: audio.captionRef } : {}),
        ...(typeof audio.provenance?.provider === 'string' ? { provenance: audio.provenance } : {})
    };
}
