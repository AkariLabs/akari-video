export interface AnnotationAgentPacketInput {
    id: string;
    sourceT: number | null;
    sourceRange: [number, number] | null;
    /** null / overlay:<id> / cut:<index> / doc:... / image:... / canvas:... / ui:<id>。 */
    target: string | null;
    /** ui: 対象の人が読める表示名。呼び出し側が uiTargetLabels から解決して渡す（無ければ null）。 */
    targetLabel: string | null;
    text: string;
    hasStrokes: boolean;
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
            : 'ドキュメント/画像上の注釈';
    const details: string[] = [];
    if (input.target) {
        details.push(input.targetLabel ? `対象 ${input.target}（${input.targetLabel}）` : `対象 ${input.target}`);
    }
    if (input.hasStrokes) {
        details.push('ペン描画あり');
    }
    const suffix = details.length > 0 ? `・${details.join('・')}` : '';
    const body = input.text.trim() ? input.text.trim() : '(本文なし。ペン描画のみ)';
    return `【注釈】${input.id}（${timeLabel}${suffix}）について: ${body}\nこの注釈に対応してください。`;
}
