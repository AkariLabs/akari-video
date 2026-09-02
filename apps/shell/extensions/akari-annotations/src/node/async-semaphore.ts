// 非同期セマフォ（task/2026-09-02-preview-perf）。
//
// media-cache の ffmpeg 起動は無制限だった。タイムラインをズームアウトすると可視ソース時間が
// 一気に増え、フィルムストリップのチャンク要求が数十本まとめて届いて ffmpeg が同時に数十本
// spawn される。プレビューの素材配信も同じ Node バックエンドプロセスが担うため、これが
// 「ズームするとプレビューまでカクつく」の実体（CPU とプロセス数の両方）。
//
// run(task) は同時実行数が limit 未満のときだけ task を開始し、それ以外は FIFO で待たせる。
// task の成否にかかわらず終了時に枠を返す。setLimit() は次の空き判定から効く
// （すでに走っているものは止めない）。

export interface AsyncSemaphore {
    run<T>(task: () => Promise<T>): Promise<T>;
    setLimit(limit: number): void;
    readonly limit: number;
    readonly active: number;
    readonly waiting: number;
}

export function createAsyncSemaphore(initialLimit: number): AsyncSemaphore {
    let limit = normalizeLimit(initialLimit);
    let active = 0;
    const queue: Array<() => void> = [];

    const pump = (): void => {
        while (active < limit && queue.length > 0) {
            active++;
            queue.shift()!();
        }
    };
    const release = (): void => {
        active--;
        pump();
    };

    return {
        run<T>(task: () => Promise<T>): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                queue.push(() => {
                    Promise.resolve().then(task).then(
                        value => { release(); resolve(value); },
                        error => { release(); reject(error); }
                    );
                });
                pump();
            });
        },
        setLimit(next: number): void {
            limit = normalizeLimit(next);
            pump();
        },
        get limit(): number { return limit; },
        get active(): number { return active; },
        get waiting(): number { return queue.length; }
    };
}

function normalizeLimit(value: number): number {
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}
