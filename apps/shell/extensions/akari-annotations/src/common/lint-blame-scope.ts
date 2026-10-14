// 保存起点フッターが、今回書いていないファイルの既存指摘まで編集へ誤帰属するのを防ぐ。
// lint の実行・記録・プロジェクト全体の合否は変えず、フッター表示の責任範囲だけを分ける。

import type { UiLintFinding } from './lint-message-ja';

export interface LintBlameSplit {
    own: UiLintFinding[];
    foreign: UiLintFinding[];
}

export function lintFindingKey(finding: UiLintFinding, captionsSource?: string): string {
    const path = finding.path ?? '';
    const match = /^captions(?:\.[a-z0-9-]+)?\.json#(?:\[(\d+)\]|(\d+))(?:\.|$)/u.exec(path);
    if (match && captionsSource) {
        try {
            const parsed = JSON.parse(captionsSource);
            const captions = Array.isArray(parsed) ? parsed : parsed.captions;
            const id = captions?.[Number(match[1] ?? match[2])]?.id;
            if (typeof id === 'string' && id) return `${finding.check ?? ''}\u0000caption:${id}`;
        } catch { /* 壊れた字幕は path で照合する。 */ }
    }
    return `${finding.check ?? ''}\u0000${path}`;
}

export function splitLintBlame(
    findings: readonly UiLintFinding[],
    writtenFiles: readonly string[],
    existingKeys: readonly string[] = [],
    currentKeys: readonly string[] = []
): LintBlameSplit {
    const writtenFileSet = new Set(writtenFiles);
    const existing = new Set(existingKeys);
    const split: LintBlameSplit = { own: [], foreign: [] };
    for (const [index, finding] of findings.entries()) {
        const findingFile = finding.path?.split('#', 1)[0];
        if (!finding.preexisting && (!findingFile || writtenFileSet.has(findingFile))
            && !existing.has(currentKeys[index] ?? lintFindingKey(finding))) {
            split.own.push(finding);
        } else {
            split.foreign.push(finding);
        }
    }
    return split;
}
