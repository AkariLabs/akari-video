// 公開型定義。README.md の公開面（mount / loadTimeline / seek / play / dispose + イベント）に対応。

/** タイムライン上の1クリップ（MVP: カット + オーバーレイのみ、エフェクト/トランジションは非スコープ） */
export interface TimelineClip {
  id: string;
  /** 素材の URL（spike://, file://, blob: など fetch 可能な URL） */
  src: string;
  /** タイムライン上の開始フレーム（このクリップの表示開始） */
  startFrame: number;
  /** タイムライン上の終了フレーム（exclusive） */
  endFrame: number;
  /** 素材内のイン点（マイクロ秒）。省略時 0 */
  sourceInUs?: number;
  /** トラック番号。E1 の activeLayerCount 計算に使う（同時刻に重なる video/image トラック数） */
  track: number;
  mediaType?: 'video' | 'image';
}

/**
 * ナレーション1件のプレビュー再生指定（edit.json `audio.narration[]` のプレビュー用サブセット。
 * 契約: docs/contract-2026-07-20-edit-json-v1-narration.md §1）。
 * script/reading/provenance 等の非再生メタデータは持たない（プレビュー再生に不要なため）。
 */
export interface TimelineNarrationSpec {
  id: string;
  /** 音声ファイルの URL（fetch 可能な URL。TimelineClip.src と同じ規約） */
  src: string;
  /** タイムライン秒（overlays[].start / audio.sfx[].t と同じ座標系）。0 以上 */
  t: number;
  /** dB。省略時 0。クランプ範囲 [-60, 12]（audio.bgm / audio.sfx と同一。契約 §4） */
  gainDb?: number;
}

/**
 * audio.bgm のプレビュー向けサブセット。**BGM 自体の音声読み込み・再生は本パッケージの
 * スコープ外**（packages/preview-engine には現状 BGM/SFX のプレビュー再生自体が未実装。
 * 詳細は README「narration 再生」節と本タスクの report.md を参照）。ここでは
 * ducking の要否フラグのみを受け取り、narration 区間に対する静的ダッキング量の計算に使う
 * （PreviewEngine#narrationDuckGainDbAt）。
 */
export interface TimelineBgmDuckingSpec {
  /** 省略時 false（契約と同一既定値） */
  ducking?: boolean;
}

export interface TimelineAudioSpec {
  bgm?: TimelineBgmDuckingSpec;
  /** 省略可。省略 = narration なし（既存タイムラインの挙動と完全に同じ。契約 §0 の後方互換方針） */
  narration?: TimelineNarrationSpec[];
}

export interface TimelineSpec {
  fps: number;
  /** 開始フレーム順は問わない。エンジン内でソートする */
  clips: TimelineClip[];
  /** 省略可。省略時は narration なしプロジェクトと完全に同じ挙動（非退行） */
  audio?: TimelineAudioSpec;
}

export type SeekMode = 'exact' | 'interactiveScrub';

/** E4 が発する警告種別 */
export type EngineWarningKind =
  | 'audioDecoderFallback' // AAC 等の configure 無限リトライ対策 — audio:false で再読込した
  | 'hwDecoderDegraded' // HW セッション枯渇/非対応 → SW へのフォールバックも失敗し劣化運用
  | 'tailGopMarginClamped' // 末尾 GOP 安全マージンでシーク位置をクランプした
  | 'decodeTimeout' // configure/decode がタイムアウトした
  | 'clipUnavailable' // どのフォールバックも尽きてクリップが利用不能
  | 'narrationUnavailable'; // narration 要素の fetch/decode 失敗、または t/gain_db が不正で無視した（契約 §4）

export interface EngineWarningEvent {
  kind: EngineWarningKind;
  clipId: string;
  message: string;
  detail?: unknown;
}

export interface EngineErrorEvent {
  clipId?: string;
  message: string;
  detail?: unknown;
}

export interface FrameEvent {
  frame: number;
  clipId: string;
  /** この描画が近似（tolerance スクラブ着地）か厳密解決か */
  approx: boolean;
  /** 実測ティックレイテンシ（ms） */
  tickMs: number;
  /** キャンバスへ既に描画済み（mount 済みなら） */
  drawn: boolean;
}

/** E5 のメモリ内サムネイルが canvas へ描画された際のイベント */
export interface ThumbnailEvent {
  frame: number;
  clipId: string;
  drawnAtMs: number;
}

export interface EngineEvents {
  frame: FrameEvent;
  thumbnail: ThumbnailEvent;
  warning: EngineWarningEvent;
  error: EngineErrorEvent;
  /** E3 warmup が発火した際の観測用イベント（ベンチ計測用） */
  warmup: { clipId: string; primedAtFrame: number; tookMs: number };
  play: { frame: number };
  pause: { frame: number };
  dispose: Record<string, never>;
}

export interface PreviewEngineOptions {
  /** E1: 30Hz スロットル間隔(ms)。既定 1000/30 */
  scrubThrottleMs?: number;
  /** E1: tolerance が範囲内にキーフレームを見つけられない場合、範囲外でも最寄りキーフレームへスナップするか。
   *  既定 true（契約からの明示的拡張。理由は README/report 参照: 長 GOP 素材では厳密 tolerance 内に
   *  キーフレームが存在しないケースが支配的なため） */
  keyframeSnapBeyondTolerance?: boolean;
  /** E2: 先読みキャッシュに保持するフレーム数 */
  lookaheadCacheSize?: number;
  /** E3: カット点ウォームアップを開始する残り時間(秒) */
  warmupLeadInSec?: number;
  /** E4: clip 読み込み(ready)のタイムアウト(ms) */
  loadTimeoutMs?: number;
  /** E4: 単発 tick() のタイムアウト(ms) */
  tickTimeoutMs?: number;
  /** E4: 末尾 GOP 安全マージン(マイクロ秒) */
  tailMarginUs?: number;
  /** E5: interactiveScrub の同期サムネイル表示を有効化する。既定 true */
  enableThumbnailScrub?: boolean;
  /** E5: 1クリップあたりのサムネイル上限。既定 40 */
  thumbnailMaxCount?: number;
  /** E5: キーフレーム索引が無い場合の等間隔サンプリング秒数。既定 2 */
  thumbnailIntervalSec?: number;
  /** E5: メモリ内サムネイルの幅(px)。既定 160 */
  thumbnailWidth?: number;
}
