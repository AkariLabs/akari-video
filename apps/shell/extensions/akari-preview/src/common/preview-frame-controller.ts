import type { PreviewFrameColor, PreviewFrameExpectations } from './preview-frame-check';

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
    let retryFrame = false;
    let preparation = 0;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const restore = (keepFrozen = false, success = false): void => {
        document.documentElement.classList.remove('akari-gen-capturing', 'akari-gen-capture-fit');
        if (!active) return;
        const saved = active;
        preparation++;
        preparing = false;
        if (keepFrozen) {
            retryFrame = true;
            environment.send({ type: 'akari-preview-capture-restored', requestId: saved.id, pageId: environment.pageId });
            return;
        }
        active = undefined;
        retryFrame = false;
        clearTimeout(saved.timer);
        button.disabled = false;
        saved.resume();
        if (success) {
            button.classList.add('akari-gen-capture-flash');
            clearTimeout(flashTimer);
            flashTimer = setTimeout(() => button.classList.remove('akari-gen-capture-flash'), 300);
        }
        environment.send({ type: 'akari-preview-capture-restored', requestId: saved.id, pageId: environment.pageId });
    };
    button.addEventListener('click', () => {
        if (active) return;
        const frozen = environment.freeze();
        // Host preparation may arrive on a later task; attach rejection handling immediately.
        void frozen.ready?.catch(() => undefined);
        const id = environment.pageId + ':capture:' + (++sequence);
        active = { id, ...frozen, timer: setTimeout(() => restore(), 30000) };
        button.disabled = true;
        environment.send({ type: 'akari-preview-capture-frame', requestId: id, pageId: environment.pageId });
    });
    window.addEventListener('pagehide', () => restore());
    window.addEventListener('message', async event => {
        const message = event.data;
        if (!active || message?.requestId !== active.id || message.pageId !== environment.pageId) return;
        if (message.type === 'akari-preview-capture-restore') { restore(message.keepFrozen === true, message.success === true); return; }
        if (message.type !== 'akari-preview-capture-prepare' || preparing) return;
        preparing = true;
        const saved = active;
        const token = ++preparation;
        const current = (): boolean => active === saved && token === preparation;
        try {
            await saved.ready;
            if (!current()) return;
            // A failed inspection restores chrome first, then leaves one paint before preparing again.
            if (retryFrame) { await nextFrame(); retryFrame = false; }
            if (!current()) return;
            const stage = document.getElementById('preview-stage');
            const pane = document.getElementById('preview-wrapper');
            const before = stage.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
            const fit = before.left < bounds.left || before.top < bounds.top || before.right > bounds.right || before.bottom > bounds.bottom;
            const color = (value: string, minimumAlpha = 0): PreviewFrameColor | undefined => {
                const parts = value.match(/[\d.]+/g)?.map(Number);
                if (!value.startsWith('rgb') || !parts || parts.length < 3
                    || (parts[3] ?? 1) <= 0 || (parts[3] ?? 1) < minimumAlpha) return;
                return [parts[0], parts[1], parts[2]];
            };
            const visible = (element: Element, stageBox: DOMRect): boolean => {
                const rect = element.getBoundingClientRect();
                if (!(rect.width > 0 && rect.height > 0) || rect.right <= stageBox.left || rect.left >= stageBox.right
                    || rect.bottom <= stageBox.top || rect.top >= stageBox.bottom) return false;
                for (let node: Element | null = element; node; node = node.parentElement) {
                    const style = getComputedStyle(node);
                    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0) return false;
                }
                return true;
            };
            // Read colors/visibility before capture CSS suppresses them. Keep element references so fit
            // can remeasure the actual screen-sized badges rather than scaling their old rectangles.
            const hiddenSelector = '[id^="akari-gen-"], [data-akari-interaction], #layer-select-box, #cut-select-box, '
                + '#caption-select-box, #layer-crop-box, .akari-caption-handle-box, .akari-caption-handle, '
                + '[data-akari-handle], [data-akari-crop-handle], [data-akari-crop-edge], '
                + '#preview-stage > :not(#preview-layers):not(#frame-engine-preview), '
                + '#frame-engine-preview > :not(#frame-engine-canvas), #indicator-toggle, #indicator-popup, '
                + '#zoom-minimap, #reload-surface, #audio-notice, #write-error-banner';
            const outlineSelector = '#caption-plate:is([data-selected], [data-alt-all]), '
                + '#caption-plate:is([data-selected], [data-alt-all]) .akari-caption__plate, '
                + '[data-akari-interaction-selected], [data-akari-interaction-editing="true"], [data-akari-caption-editing="true"]';
            const chrome: { element: HTMLElement; color?: PreviewFrameColor; kind: 'fill' | 'edge'; width: number; offset: number }[] = [];
            for (const element of Array.from(document.querySelectorAll<HTMLElement>(hiddenSelector + ', ' + outlineSelector))) {
                if (element === button || !visible(element, before)) continue;
                const style = getComputedStyle(element);
                if (element.matches(hiddenSelector)) {
                    // Translucent fills blend with footage: retain only blue detection for their region.
                    if (color(style.backgroundColor)) chrome.push({ element, color: color(style.backgroundColor, 0.95), kind: 'fill', width: 0, offset: 0 });
                    const border = color(style.borderTopColor, 0.5), width = parseFloat(style.borderTopWidth);
                    if (border && width > 0 && !['none', 'hidden'].includes(style.borderTopStyle)) {
                        chrome.push({ element, color: border, kind: 'edge', width, offset: -width });
                    }
                }
                const outline = color(style.outlineColor, 0.5), width = parseFloat(style.outlineWidth);
                if (outline && width > 0 && !['none', 'hidden'].includes(style.outlineStyle)) {
                    chrome.push({ element, color: outline, kind: 'edge', width, offset: parseFloat(style.outlineOffset) || 0 });
                }
            }
            const frame = window.frameElement as HTMLIFrameElement;
            if (!frame || window.parent === window.top) throw new Error('Theia inner preview frame is unavailable');
            document.documentElement.classList.add('akari-gen-capturing', ...(fit ? ['akari-gen-capture-fit'] : []));
            // Leave a paint/composite opportunity AFTER the capture style is applied. Fit may have a
            // transition: wait for two consecutive stable frame rectangles, bounded at 15 frames.
            let box = stage.getBoundingClientRect();
            let stable = 0;
            for (let index = 0; index < (fit ? 15 : 2); index++) {
                await nextFrame();
                if (!current()) return;
                const measured = stage.getBoundingClientRect();
                stable = ['x', 'y', 'width', 'height'].every(key => measured[key as keyof DOMRect] === box[key as keyof DOMRect]) ? stable + 1 : 0;
                box = measured;
                if (index >= 1 && (!fit || stable >= 2)) break;
            }
            const normalize = (rect: { left: number; top: number; right: number; bottom: number }): { x: number; y: number; width: number; height: number } => {
                const x = Math.max(0, Math.min(1, (rect.left - box.left) / box.width));
                const y = Math.max(0, Math.min(1, (rect.top - box.top) / box.height));
                return { x, y, width: Math.max(0, Math.min(1, (rect.right - box.left) / box.width) - x),
                    height: Math.max(0, Math.min(1, (rect.bottom - box.top) / box.height) - y) };
            };
            const expectations: PreviewFrameExpectations = { captions: [], chrome: [] };
            const plate = document.getElementById('caption-plate');
            const lines = plate ? Array.from(plate.querySelectorAll<HTMLElement>('.akari-caption__line')) : [];
            if (plate && !lines.length && plate.textContent?.trim()) lines.push(plate);
            for (const line of lines) {
                if (!line.textContent?.trim() || !visible(line, box)) continue;
                const textColor = color(getComputedStyle(line).color);
                if (textColor) expectations.captions.push({ rect: normalize(line.getBoundingClientRect()), color: textColor });
            }
            for (const entry of chrome) {
                const rect = entry.element.getBoundingClientRect();
                const sx = rect.width / (entry.element.offsetWidth || rect.width);
                const sy = rect.height / (entry.element.offsetHeight || rect.height);
                const outset = entry.kind === 'edge' ? entry.offset + entry.width : 0;
                const normalized = normalize({ left: rect.left - outset * sx, top: rect.top - outset * sy,
                    right: rect.right + outset * sx, bottom: rect.bottom + outset * sy });
                if (normalized.width > 0 && normalized.height > 0) expectations.chrome.push({ rect: normalized,
                    colors: entry.color ? [entry.color] : [], kind: entry.kind,
                    band: entry.kind === 'edge' ? { x: entry.width * sx / box.width, y: entry.width * sy / box.height } : undefined });
            }
            const frameBox = frame.getBoundingClientRect();
            const scaleX = frameBox.width / frame.offsetWidth, scaleY = frameBox.height / frame.offsetHeight;
            const x = frameBox.x + (frame.clientLeft + box.x) * scaleX;
            const y = frameBox.y + (frame.clientTop + box.y) * scaleY;
            const width = box.width * scaleX, height = box.height * scaleY;
            if (!(width > 0 && height > 0) || box.x < 0 || box.y < 0
                || box.right > window.innerWidth || box.bottom > window.innerHeight
                || x < 0 || y < 0 || x + width > window.parent.innerWidth || y + height > window.parent.innerHeight) {
                throw new Error('プレビュー全体を表示してから保存してください');
            }
            // visibility:hidden preserves transport layout, so measure the same button AFTER capture CSS.
            const playBox = document.getElementById('play-toggle')?.getBoundingClientRect();
            const sentinel = playBox && playBox.width > 0 && playBox.height > 0 && playBox.x >= 0 && playBox.y >= 0
                && playBox.right <= window.innerWidth && playBox.bottom <= window.innerHeight
                ? { x: frameBox.x + (frame.clientLeft + playBox.x) * scaleX,
                    y: frameBox.y + (frame.clientTop + playBox.y) * scaleY,
                    width: playBox.width * scaleX, height: playBox.height * scaleY } : undefined;
            environment.send({ type: 'akari-preview-capture-ready', requestId: saved.id, pageId: environment.pageId,
                time: saved.time, expectations, sentinel, rect: { x, y, width, height },
                viewport: { width: window.parent.innerWidth, height: window.parent.innerHeight } });
        } catch (error) {
            if (!current()) return;
            environment.send({ type: 'akari-preview-capture-ready', requestId: saved.id, pageId: environment.pageId, error: String(error) });
            restore();
        }
    });
}
