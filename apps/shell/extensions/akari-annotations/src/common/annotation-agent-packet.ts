import { t } from '@akari-video/i18n';
import { DescribableStroke, describeAnnotationPosition, describePenStrokes } from './pen-stroke-description';
import { AnnotationRegion } from './annotation-store';

export interface AnnotationAgentPacketInput {
    id: string;
    sourceT: number | null;
    sourceRange: [number, number] | null;
    /** null / overlay:<id> / cut:<index> / doc:... / image:... / canvas:... / ui:<id>。 */
    target: string | null;
    /** ui: 対象の人が読める表示名。呼び出し側が uiTargetLabels から解決して渡す（無ければ null）。 */
    targetLabel: string | null;
    text: string;
    hasStrokes?: boolean;
    strokes?: readonly DescribableStroke[] | null;
    region?: AnnotationRegion | null;
}

function formatAnnotationPacketSeconds(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function composeAnnotationAgentPacket(input: AnnotationAgentPacketInput): string {
    const timeLabel = input.sourceRange
        ? `${formatAnnotationPacketSeconds(input.sourceRange[0])}〜${formatAnnotationPacketSeconds(input.sourceRange[1])}`
        : input.sourceT !== null
            ? formatAnnotationPacketSeconds(input.sourceT)
        : t('annotationscommon.annotationPacket.text.documentImage');
    const details: string[] = [];
    if (input.target) {
        details.push(t('annotationscommon.annotationPacket.text.target', {
            target: input.target, label: input.targetLabel ? `（${input.targetLabel}）` : ''
        }));
    }
    const stroke = describePenStrokes(input.strokes);
    if (stroke || input.hasStrokes) {
        details.push(stroke ?? t('annotationscommon.penStrokes.text.present'));
    } else {
        const position = describeAnnotationPosition(input.region);
        if (position) details.push(position);
    }
    const suffix = details.length > 0 ? `・${details.join('・')}` : '';
    const body = input.text.trim() ? input.text.trim() : t('annotationscommon.annotationPacket.text.noBody');
    return t('annotationscommon.annotationPacket.text.prompt', { id: input.id, time: timeLabel, details: suffix, body });
}
