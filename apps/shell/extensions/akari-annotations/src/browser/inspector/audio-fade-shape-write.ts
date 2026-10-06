import type { AudioFadeShape } from '../../common/audio-inline-envelope';

export interface AudioFadeShapeWriteRequest {
    kind: 'audio-fade-shape';
    id: string;
    audioKind: 'bgm' | 'sfx' | 'narration';
    edge: 'in' | 'out';
    value: AudioFadeShape;
}

export function isAudioFadeShapeWriteRequest(value: unknown): value is AudioFadeShapeWriteRequest {
    if (!value || typeof value !== 'object') return false;
    const request = value as Partial<AudioFadeShapeWriteRequest>;
    return request.kind === 'audio-fade-shape'
        && typeof request.id === 'string' && (request.edge === 'in' || request.edge === 'out')
        && (request.audioKind === 'bgm' || request.audioKind === 'sfx' || request.audioKind === 'narration')
        && (request.value === 'linear' || request.value === 'equal_power'
            || request.value === 's_curve' || request.value === 'slow');
}
