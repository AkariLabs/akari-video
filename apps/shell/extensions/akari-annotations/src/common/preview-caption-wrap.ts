export interface PreviewCaptionWrapRequest {
    captionId: string;
    wrapWidthPct: number;
    position: { x: number; y: number };
    anchor: string;
}

export function writePreviewCaptionWrap(source: string, request: PreviewCaptionWrapRequest): string {
    if (!Number.isFinite(request.wrapWidthPct) || request.wrapWidthPct <= 0 || request.wrapWidthPct > 100
        || !Number.isFinite(request.position.x) || !Number.isFinite(request.position.y)
        || !/^[tmb][lcr]$/.test(request.anchor)) throw new Error('文字の幅または位置が不正です');
    const root = JSON.parse(source);
    const captions = Array.isArray(root) ? root : root?.captions;
    if (!Array.isArray(captions)) throw new Error('字幕ファイルの形式が不正です');
    const cue = captions.find((item: any) => item?.id === request.captionId);
    if (!cue) throw new Error(`文字が見つかりません: ${request.captionId}`);
    cue.text_style = { ...(cue.text_style ?? {}), wrap_width_pct: request.wrapWidthPct,
        text_anchor: request.anchor, position: { ...request.position } };
    delete cue.text_style.zone;
    return `${JSON.stringify(root, undefined, 2)}\n`;
}

export function duplicatePreviewCaption(source: string, captionId: string,
    position: { anchor: string; position: { x: number; y: number } }): string {
    const root = JSON.parse(source);
    const captions = Array.isArray(root) ? root : root?.captions;
    if (!Array.isArray(captions)) throw new Error('字幕ファイルの形式が不正です');
    const index = captions.findIndex((item: any) => item?.id === captionId);
    if (index < 0) throw new Error(`文字が見つかりません: ${captionId}`);
    if (!/^[tmb][lcr]$/.test(position.anchor)
        || !Number.isFinite(position.position.x) || !Number.isFinite(position.position.y)) {
        throw new Error('複製先の位置が不正です');
    }
    const clone = structuredClone(captions[index]);
    const existing = new Set(captions.map((item: any) => item?.id));
    let next = captions.reduce((max: number, item: any) => {
        const match = /^c-(\d+)$/.exec(String(item?.id ?? ''));
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    clone.id = `c-${String(next).padStart(4, '0')}`;
    while (existing.has(clone.id)) clone.id = `c-${String(++next).padStart(4, '0')}`;
    clone.text_style = { ...(clone.text_style ?? {}), text_anchor: position.anchor,
        position: { ...position.position } };
    delete clone.text_style.zone;
    captions.splice(index + 1, 0, clone);
    return `${JSON.stringify(root, undefined, 2)}\n`;
}
