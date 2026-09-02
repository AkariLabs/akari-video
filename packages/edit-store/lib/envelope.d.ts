import type { EasingV2 } from './edit-v2';
import type { DuckInterval } from './ducking';
export interface EnvelopePoint {
    /** クリップ先頭を 0 とする秒。 */
    t: number;
    /** クリップの基準ゲインへ加算する dB。 */
    gainDb: number;
    easing?: EasingV2;
}
export interface EnvelopeGainEvent {
    offsetSec: number;
    value: number;
    method: 'set' | 'linear' | 'exponential';
}
export declare const DEFAULT_DUCK_DB = -12;
export declare const DEFAULT_DUCK_ATTACK_SEC = 0.3;
export declare const DEFAULT_DUCK_RELEASE_SEC = 0.8;
export declare const DEFAULT_DUCK_KEYS: readonly ["narration", "speech"];
/** overlay-runtime の keyframe easing と数値同一の係数関数。 */
export declare function easingProgress(easing: EasingV2 | undefined, progress: number): number;
export declare function evaluateEnvelopeDb(points: readonly EnvelopePoint[], t: number): number;
export declare function composeEnvelopesDb(a: readonly EnvelopePoint[], b: readonly EnvelopePoint[]): EnvelopePoint[];
export declare function envelopeToGainEvents(points: readonly EnvelopePoint[]): EnvelopeGainEvent[];
export declare function sampleEnvelopeLinear(points: readonly EnvelopePoint[], options: {
    sampleRate: number;
    durationSec: number;
}): Float32Array;
export declare function computeDuckEnvelope(intervals: readonly DuckInterval[], options: {
    duckDb?: number;
    attackSec?: number;
    releaseSec?: number;
    clipStartSec: number;
    clipDurationSec: number;
}): EnvelopePoint[];
