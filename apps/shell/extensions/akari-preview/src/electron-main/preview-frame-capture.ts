import { endianness } from 'os';
import { inspectPreviewFrame, inspectPreviewFrameSentinel, PreviewFrameExpectations } from '../common/preview-frame-check';
import { BrowserWindow, nativeImage } from '@theia/core/electron-shared/electron';
import type { WebContents, NativeImage } from '@theia/core/electron-shared/electron';
import { PreviewFrameCaptureRequest, PreviewFrameCaptureResult, previewFrameCaptureGeometry, previewFramePixelRect } from '../common/preview-frame-capture';

interface PendingFrame {
    captureId: number;
    image?: NativeImage;
    expectations: PreviewFrameExpectations;
    geometry: ReturnType<typeof previewFrameCaptureGeometry>;
    output: { width: number; height: number };
    timer: ReturnType<typeof setTimeout>;
}
const pendingFrames = new WeakMap<WebContents, PendingFrame>();
let sequence = 0;

/** Phase 1 returns only an owned handle. No readback copy, resize, PNG encoding or large IPC payload. */
export async function capturePreviewFrame(sender: WebContents, request: PreviewFrameCaptureRequest): Promise<{ captureId: number }> {
    const target = BrowserWindow.fromWebContents(sender);
    if (!target || target.isDestroyed() || !target.isVisible()) throw new Error('Preview window is not visible');
    const output = request?.output;
    if (!output || ![output.width, output.height].every(value => Number.isInteger(value) && value > 0 && value <= 16384)) {
        throw new Error('Invalid project output size');
    }
    // The host rectangle is CSS px. capturePage accepts DIP, so also account for Theia window zoom.
    const zoom = target.webContents.getZoomFactor();
    const [width, height] = target.getContentSize();
    const geometry = previewFrameCaptureGeometry(request?.rect, request?.sentinel, zoom, { width, height });
    if (geometry.fallback) console.warn('[akari-preview] sentinel unavailable; using color inspection: ' + geometry.fallback);
    const previous = pendingFrames.get(sender);
    if (previous) clearTimeout(previous.timer);
    const pending: PendingFrame = { captureId: ++sequence, expectations: request.expectations, geometry, output: { ...output }, timer: undefined! };
    pending.timer = setTimeout(() => {
        if (pendingFrames.get(sender) === pending) pendingFrames.delete(sender);
    }, 10000);
    pending.timer.unref();
    pendingFrames.set(sender, pending);
    try {
        const captured = await target.webContents.capturePage(geometry.region);
        if (pendingFrames.get(sender) !== pending) throw new Error('Preview capture expired');
        if (captured.isEmpty()) throw new Error('Preview capture is empty');
        pending.image = captured;
        return { captureId: pending.captureId };
    } catch (error) {
        clearTimeout(pending.timer);
        if (pendingFrames.get(sender) === pending) pendingFrames.delete(sender);
        throw error;
    }
}

/** Phase 2 runs only after the renderer acknowledges restoration; a handle cannot cross window owners. */
export function finishPreviewFrame(sender: WebContents, captureId: number, discard = false): PreviewFrameCaptureResult | undefined {
    const pending = pendingFrames.get(sender);
    if (!pending || pending.captureId !== captureId) {
        if (discard) return;
        throw new Error('Preview capture expired or belongs to another window');
    }
    clearTimeout(pending.timer);
    pendingFrames.delete(sender);
    if (discard) return;
    if (!pending.image) throw new Error('Preview capture is not ready');
    const captured = pending.image, output = pending.output;
    const size = captured.getSize();
    const pixels = captured.toBitmap();
    const scale = Math.sqrt(pixels.length / 4 / (size.width * size.height));
    const unionWidth = Math.round(size.width * scale), unionHeight = Math.round(size.height * scale);
    if (!Number.isFinite(scale) || unionWidth * unionHeight * 4 !== pixels.length) throw new Error('Unknown capture pixel scale');
    // Normalize to one representation at scale 1. Do not mistake Retina DIP for actual available pixels.
    const union = nativeImage.createFromBitmap(pixels, { width: unionWidth, height: unionHeight, scaleFactor: 1 });
    const { geometry } = pending;
    const order = endianness() === 'LE' ? 'BGRA' : 'ARGB';
    let stale = false;
    if (geometry.sentinel) {
        const sentinel = union.crop(previewFramePixelRect(geometry.sentinel, geometry.region, unionWidth, unionHeight));
        const sentinelSize = sentinel.getSize();
        stale = inspectPreviewFrameSentinel(sentinel.toBitmap(), sentinelSize.width, sentinelSize.height, order);
    }
    // Only the stage reaches the resize/PNG path; the transport sentinel is never saved.
    let image = geometry.sentinel ? union.crop(previewFramePixelRect(geometry.stage, geometry.region, unionWidth, unionHeight)) : union;
    const { width: capturedWidth, height: capturedHeight } = image.getSize();
    const reduced = capturedWidth < output.width || capturedHeight < output.height;
    if (!reduced) image = image.resize({ width: output.width, height: output.height, quality: 'best' });
    const saved = image.getSize();
    const inspection = inspectPreviewFrame(image.toBitmap(), saved.width, saved.height,
        pending.expectations, order);
    if (stale) { inspection.ok = false; inspection.reasons.push('stale-frame'); }
    return { inspection, image: inspection.ok ? image.toDataURL() : '', width: saved.width, height: saved.height, capturedWidth, capturedHeight, reduced };
}
