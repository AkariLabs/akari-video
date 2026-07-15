import type { TimelineClip, TimelineSpec } from './types.js';

export interface ResolvedFrame {
  clip: TimelineClip;
  /** クリップ先頭からの経過フレーム数 */
  localFrame: number;
  /** 素材(source)ドメインでの時刻(us)。tick()/keyframeIndex に渡す時刻 */
  sourceTimeUs: number;
  /** 同時刻に重なっている video/image トラック数（E1 tolerance 計算用） */
  activeLayerCount: number;
  /** 次に始まるクリップ（カット境界の先読み対象、E3） */
  nextClip: TimelineClip | null;
  /** 現在クリップが終わるまでの残り秒数（次クリップが直後に始まる場合のみ warmup 対象） */
  secondsToBoundary: number | null;
}

export class Timeline {
  readonly fps: number;
  private clips: TimelineClip[];

  constructor(spec: TimelineSpec) {
    this.fps = spec.fps;
    this.clips = [...spec.clips].sort((a, b) => a.startFrame - b.startFrame);
  }

  getClips(): readonly TimelineClip[] {
    return this.clips;
  }

  totalFrames(): number {
    return this.clips.reduce((max, c) => Math.max(max, c.endFrame), 0);
  }

  resolve(frame: number): ResolvedFrame | null {
    // MVP: track 0 を「プライマリ（再生対象）」として扱う。複数トラックは activeLayerCount の
    // カウントにのみ寄与する（実際の合成描画は非スコープ — 契約 §4 非スコープ「エフェクト・
    // トランジションのリアルタイム合成」に該当）。
    const primary = this.clips.find(
      (c) => frame >= c.startFrame && frame < c.endFrame && (c.track ?? 0) === this.primaryTrack()
    );
    if (!primary) return null;

    const localFrame = frame - primary.startFrame;
    const sourceInUs = primary.sourceInUs ?? 0;
    const sourceTimeUs = sourceInUs + (localFrame / this.fps) * 1e6;

    const activeLayerCount = this.clips.filter(
      (c) =>
        frame >= c.startFrame &&
        frame < c.endFrame &&
        (c.mediaType ?? 'video') !== undefined &&
        ((c.mediaType ?? 'video') === 'video' || (c.mediaType ?? 'video') === 'image')
    ).length;

    const nextClip =
      this.clips
        .filter((c) => c.track === primary.track && c.startFrame >= primary.endFrame)
        .sort((a, b) => a.startFrame - b.startFrame)[0] ?? null;

    const boundaryFrame = primary.endFrame;
    const framesToBoundary = boundaryFrame - frame;
    const secondsToBoundary =
      nextClip && nextClip.startFrame === primary.endFrame ? framesToBoundary / this.fps : null;

    return {
      clip: primary,
      localFrame,
      sourceTimeUs,
      activeLayerCount: Math.max(1, activeLayerCount),
      nextClip,
      secondsToBoundary,
    };
  }

  private primaryTrack(): number {
    // トラック番号最小値をプライマリとする（MVP の単純な規約）
    return this.clips.reduce((min, c) => Math.min(min, c.track ?? 0), Infinity);
  }
}
