export interface MeasuredOverlayBox { x: number; y: number; width: number; height: number }

export function unscaleOverlayBox(output: { width: number; height: number },
    measured: MeasuredOverlayBox, scale: number): MeasuredOverlayBox | undefined {
    if (![output.width, output.height, measured.x, measured.y, measured.width, measured.height, scale].every(Number.isFinite)
        || !(output.width > 0) || !(output.height > 0) || !(measured.width > 0) || !(measured.height > 0)
        || !(scale > 0)) return undefined;
    return { x: output.width / 2 + (measured.x - output.width / 2) / scale,
        y: output.height / 2 + (measured.y - output.height / 2) / scale,
        width: measured.width / scale, height: measured.height / scale };
}

/** A self-contained webview listener; each request receives a reply even when measurement throws. */
export function installOverlayBoxRequestListener(
    win: Window,
    doc: Document,
    measure: (stage: HTMLElement | null, html: string, vars: Record<string, string | number | boolean>,
        output: { width: number; height: number }) => Promise<MeasuredOverlayBox | undefined>,
    reply: (value: { type: string; requestId: string; box?: MeasuredOverlayBox }) => void
): void {
    const pending = new Set<string>();
    win.addEventListener('message', event => {
        const request = (event as MessageEvent).data;
        if (request?.type !== 'akari-preview-overlay-box-request') return;
        const requestId = String(request.requestId ?? '');
        if (pending.has(requestId)) return;
        pending.add(requestId);
        const respond = (box?: MeasuredOverlayBox): void => {
            pending.delete(requestId);
            reply({ type: 'akari-preview-overlay-box', requestId, ...(box ? { box } : {}) });
        };
        try {
            const stage = doc.getElementById('overlay-stage');
            const current = (win as typeof win & { akari?: { state?: { summary?: { output?: {
                width?: number; height?: number } } } } }).akari?.state?.summary?.output;
            const output = current && current.width! > 0 && current.height! > 0
                ? { width: current.width!, height: current.height! }
                : { width: stage?.offsetWidth ?? 0, height: stage?.offsetHeight ?? 0 };
            Promise.resolve(measure(stage, request.fragment, request.vars ?? {}, output))
                .then(respond, () => respond());
        } catch { respond(); }
    });
}

/** Runs inside the output webview, with the same stage and fragmentBounds used by selection. */
export async function measureOverlayBoxInStage(stage: HTMLElement, html: string,
    vars: Record<string, string | number | boolean>, output: { width: number; height: number }):
    Promise<MeasuredOverlayBox | undefined> {
    const akari = (window as typeof window & { akari?: {
        interaction?: { fragmentBounds: (container: HTMLElement) => DOMRect | undefined };
        viewportUnits?: { applyAll: (container: HTMLElement) => void }
    } }).akari;
    if (!stage || !akari?.interaction?.fragmentBounds || !html
        || !(output.width > 0) || !(output.height > 0)) return undefined;
    const probeScale = 0.25;
    const probe = document.createElement('div');
    probe.setAttribute('data-overlay-id', 'akari-measure-overlay');
    Object.assign(probe.style, { position: 'absolute', inset: '0', pointerEvents: 'none', opacity: '0.001',
        transformOrigin: 'center', transform: `translate(0px, 0px) rotate(0deg) scale(${probeScale})` });
    for (const [name, value] of Object.entries(vars ?? {})) {
        if (name.startsWith('--')) probe.style.setProperty(name, String(value));
    }
    probe.style.setProperty('--scale', String(probeScale));
    const template = document.createElement('template');
    template.innerHTML = html;
    probe.appendChild(template.content.cloneNode(true));
    stage.appendChild(probe);
    try {
        akari.viewportUnits?.applyAll(probe);
        let timeout: number | undefined;
        const images = Array.from(probe.querySelectorAll('img'));
        await Promise.race([Promise.all([document.fonts.ready,
            ...images.map(image => image.decode().catch(() => undefined))]), new Promise(resolve => {
            timeout = window.setTimeout(resolve, 2000);
        })]);
        if (timeout !== undefined) window.clearTimeout(timeout);
        const bounds = akari.interaction.fragmentBounds(probe);
        const stageRect = stage.getBoundingClientRect();
        if (!bounds || !(stageRect.width > 0) || !(stageRect.height > 0)) return undefined;
        const box = { x: (bounds.left - stageRect.left) * output.width / stageRect.width,
            y: (bounds.top - stageRect.top) * output.height / stageRect.height,
            width: bounds.width * output.width / stageRect.width,
            height: bounds.height * output.height / stageRect.height };
        if (![box.x, box.y, box.width, box.height].every(Number.isFinite)
            || !(box.width > 0) || !(box.height > 0)) return undefined;
        return { x: output.width / 2 + (box.x - output.width / 2) / probeScale,
            y: output.height / 2 + (box.y - output.height / 2) / probeScale,
            width: box.width / probeScale, height: box.height / probeScale };
    } finally { probe.remove(); }
}
