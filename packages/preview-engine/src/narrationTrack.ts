// narration 再生（docs/contract-2026-07-20-edit-json-v1-narration.md §7: 「プレビュー側は
// composition track へ t の位置で挿入」という設計意図を Web Audio API で実装したもの）。
//
// 重要な前提（report.md に詳細記載）: packages/preview-engine には BGM/SFX のプレビュー再生自体が
// まだ存在しない（video の音声トラックは clipSession.ts が MP4Clip 経由でデコードするのみで、
// BGM/SFX 用のミキシンググラフは無い）。そのため本モジュールは「既存の BGM/SFX 再生に narration を
// 相乗りさせる」のではなく、narration 専用の Web Audio ミキシンググラフを新設する。ducking の
// 適用先となる BGM の GainNode 自体は本パッケージが持たないため、静的ダッキング量の計算
// （duckingGain.ts）だけを提供し、実際の BGM ゲインへの適用は呼び出し側（将来 BGM 再生を実装する側）
// の責務として engine.ts の `narrationDuckGainDbAt()` から公開する。
import { validateNarrationSpecs } from './narrationValidation.js';
import { computeDuckIntervals, dbToLinear, type DuckInterval } from './duckingGain.js';
import type { EngineWarningEvent, TimelineNarrationSpec } from './types.js';

export interface DecodedNarrationEvent {
  id: string;
  buffer: AudioBuffer;
  /** タイムライン秒 */
  t: number;
  /** クランプ済み gain_db */
  gainDb: number;
  /** デコードで得た実尺（秒） */
  durationSec: number;
}

export interface NarrationTrackOptions {
  /** テスト時の差し替え用。省略時はグローバル fetch を使う */
  fetchImpl?: typeof fetch;
}

/**
 * narration イベント群のデコード・保持・スケジュール再生を担当する。
 * 1 個の BaseAudioContext（AudioContext または OfflineAudioContext）に対して 1 インスタンス。
 */
export class NarrationTrack {
  private events: DecodedNarrationEvent[] = [];
  private activeSources: { source: AudioBufferSourceNode; gain: GainNode }[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly opts: NarrationTrackOptions = {}
  ) {}

  /** 現在保持している（デコード成功済みの）narration イベント一覧 */
  getEvents(): readonly DecodedNarrationEvent[] {
    return this.events;
  }

  /** bgm.ducking 判定に使う区間一覧（duckingGain.ts 参照） */
  getDuckIntervals(): DuckInterval[] {
    return computeDuckIntervals(this.events.map((e) => ({ t: e.t, durationSec: e.durationSec })));
  }

  /**
   * narration 仕様群を検証・fetch・デコードして内部に保持する。
   * 個別要素が読めない/壊れている場合はその要素だけをスキップし（契約 §4）、
   * console 警告 + onWarning コールバック（EngineWarningEvent 'narrationUnavailable'）の両方で通知する。
   * プレビュー全体（他の narration・映像）は継続する。
   */
  async load(
    specs: readonly TimelineNarrationSpec[],
    timelineDurationSec: number,
    onWarning: (w: EngineWarningEvent) => void
  ): Promise<void> {
    const { valid, skipped } = validateNarrationSpecs(specs, timelineDurationSec);
    for (const s of skipped) {
      const message = `narration ${s.id} skipped: ${s.reason}`;
      console.warn(`[preview-engine] ${message}`);
      onWarning({ kind: 'narrationUnavailable', clipId: s.id, message });
    }

    const fetchImpl = this.opts.fetchImpl ?? fetch;
    for (const spec of valid) {
      try {
        const res = await fetchImpl(spec.src);
        if (!res.ok) throw new Error(`fetch failed: ${spec.src} status=${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        // decodeAudioData はブラウザ実装によって Promise 版とコールバック版の両方があるため、
        // 契約で必須と決めた基盤（WebCodecs + av-cliper が既に前提とする Chromium）の Promise 版を使う。
        const buffer = await this.ctx.decodeAudioData(arrayBuf);
        this.events.push({ id: spec.id, buffer, t: spec.t, gainDb: spec.gainDb, durationSec: buffer.duration });
      } catch (e) {
        const message = `narration ${spec.id} unavailable (fetch/decode failed): ${String(e)}`;
        console.warn(`[preview-engine] ${message}`);
        onWarning({ kind: 'narrationUnavailable', clipId: spec.id, message, detail: e });
      }
    }
  }

  /**
   * startAtSec（タイムライン秒）から再生を開始するよう、保持中の narration イベントをスケジュールする。
   * 呼び出し前に鳴っていた分は stopAll() 相当で止めてから積み直す（play()/シーク時の再スケジュール用）。
   *
   * - t >= startAtSec のイベント: (t - startAtSec) 秒後に頭から開始
   * - t < startAtSec < t+durationSec のイベント（再生位置が narration の途中にシークされた場合）:
   *   即座に、バッファ内オフセット (startAtSec - t) から開始
   * - t + durationSec <= startAtSec のイベント（既に終わっている）: スケジュールしない
   */
  scheduleFrom(startAtSec: number, contextStartTime: number, destination: AudioNode): void {
    this.stopAll();
    for (const ev of this.events) {
      const endSec = ev.t + ev.durationSec;
      if (endSec <= startAtSec) continue;

      const gainNode = this.ctx.createGain();
      gainNode.gain.value = dbToLinear(ev.gainDb);
      gainNode.connect(destination);

      const source = this.ctx.createBufferSource();
      source.buffer = ev.buffer;
      source.connect(gainNode);

      if (ev.t >= startAtSec) {
        source.start(contextStartTime + (ev.t - startAtSec));
      } else {
        source.start(contextStartTime, startAtSec - ev.t);
      }
      this.activeSources.push({ source, gain: gainNode });
    }
  }

  /** 現在スケジュール/再生中の narration をすべて停止・切断する（pause/seek/dispose 用） */
  stopAll(): void {
    for (const { source, gain } of this.activeSources) {
      try {
        source.stop();
      } catch {
        // 既に停止済み/未開始のことがある（Web Audio 仕様上 stop() が例外を投げうる） — 無害
      }
      source.disconnect();
      gain.disconnect();
    }
    this.activeSources = [];
  }

  dispose(): void {
    this.stopAll();
    this.events = [];
  }
}
