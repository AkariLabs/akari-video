export type CaptionNoticeCode = { code: string; params?: Record<string, string | number> };

const FIELD_KEYS: Record<string, string> = {
    font_family: 'transcript.daihon.editor.runLookFontLabel',
    line_height: 'transcript.daihon.editor.runLookLineHeightLabel',
    text_transform: 'transcript.daihon.editor.runLookTextTransformLabel',
    fill: 'transcript.daihon.editor.runLookFillLabel',
    strokes: 'transcript.daihon.editor.runLookStrokesLabel'
};

export function captionNoticeTexts(
    codes: readonly CaptionNoticeCode[], translate: (key: string, values?: Record<string, string | number>) => string,
    log: (code: CaptionNoticeCode) => void = () => undefined
): string[] {
    const messages = new Set<string>();
    for (const notice of codes) {
        let key: string;
        let values: Record<string, string | number> | undefined;
        if (notice.code === 'run-look-omitted') {
            const field = String(notice.params?.field ?? '');
            const fieldName = translate(FIELD_KEYS[field] ?? 'transcript.daihon.editor.runLookOtherLabel');
            key = 'transcript.daihon.editor.runLookOmittedNotice';
            values = { value1: fieldName };
        } else if (notice.code === 'anchor-unmapped') key = 'transcript.daihon.editor.anchorUnmappedNotice';
        else if (notice.code === 'style-not-found') key = 'transcript.daihon.editor.styleNotFoundNotice';
        else { log(notice); continue; }
        messages.add(translate(key, values));
    }
    return [...messages];
}
