import { BrowserWindow } from '@theia/core/electron-shared/electron';
import type { VisualThumbnailPage } from '../common/visual-thumbnail';

let active = false;

/** No navigation, selection or seek is ever sent to an existing preview window. */
export async function captureVisualThumbnail(page: VisualThumbnailPage): Promise<string> {
    if (active) throw new Error('Visual thumbnail capture is busy');
    if (!page || typeof page.html !== 'string' || page.html.length > 8 * 1024 * 1024
        || !Number.isInteger(page.width) || page.width < 1 || page.width > 480
        || !Number.isInteger(page.height) || page.height < 1 || page.height > 320
        || !Array.isArray(page.sampleTimes) || page.sampleTimes.length < 1 || page.sampleTimes.length > 4
        || !page.sampleTimes.every(time => Number.isFinite(time))) {
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
                for (const [sampleIndex, time] of page.sampleTimes.entries()) {
                    // Ready already rendered the midpoint, exactly as the original single-sample host did.
                    if (sampleIndex > 0) await target.webContents.executeJavaScript(`window.__akariThumbnailSeek(${JSON.stringify(time)})`);
                    const bitmap = await target.webContents.capturePage({ x: 0, y: 0, width: page.width, height: page.height });
                    const pixels = bitmap.toBitmap();
                    for (let index = 3; index < pixels.length; index += 4) {
                        if (pixels[index] > 8) return bitmap.resize({ width: page.width, height: page.height }).toDataURL();
                    }
                }
                throw new Error('Visual thumbnail has no visible pixels');
            })(),
            new Promise<never>((_, reject) => {
                const timeoutMs = 20000 + 2000 * (page.sampleTimes.length - 1);
                timer = setTimeout(() => reject(new Error('Visual thumbnail capture timed out')), timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
        if (window && !window.isDestroyed()) window.destroy();
        active = false;
    }
}
