import { EditV2Document, indexEditV2Items, insertItem, insertTrack, insertTreeV2ItemIntoCanvas } from './edit-v2-mutations';
import { topVisualTarget } from '../browser/preview-material-placement';
import { canvasAtFrame, canvasDropDuration, canvasDropTargets } from '../browser/canvas-drop-target';
import type { ProjectItemV2 } from '@akari-video/edit-store';

export interface OverlayPlaceRequest {
    key: string;
    t?: number;
    center?: { x: number; y: number };
    editUri?: string;
    outsideCanvas?: boolean;
}

export interface OverlayBox { x: number; y: number; width: number; height: number }

export function isUsableOverlayBox(value: unknown): value is OverlayBox {
    if (!value || typeof value !== 'object') return false;
    const box = value as OverlayBox;
    return [box.x, box.y, box.width, box.height].every(Number.isFinite)
        && box.width > 0 && box.height > 0;
}

export function overlayBoxOrOutput(output: { width: number; height: number }, measured?: OverlayBox): OverlayBox {
    return isUsableOverlayBox(measured)
        ? measured : { x: 0, y: 0, width: output.width, height: output.height };
}

/** HTML の外側コンテナは出力全体・transform-origin はその中心。box は fragmentBounds の未変形値。 */
export function overlayTransformForBox(output: { width: number; height: number },
    center: { x: number; y: number }, box: OverlayBox): { x: number; y: number; scale: number } | undefined {
    if (![output.width, output.height, center.x, center.y, box.x, box.y, box.width, box.height].every(Number.isFinite)
        || output.width <= 0 || output.height <= 0 || box.width <= 0 || box.height <= 0) return undefined;
    const scale = output.width * 0.4 / box.width;
    return {
        x: center.x - output.width / 2 - scale * (box.x + box.width / 2 - output.width / 2),
        y: center.y - output.height / 2 - scale * (box.y + box.height / 2 - output.height / 2),
        scale
    };
}

export function parseOverlayPlaceRequest(value: unknown): OverlayPlaceRequest | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    if (typeof raw.key !== 'string' || !/^overlay\/[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(raw.key)) return undefined;
    const center = raw.center as { x?: unknown; y?: unknown } | undefined;
    return { key: raw.key,
        ...(typeof raw.t === 'number' && Number.isFinite(raw.t) && raw.t >= 0 ? { t: raw.t } : {}),
        ...(center && typeof center.x === 'number' && Number.isFinite(center.x)
            && typeof center.y === 'number' && Number.isFinite(center.y)
            ? { center: { x: center.x, y: center.y } } : {}),
        ...(typeof raw.editUri === 'string' ? { editUri: raw.editUri } : {}),
        ...(raw.outsideCanvas === true ? { outsideCanvas: true } : {}) };
}

export function overlayDefaultVars(meta: unknown, fragment: string): Record<string, string | number | boolean> {
    const knobs = meta && typeof meta === 'object' && Array.isArray((meta as { knobs?: unknown }).knobs)
        ? (meta as { knobs: unknown[] }).knobs : [];
    const vars: Record<string, string | number | boolean> = {};
    for (const raw of knobs) {
        if (!raw || typeof raw !== 'object') continue;
        const knob = raw as Record<string, unknown>;
        const name = knob.cssVar;
        if (typeof name !== 'string' || !/^--[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) continue;
        const declared = knob.default ?? knob.defaultValue;
        if (typeof declared === 'string' || typeof declared === 'number' || typeof declared === 'boolean') {
            vars[name] = typeof declared === 'number' && typeof knob.unit === 'string'
                ? `${declared}${knob.unit}` : declared;
            continue;
        }
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = fragment.match(new RegExp(`var\\(\\s*${escaped}\\s*,\\s*([^)]*)\\)`));
        if (match?.[1]?.trim()) vars[name] = match[1].trim();
    }
    return vars;
}

export function nextOverlayItemId(doc: EditV2Document): string {
    const ids = new Set(indexEditV2Items(doc).keys());
    let serial = 1;
    while (ids.has(`overlay-${serial}`)) serial++;
    return `overlay-${serial}`;
}

export function buildOverlayItem(options: { id: string; at: number; duration: number; path: string;
    output: { width: number; height: number }; center?: { x: number; y: number };
    vars: Record<string, string | number | boolean>; box?: OverlayBox }): Record<string, unknown> {
    const { width, height } = options.output;
    const center = options.center ?? { x: width / 2, y: height / 2 };
    const transform = overlayTransformForBox(options.output, center, overlayBoxOrOutput(options.output, options.box));
    if (!transform) throw new Error('オーバーレイの大きさを測れませんでした');
    return { id: options.id, at: Math.max(0, Math.round(options.at)), duration: Math.max(1, Math.round(options.duration)),
        transform,
        source: { kind: 'html', path: options.path, vars: options.vars } };
}

export function insertOverlayItem(doc: EditV2Document, item: Record<string, unknown>, outsideCanvas = false): EditV2Document {
    const tracks = doc.tracks as Array<Record<string, unknown>>;
    const canvas = canvasAtFrame(canvasDropTargets(tracks), item.at as number, outsideCanvas);
    if (canvas) {
        const child = { ...item, duration: canvasDropDuration(item.at as number, item.duration as number, canvas) };
        return insertTreeV2ItemIntoCanvas(doc, child as unknown as ProjectItemV2, canvas.id).document;
    }
    const target = topVisualTarget(tracks, { at: item.at as number, duration: item.duration as number });
    if (target.insertIndex !== undefined) {
        const withTrack = insertTrack(doc, { index: target.insertIndex, lane: 'visual' });
        const trackId = String((withTrack.tracks as Array<{ id: string }>)[target.insertIndex].id);
        return insertItem(withTrack, trackId, item);
    }
    return insertItem(doc, target.targetTrackId!, item);
}

export async function resolveThenWriteOverlay<T>(
    resolve: () => Promise<T | undefined>, write: (value: T) => Promise<void>
): Promise<boolean> {
    const imported = await resolve();
    if (!imported) return false;
    await write(imported);
    return true;
}
