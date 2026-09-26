export interface DropRect { x: number; y: number; width: number; height: number }
export interface DropPoint { x: number; y: number }
export interface ContentFrame { rect: DropRect; viewport: { width: number; height: number } }

/** The webview reports the rendered output rectangle in its own viewport. */
export function outputRectInHost(iframe: DropRect & { clientLeft?: number; clientTop?: number; layoutWidth: number; layoutHeight: number },
    output: DropRect, fullscreen = false, content?: ContentFrame): DropRect | undefined {
    if (fullscreen || ![iframe.x, iframe.y, iframe.width, iframe.height, iframe.layoutWidth,
        iframe.layoutHeight, output.x, output.y, output.width, output.height].every(Number.isFinite)
        || iframe.width <= 0 || iframe.height <= 0 || iframe.layoutWidth <= 0 || iframe.layoutHeight <= 0
        || output.width <= 0 || output.height <= 0) return undefined;
    const sx = iframe.width / iframe.layoutWidth;
    const sy = iframe.height / iframe.layoutHeight;
    const frame = content?.rect;
    const viewport = content?.viewport;
    if (content && (!frame || !viewport || ![frame.x, frame.y, frame.width, frame.height,
        viewport.width, viewport.height].every(Number.isFinite)
        || frame.width <= 0 || frame.height <= 0 || viewport.width <= 0 || viewport.height <= 0)) return undefined;
    const innerSx = frame ? frame.width / viewport!.width : 1;
    const innerSy = frame ? frame.height / viewport!.height : 1;
    return { x: iframe.x + ((iframe.clientLeft ?? 0) + (frame?.x ?? 0) + output.x * innerSx) * sx,
        y: iframe.y + ((iframe.clientTop ?? 0) + (frame?.y ?? 0) + output.y * innerSy) * sy,
        width: output.width * innerSx * sx, height: output.height * innerSy * sy };
}

export function hostToOutput(point: DropPoint, rect: DropRect, output: { width: number; height: number }): DropPoint | undefined {
    if (![point.x, point.y, rect.x, rect.y, rect.width, rect.height, output.width, output.height].every(Number.isFinite)
        || rect.width <= 0 || rect.height <= 0 || output.width <= 0 || output.height <= 0
        || point.x < rect.x || point.y < rect.y || point.x > rect.x + rect.width || point.y > rect.y + rect.height) return undefined;
    return { x: (point.x - rect.x) * output.width / rect.width,
        y: (point.y - rect.y) * output.height / rect.height };
}

/** Clamp a pointer inside the preview widget to the nearest output pixel. */
export function nearestOutputPoint(point: DropPoint, rect: DropRect,
    output: { width: number; height: number }): DropPoint | undefined {
    if (![point.x, point.y, rect.x, rect.y, rect.width, rect.height, output.width, output.height].every(Number.isFinite)
        || rect.width <= 0 || rect.height <= 0 || output.width <= 0 || output.height <= 0) return undefined;
    return { x: Math.max(0, Math.min(output.width, (point.x - rect.x) * output.width / rect.width)),
        y: Math.max(0, Math.min(output.height, (point.y - rect.y) * output.height / rect.height)) };
}

/** URI comparison is case-sensitive; macOS's fixed root aliases and Unicode spellings are normalized. */
export function projectFileKey(value: string): string | undefined {
    try {
        const uri = new URL(value);
        if (uri.protocol !== 'file:') return undefined;
        const parts: string[] = [];
        for (const part of decodeURIComponent(uri.pathname).normalize('NFC').split('/')) {
            if (!part || part === '.') continue;
            if (part === '..') parts.pop();
            else parts.push(part);
        }
        if (!uri.host && ['tmp', 'var', 'etc'].includes(parts[0])) parts.unshift('private');
        return `file://${uri.host}/${parts.join('/')}`;
    } catch { return undefined; }
}

export function sameProjectFile(a: string, b: string): boolean {
    const key = projectFileKey(a);
    return key !== undefined && key === projectFileKey(b);
}

export function mediaKindFromPath(path: string): 'video' | 'image' | 'audio' | undefined {
    const extension = path.split(/[?#]/, 1)[0].match(/\.([^./]+)$/)?.[1]?.toLowerCase();
    if (extension && ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'].includes(extension)) return 'video';
    if (extension && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff'].includes(extension)) return 'image';
    if (extension && ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'opus', 'aiff'].includes(extension)) return 'audio';
    return undefined;
}

/** Relative media paths are resolved from the edit file's parent directory. */
export function explorerMaterial(uri: string, editUri: string):
    { relativePath: string; kind: 'video' | 'image' | 'audio' } | 'outside' | undefined {
    const file = projectFileKey(uri);
    const edit = projectFileKey(editUri);
    if (!file || !edit) return undefined;
    const editParent = edit.slice(0, edit.lastIndexOf('/'));
    if (!file.startsWith(`${editParent}/`)) return 'outside';
    const relativePath = file.slice(editParent.length + 1);
    const kind = mediaKindFromPath(relativePath);
    return kind ? { relativePath, kind } : undefined;
}

export function previewDropTransform(point: DropPoint, output: { width: number; height: number },
    source: { width: number; height: number }): { x: number; y: number; scale: number } | undefined {
    if (![point.x, point.y, output.width, output.height, source.width, source.height].every(Number.isFinite)
        || output.width <= 0 || output.height <= 0 || source.width <= 0 || source.height <= 0) return undefined;
    return { ...outputOffset(point, output),
        scale: output.width / (4 * source.width) };
}

export function outputOffset(point: DropPoint, output: { width: number; height: number }): DropPoint {
    return { x: point.x - output.width / 2, y: point.y - output.height / 2 };
}

export function previewDropBox(output: { width: number; height: number }, source?: { width?: number; height?: number }, fraction = 1 / 4): {
    width: number; height: number
} | undefined {
    if (!(output.width > 0) || !(output.height > 0)) return undefined;
    const width = output.width * fraction;
    const aspect = source?.width && source?.height && source.width > 0 && source.height > 0
        ? source.width / source.height : 16 / 9;
    return { width, height: width / aspect };
}
