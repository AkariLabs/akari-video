import { t } from '../common/project-text';
import { EditLintFinding } from './akari-project-protocol';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;
const SEVERITY_LABEL = { error: t('project.library.importSheet.errorLabel'), warning: t('project.library.importSheet.warningLabel'), info: t('project.editCheck.resultDialog.infoLabel') } as const;

export function summarizeLintFindings(findings: readonly EditLintFinding[]): {
    ordered: EditLintFinding[];
    error: number;
    warning: number;
    info: number;
} {
    const counts = { error: 0, warning: 0, info: 0 };
    for (const finding of findings) counts[finding.severity] += 1;
    return {
        ordered: [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
        ...counts
    };
}

export function lintStatusLabel(running: boolean, count?: number): string {
    if (running) return t('project.editCheck.result.checkingStatus');
    if (count === undefined) return t('project.editCheck.result.checkNotRunAction');
    return count === 0 ? t('project.editCheck.result.checkNoIssuesAction') : t('project.editCheck.result.checkCountIssuesAction', { count: count, n: count });
}

export function lintPartnerPrompt(findings: readonly EditLintFinding[]): string {
    const ordered = summarizeLintFindings(findings).ordered;
    return t('project.editCheck.result.editCheckLengthIssuesLabel', { length: ordered.length, n: ordered.length, value2: ordered.map(finding =>
        `- [${SEVERITY_LABEL[finding.severity]}] ${finding.message}${finding.path ? ` (${finding.path})` : ''}`
    ).join('\n') });
}
