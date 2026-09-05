import {
    addCurvePoint, removeCurvePoint, moveCurvePoint, curvePathD,
    addHuePoint, removeHuePoint, moveHuePoint, huePathD,
    IDENTITY_CURVE_POINTS, DEFAULT_HUE_POINTS, INSPECTOR_CURVE_CHANNELS,
    INSPECTOR_HUE_CHANNELS, INSPECTOR_ADJUST_WHEELS, wheelRange, wheelXyToRgb, rgbToWheelDisplay
} from './adjust-editor-model';
import type { AdjustCurvePointV1, AdjustHuePointV1 } from './adjust-editor-model';
import type { InspectorAdjustSnapshot, InspectorAdjustPath, InspectorAdjustValue } from './adjust-fields';
import { createNumberField } from './number-field';

export type AdjustEditorWrite = (path: InspectorAdjustPath, value: InspectorAdjustValue) => Promise<{ ok: boolean; message?: string }>;
const SVG_NS = 'http://www.w3.org/2000/svg';

function element(tag: string, className: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

/** 保存失敗はエディタ内へ表示し、呼び出し元がドラフトを戻せるようにする。 */
function writer(root: HTMLElement, write: AdjustEditorWrite): AdjustEditorWrite {
    const notice = element('div', 'akari-adjust-editor-notice');
    notice.setAttribute('role', 'status');
    root.appendChild(notice);
    return async (path, value) => {
        try {
            const result = await write(path, value);
            notice.textContent = result.ok ? '' : result.message ?? '調整を保存できませんでした。';
            return result;
        } catch (error) {
            notice.textContent = error instanceof Error ? error.message : '調整を保存できませんでした。';
            return { ok: false, message: notice.textContent };
        }
    };
}

interface PointEditorOptions<T> {
    channels: readonly { key: string; label: string }[];
    read: (key: string) => T[];
    path: (key: string) => InspectorAdjustPath;
    defaults: readonly T[];
    xy: (point: T) => [number, number];
    point: (x: number, y: number) => T;
    add: (points: T[], point: T) => T[];
    remove: (points: T[], index: number) => T[];
    move: (points: T[], index: number, point: T) => T[];
    pathD: (points: T[], width: number, height: number) => string;
    hue?: boolean;
}

function buildPointEditor<T extends AdjustCurvePointV1 | AdjustHuePointV1>(options: PointEditorOptions<T>, write: AdjustEditorWrite): HTMLElement {
    const root = element('div', 'akari-adjust-editor');
    const chips = element('div', 'akari-adjust-preview-channels');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'akari-adjust-preview-curve akari-adjust-editor-curve');
    svg.setAttribute('viewBox', '0 0 180 140');
    // 座標変換を表示矩形と一致させる（狭いインスペクターでも余白を生じさせない）。
    svg.setAttribute('preserveAspectRatio', 'none');
    if (options.hue) svg.classList.add('akari-adjust-editor-hue');
    const grid = document.createElementNS(SVG_NS, 'path');
    grid.setAttribute('class', 'akari-adjust-preview-curve-grid');
    grid.setAttribute('d', 'M45 0V140 M90 0V140 M135 0V140 M0 35H180 M0 70H180 M0 105H180');
    const identity = document.createElementNS(SVG_NS, 'path');
    identity.setAttribute('class', 'akari-adjust-preview-curve-identity');
    identity.setAttribute('d', options.hue ? 'M0 70H180' : 'M0 140L180 0');
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('class', 'akari-adjust-editor-line');
    const handles = document.createElementNS(SVG_NS, 'g');
    svg.append(grid, identity, line, handles);
    root.append(chips, svg);
    const commit = writer(root, write);
    let active = options.channels[0].key;
    const values = new Map(options.channels.map(ch => [ch.key, options.read(ch.key)]));
    let points = values.get(active)!;
    let busy = false;
    let drag: { pointerId: number; index: number; before: T[]; target: SVGCircleElement } | undefined;
    const buttons: HTMLButtonElement[] = [];
    const paint = (): void => {
        line.setAttribute('d', options.pathD(points, 180, 140));
        svg.setAttribute('aria-label', `${options.channels.find(ch => ch.key === active)!.label} カーブエディタ`);
        points.forEach((p, i) => {
            const [x, y] = options.xy(p);
            handles.children[i].setAttribute('cx', String(x * 180));
            handles.children[i].setAttribute('cy', String((1 - y) * 140));
            handles.children[i].setAttribute('aria-label', `制御点 ${i + 1}: ${x.toFixed(3)}, ${y.toFixed(3)}（右クリックで削除）`);
        });
    };
    const save = async (next: T[] | null): Promise<void> => {
        if (busy) return;
        busy = true;
        const result = await commit(options.path(active), next as AdjustCurvePointV1[] | AdjustHuePointV1[] | null);
        if (result.ok) values.set(active, next ?? options.defaults.map(p => ({ ...p })));
        points = values.get(active)!;
        busy = false;
        rebuild();
    };
    const position = (event: MouseEvent): T => {
        const rect = svg.getBoundingClientRect();
        return options.point((event.clientX - rect.left) / rect.width, 1 - (event.clientY - rect.top) / rect.height);
    };
    const rebuild = (): void => {
        handles.replaceChildren();
        points.forEach((_, index) => {
            const handle = document.createElementNS(SVG_NS, 'circle');
            handle.setAttribute('r', '4');
            handle.setAttribute('class', 'akari-adjust-editor-point');
            handle.addEventListener('pointerdown', event => {
                if (busy || drag || event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                handle.setPointerCapture(event.pointerId);
                drag = { pointerId: event.pointerId, index, before: points, target: handle };
            });
            handle.addEventListener('dblclick', event => event.stopPropagation());
            handle.addEventListener('contextmenu', event => {
                event.preventDefault();
                if (busy || drag) return;
                const next = options.remove(points, index);
                if (next !== points) void save(next);
            });
            handles.appendChild(handle);
        });
        buttons.forEach((button, i) => {
            const selected = options.channels[i].key === active;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        const colors: Record<string, string> = { master: '#dddddd', r: '#ec8787', g: '#8bcd98', b: '#80a9e8', hue: '#e0c060', sat: '#60c0e0', luma: '#a0e0a0' };
        line.style.stroke = colors[active];
        paint();
    };
    options.channels.forEach(ch => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `akari-adjust-preview-channel akari-adjust-preview-channel-${ch.label.toLowerCase()}`;
        chip.textContent = ch.label;
        chip.title = 'ダブルクリックでチャンネルをリセット';
        chip.addEventListener('click', () => {
            if (busy || drag) return;
            active = ch.key;
            points = values.get(active)!;
            rebuild();
        });
        chip.addEventListener('dblclick', () => {
            if (!busy && !drag) void save(null);
        });
        buttons.push(chip);
        chips.appendChild(chip);
    });
    svg.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId || !(event.buttons & 1)) return;
        points = options.move(points, drag.index, position(event));
        paint();
    });
    svg.addEventListener('pointerup', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const changed = points !== drag.before;
        const target = drag.target;
        drag = undefined;
        if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
        if (changed) void save(points);
    });
    const cancel = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        points = drag.before;
        const target = drag.target;
        drag = undefined;
        if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
        paint();
    };
    svg.addEventListener('pointercancel', cancel);
    svg.addEventListener('lostpointercapture', cancel);
    svg.addEventListener('dblclick', event => {
        if (busy || drag) return;
        const next = options.add(points, position(event));
        if (next !== points) void save(next);
    });
    rebuild();
    return root;
}

