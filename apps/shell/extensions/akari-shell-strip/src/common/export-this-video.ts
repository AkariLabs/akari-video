import {
    buildTimelineMap,
    readInternalEdit,
    visualContentEndSeconds,
    walkItems
} from '@akari-video/edit-store';

export type ExportOrientation = 'landscape' | 'portrait' | 'square';

export interface ThisVideoDescription {
    readonly orientation: ExportOrientation;
    readonly width: number | undefined;
    readonly height: number | undefined;
    readonly fps: number | undefined;
    readonly durationSeconds?: number;
    readonly cutCount?: number;
    readonly captionCount?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function positiveNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function captionCount(captionsJson: unknown): number | undefined {
    if (Array.isArray(captionsJson)) {
        return captionsJson.length;
    }
    const captions = record(captionsJson)?.captions;
    return Array.isArray(captions) ? captions.length : undefined;
}

/** edit.json / captions.json の一部が欠けても、取得できた値だけを返す寛容リーダー。 */
export function describeThisVideo(editJson: unknown, captionsJson?: unknown): ThisVideoDescription {
    const edit = record(editJson) ?? {};
    const output = record(edit.output) ?? {};
    const width = positiveNumber(output.width);
    const height = positiveNumber(output.height);
    const fps = positiveNumber(output.fps);
    const cuts = Array.isArray(edit.cuts) ? edit.cuts : undefined;
    let durationSeconds: number | undefined;
    let cutCount: number | undefined;
    if (cuts) {
        try {
            const duration = buildTimelineMap(cuts as never[], { fps }).totalDuration;
            durationSeconds = Number.isFinite(duration) && duration >= 0 ? duration : undefined;
            cutCount = cuts.length;
        } catch {
            durationSeconds = undefined;
            cutCount = undefined;
        }
    } else {
        try {
            const internal = readInternalEdit(editJson);
            const duration = visualContentEndSeconds(internal);
            durationSeconds = Number.isFinite(duration) && duration >= 0 ? duration : undefined;
            cutCount = [...walkItems(internal)].filter(item => item.source.kind === 'media').length;
        } catch {
            durationSeconds = undefined;
            cutCount = undefined;
        }
    }
    const orientation: ExportOrientation = width !== undefined && height !== undefined
        ? width === height ? 'square' : width > height ? 'landscape' : 'portrait'
        : 'landscape';
    return {
        orientation,
        width,
        height,
        fps,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        ...(cutCount !== undefined ? { cutCount } : {}),
        ...(captionCount(captionsJson) !== undefined ? { captionCount: captionCount(captionsJson) } : {})
    };
}
