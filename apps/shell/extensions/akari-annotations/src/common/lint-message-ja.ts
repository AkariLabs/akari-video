export interface UiLintFinding {
    check?: string;
    severity?: string;
    message?: string;
    path?: string;
}

/** UI で短く案内する高頻度 check だけを持つ。詳細ログの英語本文は置き換えない。 */
export const LINT_CHECK_JA: Readonly<Record<string, string>> = Object.freeze({
    'cuts.track-transition-unsupported':
        'このトランジションは PiP または複数トラックの合成では書き出せません。トランジションを削除するか、映像を単一のトラックへ戻してください。',
    'cuts.transition-out.non-adjacent':
        'トランジションの次のクリップとの間にすき間があります。すき間を詰めるか、トランジションを削除してください。',
    'cuts.transition-out.zero-overlap':
        'トランジションを宣言していますが、次のクリップと重なっていないため効きません。前のクリップの終わりを延ばすか、トランジションを削除してください。',
    'cuts.transition-out.layer-evacuated':
        'このクリップは PiP 経路へ退避されているため、宣言したトランジションは書き出されません。重なりを解消するか、トランジションを削除してください。',
    'captions.overlap':
        '字幕の表示時間が重なっています。タイムラインで字幕の開始・終了位置をずらしてください。',
    'captions.output-domain-exceeds-duration':
        '出力時間の字幕が動画総尺を超えています。書き出しでは動画終端までにクランプして表示されます。',
    'cuts.track-overlap':
        '同じ映像トラック上でクリップが重なっています。クリップを重ならない位置へ移動してください。',
    'references.files':
        '参照している素材ファイルが見つかりません。素材の場所またはファイル名を確認してください。',
    'overlays.timeline':
        'オーバーレイが映像の範囲外にあります。表示位置か映像の長さを調整してください。',
    'audio.sfx.timeline':
        '効果音が映像の範囲外にあります。再生位置か映像の長さを調整してください。'
});

/** pass verdict でも保存直後に知らせる、本タスク由来の transition warning だけ。 */
export const LINT_WARNING_SUMMARY_CHECKS: readonly string[] = Object.freeze([
    'cuts.transition-out.zero-overlap',
    'cuts.transition-out.layer-evacuated'
]);

export function lintCheckFromError(error: string | undefined): string | undefined {
    const match = /^\[([^\]]+)\]/u.exec(error ?? '');
    return match?.[1];
}

export function japaneseLintSummary(
    errors: readonly string[],
    findings: readonly UiLintFinding[] = []
): string | undefined {
    const finding = findings.find(candidate => candidate.severity === 'error' && candidate.check
        && LINT_CHECK_JA[candidate.check]);
    const check = finding?.check ?? lintCheckFromError(errors[0]);
    return check ? LINT_CHECK_JA[check] : undefined;
}

export function japaneseLintWarningSummary(
    findings: readonly UiLintFinding[] = []
): string | undefined {
    const finding = findings.find(candidate => candidate.severity === 'warning' && candidate.check
        && LINT_WARNING_SUMMARY_CHECKS.includes(candidate.check));
    return finding?.check ? LINT_CHECK_JA[finding.check] : undefined;
}

/**
 * 辞書にある check は日本語要約 + 従来の英語詳細、未知 check は従来文言そのまま。
 */
export function formatLintFailureForUi(
    prefix: string,
    errors: readonly string[],
    findings: readonly UiLintFinding[] = []
): string {
    const detail = errors[0] ?? 'edit-lint error';
    const summary = japaneseLintSummary(errors, findings);
    return summary ? `${prefix}: ${summary} 詳細: ${detail}` : `${prefix}: ${detail}`;
}
