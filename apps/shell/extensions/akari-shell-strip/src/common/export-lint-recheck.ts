/**
 * 書き出しダイアログの「lint で停止」画面を最新に保つための純関数群。
 *
 * 出自（2026-09-03 オーナー実機報告）: パートナーが edit.json を直したあとも
 * 書き出しエラー画面が開いた時点の検査結果を持ち続け、閉じて開き直しても
 * バックエンドが保持している lint-failed がそのまま出ていた
 * （akari-quick-export-service.ts の `status` は次の start まで書き換わらない）。
 * ここでは「いつ再検査を起こすか」「画面にどう出すか」だけを決め、
 * 実行そのものは session service（フロント）と quick export service（node）が持つ。
 */

/** 再検査の引き金になる編集ドキュメント（edit-lint の入力）。 */
export const LINT_RECHECK_WATCHED_FILES: readonly string[] = ['edit.json', 'captions.json'];

/** ファイル変更 1 件が自動再検査に値するか。パスは絶対 / 相対・OS 区切りのどちらでもよい。 */
export function shouldRecheckLintForPath(path: string): boolean {
    const base = path.split(/[\\/]+/u).filter(segment => segment.length > 0).pop();
    return base !== undefined && LINT_RECHECK_WATCHED_FILES.includes(base);
}

/**
 * 自動再検査を仕掛けてよい状態か。ダイアログを閉じている間は仕掛けない
 * （編集のたびに edit-lint を余分に 1 本起こさないため。保存経路側の
 * 保存後 lint（packages/edit-store の write-gate）とは別物であることに注意）。
 */
export function shouldWatchForLintRecheck(phase: string | undefined, dialogVisible: boolean): boolean {
    return dialogVisible && phase === 'lint-failed';
}

/** 「直近の検査」表示。時刻は実行環境のローカル時刻（HH:MM:SS）。 */
export function formatLintCheckedAt(checkedAt: number | undefined, now: Date = new Date()): string {
    if (checkedAt === undefined || !Number.isFinite(checkedAt)) {
        return '未検査';
    }
    const checked = new Date(checkedAt);
    if (Number.isNaN(checked.getTime()) || checked.getTime() > now.getTime() + 60_000) {
        return '未検査';
    }
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(checked.getHours())}:${pad(checked.getMinutes())}:${pad(checked.getSeconds())}`;
}

/** lint 停止画面のフッター 1 行（検査中 / 直近の検査時刻 / 自動再検査の説明）。 */
export function lintRecheckHint(state: {
    readonly rechecking: boolean;
    readonly checkedAt?: number;
}, now: Date = new Date()): string {
    if (state.rechecking) {
        return 'いま検査し直しています…';
    }
    if (state.checkedAt === undefined) {
        return '編集を保存すると自動でもう一度検査します。';
    }
    return `編集を保存すると自動でもう一度検査します（直近の検査 ${formatLintCheckedAt(state.checkedAt, now)}）。`;
}
