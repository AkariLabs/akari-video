import { EditLintFinding } from '../common/akari-project-protocol';
import { t } from '../common/project-text';
import { lintStatusLabel } from '../common/lint-results';

export function lintBadgeCounts(findings: readonly EditLintFinding[]): { issues: number; info: number } {
    let issues = 0;
    let info = 0;
    for (const finding of findings) {
        if (finding.severity === 'error' || finding.severity === 'warning') issues += 1;
        else if (finding.severity === 'info') info += 1;
    }
    return { issues, info };
}

export function lintBadgeLabel(running: boolean, findings?: readonly EditLintFinding[]): string {
    if (running) return lintStatusLabel(true);
    if (findings === undefined) return lintStatusLabel(false);
    const { issues, info } = lintBadgeCounts(findings);
    if (issues === 0 && info > 0) {
        return t('project.editCheck.result.checkNoIssuesWithInfoAction', { count: info, n: info });
    }
    return lintStatusLabel(false, issues);
}
