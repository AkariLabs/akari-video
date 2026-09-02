export const AKARI_EXPORT_THUMBNAIL_SERVICE_PATH = '/services/akari-export-thumbnail';

export interface ExportThumbnailFrame {
    readonly outputSeconds: number;
    readonly dataUrl: string | undefined;
}

export interface ExportThumbnailStrip {
    readonly durationSeconds: number;
    readonly frames: readonly ExportThumbnailFrame[];
}

export interface ExportThumbnailStripRequest {
    readonly projectRootUri: string;
    readonly count?: number;
}

export const AkariExportThumbnailService = Symbol('AkariExportThumbnailService');

export interface AkariExportThumbnailService {
    prepareStrip(request: ExportThumbnailStripRequest): Promise<ExportThumbnailStrip>;
}

/** 進捗率（0–100）に対応する帯の枚の index。最も近い outputSeconds を選ぶ。空なら -1。 */
export function currentStripIndex(
    strip: ExportThumbnailStrip | undefined,
    progressPercent: number
): number {
    if (!strip || strip.frames.length === 0) {
        return -1;
    }
    if (strip.durationSeconds <= 0) {
        return 0;
    }
    const percent = Math.max(0, Math.min(100, Number.isFinite(progressPercent) ? progressPercent : 0));
    const target = percent / 100 * strip.durationSeconds;
    let nearestIndex = 0;
    let nearestDistance = Math.abs(strip.frames[0].outputSeconds - target);
    for (let index = 1; index < strip.frames.length; index += 1) {
        const distance = Math.abs(strip.frames[index].outputSeconds - target);
        if (distance < nearestDistance) {
            nearestIndex = index;
            nearestDistance = distance;
        }
    }
    return nearestIndex;
}