export function buildRgbCurveEditor(snapshot: InspectorAdjustSnapshot, write: AdjustEditorWrite): HTMLElement {
    return buildPointEditor<AdjustCurvePointV1>({
        channels: INSPECTOR_CURVE_CHANNELS, defaults: IDENTITY_CURVE_POINTS,
        read: key => snapshot.curves[key as keyof typeof snapshot.curves],
        path: key => `adjust.curves.${key as keyof typeof snapshot.curves}`,
        xy: p => [p.in, p.out], point: (x, y) => ({ in: x, out: y }),
        add: addCurvePoint, remove: removeCurvePoint, move: moveCurvePoint, pathD: curvePathD
    }, write);
}

export function buildHueCurveEditor(snapshot: InspectorAdjustSnapshot, write: AdjustEditorWrite): HTMLElement {
    return buildPointEditor<AdjustHuePointV1>({
        channels: INSPECTOR_HUE_CHANNELS, defaults: DEFAULT_HUE_POINTS, hue: true,
        read: key => snapshot.hue[key as keyof typeof snapshot.hue],
        path: key => `adjust.hue.${key as keyof typeof snapshot.hue}`,
        xy: p => [p.hue, p.value], point: (x, y) => ({ hue: x, value: y }),
        add: addHuePoint, remove: removeHuePoint, move: moveHuePoint, pathD: huePathD
    }, write);
}

