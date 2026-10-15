import { Annotation } from './akari-annotations-protocol';
import { composeAnnotationAgentPacket } from './annotation-agent-packet';
import { composeBatchAnnotationHandoff, pendingAnnotationHandoff } from './batch-annotation-handoff';
import { PromptResult } from './partner-handoff';
import { buildUiTargetRow, parseUiTarget } from './doc-target';

export interface AnnotationHandoffPort {
    hand(prompt: string): Promise<PromptResult>;
    markSent(id: string): Promise<void>;
}

export function composeSingleAnnotationHandoff(
    annotation: Annotation, uiTargetLabels: Readonly<Record<string, string>> = {}
): string {
    const uiTarget = parseUiTarget(annotation.target);
    const targetLabel = uiTarget ? buildUiTargetRow(uiTarget.id, uiTargetLabels).label : null;
    return composeAnnotationAgentPacket({
        id: annotation.id, sourceT: annotation.sourceT, sourceRange: annotation.sourceRange,
        target: annotation.target, targetLabel, text: annotation.text, strokes: annotation.strokes
    });
}

export async function handAnnotation(
    annotation: Annotation, uiTargetLabels: Readonly<Record<string, string>>, port: AnnotationHandoffPort
): Promise<PromptResult> {
    const result = await port.hand(composeSingleAnnotationHandoff(annotation, uiTargetLabels));
    if (result === 'typed' || result === 'unsupported') await port.markSent(annotation.id);
    return result;
}

export async function handPendingAnnotations(
    annotations: readonly Annotation[], sent: ReadonlySet<string>, port: AnnotationHandoffPort
): Promise<Annotation[]> {
    const pending = pendingAnnotationHandoff(annotations, sent);
    if (!pending.length) return [];
    const result = await port.hand(composeBatchAnnotationHandoff(pending));
    if (result === 'typed' || result === 'unsupported') {
        for (const annotation of pending) await port.markSent(annotation.id);
    }
    return pending;
}
