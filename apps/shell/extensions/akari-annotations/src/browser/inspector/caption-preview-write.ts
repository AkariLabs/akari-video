import type { InspectorWriteRequest, InspectorWriteResult } from '../timeline-selection-model';

export interface CaptionPreviewFailure { captionId: string; textStyle: null; failed: true }

export async function withCaptionPreviewFailure(
    request: InspectorWriteRequest,
    operation: Promise<InspectorWriteResult>,
    report: (detail: CaptionPreviewFailure) => void = detail =>
        window.dispatchEvent(new CustomEvent('akari-caption-panel-preview', { detail }))
): Promise<InspectorWriteResult> {
    const failed = (): void => {
        if (request.kind.startsWith('caption-style-') && 'id' in request) {
            report({ captionId: request.id, textStyle: null, failed: true });
        }
    };
    try {
        const result = await operation;
        if (!result.ok) failed();
        return result;
    } catch (error) {
        failed();
        throw error;
    }
}
