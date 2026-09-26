import { evaluatedItemTransform, hasItemKeyframeGroup, type ItemV2 } from '@akari-video/edit-store';

/**
 * タイムラインの Alt+矢印ナッジ（位置を 1px / 10px）の値の決め方。DOM に依存しない純関数だけを置く。
 *
 * - 最初の値は「再生位置で見えている値」から取る。位置のまとまりが動き（キーフレーム）を持つ item で
 *   静的な `transform` を基準にすると、見えている位置から +1px ではなく静的値 +1px へ跳ぶ
 * - 同じ item・同じ軸の続き（keydown が続く間）は前回の値から足し込む（`NudgeCommitSession` が
 *   keyup ごとに 1 回だけ書き込むのと対になる）
 */

export type NudgePath = 'transform.x' | 'transform.y';

export interface NudgeValue {
    id: string;
    path: NudgePath;
    value: number;
}

type NudgeItem = Pick<ItemV2, 'source' | 'transform' | 'keyframes' | 'duration'>;

const fieldOf = (path: NudgePath): 'x' | 'y' => path.endsWith('.x') ? 'x' : 'y';

/** 出力の秒と item の開始秒から item 内フレーム。祖先の at は呼び出し側で itemStartSeconds に含める。 */
export function itemFrameAtPlayhead(options: {
    playheadSeconds?: number; itemStartSeconds: number; durationFrames?: number; fps: number;
}): number {
    const start = Number.isFinite(options.itemStartSeconds) ? options.itemStartSeconds : 0;
    const playhead = Number.isFinite(options.playheadSeconds) ? options.playheadSeconds as number : start;
    const duration = Number.isFinite(options.durationFrames) ? options.durationFrames as number : 0;
    return Math.max(0, Math.min(duration, Math.round((playhead - start) * options.fps)));
}

/** 最初の基準値: 位置のまとまりが動きを持つなら再生位置の見えている値、無ければ静的値。 */
export function nudgeBaseValue(item: NudgeItem, frame: number, path: NudgePath): number {
    const field = fieldOf(path);
    const transform = (item.transform ?? {}) as Record<string, unknown>;
    const staticValue = Number.isFinite(transform[field]) ? transform[field] as number : 0;
    if (!hasItemKeyframeGroup(item, 'position')) return staticValue;
    return evaluatedItemTransform(item, frame)[field];
}

/** 同じ item・軸の続きなら前回値から、そうでなければ見えている値から、押した分だけ進める。 */
export function nextNudgeValue(options: {
    item: NudgeItem; frame: number; id: string; path: NudgePath; direction: 1 | -1; step: number; previous?: NudgeValue;
}): NudgeValue {
    const base = nudgeBaseValue(options.item, options.frame, options.path);
    const current = options.previous && options.previous.id === options.id && options.previous.path === options.path
        ? options.previous.value : base;
    return { id: options.id, path: options.path, value: current + options.direction * options.step };
}
