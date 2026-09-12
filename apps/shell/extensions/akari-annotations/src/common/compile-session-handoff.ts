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
        return { kind: 'notice', notice: `指定した録音セッションが見つかりません: ${sessionId}` };
    }
    if (sessions.length === 0) {
        return { kind: 'notice', notice: '録音済みセッションがありません。先に録音してください。' };
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
    const prompt = `review セッション ${session.id} をコンパイルして`;
    return { kind: 'copy', sessionId: session.id, prompt };
}

export function compileCopiedMessage(prompt: string): string {
    return `「${prompt}」をクリップボードにコピーしました。パートナーへ貼り付けてください。`;
}

export function compileClipboardFailureNotice(detail: string): string {
    return `クリップボードにコピーできません: ${detail}`;
}

export function compileClipboardFailureFooter(prompt: string): string {
    return `クリップボードにコピーできません。次の定型文を手動でコピーしてください: ${prompt}`;
}
