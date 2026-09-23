/** One successful host-side captions.json operation, in the exact bytes written. */
export interface PreviewCaptionWrite {
    editUri: string;
    captionsUri: string;
    before: string;
    after: string;
    label: string;
}

export function previewCaptionWrite(
    editUri: string, captionsUri: string, before: string, after: string, label: string
): PreviewCaptionWrite | undefined {
    return before === after ? undefined : { editUri, captionsUri, before, after, label };
}
