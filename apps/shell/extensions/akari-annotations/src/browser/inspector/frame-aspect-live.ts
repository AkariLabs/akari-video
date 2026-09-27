import { frameAspectTransform, frameDimensions, type FrameAspect } from './frame-geometry';

export type FrameSize = { width: number; height: number };
type Transform = { scale?: number; [key: string]: unknown };

export function frameSizeFromResolution(value: unknown): FrameSize | undefined {
    const match = typeof value === 'string' ? /^(\d+)x(\d+)$/u.exec(value) : null;
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
        ? { width, height } : undefined;
}

export function frameSizeFromPng(bytes: Uint8Array): FrameSize | undefined {
    if (bytes.length < 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte)
        || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return undefined;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
}

/** The desired shape and the PNG currently under the preview are separate clocks. */
export class FrameAspectLive {
    sourcePath: string;
    sourceSize?: FrameSize;
    previewSize?: FrameSize;
    revision = 0;
    sourceEpoch = 0;
    private expectedSource?: { path: string; size: FrameSize; transform?: Transform };
    private desiredSize?: FrameSize;
    private desiredTransform?: Transform;
    private pending: FrameAspect[] = [];
    private canvas?: FrameSize;
    private initialTransform?: Transform;

    constructor(sourcePath: string) { this.sourcePath = sourcePath; }

    observeSource(sourcePath: string): boolean {
        if (this.sourcePath === sourcePath) return false;
        if (this.expectedSource?.path === sourcePath) {
            this.sourcePath = sourcePath;
            this.sourceSize = this.expectedSource.size;
            this.acceptCommittedSize(this.expectedSource.size, this.expectedSource.transform);
            this.expectedSource = undefined;
            return false;
        }
        this.sourcePath = sourcePath;
        this.sourceSize = undefined;
        this.previewSize = undefined;
        this.desiredSize = undefined;
        this.desiredTransform = undefined;
        this.pending = [];
        this.initialTransform = undefined;
        this.canvas = undefined;
        this.revision++;
        this.sourceEpoch++;
        this.expectedSource = undefined;
        return true;
    }

    resolveSource(sourcePath: string, size: FrameSize): boolean {
        if (this.sourcePath !== sourcePath) return false;
        this.sourceSize = size;
        this.previewSize ??= size;
        this.applyPending();
        return true;
    }

    press(aspect: FrameAspect, canvas: FrameSize | undefined, transform: Transform | undefined): number {
        const revision = ++this.revision;
        if (canvas) this.canvas = canvas;
        this.initialTransform ??= transform;
        this.pending.push(aspect);
        this.applyPending();
        return revision;
    }

    setCanvas(canvas: FrameSize): void {
        this.canvas = canvas;
        this.applyPending();
    }

    /** A committed card becomes the preview's base; later presses retain their desired shape. */
    expectSource(sourcePath: string, size: FrameSize, transform?: Transform): void {
        this.expectedSource = { path: sourcePath, size, transform };
    }

    cancelExpectedSource(): void { this.expectedSource = undefined; }

    resetDesired(transform: Transform | undefined): void {
        this.desiredSize = undefined;
        this.desiredTransform = undefined;
        this.pending = [];
        this.initialTransform = transform;
    }

    adoptSource(sourcePath: string, size: FrameSize, transform?: Transform): void {
        this.sourcePath = sourcePath;
        this.sourceSize = size;
        this.previewSize = size;
        this.acceptCommittedSize(size, transform);
    }

    private acceptCommittedSize(size: FrameSize, transform?: Transform): void {
        if (this.pending.length && !this.desiredSize) {
            this.pending.shift();
            this.desiredSize = size;
            this.desiredTransform = transform;
            this.applyPending();
        }
    }

    live(): { scaleX: number; scaleY: number } | undefined {
        if (!this.desiredSize || !this.previewSize) return undefined;
        const scale = this.desiredTransform?.scale ?? 1;
        return { scaleX: this.desiredSize.width * scale / this.previewSize.width,
            scaleY: this.desiredSize.height * scale / this.previewSize.height };
    }

    private applyPending(): void {
        if (!this.sourceSize || !this.canvas) return;
        while (this.pending.length) {
            const next = frameDimensions(this.pending.shift()!, this.canvas);
            const old = this.desiredSize ?? this.sourceSize;
            this.desiredTransform = frameAspectTransform(old, next, this.desiredTransform ?? this.initialTransform);
            this.desiredSize = next;
        }
    }
}
