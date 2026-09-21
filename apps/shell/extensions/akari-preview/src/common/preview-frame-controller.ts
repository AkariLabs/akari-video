/** Serialized into the preview. Keep self-contained; no preferences or generation overlay state are changed. */
export function installPreviewFrameCapture(environment: {
    pageId: string;
    send: (message: unknown) => void;
    freeze: () => { time: number; ready?: Promise<unknown>; resume: () => void };
}): void {
    const button = document.getElementById('akari-gen-capture-frame') as HTMLButtonElement;
    if (!button) return;
    let active: { id: string; time: number; ready?: Promise<unknown>; resume: () => void; timer: ReturnType<typeof setTimeout> } | undefined;
    let sequence = 0;
    let preparing = false;
    const restore = (): void => {
        document.documentElement.classList.remove('akari-gen-capturing', 'akari-gen-capture-fit');
        if (!active) return;
        const saved = active;
        active = undefined;
        preparing = false;
        clearTimeout(saved.timer);
        button.disabled = false;
        saved.resume();
        environment.send({ type: 'akari-preview-capture-restored', requestId: saved.id, pageId: environment.pageId });
    };
    button.addEventListener('click', () => {
        if (active) return;
        const frozen = environment.freeze();
        // Host preparation may arrive on a later task; attach rejection handling immediately.
        void frozen.ready?.catch(() => undefined);
        const id = environment.pageId + ':capture:' + (++sequence);
        active = { id, ...frozen, timer: setTimeout(restore, 10000) };
        button.disabled = true;
        environment.send({ type: 'akari-preview-capture-frame', requestId: id, pageId: environment.pageId });
    });
    window.addEventListener('pagehide', restore);
    window.addEventListener('message', async event => {
        const message = event.data;
        if (!active || message?.requestId !== active.id || message.pageId !== environment.pageId) return;
        if (message.type === 'akari-preview-capture-restore') { restore(); return; }
        if (message.type !== 'akari-preview-capture-prepare' || preparing) return;
        preparing = true;
        const saved = active;
        try {
            await saved.ready;
            if (active !== saved) return;
            // ready drains the engine render promise and updates DOM captions, but the preview's
            // WebGL compositor uses gl.flush(), not a browser presentation fence. DOM layout reads
            // alone cannot make those separate surfaces appear in the same captured frame.
            // Two rAF callbacks leave a paint/composite opportunity between them. Keep both BEFORE
            // the capture classes: the existing editor view stays visible throughout this wait.
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            if (active !== saved) return;
            const stage = document.getElementById('preview-stage');
            const pane = document.getElementById('preview-wrapper');
            const before = stage.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
            const fit = before.left < bounds.left || before.top < bounds.top || before.right > bounds.right || before.bottom > bounds.bottom;
            // Finish readiness, fit decision and iframe reads before the visible capture interval.
            // The fit override changes only a transform, not the canvas content-box dimensions.
            // The inner frame and outer webview have the same origin. Host cannot read either's DOM.
            const frame = window.frameElement as HTMLIFrameElement;
            if (!frame || window.parent === window.top) throw new Error('Theia inner preview frame is unavailable');
            const frameBox = frame.getBoundingClientRect();
            const scaleX = frameBox.width / frame.offsetWidth, scaleY = frameBox.height / frame.offsetHeight;
            document.documentElement.classList.add('akari-gen-capturing', ...(fit ? ['akari-gen-capture-fit'] : []));
            // Flush the new style/layout synchronously, then request capture in this same task.
            // capturePage requests the next compositor frame; an extra rAF here only extends flicker.
            // Measure AFTER fit so a pre-fit rectangle can never crop the wrong area.
            const box = stage.getBoundingClientRect();
            const x = frameBox.x + (frame.clientLeft + box.x) * scaleX;
            const y = frameBox.y + (frame.clientTop + box.y) * scaleY;
            const width = box.width * scaleX, height = box.height * scaleY;
            if (!(width > 0 && height > 0) || box.x < 0 || box.y < 0
                || box.right > window.innerWidth || box.bottom > window.innerHeight
                || x < 0 || y < 0 || x + width > window.parent.innerWidth || y + height > window.parent.innerHeight) {
                throw new Error('プレビュー全体を表示してから保存してください');
            }
            environment.send({ type: 'akari-preview-capture-ready', requestId: saved.id, pageId: environment.pageId,
                time: saved.time, rect: { x, y, width, height },
                viewport: { width: window.parent.innerWidth, height: window.parent.innerHeight } });
        } catch (error) {
            if (active !== saved) return;
            environment.send({ type: 'akari-preview-capture-ready', requestId: saved.id, pageId: environment.pageId, error: String(error) });
            restore();
        }
    });
}
