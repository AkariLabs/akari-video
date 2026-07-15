// 公開エントリポイント。README.md「公開面」参照。
export { PreviewEngine } from './engine.js';
export type {
  TimelineClip,
  TimelineSpec,
  SeekMode,
  EngineEvents,
  EngineWarningEvent,
  EngineWarningKind,
  EngineErrorEvent,
  FrameEvent,
  PreviewEngineOptions,
} from './types.js';

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
