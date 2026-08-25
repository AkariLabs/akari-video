// 保存起点フッターが、今回書いていないファイルの既存指摘まで編集へ誤帰属するのを防ぐ。
// lint の実行・記録・プロジェクト全体の合否は変えず、フッター表示の責任範囲だけを分ける。

import type { UiLintFinding } from './lint-message-ja';

export interface LintBlameSplit {
    own: UiLintFinding[];
    foreign: UiLintFinding[];
}

export function splitLintBlame(
    findings: readonly UiLintFinding[],
    writtenFiles: readonly string[]
): LintBlameSplit {
    const writtenFileSet = new Set(writtenFiles);
    const split: LintBlameSplit = { own: [], foreign: [] };
    for (const finding of findings) {
        const findingFile = finding.path?.split('#', 1)[0];
        if (!findingFile || writtenFileSet.has(findingFile)) {
            split.own.push(finding);
        } else {
            split.foreign.push(finding);
        }
    }
    return split;
}
