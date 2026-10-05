export type ZoomBarPart = 'start' | 'end' | 'thumb';

/** Pointer handling and stable DOM for either axis; the caller owns range calculations. */
export class TimelineZoomBar {
    readonly node = document.createElement('div');
    readonly content = document.createElement('div');
    readonly endMark = document.createElement('div');
    readonly thumb = document.createElement('div');
    readonly startHandle = document.createElement('div');
    readonly endHandle = document.createElement('div');
    private start = 0;
    private end = 1;
    private extent = 1;

    constructor(
        readonly axis: 'h' | 'v',
        private readonly onDrag: (part: ZoomBarPart, delta: number) => void,
        private readonly onClick: (ratio: number) => void,
        private readonly onReset: () => void
    ) {
        this.node.className = `akari-timeline-zoom-bar akari-timeline-zoom-bar--${axis}`;
        this.content.className = 'akari-timeline-zoom-bar__content';
        this.endMark.className = 'akari-timeline-zoom-bar__end-mark';
        this.thumb.className = 'akari-timeline-zoom-bar__thumb';
        this.startHandle.className = 'akari-timeline-zoom-bar__handle akari-timeline-zoom-bar__handle--start';
        this.endHandle.className = 'akari-timeline-zoom-bar__handle akari-timeline-zoom-bar__handle--end';
        this.thumb.append(this.startHandle, this.endHandle);
        this.node.append(this.content, this.endMark, this.thumb);
        for (const [element, part] of [
            [this.thumb, 'thumb'], [this.startHandle, 'start'], [this.endHandle, 'end']
        ] as const) element.addEventListener('pointerdown', event => this.beginDrag(event, part));
        this.node.addEventListener('click', event => {
            if (event.target !== this.node && event.target !== this.content && event.target !== this.endMark) return;
            const rect = this.node.getBoundingClientRect();
            const size = this.axis === 'h' ? rect.width : rect.height;
            if (size > 0) this.onClick(((this.axis === 'h' ? event.clientX - rect.left : event.clientY - rect.top) / size));
        });
        this.node.addEventListener('dblclick', event => { event.preventDefault(); this.onReset(); });
    }

    update(start: number, end: number, extent: number, contentEnd: number): void {
        this.start = start;
        this.end = end;
        this.extent = Math.max(extent, 1e-9);
        const position = this.axis === 'h' ? 'left' : 'top';
        const size = this.axis === 'h' ? 'width' : 'height';
        this.thumb.style[position] = `${Math.max(0, start / this.extent * 100)}%`;
        this.thumb.style[size] = `${Math.min(100, Math.max(0, (end - start) / this.extent * 100))}%`;
        this.content.style[size] = `${Math.min(100, Math.max(0, contentEnd / this.extent * 100))}%`;
        this.endMark.style[position] = `${Math.min(100, Math.max(0, contentEnd / this.extent * 100))}%`;
    }

    private beginDrag(event: PointerEvent, part: ZoomBarPart): void {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        const rect = this.node.getBoundingClientRect();
        const size = this.axis === 'h' ? rect.width : rect.height;
        const extent = this.extent;
        const origin = this.axis === 'h' ? event.clientX : event.clientY;
        const onMove = (move: PointerEvent): void => {
            if (move.pointerId !== event.pointerId || size <= 0) return;
            this.onDrag(part, ((this.axis === 'h' ? move.clientX : move.clientY) - origin) / size * extent);
        };
        const onEnd = (end: PointerEvent): void => {
            if (end.pointerId !== event.pointerId) return;
            if (target.hasPointerCapture(end.pointerId)) target.releasePointerCapture(end.pointerId);
            target.removeEventListener('pointermove', onMove);
            target.removeEventListener('pointerup', onEnd);
            target.removeEventListener('pointercancel', onEnd);
        };
        target.addEventListener('pointermove', onMove);
        target.addEventListener('pointerup', onEnd);
        target.addEventListener('pointercancel', onEnd);
        this.onDrag(part, 0);
    }
}
