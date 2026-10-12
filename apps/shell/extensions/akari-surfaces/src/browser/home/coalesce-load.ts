/**
 * 重い読み込みを重ねて走らせない。走っている間に来た依頼は、終わったあとの 1 回にまとめる。
 * 呼んだ側の await は「依頼より後に始まった読み込み」が終わるまで待つので、古い結果で進むことはない。
 */
export function coalesceLoads(run: () => Promise<void>): () => Promise<void> {
    let running: Promise<void> | undefined;
    let again: Promise<void> | undefined;
    const start = (): Promise<void> => {
        if (!running) {
            running = run().finally(() => { running = undefined; });
            return running;
        }
        if (!again) {
            again = running.catch(() => undefined).then(() => {
                again = undefined;
                return start();
            });
        }
        return again;
    };
    return start;
}
