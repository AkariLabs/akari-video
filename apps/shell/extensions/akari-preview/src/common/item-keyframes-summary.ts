import type { InternalEdit, InternalItem, KeyframeV2 } from '@akari-video/edit-store';

export type ItemKeyframe = KeyframeV2;

export interface ItemKeyframeSummaryFields {
    keyframes?: readonly ItemKeyframe[];
    opacity?: number;
}

interface ResolvePreviewItemKeyframesOptions {
    readText: (path: string) => Promise<string>;
    onReference?: (path: string) => void;
    onWarning?: (message: string, error?: unknown) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const itemChildren = (item: InternalItem): readonly InternalItem[] =>
    Array.isArray(item.children) ? item.children : [];

/**
 * HTML item の motion 袋参照を秒単位の inline 配列へ解決する。内部表現の
 * inline 点は既に秒単位であり、expandBagOverlays の既定も秒単位。
 * 失敗は警告だけに留め、
 * declaration を変更しないことで overlay-runtime の静的値へフォールバックする。
 */
export async function resolvePreviewItemKeyframes(
    internal: InternalEdit,
    options: ResolvePreviewItemKeyframesOptions
): Promise<void> {
    const warn = options.onWarning ?? ((message: string, error?: unknown) => console.warn(message, error));
    const bags = new Map<string, Promise<Record<string, unknown> | null>>();
    const readBag = (path: string): Promise<Record<string, unknown> | null> => {
        const cached = bags.get(path);
        if (cached) return cached;
        options.onReference?.(path);
        const pending = options.readText(path).then(source => {
            const parsed: unknown = JSON.parse(source);
            if (!isRecord(parsed) || !isRecord(parsed.items)) {
                warn(`[akari-preview] motion bag ${path} has no items object; referenced items stay static`);
                return null;
            }
            return parsed.items;
        }).catch(error => {
            warn(`[akari-preview] motion bag ${path} could not be read; referenced items stay static`, error);
            return null;
        });
        bags.set(path, pending);
        return pending;
    };

    const visit = async (item: InternalItem): Promise<void> => {
        if (item.source.kind === 'html'
            && item.keyframesRef
            && !Array.isArray(item.declaration.keyframes)) {
            const path = typeof item.keyframesRef.path === 'string' ? item.keyframesRef.path : '';
            if (!path) {
                warn(`[akari-preview] motion bag path is empty for ${item.id}; item stays static`);
            } else {
                const items = await readBag(path);
                const points = items?.[item.id];
                if (Array.isArray(points) && points.length > 0) {
                    item.declaration = { ...item.declaration, keyframes: points.map(point => isRecord(point)
                        ? { ...point, ...(typeof point.t === 'number' && Number.isFinite(point.t)
                            ? { t: point.t / internal.output.fps } : {}) }
                        : point) };
                } else if (items) {
                    warn(`[akari-preview] motion bag ${path} has no points for ${item.id}; item stays static`);
                }
            }
        }
        for (const child of itemChildren(item)) await visit(child);
    };

    for (const track of internal.tracks) {
        for (const item of track.items) await visit(item);
    }
}

/** 静的 opacity は keyframes の有無に依存せず描画へ渡す。 */
export function buildItemKeyframeSummaryFields(value: Record<string, unknown>): ItemKeyframeSummaryFields {
    return {
        ...(Array.isArray(value.keyframes) ? { keyframes: value.keyframes as ItemKeyframe[] } : {}),
        ...(typeof value.opacity === 'number' && Number.isFinite(value.opacity)
            ? { opacity: value.opacity } : {})
    };
}
