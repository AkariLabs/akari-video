import { t } from '@akari-video/i18n';
import type { UiLintFinding } from './lint-message-ja';
import { withNewerVersionLintPrefix } from '@akari-video/edit-store';

export function timelineIssueLabel(count: number): string {
    return t('annotationscommon.timelineIssueChip.label.issues', { count, n: count });
}

export function timelineIssueHeading(count: number, savedVersion?: string): string {
    return withNewerVersionLintPrefix(t('annotationscommon.timelineIssueChip.label.existingIssuesNoneAddedEdit', { count, n: count }), savedVersion);
}

export function timelineIssueLine(finding: UiLintFinding): string {
    return [finding.severity ?? 'error', finding.check ?? 'edit-lint',
        finding.message ?? t('annotationscommon.timelineIssueChip.label.unknownErrors'), finding.path ?? '—'].join(' · ');
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
