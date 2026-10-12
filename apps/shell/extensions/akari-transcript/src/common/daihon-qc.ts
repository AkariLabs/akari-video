import { pluralCountForDisplay } from './plural-display-count';
import { t } from '../browser/transcript-text';
import type { DaihonRow } from './daihon-row-model';

export const DAIHON_QC_THRESHOLDS = {
    maxCharsPerSecond: 8,
    minDurationSec: 0.6
} as const;

export type DaihonQcIssueKind = 'fast' | 'short' | 'karaoke-unhealthy' | 'karaoke-missing' | 'unrecognized' | 'overflow';

export interface DaihonQcIssue {
    kind: DaihonQcIssueKind;
    label: string;
}

const QC_KINDS: readonly DaihonQcIssueKind[] = [
    'fast', 'short', 'karaoke-unhealthy', 'karaoke-missing', 'unrecognized', 'overflow'
];

function visibleText(text: string): string {
    return text.replace(/[\s\p{P}]/gu, '');
}

export function visibleLength(text: string): number {
    return Array.from(visibleText(text)).reduce((units, char) => units + (char.codePointAt(0)! <= 0x7f ? 0.5 : 1), 0);
}

export function rowIssues(row: DaihonRow, overflowUnits?: number): DaihonQcIssue[] {
    if (row.outStart === null) return [];
    const issues: DaihonQcIssue[] = [];
    if (typeof overflowUnits === 'number' && Number.isFinite(overflowUnits) && overflowUnits > 0) {
        issues.push({ kind: 'overflow', label: t('transcript.daihon.qualityCheck.doesNotFitCharactersWithCountLabel', { value1: overflowUnits, n: overflowUnits }) });
    }
    if (row.unrecognized.length > 0) {
        const count = row.unrecognized.length;
        issues.push({ kind: 'unrecognized', label: count > 1 ? t('transcript.daihon.qualityCheck.unrecognizedUnrecognizedWithValueLabel', { value1: count }) : t('transcript.daihon.qualityCheck.unrecognizedUnrecognizedLabel') });
    }
    const duration = row.end - row.start;
    const cps = visibleLength(row.text) / Math.max(0.01, duration);
    if (cps > DAIHON_QC_THRESHOLDS.maxCharsPerSecond) {
        issues.push({ kind: 'fast', label: t('transcript.daihon.qualityCheck.fastCharactersSecWithCountLabel', { value1: cps.toFixed(1), n: pluralCountForDisplay(cps.toFixed(1)) }) });
    }
    if (duration < DAIHON_QC_THRESHOLDS.minDurationSec) {
        issues.push({ kind: 'short', label: t('transcript.daihon.qualityCheck.displayedLessThan0point6SecLabel') });
    }
    if (row.words?.length) {
        let previousStart = Number.NEGATIVE_INFINITY;
        const outside = row.words.some(word => word.start < row.start || word.start > row.end
            || word.end < row.start || word.end > row.end);
        const nonMonotonic = row.words.some(word => {
            const invalid = word.start < previousStart;
            previousStart = word.start;
            return invalid;
        });
        const wordsText = row.words.map(word => visibleText(word.text)).join('');
        if (outside || nonMonotonic || wordsText !== visibleText(row.text)) {
            issues.push({ kind: 'karaoke-unhealthy', label: t('transcript.daihon.qualityCheck.karaokeTimingMismatchLabel') });
        }
    } else if (row.style === 'karaoke' || row.style === 'reveal-word') {
        issues.push({ kind: 'karaoke-missing', label: t('transcript.daihon.qualityCheck.noKaraokeLabel') });
    }
    return issues;
}

export function summarizeQc(rows: readonly DaihonRow[], overflowUnitsById: ReadonlyMap<string, number> = new Map()): {
    issueCount: number;
    rowCount: number;
    byKind: Record<DaihonQcIssueKind, number>;
} {
    const byKind = Object.fromEntries(QC_KINDS.map(kind => [kind, 0])) as Record<DaihonQcIssueKind, number>;
    let issueCount = 0;
    let rowCount = 0;
    for (const row of rows) {
        const issues = rowIssues(row, overflowUnitsById.get(row.id));
        if (issues.length > 0) rowCount++;
        issueCount += issues.length;
        for (const issue of issues) byKind[issue.kind]++;
    }
    return { issueCount, rowCount, byKind };
}
