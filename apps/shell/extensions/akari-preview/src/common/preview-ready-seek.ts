/** Host ↔ current renderer acknowledgement. Retrying also covers iframe replacement during setHTML. */
let nextSeekRequest = 0;
export async function requestReadyPreviewSeek(transport: {
    pageId: () => string | undefined;
    disposed: () => boolean;
    send: (message: unknown) => unknown;
    onMessage: (listener: (message: any) => void) => { dispose(): void };
}, time: number, timeoutMs = 30000): Promise<void> {
    const requestId = ++nextSeekRequest;
    await new Promise<void>((resolve, reject) => {
        let finished = false;
        const finish = (error?: Error): void => {
            if (finished) return;
            finished = true;
            clearInterval(interval);
            clearTimeout(timeout);
            subscription.dispose();
            if (error) reject(error); else resolve();
        };
        const subscription = transport.onMessage(message => {
            if (message?.type === 'akari-preview-ready-seeked' && message.requestId === requestId
                && message.pageId === transport.pageId() && !transport.disposed()) finish();
        });
        const send = (): void => {
            if (transport.disposed()) { finish(new Error('出力プレビューが閉じられました。')); return; }
            const pageId = transport.pageId();
            if (!pageId) return;
            try {
                Promise.resolve(transport.send({ type: 'akari-preview-ready-seek', requestId, pageId, time }))
                    .catch(error => finish(error));
            } catch (error) { finish(error as Error); }
        };
        const interval = setInterval(send, 100);
        const timeout = setTimeout(() => finish(new Error('出力プレビューの再生準備が完了しませんでした。')), timeoutMs);
        send();
    });
}

/** Serialized into the renderer; keep this function self-contained. */
export function createReadySeekResponder(environment: {
    pageId: string;
    ready: () => boolean;
    pendingModel: () => Promise<unknown> | undefined;
    seek: (time: number) => void;
    reply: (message: unknown) => void;
}): (message: any) => Promise<void> {
    let completed: number | undefined;
    let pending: number | undefined;
    return async message => {
        if (message?.type !== 'akari-preview-ready-seek' || message.pageId !== environment.pageId
            || !Number.isFinite(message.time) || !Number.isInteger(message.requestId)) return;
        const acknowledge = (): void => environment.reply({
            type: 'akari-preview-ready-seeked', pageId: environment.pageId, requestId: message.requestId
        });
        if (completed === message.requestId) { acknowledge(); return; }
        if (!environment.ready() || pending !== undefined) return;
        pending = message.requestId;
        try {
            const model = environment.pendingModel();
            await model;
            if (!environment.ready() || model !== environment.pendingModel()) return;
            environment.seek(message.time);
            completed = message.requestId;
            acknowledge();
        } finally { pending = undefined; }
    };
}
