import URI from '@theia/core/lib/common/uri';

// akari-transcript の Caption から、プレビュー表示に必要なフィールドだけを複製する。
export interface PreviewCaption {
    start: number;
    end: number;
    text: string;
    style?: 'karaoke' | 'pop';
    words?: { start: number; end: number; text: string }[];
}

export function locatePreviewCaptions(editUri: URI | undefined, workspaceRoot: URI | undefined): URI | undefined {
    const base = editUri ? editUri.parent : workspaceRoot?.resolve('project');
    return base?.resolve('captions.json');
}

export function parsePreviewCaptions(source: string): PreviewCaption[] {
    const values: unknown = JSON.parse(source);
    if (!Array.isArray(values)) {
        throw new Error('captions.json is not an array');
    }
    const captions: PreviewCaption[] = [];
    for (const value of values) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const candidate = value as Record<string, unknown>;
        const { start, end, text } = candidate;
        if (typeof start !== 'number' || typeof end !== 'number'
            || !Number.isFinite(start) || !Number.isFinite(end) || start >= end
            || typeof text !== 'string') {
            continue;
        }
        const style = candidate.style === 'karaoke' || candidate.style === 'pop'
            ? candidate.style
            : undefined;
        const words = Array.isArray(candidate.words)
            ? candidate.words.flatMap(word => {
                if (!word || typeof word !== 'object') {
                    return [];
                }
                const item = word as Record<string, unknown>;
                return typeof item.start === 'number' && Number.isFinite(item.start)
                    && typeof item.end === 'number' && Number.isFinite(item.end) && item.end > item.start
                    && typeof item.text === 'string' && item.text.length > 0
                    ? [{ start: item.start, end: item.end, text: item.text }]
                    : [];
            })
            : [];
        captions.push({
            start,
            end,
            text,
            ...(style ? { style } : {}),
            ...(words.length > 0 ? { words } : {})
        });
    }
    return captions;
}
