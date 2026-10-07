import { randomBytes } from 'crypto';
import { pathToFileURL } from 'url';

export interface ScratchThumbnail { bytes?: Buffer; width?: number; height?: number }

/** Decode untrusted image bytes only in a short-lived sandboxed renderer. */
export async function renderScratchThumbnail(path: string): Promise<ScratchThumbnail> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- Defer Electron loading while keeping webpack resolution static.
    const electron = require('@theia/core/electron-shared/electron') as typeof import('@theia/core/electron-shared/electron');
    const { BrowserWindow, session } = electron;
    const partition = `akari-scratch-thumb-${randomBytes(12).toString('hex')}`;
    const isolated = session.fromPartition(partition);
    isolated.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !/^(?:file|data):/iu.test(details.url) });
    });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    const window = new BrowserWindow({ show: false, width: 512, height: 512,
        webPreferences: { partition, sandbox: true, contextIsolation: true,
            nodeIntegration: false, webSecurity: true, offscreen: true } });
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.removeAllListeners('will-navigate');
    contents.on('will-navigate', (event, url) => {
        if (url !== pathToFileURL(path).href) event.preventDefault();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            (async (): Promise<ScratchThumbnail> => {
                await contents.loadURL(pathToFileURL(path).href);
                const size = await contents.executeJavaScript(`(async () => {
                    const image = document.images[0];
                    if (!image) return undefined;
                    await image.decode();
                    const width = image.naturalWidth, height = image.naturalHeight;
                    if (!width || !height) return undefined;
                    const ratio = Math.min(1, 512 / Math.max(width, height));
                    const scaledWidth = Math.max(1, Math.round(width * ratio));
                    const scaledHeight = Math.max(1, Math.round(height * ratio));
                    document.documentElement.style.cssText = 'margin:0;overflow:hidden;background:Canvas';
                    document.body.style.cssText = 'margin:0;overflow:hidden;background:Canvas';
                    const canvas = document.createElement('canvas');
                    canvas.width = scaledWidth; canvas.height = scaledHeight;
                    canvas.style.display = 'block';
                    const context = canvas.getContext('2d');
                    if (!context) return undefined;
                    context.drawImage(image, 0, 0, scaledWidth, scaledHeight);
                    document.body.replaceChildren(canvas);
                    return { width, height, scaledWidth, scaledHeight };
                })()` ) as { width: number; height: number; scaledWidth: number; scaledHeight: number } | undefined;
                if (!size) return {};
                window.setContentSize(size.scaledWidth, size.scaledHeight);
                await new Promise<void>(resolve => setTimeout(resolve, 50));
                const captured = await contents.capturePage({ x: 0, y: 0,
                    width: size.scaledWidth, height: size.scaledHeight });
                if (captured.isEmpty()) return { width: size.width, height: size.height };
                const capturedSize = captured.getSize();
                const ratio = Math.min(1, 512 / Math.max(capturedSize.width, capturedSize.height));
                const thumb = ratio < 1 ? captured.resize({
                    width: Math.max(1, Math.round(capturedSize.width * ratio)),
                    height: Math.max(1, Math.round(capturedSize.height * ratio)) }) : captured;
                return { bytes: thumb.toJPEG(70), width: size.width, height: size.height };
            })(),
            new Promise<ScratchThumbnail>(resolve => { timer = setTimeout(() => resolve({}), 5000); })
        ]);
    } catch { return {}; }
    finally {
        if (timer) clearTimeout(timer);
        if (!window.isDestroyed()) window.destroy();
    }
}
