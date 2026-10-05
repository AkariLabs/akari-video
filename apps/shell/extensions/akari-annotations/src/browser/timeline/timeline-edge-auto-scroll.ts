import { edgeAutoScrollDelta } from '../../common/timeline-view-range';

/** Keeps advancing a captured drag while its pointer rests at a strip edge. */
export class TimelineEdgeAutoScroll {
    private pointer: { x: number; y: number } | undefined;
    private frame: number | undefined;

    constructor(
        private readonly view: () => { left: number; right: number; duration: number },
        private readonly advance: (delta: number) => boolean,
        private readonly follow: (x: number, y: number) => void
    ) {}

    update(x: number, y: number): void {
        this.pointer = { x, y };
        const view = this.view();
        if (edgeAutoScrollDelta(x, view.left, view.right, view.duration) === 0) {
            this.stop();
        } else if (this.frame === undefined) {
            this.frame = requestAnimationFrame(() => this.tick());
        }
    }

    stop(): void {
        this.pointer = undefined;
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
    }

    private tick(): void {
        this.frame = undefined;
        const point = this.pointer;
        if (!point) return;
        const view = this.view();
        const delta = edgeAutoScrollDelta(point.x, view.left, view.right, view.duration);
        if (delta === 0 || !this.advance(delta)) return;
        this.follow(point.x, point.y);
        if (this.frame === undefined && this.pointer) this.frame = requestAnimationFrame(() => this.tick());
    }
}
