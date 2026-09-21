import { BrowserWindow, nativeImage } from '@theia/core/electron-shared/electron';
import type { WebContents, NativeImage } from '@theia/core/electron-shared/electron';
import { PreviewFrameCaptureRequest, PreviewFrameCaptureResult, previewFrameCaptureRect } from '../common/preview-frame-capture';

interface PendingFrame {
    captureId: number;
    image?: NativeImage;
    output: { width: number; height: number };
    timer: ReturnType<typeof setTimeout>;
}
const pendingFrames = new WeakMap<WebContents, PendingFrame>();
let sequence = 0;

/** Phase 1 returns only an owned handle. No readback copy, resize, PNG encoding or large IPC payload. */
export async function capturePreviewFrame(sender: WebContents, request: PreviewFrameCaptureRequest): Promise<{ captureId: number }> {
    const target = BrowserWindow.fromWebContents(sender);
    if (!target || target.isDestroyed() || !target.isVisible()) throw new Error('Preview window is not visible');
    const rect = previewFrameCaptureRect(request?.rect);
    const output = request?.output;
    if (!output || ![output.width, output.height].every(value => Number.isInteger(value) && value > 0 && value <= 16384)) {
        throw new Error('Invalid project output size');
    }
    // The host rectangle is CSS px. capturePage accepts DIP, so also account for Theia window zoom.
    const zoom = target.webContents.getZoomFactor();
    const region = previewFrameCaptureRect({ x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom });
    const [width, height] = target.getContentSize();
    if (region.x + region.width > width || region.y + region.height > height) throw new Error('Preview stage is clipped by the window');
    const previous = pendingFrames.get(sender);
    if (previous) clearTimeout(previous.timer);
    const pending: PendingFrame = { captureId: ++sequence, output: { ...output }, timer: undefined! };
    pending.timer = setTimeout(() => {
        if (pendingFrames.get(sender) === pending) pendingFrames.delete(sender);
    }, 10000);
    pending.timer.unref();
    pendingFrames.set(sender, pending);
    try {
        const captured = await target.webContents.capturePage(region);
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
    const capturedWidth = Math.round(size.width * scale), capturedHeight = Math.round(size.height * scale);
    if (!Number.isFinite(scale) || capturedWidth * capturedHeight * 4 !== pixels.length) throw new Error('Unknown capture pixel scale');
    // Normalize to one representation at scale 1. Do not mistake Retina DIP for actual available pixels.
    let image = nativeImage.createFromBitmap(pixels, { width: capturedWidth, height: capturedHeight, scaleFactor: 1 });
    const reduced = capturedWidth < output.width || capturedHeight < output.height;
    if (!reduced) image = image.resize({ width: output.width, height: output.height, quality: 'best' });
    const saved = image.getSize();
    return { image: image.toDataURL(), width: saved.width, height: saved.height, capturedWidth, capturedHeight, reduced };
}
