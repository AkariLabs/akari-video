import { BrowserWindow } from '@theia/core/electron-shared/electron';
import type { VisualThumbnailCapture, VisualThumbnailPage } from '../common/visual-thumbnail';
import { alphaContentRect } from '../common/thumbnail-content-rect';

let active = false;

/** No navigation, selection or seek is ever sent to an existing preview window. */
export async function captureVisualThumbnail(page: VisualThumbnailPage): Promise<VisualThumbnailCapture> {
    if (active) throw new Error('Visual thumbnail capture is busy');
    if (!page || typeof page.html !== 'string' || page.html.length > 8 * 1024 * 1024
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
                await target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page.html)}`);
                await target.webContents.executeJavaScript('window.__akariThumbnailReady');
                const bitmap = await target.webContents.capturePage({ x: 0, y: 0, width: page.width, height: page.height });
                const pixels = bitmap.toBitmap();
                const size = bitmap.getSize();
                const pixelScale = Math.round(Math.sqrt(pixels.length / 4 / (size.width * size.height)));
                const bitmapWidth = size.width * pixelScale, bitmapHeight = size.height * pixelScale;
                const image = bitmap.resize({ width: page.width, height: page.height }).toDataURL();
                if ((pixelScale !== 1 && pixelScale !== 2) || pixels.length !== bitmapWidth * bitmapHeight * 4) return { image };
                const rect = alphaContentRect(pixels, bitmapWidth, bitmapHeight);
                if (!rect) throw new Error('Visual thumbnail has no visible pixels');
                const x = Math.max(0, Math.floor(rect.x * page.width / bitmapWidth));
                const y = Math.max(0, Math.floor(rect.y * page.height / bitmapHeight));
                const right = Math.min(page.width, Math.ceil((rect.x + rect.width) * page.width / bitmapWidth));
                const bottom = Math.min(page.height, Math.ceil((rect.y + rect.height) * page.height / bitmapHeight));
                return { image, contentRect: { x, y, width: right - x, height: bottom - y } };
            })(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Visual thumbnail capture timed out')), 20000); })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
        if (window && !window.isDestroyed()) window.destroy();
        active = false;
    }
}
