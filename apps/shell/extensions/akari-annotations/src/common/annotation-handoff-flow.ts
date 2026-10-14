import { Annotation } from './akari-annotations-protocol';
import { composeAnnotationAgentPacket } from './annotation-agent-packet';
import { composeBatchAnnotationHandoff, pendingAnnotationHandoff } from './batch-annotation-handoff';
import { PromptResult } from './partner-handoff';

export interface AnnotationHandoffPort {
    hand(prompt: string): Promise<PromptResult>;
    markSent(id: string): Promise<void>;
}

export async function handAnnotation(annotation: Annotation, targetLabel: string | null, port: AnnotationHandoffPort): Promise<PromptResult> {
    const result = await port.hand(composeAnnotationAgentPacket({
        id: annotation.id, sourceT: annotation.sourceT, sourceRange: annotation.sourceRange,
        target: annotation.target, targetLabel, text: annotation.text, strokes: annotation.strokes
    }));
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
