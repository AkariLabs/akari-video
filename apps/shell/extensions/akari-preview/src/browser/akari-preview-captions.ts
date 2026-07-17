import URI from '@theia/core/lib/common/uri';

// akari-transcript の Caption から、プレビュー表示に必要なフィールドだけを複製する。
export interface PreviewCaption {
    start: number;
    end: number;
    text: string;
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
        captions.push({ start, end, text });
    }
    return captions;
}
