export interface CaptionOutputSegment {
    src?: string;
    in: number;
    out: number;
    speed: number;
    tlStart: number;
    tlEnd: number;
}

export interface SourceCaptionEdgeDragInput {
    edge: 'start' | 'end';
    originalStart: number;
    originalEnd: number;
    originalOutputStart: number;
    originalOutputEnd: number;
    proposedOutputEdge: number;
    src?: string;
    segments: readonly CaptionOutputSegment[];
}

export interface SourceCaptionEdgeDragResult {
    start: number;
    end: number;
    outputStart: number;
    outputEnd: number;
    convertsToOutput: boolean;
}

const EPSILON = 0.000001;

/** output-domain 字幕の保存・ゴーストに共通する表示可能範囲クランプ。 */
export function clampCaptionOutputRange(
    start: number,
    end: number,
    timelineEnd: number
): { start: number; end: number } {
    const limit = Number.isFinite(timelineEnd) ? Math.max(0, timelineEnd) : 0;
    return {
        start: Math.min(limit, Math.max(0, start)),
        end: Math.min(limit, Math.max(0, end))
    };
}

/**
 * source-domain 字幕の端ドラッグを、現在その端を描いている cut と照合する。
 * cut 内なら source 秒へ戻し、cut 境界を越えた瞬間だけ output 秒の連続区間へ変換する。
 */
export function resolveSourceCaptionEdgeDrag(
    input: SourceCaptionEdgeDragInput
): SourceCaptionEdgeDragResult {
    const originalOutputEdge = input.edge === 'start'
        ? input.originalOutputStart : input.originalOutputEnd;
    const matching = input.segments.filter(segment =>
        (input.src === undefined || segment.src === input.src)
        && originalOutputEdge >= segment.tlStart - EPSILON
        && originalOutputEdge <= segment.tlEnd + EPSILON
    );
    const segment = input.edge === 'start' ? matching[0] : matching[matching.length - 1];
    if (!segment) {
        const delta = input.proposedOutputEdge - originalOutputEdge;
        return {
            start: input.edge === 'start' ? input.originalStart + delta : input.originalStart,
            end: input.edge === 'end' ? input.originalEnd + delta : input.originalEnd,
            outputStart: input.edge === 'start' ? input.proposedOutputEdge : input.originalOutputStart,
            outputEnd: input.edge === 'end' ? input.proposedOutputEdge : input.originalOutputEnd,
            convertsToOutput: false
        };
    }
    const crossesBoundary = input.edge === 'start'
        ? input.proposedOutputEdge < segment.tlStart - EPSILON
        : input.proposedOutputEdge > segment.tlEnd + EPSILON;
    const outputStart = input.edge === 'start'
        ? input.proposedOutputEdge : input.originalOutputStart;
    const outputEnd = input.edge === 'end'
        ? input.proposedOutputEdge : input.originalOutputEnd;
    if (crossesBoundary) {
        return {
            start: outputStart,
            end: outputEnd,
            outputStart,
            outputEnd,
            convertsToOutput: true
        };
    }
    const sourceEdge = segment.in
        + (input.proposedOutputEdge - segment.tlStart) * segment.speed;
    return {
        start: input.edge === 'start' ? sourceEdge : input.originalStart,
        end: input.edge === 'end' ? sourceEdge : input.originalEnd,
        outputStart,
        outputEnd,
        convertsToOutput: false
    };
}
