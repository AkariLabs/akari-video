// showReviewAnnotationStrokes（akari-preview-open-handler.ts）が strokes 静止表示のシーク値を
// 計算するための純関数。seekOutputPreview 経路（akari-annotations 側の sourceToOutput 相当）と
// 同じ「source 秒 → composition(出力) 秒」変換を、cuts の track 0（既定トラック）を配列順に
// 連結した単純写像で行う。同一 source 秒が複数カットに含まれる場合は cutIndex を優先する。
// track 0 以外の高度な多トラック構成（at / track 指定を使う編集）は非対応で、該当カットは
// 無視して他の track 0 カットで解決する（該当が無ければ source 秒をそのまま返す）。
export interface ReviewStrokeSeekCut {
    in: number;
    out: number;
    speed?: number;
    track?: number;
}

interface ReviewStrokeSeekSegment {
    cutIndex: number;
    in: number;
    out: number;
    speed: number;
    outStart: number;
}

export function resolveAnnotationStrokeCompositionSeconds(
    cuts: readonly ReviewStrokeSeekCut[],
    sourceT: number,
    cutIndex: number | null
): number {
    const segments: ReviewStrokeSeekSegment[] = [];
    let offset = 0;
    cuts.forEach((cut, index) => {
        const track = Number.isInteger(cut.track) ? cut.track! : 0;
        if (track !== 0 || !Number.isFinite(cut.in) || !Number.isFinite(cut.out) || cut.out <= cut.in) {
            return;
        }
        const speed = Number.isFinite(cut.speed) && cut.speed! > 0 ? cut.speed! : 1;
        segments.push({ cutIndex: index, in: cut.in, out: cut.out, speed, outStart: offset });
        offset += (cut.out - cut.in) / speed;
    });
    if (segments.length === 0) {
        return sourceT;
    }
    const contains = (segment: ReviewStrokeSeekSegment): boolean => sourceT >= segment.in && sourceT < segment.out;
    const distance = (segment: ReviewStrokeSeekSegment): number => sourceT < segment.in
        ? segment.in - sourceT
        : Math.max(0, sourceT - segment.out);
    const byCutIndex = cutIndex !== null ? segments.filter(segment => segment.cutIndex === cutIndex) : [];
    const nearest = segments.reduce(
        (best, segment) => (distance(segment) < distance(best) ? segment : best),
        segments[0]
    );
    const chosen = byCutIndex.find(contains) ?? byCutIndex[0] ?? segments.find(contains) ?? nearest;
    const clampedSource = Math.min(chosen.out, Math.max(chosen.in, sourceT));
    return chosen.outStart + (clampedSource - chosen.in) / chosen.speed;
}
