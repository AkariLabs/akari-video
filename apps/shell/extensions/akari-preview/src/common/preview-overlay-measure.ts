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

/** Runs inside the output webview; measure visible paint and fall back to fragmentBounds. */
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
        probe.getBoundingClientRect?.();
        let animations: Animation[] = [];
        try {
            if (typeof probe.getAnimations === 'function') animations = probe.getAnimations({ subtree: true });
        } catch { /* 古い webview では document 側から探す。 */ }
        if (!animations.length && typeof document.getAnimations === 'function') {
            animations = document.getAnimations().filter(animation => {
                const target = (animation.effect as KeyframeEffect | null)?.target;
                return target instanceof Node && probe.contains(target);
            });
        }
        for (const animation of animations) {
            try {
                animation.pause();
                const timing = animation.effect?.getComputedTiming();
                let end = Number(timing?.endTime);
                if (!Number.isFinite(end)) {
                    const delay = Number(timing?.delay);
                    const duration = Number(timing?.duration);
                    end = (Number.isFinite(delay) ? delay : 0) + (Number.isFinite(duration) ? duration : 0);
                }
                if (Number.isFinite(end)) animation.currentTime = end;
            } catch { /* 測定できる他の要素は続ける。 */ }
        }
        const visibleColor = (value: string): boolean => {
            const color = String(value ?? '').replace(/\s+/g, '').toLowerCase();
            return !!color && color !== 'transparent' && !/^#[0-9a-f]{3}0$|^#[0-9a-f]{6}00$/u.test(color)
                && !/(?:,|\/)0(?:\.0+)?\)$/u.test(color);
        };
        const visibleRect = (rect: DOMRect, element: Element): { left: number; top: number; right: number; bottom: number } | undefined => {
            let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
            if (![left, top, right, bottom].every(Number.isFinite)) return undefined;
            for (let ancestor = element.parentElement; ancestor && ancestor !== stage; ancestor = ancestor.parentElement) {
                const style = getComputedStyle(ancestor);
                const paintContain = /\b(?:paint|content|strict)\b/u.test(style.contain ?? '');
                const overflowX = style.overflowX || style.overflow;
                const overflowY = style.overflowY || style.overflow;
                if (!paintContain && !['hidden', 'clip', 'auto', 'scroll'].includes(overflowX)
                    && !['hidden', 'clip', 'auto', 'scroll'].includes(overflowY)) continue;
                const clip = ancestor.getBoundingClientRect();
                if (paintContain || ['hidden', 'clip', 'auto', 'scroll'].includes(overflowX)) {
                    left = Math.max(left, clip.left); right = Math.min(right, clip.right);
                }
                if (paintContain || ['hidden', 'clip', 'auto', 'scroll'].includes(overflowY)) {
                    top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
                }
                if (right <= left || bottom <= top) return undefined;
            }
            return right > left && bottom > top ? { left, top, right, bottom } : undefined;
        };
        const painted = (element: Element): boolean => {
            for (let ancestor: Element | null = element; ancestor && ancestor !== stage; ancestor = ancestor.parentElement) {
                const style = getComputedStyle(ancestor);
                if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
                    || Number(style.opacity) === 0) return false;
            }
            return true;
        };
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        const add = (rect: DOMRect, element: Element): void => {
            const clipped = visibleRect(rect, element);
            if (!clipped) return;
            left = Math.min(left, clipped.left); top = Math.min(top, clipped.top);
            right = Math.max(right, clipped.right); bottom = Math.max(bottom, clipped.bottom);
        };
        const ignored = new Set(['HEAD', 'LINK', 'META', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE', 'TITLE']);
        const replaced = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'PICTURE', 'IFRAME']);
        for (const element of Array.from(probe.querySelectorAll('*'))) {
            const tag = element.tagName.toUpperCase();
            if (ignored.has(tag) || !painted(element)) continue;
            const style = getComputedStyle(element);
            const border = ['Top', 'Right', 'Bottom', 'Left'].some(side =>
                Number.parseFloat(style[`border${side}Width` as keyof CSSStyleDeclaration] as string) > 0
                && style[`border${side}Style` as keyof CSSStyleDeclaration] !== 'none'
                && visibleColor(style[`border${side}Color` as keyof CSSStyleDeclaration] as string));
            let topSvg = tag === 'SVG';
            if (topSvg) for (let ancestor = element.parentElement; ancestor && ancestor !== probe; ancestor = ancestor.parentElement) {
                if (ancestor.tagName.toUpperCase() === 'SVG') { topSvg = false; break; }
            }
            const draws = visibleColor(style.backgroundColor) || (!!style.backgroundImage && style.backgroundImage !== 'none')
                || border || (replaced.has(tag) && (tag !== 'SVG' || topSvg));
            if (draws) add(element.getBoundingClientRect(), element);
            if (typeof document.createRange === 'function') for (const node of Array.from(element.childNodes)) {
                if (node.nodeType !== 3 || !node.textContent?.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                add(range.getBoundingClientRect(), element);
            }
        }
        const bounds = [left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top
            ? { left, top, right, bottom, width: right - left, height: bottom - top }
            : akari.interaction.fragmentBounds(probe);
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
