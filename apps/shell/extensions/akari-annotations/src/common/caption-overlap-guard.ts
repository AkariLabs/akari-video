/**
 * 字幕ドラッグの重なりガード（task 2026-09-02-timeline-caption-overlap-guard）。
 *
 * edit-lint の captions.overlap は「同じ時間群（output 時間軸 = 1 群 / source 時間軸 = src ごと）で
 * start < 直前までの最遠 end − 1e-6」を error にする。文字起こし由来の隙間なし字幕列では 1 px の
 * 移動でも隣へ食い込んで error になっていた（オーナー実機 2026-09-02）。
 * ここでは書き込む前に、同じ群の隣の字幕へ食い込まない位置へ **クランプ** する（拒否はしない）。
 * 接触（end == 次の start）は lint と同じく許容。DOM に依存しないので node --test で検証できる。
 */

export type CaptionDragMode = 'move' | 'start' | 'end';

export interface CaptionNeighborRange {
    id: string;
    start: number;
    end: number;
}

export interface ClampCaptionRangeInput {
    /** ドラッグ中の字幕の id（隣の候補から自分を除くため）。 */
    id: string;
    start: number;
    end: number;
    mode: CaptionDragMode;
    /** 同じ時間群の字幕（自分を含んでいてもよい。id で除く）。 */
    neighbors: readonly CaptionNeighborRange[];
    /** 端トリムで下回らない最小尺（秒）。 */
    minDuration: number;
    /**
     * クランプしても正当な位置（0 秒以上・どの隣とも重ならない）が作れないときに戻す区間
     * （通常はドラッグ前の区間）。省略時はクランプ結果をそのまま返す。
     */
    fallback?: { start: number; end: number };
}

export interface ClampCaptionRangeResult {
    start: number;
    end: number;
    /** クランプで位置が変わったら true。 */
    clamped: boolean;
    /** 止めた相手（クランプしたときだけ）。 */
    blockedBy?: CaptionNeighborRange;
}

const EPSILON = 1e-6;

/** 自分を除き、時刻が有限な隣だけを返す。 */
export function usableNeighbors(id: string, neighbors: readonly CaptionNeighborRange[]): CaptionNeighborRange[] {
    return neighbors.filter(candidate => candidate.id !== id
        && Number.isFinite(candidate.start) && Number.isFinite(candidate.end) && candidate.end > candidate.start);
}

/**
 * [start, end] と重なる隣のうち、区間の「左側の壁」（自分より前で終わる最遠の end）と
 * 「右側の壁」（自分より後で始まる最近の start）を求める。
 * 壁の判定は区間の中心を基準にする（食い込みの深さに関わらず同じ隣を壁として扱うため）。
 */
export function neighborWalls(
    start: number,
    end: number,
    neighbors: readonly CaptionNeighborRange[]
): { left?: CaptionNeighborRange; right?: CaptionNeighborRange } {
    const center = (start + end) / 2;
    let left: CaptionNeighborRange | undefined;
    let right: CaptionNeighborRange | undefined;
    for (const neighbor of neighbors) {
        const neighborCenter = (neighbor.start + neighbor.end) / 2;
        if (neighborCenter <= center) {
            if (!left || neighbor.end > left.end) left = neighbor;
        } else if (!right || neighbor.start < right.start) {
            right = neighbor;
        }
    }
    return { left, right };
}

export function clampCaptionRangeToNeighbors(input: ClampCaptionRangeInput): ClampCaptionRangeResult {
    const { mode, minDuration } = input;
    let { start, end } = input;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return { start, end, clamped: false };
    }
    const neighbors = usableNeighbors(input.id, input.neighbors);
    if (neighbors.length === 0) {
        return { start, end, clamped: false };
    }
    const duration = end - start;
    const walls = neighborWalls(start, end, neighbors);
    let blockedBy: CaptionNeighborRange | undefined;

    if (mode === 'move') {
        if (walls.right && end > walls.right.start + EPSILON) {
            start = walls.right.start - duration;
            end = walls.right.start;
            blockedBy = walls.right;
        }
        if (walls.left && start < walls.left.end - EPSILON) {
            start = walls.left.end;
            end = start + duration;
            blockedBy = walls.left;
            // 左右の壁の間に尺が入らないときは、右の壁も越えないよう再クランプする
            if (walls.right && end > walls.right.start + EPSILON) {
                end = Math.max(walls.right.start, start + minDuration);
            }
        }
    } else if (mode === 'start') {
        if (walls.left && start < walls.left.end - EPSILON) {
            start = Math.min(walls.left.end, end - minDuration);
            blockedBy = walls.left;
        }
    } else if (walls.right && end > walls.right.start + EPSILON) {
        end = Math.max(walls.right.start, start + minDuration);
        blockedBy = walls.right;
    }

    const clamped = Math.abs(start - input.start) > EPSILON || Math.abs(end - input.end) > EPSILON;
    // クランプ後も 0 秒未満・隣と重なる（尺が入らない・0 秒側に押し出された等）なら、fallback へ戻す。
    // 2026-09-02 実機: 0 秒に字幕がある状態で別の字幕を 0 秒へ寄せると start が負（-0:00 表示）になった。
    if (input.fallback && !isValidCaptionRange(start, end, neighbors)) {
        const fallback = input.fallback;
        return { start: fallback.start, end: fallback.end, clamped: true, ...(blockedBy ? { blockedBy } : {}) };
    }
    return clamped ? { start, end, clamped, blockedBy } : { start: input.start, end: input.end, clamped: false };
}

/** 0 秒以上で、どの隣とも重ならない（接触は可）なら true。 */
export function isValidCaptionRange(
    start: number,
    end: number,
    neighbors: readonly CaptionNeighborRange[]
): boolean {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < -EPSILON || end <= start) return false;
    return neighbors.every(neighbor => end <= neighbor.start + EPSILON || start >= neighbor.end - EPSILON);
}
