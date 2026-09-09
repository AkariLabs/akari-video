import { app, BrowserWindow } from '@theia/core/electron-shared/electron';
import type { VisualThumbnailCapture, VisualThumbnailPage } from '../common/visual-thumbnail';
import { alphaContentRect, thumbnailCropRect } from '../common/thumbnail-content-rect';

let active = false;
let captureCalls = 0;

/** No navigation, selection or seek is ever sent to an existing preview window. */
export async function captureVisualThumbnail(page: VisualThumbnailPage): Promise<VisualThumbnailCapture> {
    const failFirst = app.isPackaged ? 0 : Number(process.env.AKARI_VISUAL_THUMBNAIL_FAIL_FIRST ?? 0);
    if (++captureCalls <= failFirst && Number.isSafeInteger(failFirst)) throw new Error('Visual thumbnail capture timed out');
    if (active) throw new Error('Visual thumbnail capture is busy');
    if (!page || typeof page.html !== 'string' || page.html.length > 8 * 1024 * 1024
        || !Array.isArray(page.sampleTimes) || page.sampleTimes.length < 1 || page.sampleTimes.length > 4
        || !page.sampleTimes.every(time => Number.isFinite(time))
        || !Number.isInteger(page.width) || page.width < 1 || page.width > 480
        || !Number.isInteger(page.height) || page.height < 1 || page.height > 320) {
        throw new Error('Invalid visual thumbnail page');
    }
    active = true;
    let window: BrowserWindow | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        window = new BrowserWindow({
            show: false, width: page.width, height: page.height, useContentSize: true,
            transparent: true, backgroundColor: '#00000000', focusable: false,
            webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false }
        });
        const target = window;
        target.webContents.setAudioMuted(true);
        target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        target.webContents.on('will-navigate', event => event.preventDefault());
        return await Promise.race([
            (async () => {
                try {
                    await target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page.html)}`);
                    // Carry the page's failure text across Electron instead of its generic script-rejected error.
                    const ready = await target.webContents.executeJavaScript(
                        'Promise.resolve(window.__akariThumbnailReady).then(value => ({ok:value === true}), error => ({ok:false,error:String(error)}))');
                    if (!ready?.ok) throw new Error(ready?.error ?? 'Missing visual renderer readiness');
                } catch (error) {
                    throw new Error(`Visual renderer failed: ${String(error)}`);
                }
                for (const [sampleIndex, time] of page.sampleTimes.entries()) {
                    if (sampleIndex > 0) {
                        try {
                            const sought = await target.webContents.executeJavaScript(
                                `Promise.resolve(window.__akariThumbnailSeek(${JSON.stringify(time)})).then(value => ({ok:value === true}), error => ({ok:false,error:String(error)}))`);
                            if (!sought?.ok) throw new Error(sought?.error ?? 'Missing visual renderer seek');
                        } catch (error) {
                            throw new Error(`Visual renderer failed: ${String(error)}`);
                        }
                    }
                    const bitmap = await target.webContents.capturePage({ x: 0, y: 0, width: page.width, height: page.height });
                    const pixels = bitmap.toBitmap();
                    const size = bitmap.getSize();
                    const pixelScale = Math.round(Math.sqrt(pixels.length / 4 / (size.width * size.height)));
                    const bitmapWidth = size.width * pixelScale, bitmapHeight = size.height * pixelScale;
                    const image = bitmap.resize({ width: page.width, height: page.height }).toDataURL();
                    if ((pixelScale !== 1 && pixelScale !== 2) || pixels.length !== bitmapWidth * bitmapHeight * 4) return { image };
                    const rect = alphaContentRect(pixels, bitmapWidth, bitmapHeight);
                    if (!rect) continue;
                    const x = Math.max(0, Math.floor(rect.x * page.width / bitmapWidth));
                    const y = Math.max(0, Math.floor(rect.y * page.height / bitmapHeight));
                    const right = Math.min(page.width, Math.ceil((rect.x + rect.width) * page.width / bitmapWidth));
                    const bottom = Math.min(page.height, Math.ceil((rect.y + rect.height) * page.height / bitmapHeight));
                    const contentRect = { x, y, width: right - x, height: bottom - y };
                    const crop = thumbnailCropRect(contentRect, { width: page.width, height: page.height });
                    let croppedImage: string | undefined;
                    if (crop) {
                        try {
                            // nativeImage.crop() works in getSize() coordinates, which are twice the page on HiDPI captures.
                            const scaleX = size.width / page.width, scaleY = size.height / page.height;
                            const region = {
                                x: Math.min(size.width - 1, Math.max(0, Math.round(crop.x * scaleX))),
                                y: Math.min(size.height - 1, Math.max(0, Math.round(crop.y * scaleY))),
                                width: Math.max(1, Math.round(crop.width * scaleX)),
                                height: Math.max(1, Math.round(crop.height * scaleY))
                            };
                            region.width = Math.min(region.width, size.width - region.x);
                            region.height = Math.min(region.height, size.height - region.y);
                            const cropped = bitmap.crop(region).resize({ width: crop.width, height: crop.height });
                            const croppedSize = cropped.getSize();
                            if (croppedSize.width === crop.width && croppedSize.height === crop.height) croppedImage = cropped.toDataURL();
                        } catch {
                            // A failed crop keeps the original framing without losing the capture.
                        }
                    }
                    return croppedImage ? { image, contentRect, croppedImage } : { image, contentRect };
                }
                throw new Error('Visual thumbnail has no visible pixels');
            })(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Visual thumbnail capture timed out')), 20000 + 2000 * (page.sampleTimes.length - 1)); })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
        if (window && !window.isDestroyed()) window.destroy();
        active = false;
    }
}
