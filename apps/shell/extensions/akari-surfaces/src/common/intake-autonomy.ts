import type { IntakeAutonomy } from './intake-labels';

/** 既存の値とキー順を保持し、おまかせ度だけを変更する。 */
export function applyAutonomy(sourceText: string, autonomy: IntakeAutonomy): string {
    if (autonomy !== 'full-auto' && autonomy !== 'checkpoint' && autonomy !== 'collaborative') {
        throw new Error('Invalid intake autonomy');
    }
    const intake = JSON.parse(sourceText);
    if (!intake || typeof intake !== 'object' || Array.isArray(intake)) {
        throw new Error('Intake must be a JSON object');
    }
    intake.autonomy = autonomy;
    return `${JSON.stringify(intake, null, 2)}\n`;
}
