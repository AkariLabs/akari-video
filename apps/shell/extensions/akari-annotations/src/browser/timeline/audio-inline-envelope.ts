import {
    INLINE_AUDIO_SHAPES, INLINE_FADE_HANDLE_TOP_PX, inlineAddPoint, inlineAudioExpanded, inlineFadeCurve, inlineFadeSeconds,
    inlineGainFromDrag, inlineGainY, inlineMovePoint, inlinePointGainAt, inlineTimeFrame,
    type AudioFadeShape, type InlineAudioPatch, type InlineAudioPoint
} from '../../common/audio-inline-envelope';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface AudioInlineEnvelopeOptions {
    readonly id: string;
    readonly durationSec: number;
    readonly widthPx: number;
    readonly heightPx: number;
    readonly fps: number;
    readonly fadeIn: number;
    readonly fadeOut: number;
    readonly fadeInShape?: AudioFadeShape;
    readonly fadeOutShape?: AudioFadeShape;
    readonly gainDb: number;
    readonly points: readonly InlineAudioPoint[];
    readonly locked: boolean;
    readonly commit: (label: string, patch: InlineAudioPatch) => Promise<unknown>;
    readonly onError: (message: string) => void;
    readonly selectPoint: (frame: number) => void;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
    return document.createElementNS(SVG_NS, name);
}

function readout(parent: HTMLElement, label: string, x: number, y: number): HTMLElement {
    let display = parent.querySelector<HTMLElement>('[data-akari-audio-inline-readout]');
    if (!display) {
        display = document.createElement('span');
        display.dataset.akariAudioInlineReadout = '';
        Object.assign(display.style, {
            position: 'absolute', zIndex: '18', padding: '2px 5px', borderRadius: '3px',
            background: 'var(--theia-editor-background)', color: 'var(--theia-editor-foreground)',
            border: '1px solid var(--theia-widget-border)', fontSize: '11px',
            pointerEvents: 'none', whiteSpace: 'nowrap'
        });
        parent.appendChild(display);
    }
    display.textContent = label;
    display.style.left = `${Math.max(0, x)}px`;
    display.style.top = `${Math.max(0, y)}px`;
    return display;
}

