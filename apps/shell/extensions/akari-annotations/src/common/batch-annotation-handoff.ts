import { t } from '@akari-video/i18n';
import { Annotation } from './akari-annotations-protocol';
import { describePenStrokes } from './pen-stroke-description';

export function pendingAnnotationHandoff(annotations: readonly Annotation[], sentIds: ReadonlySet<string>): Annotation[] {
    return annotations.filter(annotation => annotation.status === 'open' && !sentIds.has(annotation.id))
        .sort((left, right) => (left.sourceT ?? Infinity) - (right.sourceT ?? Infinity) || left.id.localeCompare(right.id));
}

export function composeBatchAnnotationHandoff(annotations: readonly Annotation[]): string {
    const lines = [t('annotationscommon.batchHandoff.text.heading', { count: annotations.length, n: annotations.length })];
    for (const annotation of annotations) {
        const seconds = annotation.sourceT;
        const rounded = seconds === null ? null : Math.max(0, Math.round(seconds));
        const time = rounded === null ? '' : `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
        const stroke = describePenStrokes(annotation.strokes ?? []);
        const parts = [annotation.id, time, annotation.target ?? '', annotation.text.replace(/\s*\r?\n\s*/g, ' ').trim()].filter(Boolean);
        lines.push(`\u30fb${parts.join(' ')}${stroke ? `\uff08${stroke}\uff09` : ''}`);
    }
    return lines.join('\n');
}
