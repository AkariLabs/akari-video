import { DuckInterval } from './ducking';
export type WebAudioScheduleKind = 'bgm' | 'sfx' | 'narration';
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
}
export interface WebAudioScheduleDeclaration {
    bgm?: WebAudioDecodedItem;
    sfx?: WebAudioDecodedItem[];
    narration?: WebAudioDecodedItem[];
}
export interface WebAudioGainEvent {
    /** AudioBufferSourceNode の start 時刻からの相対秒。 */
    offsetSec: number;
    value: number;
    method: 'set' | 'linear';
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
    loop: boolean;
    gainDb: number;
    gainEvents: WebAudioGainEvent[];
    /** BGM 専用。base gain/fade と別 GainNode に適用する矩形ダッキング。 */
    duckingEvents: WebAudioGainEvent[];
}
export interface WebAudioScheduleInput {
    timelineDurationSec: number;
    startAtSec: number;
    audio?: WebAudioScheduleDeclaration;
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