function dragOn(
    event: PointerEvent,
    update: (event: PointerEvent) => void, finish: (dragged: boolean) => void
): void {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;
    const move = (next: PointerEvent): void => {
        if (next.pointerId !== event.pointerId) return;
        next.preventDefault();
        if (Math.abs(next.clientX - startX) + Math.abs(next.clientY - startY) >= 3) dragged = true;
        if (dragged) update(next);
    };
    const end = (next: PointerEvent): void => {
        if (next.pointerId !== event.pointerId) return;
        next.preventDefault();
        next.stopPropagation();
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        finish(dragged);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
}

function stopEvent(event: Event): void { event.stopPropagation(); }

function shapeMenu(anchor: HTMLElement, shape: AudioFadeShape | undefined, choose: (shape: AudioFadeShape) => void): void {
    document.querySelector('[data-akari-audio-fade-menu]')?.remove();
    const menu = document.createElement('div');
    menu.dataset.akariAudioFadeMenu = '';
    const rect = anchor.getBoundingClientRect();
    Object.assign(menu.style, {
        position: 'fixed', left: `${rect.left}px`, top: `${rect.bottom + 3}px`, zIndex: '10000',
        minWidth: '112px', padding: '3px', borderRadius: '4px',
        background: 'var(--theia-editor-background)', color: 'var(--theia-editor-foreground)',
        border: '1px solid var(--theia-widget-border)', boxShadow: '0 3px 12px var(--theia-widget-shadow)'
    });
    for (const option of INLINE_AUDIO_SHAPES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitemradio');
        button.setAttribute('aria-checked', String((shape ?? 'linear') === option.value));
        button.dataset.akariFadeShape = option.value;
        button.textContent = `${(shape ?? 'linear') === option.value ? '✓ ' : '　'}${option.label}`;
        Object.assign(button.style, {
            display: 'block', width: '100%', textAlign: 'left', border: '0', padding: '5px 7px',
            background: 'var(--theia-editor-background)', color: 'var(--theia-editor-foreground)', cursor: 'pointer'
        });
        button.addEventListener('click', event => {
            event.stopPropagation();
            menu.remove();
            document.removeEventListener('pointerdown', dismiss, true);
            choose(option.value);
        });
        menu.appendChild(button);
    }
    const dismiss = (event: PointerEvent): void => {
        if (!menu.contains(event.target as Node)) menu.remove();
        document.removeEventListener('pointerdown', dismiss, true);
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.body.appendChild(menu);
}

export function mountAudioInlineEnvelope(clip: HTMLElement, options: AudioInlineEnvelopeOptions): void {
    clip.querySelector(':scope > [data-akari-audio-inline-envelope]')?.remove();
    const { widthPx: width, heightPx: height, durationSec: duration, fps } = options;
    if (!(duration > 0) || !(width > 0) || options.locked) return;
    const root = document.createElement('div');
    root.dataset.akariAudioInlineEnvelope = '';
    Object.assign(root.style, { position: 'absolute', inset: '0', zIndex: '7', pointerEvents: 'none' });
    clip.appendChild(root);
    const commit = (label: string, patch: InlineAudioPatch): void => {
        void options.commit(label, patch).catch(error => options.onError(
            error instanceof Error ? error.message : '音声の変更を保存できませんでした。'
        ));
    };
    const rectX = (clientX: number): number => clientX - clip.getBoundingClientRect().left;
    const durationFrames = Math.round(duration * fps);

    if (width >= 40) for (const edge of ['in', 'out'] as const) {
        const fade = Math.min(duration / 2, edge === 'in' ? options.fadeIn : options.fadeOut);
        const shape = edge === 'in' ? options.fadeInShape : options.fadeOutShape;
        const extent = Math.max(0, fade / duration * width);
        if (extent > 0) {
            const svg = svgElement('svg');
            svg.dataset.akariAudioFadeCurve = edge;
            svg.dataset.akariFadeShape = shape ?? 'linear';
            svg.setAttribute('viewBox', `0 0 ${Math.max(1, extent)} ${height}`);
            Object.assign(svg.style, {
                position: 'absolute', top: '0', left: edge === 'in' ? '0' : `${width - extent}px`,
                width: `${extent}px`, height: `${height}px`, pointerEvents: 'none', overflow: 'hidden'
            });
            const values = inlineFadeCurve(shape, edge);
            const pathData = values.map((value, index) =>
                `${index ? 'L' : 'M'}${index / 16 * extent} ${height - 6 - value * (height - 17)}`).join(' ');
            const shade = svgElement('path');
            shade.setAttribute('d', `${pathData} L${extent} ${height} L0 ${height} Z`);
            shade.setAttribute('fill', 'var(--theia-focusBorder)');
            shade.setAttribute('opacity', '0.12');
            const curve = svgElement('path');
            curve.setAttribute('d', pathData);
            curve.setAttribute('fill', 'none');
            curve.setAttribute('stroke', 'var(--theia-focusBorder)');
            curve.setAttribute('stroke-width', '1.5');
            svg.append(shade, curve);
            root.appendChild(svg);
        }
        const handle = document.createElement('span');
        handle.dataset.akariAudioFadeHandle = edge;
        handle.setAttribute('role', 'button');
        handle.setAttribute('aria-label', edge === 'in' ? 'フェードイン' : 'フェードアウト');
        const center = edge === 'in' ? Math.max(12, extent) : Math.min(width - 12, width - extent);
        Object.assign(handle.style, {
            position: 'absolute', left: `${center - 10}px`, top: `${INLINE_FADE_HANDLE_TOP_PX}px`, width: '20px', height: '20px',
            display: 'grid', placeItems: 'center', cursor: 'ew-resize', pointerEvents: 'auto', touchAction: 'none'
        });
        const dot = document.createElement('span');
        Object.assign(dot.style, {
            width: '10px', height: '10px', borderRadius: '50%',
            background: 'var(--theia-focusBorder)', border: '1px solid var(--theia-editor-background)'
        });
        handle.appendChild(dot);
        handle.addEventListener('dblclick', stopEvent);
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            let proposed = fade;
            dragOn(event, next => {
                proposed = inlineFadeSeconds(rectX(next.clientX), width, duration, edge, fps);
                handle.style.left = `${(edge === 'in' ? Math.max(12, proposed / duration * width)
                    : Math.min(width - 12, width - proposed / duration * width)) - 10}px`;
                readout(root, `${edge === 'in' ? 'フェードイン' : 'フェードアウト'} ${proposed.toFixed(2)} 秒`, center, 19);
            }, dragged => {
                root.querySelector('[data-akari-audio-inline-readout]')?.remove();
                if (dragged) commit('フェードを変更', { [edge === 'in' ? 'fade_in' : 'fade_out']: proposed });
                else shapeMenu(handle, shape, selected => commit('フェードの形を変更', {
                    [edge === 'in' ? 'fade_in_shape' : 'fade_out_shape']: selected
                }));
            });
        });
        root.appendChild(handle);
    }

    if (!inlineAudioExpanded(height)) return;
    const svg = svgElement('svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    Object.assign(svg.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none'
    });
    const path = svgElement('path');
    const sampleCount = Math.max(32, Math.min(256, Math.round(width / 3)));
    path.setAttribute('d', Array.from({ length: sampleCount + 1 }, (_, index) => {
        const x = index / sampleCount * width;
        return `${index ? 'L' : 'M'}${x} ${inlineGainY(options.gainDb + inlinePointGainAt(options.points,
            Math.round(index / sampleCount * durationFrames)), height)}`;
    }).join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'var(--theia-focusBorder)');
    path.setAttribute('stroke-width', '2');
    const hit = svgElement('path');
    hit.dataset.akariAudioGainLine = '';
    hit.setAttribute('d', path.getAttribute('d') ?? '');
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '16');
    Object.assign(hit.style, { pointerEvents: 'stroke', cursor: 'ns-resize' });
    hit.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const x = rectX(event.clientX);
        if (event.altKey) {
            event.preventDefault(); event.stopPropagation();
            const frame = inlineTimeFrame(x, width, duration, fps);
            const points = inlineAddPoint(options.points, frame, durationFrames,
                inlinePointGainAt(options.points, frame));
            if (points.length !== options.points.length) commit('音量キーフレームを追加', { keyframes: points });
            return;
        }
        const startY = event.clientY;
        let proposed = options.gainDb;
        dragOn(event, next => {
            const fine = next.metaKey || next.ctrlKey;
            proposed = inlineGainFromDrag(options.gainDb, next.clientY - startY, height, fine);
            readout(root, `${proposed >= 0 ? '+' : ''}${proposed.toFixed(fine ? 2 : 1)} dB`, x, inlineGainY(proposed, height) - 18);
        }, dragged => {
            root.querySelector('[data-akari-audio-inline-readout]')?.remove();
            if (dragged && proposed !== options.gainDb) commit('音量を変更', { gain_db: proposed });
        });
    });
    hit.addEventListener('dblclick', stopEvent);
    svg.append(path, hit);
    root.appendChild(svg);
    options.points.forEach((point, index) => {
        const marker = document.createElement('span');
        marker.dataset.akariAudioKfIndex = String(index);
        marker.tabIndex = 0;
        marker.setAttribute('role', 'button');
        marker.setAttribute('aria-label', `音量キーフレーム ${index + 1}`);
        const x = durationFrames > 0 ? point.t / durationFrames * width : 0;
        const y = inlineGainY(options.gainDb + point.gain_db, height);
        Object.assign(marker.style, {
            position: 'absolute', left: `${x - 7}px`, top: `${y - 7}px`,
            width: '14px', height: '14px', borderRadius: '50%',
            background: 'var(--theia-focusBorder)', border: '2px solid var(--theia-editor-background)',
            boxSizing: 'border-box', pointerEvents: 'auto', cursor: 'move', touchAction: 'none'
        });
        marker.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            const startY = event.clientY;
            let proposed = point;
            let fine = false;
            const startDigits = event.metaKey || event.ctrlKey
                || Math.abs(point.gain_db * 10 - Math.round(point.gain_db * 10)) > 1e-7 ? 2 : 1;
            readout(root, `${(point.t / fps).toFixed(2)} 秒  ${point.gain_db.toFixed(startDigits)} dB`,
                x, y - 22);
            dragOn(event, next => {
                const frame = inlineTimeFrame(rectX(next.clientX), width, duration, fps);
                fine = next.metaKey || next.ctrlKey;
                const deltaDb = inlineGainFromDrag(point.gain_db, next.clientY - startY, height, fine);
                proposed = inlineMovePoint(options.points, index, frame, deltaDb, durationFrames, fine)[index];
                marker.style.left = `${proposed.t / durationFrames * width - 7}px`;
                marker.style.top = `${inlineGainY(options.gainDb + proposed.gain_db, height) - 7}px`;
                readout(root, `${(proposed.t / fps).toFixed(2)} 秒  ${proposed.gain_db.toFixed(fine ? 2 : 1)} dB`,
                    proposed.t / durationFrames * width, inlineGainY(options.gainDb + proposed.gain_db, height) - 22);
            }, dragged => {
                root.querySelector('[data-akari-audio-inline-readout]')?.remove();
                if (dragged) commit('音量キーフレームを変更', {
                    keyframes: inlineMovePoint(options.points, index, proposed.t, proposed.gain_db, durationFrames, fine)
                });
                if (!dragged) marker.focus();
                options.selectPoint(dragged ? proposed.t : point.t);
            });
        });
        marker.addEventListener('dblclick', stopEvent);
        root.appendChild(marker);
    });
}
