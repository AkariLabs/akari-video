const FOLLOW_THRESHOLD = 0.78;

export interface TimelinePlayheadFollowPorts {
    viewStart(): number;
    visibleDuration(): number;
    canFollow(): boolean;
    setViewStart(start: number): void;
}

export class TimelinePlayheadFollow {
    constructor(private readonly ports: TimelinePlayheadFollowPorts) {}

    follow(time: number): void {
        if (!this.ports.canFollow()) return;
        const start = this.ports.viewStart();
        const duration = this.ports.visibleDuration();
        const edge = start + duration * FOLLOW_THRESHOLD;
        if (time > edge) {
            const next = time - duration * FOLLOW_THRESHOLD;
            if (next > start + 1e-6) this.ports.setViewStart(next);
        } else if (time < start) {
            const next = Math.max(0, time - duration * (1 - FOLLOW_THRESHOLD));
            if (next < start - 1e-6) this.ports.setViewStart(next);
        }
    }
}
