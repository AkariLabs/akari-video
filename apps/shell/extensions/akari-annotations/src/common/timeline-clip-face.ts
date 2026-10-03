import { shapeMarkup, type ShapeSourceV2 } from '@akari-video/edit-store';

type ClipItem = { id: string; name?: unknown; source?: { kind?: string; shape?: string; path?: string; params?: { preset?: unknown } } };

const shapeNames: Record<string, string> = {
    rect: '四角', 'rounded-rect': '角丸四角', ellipse: '円', line: '線', arrow: '矢印',
    'speech-bubble': '吹き出し', bubble: '吹き出し', path: '図形'
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
    return userName(item) || presetName || shapeNames[item.source?.shape ?? ''] || '図形';
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
