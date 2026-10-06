import { EditLintFinding } from './akari-project-protocol';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;
const SEVERITY_LABEL = { error: 'エラー', warning: '注意', info: '情報' } as const;

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
    if (running) return '確認中…';
    if (count === undefined) return 'チェック: 未実行';
    return count === 0 ? 'チェック: 問題なし' : `チェック: 指摘 ${count} 件`;
}

export function lintPartnerPrompt(findings: readonly EditLintFinding[]): string {
    const ordered = summarizeLintFindings(findings).ordered;
    return `【編集内容のチェック】${ordered.length} 件の指摘:\n${ordered.map(finding =>
        `- [${SEVERITY_LABEL[finding.severity]}] ${finding.message}${finding.path ? ` (${finding.path})` : ''}`
    ).join('\n')}`;
}
