// 公開エントリポイント。README.md「公開面」参照。
export { PreviewEngine } from './engine.js';
export type {
  TimelineClip,
  TimelineSpec,
  TimelineNarrationSpec,
  TimelineBgmDuckingSpec,
  TimelineAudioSpec,
  SeekMode,
  EngineEvents,
  EngineWarningEvent,
  EngineWarningKind,
  EngineErrorEvent,
  FrameEvent,
  ThumbnailEvent,
  PreviewEngineOptions,
} from './types.js';

// narration 再生 + 静的ダッキング近似（Wave 20 T4）。duckingGain.ts は DOM 非依存の純粋関数のみで
// package.json の `npm test` から直接検証できる（README「narration 再生」節参照）。
export {
  AUDIO_GAIN_DB_MIN,
  AUDIO_GAIN_DB_MAX,
  STATIC_DUCK_GAIN_DB,
  clampGainDb,
  dbToLinear,
  computeDuckIntervals,
  isWithinDuckInterval,
  computeBgmDuckGainDb,
} from './duckingGain.js';
export type { DuckInterval, DuckIntervalSource } from './duckingGain.js';
export { validateNarrationSpecs } from './narrationValidation.js';
export type {
  ResolvedNarrationSpec,
  NarrationValidationWarning,
  NarrationValidationResult,
} from './narrationValidation.js';
export { NarrationTrack } from './narrationTrack.js';
export type { DecodedNarrationEvent, NarrationTrackOptions } from './narrationTrack.js';

// ベンチ/計測ハーネスや将来の高度な利用向けに内部モジュールも export しておく
// （安定 API 契約の対象外 — 契約変更時は README の「公開面」節のみを正とする）
export { ClipSession } from './clipSession.js';
export type { ClipSessionState, TickResult } from './clipSession.js';
export { Timeline } from './timeline.js';
export type { ResolvedFrame } from './timeline.js';
export { buildKeyframeIndexFromHeader } from './keyframeIndex.js';
export type { KeyframeIndex } from './keyframeIndex.js';
export { LookaheadCache } from './lookaheadCache.js';
export { ScrubController } from './scrubController.js';
export { WarmupManager } from './warmupManager.js';
export { ThumbnailTrack } from './thumbnailTrack.js';
export type { ThumbnailEntry, ThumbnailTrackOptions } from './thumbnailTrack.js';
