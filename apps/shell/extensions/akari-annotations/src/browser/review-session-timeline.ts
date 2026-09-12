export interface ReviewSessionTimelineEvent {
    recT: number;
    type: string;
    [key: string]: unknown;
}

interface TimelineState {
    playing: boolean;
    anchorTimelineT: number;
    anchorRecT: number;
    rate: number;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function positionAt(state: TimelineState, recT: number): number {
    return state.playing
        ? state.anchorTimelineT + (recT - state.anchorRecT) * state.rate
        : state.anchorTimelineT;
}

export function resolveSessionTimelineT(
    events: readonly ReviewSessionTimelineEvent[], recT: number
): number | null {
    if (!finite(recT)) return null;
    let state: TimelineState | undefined;
    for (const event of events) {
        if (!finite(event?.recT) || event.recT > recT) continue;
        if (event.type === 'start') {
            if (!finite(event.timelineT)) continue;
            state = {
                playing: Boolean(event.playing), anchorTimelineT: event.timelineT,
                anchorRecT: event.recT, rate: 1
            };
            continue;
        }
        if (!state) continue;
        const current = positionAt(state, event.recT);
        switch (event.type) {
            case 'play':
                state = { ...state, playing: true, anchorTimelineT: finite(event.timelineT) ? event.timelineT : current,
                    anchorRecT: event.recT };
                break;
            case 'pause':
                state = { ...state, playing: false, anchorTimelineT: finite(event.timelineT) ? event.timelineT : current,
                    anchorRecT: event.recT };
                break;
            case 'seek':
                if (finite(event.to)) state = { ...state, anchorTimelineT: event.to, anchorRecT: event.recT };
                break;
            case 'rate':
                if (finite(event.value) && event.value > 0) {
                    state = { ...state, rate: event.value, anchorTimelineT: current, anchorRecT: event.recT };
                }
                break;
            case 'tick':
                if (finite(event.timelineT)) {
                    state = { ...state, anchorTimelineT: event.timelineT, anchorRecT: event.recT };
                }
                break;
            case 'end':
                state = { ...state, playing: false,
                    anchorTimelineT: finite(event.timelineT) ? event.timelineT : current,
                    anchorRecT: event.recT };
                break;
            default:
                break;
        }
    }
    return state ? positionAt(state, recT) : null;
}

export function sessionRecDurationSec(events: readonly ReviewSessionTimelineEvent[]): number {
    return events.reduce((last, event) => finite(event?.recT) ? Math.max(last, event.recT) : last, 0);
}

export function activeUtteranceIndex(
    segments: readonly { start: number; end: number }[], recT: number
): number {
    let previous = -1;
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (recT < segment.start) return previous;
        if (recT <= segment.end) return index;
        previous = index;
    }
    return previous;
}