export function buildColorWheelEditor(snapshot: InspectorAdjustSnapshot, write: AdjustEditorWrite): HTMLElement {
    const root = element('div', 'akari-adjust-editor');
    const grid = element('div', 'akari-adjust-preview-wheel-grid');
    root.appendChild(grid);
    const commit = writer(root, write);
    for (const { key, label } of INSPECTOR_ADJUST_WHEELS) {
        const item = element('div', 'akari-adjust-preview-wheel-item');
        const heading = element('span', 'akari-adjust-preview-wheel-label');
        heading.textContent = label;
        const ring = element('div', 'akari-adjust-preview-wheel');
        ring.title = 'ドラッグで色シフト / ダブルクリックでリセット';
        ring.setAttribute('aria-label', `${label} カラーホイール`);
        const handle = element('span', 'akari-adjust-preview-wheel-center');
        ring.appendChild(handle);
        const luminance = element('div', 'akari-adjust-editor-luminance');
        item.append(heading, ring, luminance);
        grid.appendChild(item);
        const range = wheelRange(key);
        let rgb = { ...snapshot.wheels[key] };
        let busy = false;
        let drag: { id: number; before: typeof rgb; luma: number; moved: boolean } | undefined;
        const display = (): ReturnType<typeof rgbToWheelDisplay> => rgbToWheelDisplay(rgb.r, rgb.g, rgb.b, range);
        const paint = (): void => {
            const d = display();
            handle.style.left = `${d.xPct}%`;
            handle.style.top = `${d.yPct}%`;
        };
        const save = async (next: typeof rgb | null): Promise<boolean> => {
            if (busy) return false;
            busy = true;
            const result = await commit(`adjust.wheels.${key}`, next);
            if (result.ok) rgb = next ?? { r: 0, g: 0, b: 0 };
            busy = false;
            paint();
            renderLuma();
            return result.ok;
        };
        const changeLuma = (value: number): Promise<boolean> => {
            const delta = value - display().luma;
            const clamp = (v: number): number => Math.max(-range, Math.min(range, v + delta));
            return save({ r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) });
        };
        const renderLuma = (): void => {
            const field = createNumberField({
                name: `adjust-wheel-${key}-luma`, label: `${label} 輝度`, value: display().luma,
                step: range / 100, min: -range, max: range, displayScale: 100 / range,
                displayPrecision: 0, onCommit: changeLuma
            });
            field.querySelector('.akari-inspector-kf-controls')?.remove();
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.textContent = '↺';
            reset.title = `${label} 輝度のみリセット`;
            reset.addEventListener('click', () => void changeLuma(0));
            field.addEventListener('dblclick', () => void changeLuma(0));
            luminance.replaceChildren(field, reset);
        };
        const applyPointer = (event: PointerEvent): void => {
            const rect = ring.getBoundingClientRect();
            const dx = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
            const dy = -(event.clientY - rect.top - rect.height / 2) / (rect.height / 2);
            const [r, g, b] = wheelXyToRgb(dx, dy, range, drag!.luma);
            rgb = { r, g, b };
            paint();
        };
        ring.addEventListener('pointerdown', event => {
            if (busy || drag || event.button !== 0) return;
            event.preventDefault();
            drag = { id: event.pointerId, before: rgb, luma: display().luma, moved: false };
            ring.setPointerCapture(event.pointerId);
            applyPointer(event);
        });
        ring.addEventListener('pointermove', event => {
            if (drag && event.pointerId === drag.id && (event.buttons & 1)) {
                drag.moved = true;
                applyPointer(event);
            }
        });
        ring.addEventListener('pointerup', event => {
            if (!drag || event.pointerId !== drag.id) return;
            const next = rgb;
            const moved = drag.moved;
            rgb = drag.before;
            drag = undefined;
            if (ring.hasPointerCapture(event.pointerId)) ring.releasePointerCapture(event.pointerId);
            // クリックだけでは保存・再描画しない。後続の dblclick が同じ ring に届く。
            if (moved) void save(next);
            else paint();
        });
        const cancel = (event: PointerEvent): void => {
            if (!drag || event.pointerId !== drag.id) return;
            rgb = drag.before;
            drag = undefined;
            if (ring.hasPointerCapture(event.pointerId)) ring.releasePointerCapture(event.pointerId);
            paint();
        };
        ring.addEventListener('pointercancel', cancel);
        ring.addEventListener('lostpointercapture', cancel);
        ring.addEventListener('dblclick', () => { if (!busy && !drag) void save(null); });
        paint();
        renderLuma();
    }
    return root;
}
