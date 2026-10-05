import { advanceShuttle, nextShuttleRate, shuttleCancelEffect,
    type ShuttleCancelReason, type ShuttleDirection, type ShuttleRate } from '../../common/timeline-shuttle';

export interface TimelineShuttlePorts {
    time(): number;
    duration(): number;
    seek(time: number): void;
    play(): void;
    pause(): void;
    display(rate: ShuttleRate): void;
}

export class TimelineShuttleController {
    rate: ShuttleRate = 0;
    private frame: number | undefined;
    private lastStamp: number | undefined;

    constructor(private readonly ports: TimelineShuttlePorts) { }

    direction(direction: ShuttleDirection, previewPlaying: boolean): void {
        const previous = this.rate || (previewPlaying ? 1 : 0);
        const next = nextShuttleRate(previous, direction);
        if (previous === 1 && next !== 1) this.ports.pause();
        this.cancelFrame();
        this.rate = next;
        this.ports.display(next);
        if (next === 1 && previous !== 1) this.ports.play();
        else if (next !== 0 && next !== 1) this.frame = requestAnimationFrame(this.tick);
    }

    stop(reason: ShuttleCancelReason = 'stop', previewPlaying = false): void {
        const effect = shuttleCancelEffect(this.rate, reason, previewPlaying);
        if (effect.pausePlayback) this.ports.pause();
        this.cancelFrame();
        this.rate = effect.nextRate;
        this.ports.display(effect.nextRate);
    }

    private cancelFrame(): void {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
        this.lastStamp = undefined;
    }

    private readonly tick = (stamp: number): void => {
        this.frame = undefined;
        if (this.rate === 0 || this.rate === 1) return;
        const elapsed = this.lastStamp === undefined ? 0 : (stamp - this.lastStamp) / 1000;
        this.lastStamp = stamp;
        const next = advanceShuttle(this.ports.time(), this.rate, elapsed, this.ports.duration());
        if (next.time !== this.ports.time()) this.ports.seek(next.time);
        if (next.rate === 0) this.stop('edge');
        else this.frame = requestAnimationFrame(this.tick);
    };
}
