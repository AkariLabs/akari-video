import { t } from '@akari-video/i18n';
import { shapeMarkup, type ShapeSourceV2 } from '@akari-video/edit-store';

type ClipItem = { id: string; name?: unknown; source?: { kind?: string; shape?: string; path?: string; params?: { preset?: unknown } } };

const shapeNames: Record<string, string> = {
    rect: t('annotationscommon.timelineClipFace.shape.rectangle'), 'rounded-rect': t('annotationscommon.timelineClipFace.shape.roundedRectangle'), ellipse: t('annotationscommon.timelineClipFace.shape.ellipse'), line: t('annotationscommon.timelineClipFace.shape.line'), arrow: t('annotationscommon.timelineClipFace.shape.arrow'),
    'speech-bubble': t('annotationscommon.timelineClipFace.shape.speechBubble'), bubble: t('annotationscommon.timelineClipFace.shape.speechBubble'), path: t('annotationscommon.timelineClipFace.shape.generic')
};

function userName(item: ClipItem): string | undefined {
    return typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined;
}

export function clipFaceWidthPx(height: number, kind: 'shape' | 'html', svg?: string): number {
    if (!Number.isFinite(height) || height <= 0) return 0;
    if (kind === 'html') return Math.round(height * 16 / 9 * 100) / 100;
    const root = svg?.match(/^<svg\b[^>]*>/u)?.[0] ?? '';
    const width = Number(root.match(/\bwidth="([\d.]+)"/u)?.[1]);
    const svgHeight = Number(root.match(/\bheight="([\d.]+)"/u)?.[1]);
    const aspect = width > 0 && svgHeight > 0 ? width / svgHeight : 1;
    return Math.round(height * Math.max(1, Math.min(2.5, aspect)) * 100) / 100;
}

export function shapeClipLabel(item: ClipItem, presetName?: string): string {
    return userName(item) || presetName || shapeNames[item.source?.shape ?? ''] || t('annotationscommon.timelineClipFace.shape.generic');
}

export function shapeClipFace(item: ClipItem, presetName?: string): { label: string; svg: string } {
    const source = item.source;
    return {
        label: shapeClipLabel(item, presetName),
        svg: source?.kind === 'shape' ? shapeMarkup(source as ShapeSourceV2, item.id) : ''
    };
}

export function htmlClipFace(item: ClipItem, fallbackLabel: string, meta?: { title?: unknown }, preview?: string):
    { label: string; preview: string | undefined } {
    return {
        label: userName(item) || (typeof meta?.title === 'string' && meta.title.trim() ? meta.title.trim() : fallbackLabel),
        preview: item.source?.kind === 'html' && typeof item.source.path === 'string' ? preview : undefined
    };
}
