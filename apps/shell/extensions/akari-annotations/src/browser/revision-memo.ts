// リビジョン番号つきメモ（task/2026-09-02-preview-perf）。
//
// タイムラインの contentEndDuration() は cuts / overlays / layers / audio / captions を全走査する
// O(items) の集計で、ズーム 1 イベントあたり totalDuration() 経由で 8 回前後呼ばれていた。
// 集計結果は編集モデル・字幕・実尺キャッシュが変わらない限り不変なので、呼び出し側が
// 「モデルが変わったら進める」リビジョン番号を渡し、同じ番号のあいだは計算済みの値を返す。
//
// compute() が例外を投げた場合は何もキャッシュしない（次回また計算する）。

export interface RevisionMemo<T> {
    /** Return the value computed for `revision`, recomputing only when the revision changed. */
    read(revision: number): T;
}

export function createRevisionMemo<T>(compute: () => T): RevisionMemo<T> {
    let cachedRevision: number | undefined;
    let cachedValue: T | undefined;
    return {
        read(revision: number): T {
            if (cachedRevision === revision) {
                return cachedValue as T;
            }
            const value = compute();
            cachedRevision = revision;
            cachedValue = value;
            return value;
        }
    };
}
