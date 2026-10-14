import { t } from '@akari-video/i18n';

// 2026-09-12 裁定 A の純粋ロジック。
// widget はこの結果を DOM へ反映するだけとする。

export interface CompileSessionCandidate {
    id: string;
    startedAt: string;
}

export type CompileSessionPlan =
    { kind: 'notice'; notice: string }
    | { kind: 'copy'; sessionId: string; prompt: string };

export function sessionSortKey(session: CompileSessionCandidate): number {
    const match = /^s-(\d+)$/.exec(session.id);
    return match ? Number(match[1]) : 0;
}

export function planCompileHandoff(
    sessions: readonly CompileSessionCandidate[], sessionId?: string
): CompileSessionPlan {
    if (sessionId && !sessions.some(session => session.id === sessionId)) {
        return { kind: 'notice', notice: t('annotationscommon.compileSessionHandoff.notice.missingSession', { sessionId }) };
    }
    if (sessions.length === 0) {
        return { kind: 'notice', notice: t('annotationscommon.compileSessionHandoff.notice.noRecordings') };
    }
    const session = sessionId
        ? sessions.find(candidate => candidate.id === sessionId)!
        : [...sessions].sort((left, right) => {
            const leftOrder = sessionSortKey(left);
            const rightOrder = sessionSortKey(right);
            return leftOrder === rightOrder
                ? left.startedAt.localeCompare(right.startedAt)
                : leftOrder - rightOrder;
        }).pop()!;
    const prompt = t('annotationscommon.compileSessionHandoff.text.prompt', { id: session.id });
    return { kind: 'copy', sessionId: session.id, prompt };
}

export function compileCopiedMessage(prompt: string): string {
    return t('annotationscommon.compileSessionHandoff.notice.copied', { prompt });
}

export function compileClipboardFailureNotice(detail: string): string {
    return t('annotationscommon.compileSessionHandoff.notice.copyFailed', { detail });
}

export function compileClipboardFailureFooter(prompt: string): string {
    return t('annotationscommon.compileSessionHandoff.notice.copyManually', { prompt });
}
