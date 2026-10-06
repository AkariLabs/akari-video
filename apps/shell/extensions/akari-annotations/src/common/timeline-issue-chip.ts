import type { UiLintFinding } from './lint-message-ja';
import { withNewerVersionLintPrefix } from '@akari-video/edit-store';

export function timelineIssueLabel(count: number): string {
    return `⚠ 課題 ${count}`;
}

export function timelineIssueHeading(count: number, savedVersion?: string): string {
    return withNewerVersionLintPrefix(`保存前からある課題 ${count} 件（この編集で増えたものではありません）`, savedVersion);
}

export function timelineIssueLine(finding: UiLintFinding): string {
    return [finding.severity ?? 'error', finding.check ?? 'edit-lint',
        finding.message ?? '不明なエラー', finding.path ?? '—'].join(' · ');
}

export function timelineIssueRows(findings: readonly UiLintFinding[], limit = 10): { rows: string[]; remaining: number } {
    return {
        rows: findings.slice(0, limit).map(timelineIssueLine),
        remaining: Math.max(0, findings.length - limit)
    };
}

export function timelineIssueCopyText(findings: readonly UiLintFinding[]): string {
    return findings.map(timelineIssueLine).join('\n');
}
