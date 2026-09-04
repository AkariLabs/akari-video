import type { EvaluationPlan, NativeFrameSource } from '../types.js';

/**
 * stream 単位で解放できるソース。ClipSessionPool（デコーダのレーン）と LookaheadFrameSource
 * （デコード済みクローンのキャッシュ）が実装する。
 */
export interface StreamReleasingSource {
  /** 生きている stream の一覧（解放済みは含まない）。 */
  liveStreamIds(): readonly string[];
  /** stream 1 本を解放する。生きていた場合だけ true。 */
  releaseStream(streamId: string): boolean;
}

export type ReapableFrameSource = NativeFrameSource & Partial<StreamReleasingSource>;

function isReapable(source: NativeFrameSource): source is NativeFrameSource & StreamReleasingSource {
  const value = source as Partial<StreamReleasingSource>;
  return typeof value.liveStreamIds === 'function' && typeof value.releaseStream === 'function';
}

/**
 * plan が実際に decode を要求する stream を、ソースごとに集める。
 *
 * **evaluate.ts の decode 呼び出しと 1:1 で対応させること**（base = `layer.id` / 合成層 =
 * `layer-<id>` / マット = `layer-<id>-mask`）。ここがずれると「まだ使う stream」を解放して
 * しまい、毎フレーム fork し直す退行になる。
 */
export function planStreamsBySource(plan: EvaluationPlan): Map<NativeFrameSource, Set<string>> {
  const streams = new Map<NativeFrameSource, Set<string>>();
  const add = (source: NativeFrameSource | undefined, streamId: string): void => {
    if (!source) return;
    let ids = streams.get(source);
    if (!ids) {
      ids = new Set();
      streams.set(source, ids);
    }
    ids.add(streamId);
  };
  for (const layer of plan.base) {
    if (layer.kind === 'image') continue;
    add(layer.source, layer.id);
  }
  for (const layer of plan.layers) {
    if (layer.kind === 'filter') continue;
    add(layer.source, `layer-${layer.id}`);
    if (layer.mask) add(layer.mask.source, `layer-${layer.id}-mask`);
  }
  return streams;
}

export interface StreamReaperOptions {
  /**
   * 最後に使ったフレームから何フレームぶん残すか。トランジションの送出側は plan に載るので
   * 0 でも壊れないが、数フレームだけ間の空く層で fork をやり直さないための余裕（既定 = 1 秒相当）。
   */
  graceFrames?: number;
}

export interface StreamReapResult {
  released: number;
  liveStreams: number;
}

/**
 * 書き出し（厳密に前方順・過去フレームを読み直さない）で、通り過ぎたカットのデコーダセッションを
 * 解放する。カットごとに 1 セッションを掴んだまま最後まで走ると RSS が単調に膨らみ、長尺で
 * hard stop に当たる（issue #52）。
 *
 * 再生（シークが後ろへ戻る）では使わないこと — 戻った先の stream を毎回 fork し直すことになる。
 */
export class StreamReaper {
  private readonly sources: ReadonlyArray<NativeFrameSource & StreamReleasingSource>;
  private readonly lastSeen = new Map<NativeFrameSource, Map<string, number>>();
  private readonly graceFrames: number;
  private releasedTotal = 0;

  constructor(sources: Iterable<NativeFrameSource>, options: StreamReaperOptions = {}) {
    this.sources = [...sources].filter(isReapable);
    const grace = Number(options.graceFrames);
    this.graceFrames = Number.isFinite(grace) && grace >= 0 ? Math.floor(grace) : 30;
  }

  /**
   * 1 フレームぶんの回収。plan を評価する **前** に呼ぶ（新しい decode が始まる前に空ける）。
   */
  reap(plan: EvaluationPlan, frameNumber: number): StreamReapResult {
    const inUse = planStreamsBySource(plan);
    const frame = Number.isFinite(frameNumber) ? Math.round(frameNumber) : 0;
    let released = 0;
    let liveStreams = 0;
    for (const source of this.sources) {
      const seen = this.seenFor(source);
      const active = inUse.get(source);
      if (active) for (const streamId of active) seen.set(streamId, frame);
      for (const streamId of [...source.liveStreamIds()]) {
        const last = seen.get(streamId);
        // 初見（reaper を通さずに作られた stream）は今フレームに使われたものとして数え、次から測る
        if (last === undefined) {
          seen.set(streamId, frame);
          continue;
        }
        if (frame - last <= this.graceFrames) continue;
        if (source.releaseStream(streamId)) {
          released += 1;
          seen.delete(streamId);
        }
      }
      liveStreams += source.liveStreamIds().length;
    }
    this.releasedTotal += released;
    return { released, liveStreams };
  }

  /** 現在生きている stream の総数（run.json の memory ブロックに出す可視化用）。 */
  liveStreams(): number {
    let total = 0;
    for (const source of this.sources) total += source.liveStreamIds().length;
    return total;
  }

  /** これまでに解放した stream の累計。 */
  released(): number {
    return this.releasedTotal;
  }

  private seenFor(source: NativeFrameSource): Map<string, number> {
    let seen = this.lastSeen.get(source);
    if (!seen) {
      seen = new Map();
      this.lastSeen.set(source, seen);
    }
    return seen;
  }
}
