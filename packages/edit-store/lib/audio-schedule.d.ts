import { DuckInterval } from './ducking';
import type { EditCut } from './edit-store';
export type WebAudioScheduleKind = 'bgm' | 'sfx' | 'narration' | 'speech';
export interface WebAudioDecodedItem {
    id?: string;
    durationSec: number;
    t?: unknown;
    in?: unknown;
    out?: unknown;
    loop?: unknown;
    track?: unknown;
    gain_db?: unknown;
    gainDb?: unknown;
    fadeIn?: unknown;
    fadeOut?: unknown;
    fade_in?: unknown;
    fade_out?: unknown;
    ducking?: unknown;
    duck_db?: unknown;
    duck_attack?: unknown;
    duck_release?: unknown;
    keyframes?: unknown;
    /** 重い WAV の trim 済み FLAC。存在すると in/out はサイドカー生成時に適用済み。 */
    sidecar?: WebAudioSidecar;
}
export interface WebAudioSidecar {
    path: string;
    durationSec: number;
    padBeforeSec: number;
    padAfterSec: number;
    generatedMs?: number;
    skipped?: boolean;
    bytes?: number;
}
export interface WebAudioScheduleDeclaration {
    bgm?: WebAudioDecodedItem;
    sfx?: WebAudioDecodedItem[];
    narration?: WebAudioDecodedItem[];
    speech?: WebAudioSpeechDeclaration[];
    duck_keys?: unknown;
}
export interface WebAudioSpeechDeclaration {
    id: string;
    src: string;
    atSec: number;
    /** 出力タイムライン上の再生尺。 */
    durationSec: number;
    inSec: number;
    outSec: number;
    speed: number;
    gainDb?: number;
    track?: number;
    /** decode 後の素材実尺。 */
    materialDurationSec: number;
    /** trim / atempo を ffmpeg で焼いた、区間単位のプレビュー用 FLAC。 */
    sidecar?: WebAudioSidecar;
    /** 旧 summary の読み取り互換。新規生成は sidecar だけを使う。 */
    atempo?: {
        path: string;
        durationSec: number;
        generatedMs?: number;
    };
    padBeforeSec?: number;
    padAfterSec?: number;
    crossfadeInSec?: number;
    crossfadeOutSec?: number;
}
export interface WebAudioSpeechCut extends EditCut {
    id?: string;
    freeze?: {
        at_sec?: unknown;
        duration_sec?: unknown;
    } | null;
    gain_db?: unknown;
    gainDb?: unknown;
    volume_db?: unknown;
    transition_out?: EditCut['transitionOut'] | null;
}
export interface WebAudioGainEvent {
    /** AudioBufferSourceNode の start 時刻からの相対秒。 */
    offsetSec: number;
    value: number;
    method: 'set' | 'linear' | 'exponential';
}
export interface WebAudioScheduledItem {
    kind: WebAudioScheduleKind;
    id: string;
    track: number;
    timelineStartSec: number;
    timelineEndSec: number;
    delaySec: number;
    sourceOffsetSec: number;
    durationSec: number;
    /** AudioBufferSourceNode の再生速度。 */
    playbackRate: number;
    /** start() の duration 引数へ渡す素材時間軸の尺。 */
    sourceDurationSec: number;
    loop: boolean;
    gainDb: number;
    gainEvents: WebAudioGainEvent[];
    /** base gain/fade と別 GainNode に適用する keyframe + ducking エンベロープ。 */
    envelopeEvents: WebAudioGainEvent[];
}
export interface WebAudioScheduleInput {
    timelineDurationSec: number;
    startAtSec: number;
    audio?: WebAudioScheduleDeclaration;
    /** narration 以外から得たタイムライン上の duck 鍵区間。 */
    duckKeyIntervals?: DuckInterval[];
    /** duckKeyIntervals の互換別名。 */
    speechKeyIntervals?: DuckInterval[];
}
export interface WebAudioScheduleResult {
    timelineDurationSec: number;
    startAtSec: number;
    items: WebAudioScheduledItem[];
    duckIntervals: DuckInterval[];
    warnings: string[];
}
/**
 * 解決済みタイムライン尺・正規化済み audio 宣言・デコード実尺を、Web Audio がそのまま
 * 消費できる予定表へ落とす。fetch/decode/時計は扱わないため、実時間と OfflineAudioContext
 * の両方で同じ結果を再生できる。
 */
export declare function buildWebAudioSchedule(input: WebAudioScheduleInput): WebAudioScheduleResult;
/**
 * cuts[] を出力タイムライン上の撮影素材音声へ投影する。URL 解決と decode 実尺の確定は
 * 呼び出し側が行い、ここでは source id と時間写像だけを決定する。
 */
export declare function projectSpeechDeclarations(cuts: readonly WebAudioSpeechCut[], options: {
    fps: number;
}): WebAudioSpeechDeclaration[];
