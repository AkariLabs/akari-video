export interface ReviewSessionRange {
    start: number;
    end: number;
}

export type ReviewSessionRangeEvent =
    | { type: 'start'; timelineT: number; playing: boolean }
    | { type: 'play' | 'pause' | 'tick' | 'end'; timelineT: number }
    | { type: 'seek'; from: number; to: number };

const RANGE_EPSILON_SECONDS = 1e-6;

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * events.jsonl の transport 観測から、録音中にプレイヘッドが通過した出力秒の集合を作る。
 * UI/tool イベントや将来追加される未知イベントは読み取り境界で無視する。
 */
export function reviewSessionRanges(events: unknown): ReviewSessionRange[] {
    const iterator = events && typeof events === 'object'
        ? (events as { [Symbol.iterator]?: unknown })[Symbol.iterator]
        : undefined;
    if (typeof iterator !== 'function') {
        return [];
    }
    const ranges: ReviewSessionRange[] = [];
    let playing = false;
    let current: ReviewSessionRange | undefined;
    let lastTimelineT: number | undefined;

    const point = (timelineT: number): void => {
        ranges.push({ start: timelineT, end: timelineT });
        lastTimelineT = timelineT;
    };
    const begin = (timelineT: number): void => {
        current = { start: timelineT, end: timelineT };
        lastTimelineT = timelineT;
    };
    const extend = (timelineT: number): void => {
        if (!current) {
            begin(timelineT);
            return;
        }
        current.start = Math.min(current.start, timelineT);
        current.end = Math.max(current.end, timelineT);
        lastTimelineT = timelineT;
    };
    const close = (timelineT = lastTimelineT): void => {
        if (!current) {
            return;
        }
        if (timelineT !== undefined) {
            extend(timelineT);
        }
        ranges.push(current);
        current = undefined;
    };

    for (const candidate of events as Iterable<unknown>) {
        if (!candidate || typeof candidate !== 'object') {
            continue;
        }
        const event = candidate as Record<string, unknown>;
        switch (event.type) {
            case 'start':
                if (!finite(event.timelineT) || typeof event.playing !== 'boolean') continue;
                close();
                playing = event.playing;
                if (playing) begin(event.timelineT);
                else point(event.timelineT);
                break;
            case 'play':
                if (!finite(event.timelineT)) continue;
                close();
                playing = true;
                begin(event.timelineT);
                break;
            case 'pause':
                if (!finite(event.timelineT)) continue;
                if (playing) close(event.timelineT);
                else point(event.timelineT);
                playing = false;
                lastTimelineT = event.timelineT;
                break;
            case 'tick':
                if (!finite(event.timelineT)) continue;
                if (playing) extend(event.timelineT);
                else point(event.timelineT);
                break;
            case 'seek':
                if (!finite(event.from) || !finite(event.to)) continue;
                if (playing) close(event.from);
                if (playing) begin(event.to);
                else point(event.to);
                lastTimelineT = event.to;
                break;
            case 'end':
                if (!finite(event.timelineT)) continue;
                if (playing) close(event.timelineT);
                else point(event.timelineT);
                playing = false;
                lastTimelineT = event.timelineT;
                break;
            default:
                break;
        }
    }
    close();

    return ranges
        .map(range => ({ start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) }))
        .sort((left, right) => left.start - right.start || left.end - right.end)
        .reduce<ReviewSessionRange[]>((merged, range) => {
            const previous = merged[merged.length - 1];
            if (previous && range.start <= previous.end + RANGE_EPSILON_SECONDS) {
                previous.end = Math.max(previous.end, range.end);
            } else {
                merged.push({ ...range });
            }
            return merged;
        }, []);
}

/** 壊れた行を含む既存 events.jsonl でも、読める transport 行だけで帯を復元する。 */
export function reviewSessionRangesFromJsonl(source: string): ReviewSessionRange[] {
    const events: unknown[] = [];
    for (const line of source.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            events.push(JSON.parse(line));
        } catch {
            // 生の記録は修復せず、壊れた 1 行だけを読み飛ばす。
        }
    }
    return reviewSessionRanges(events);
}
