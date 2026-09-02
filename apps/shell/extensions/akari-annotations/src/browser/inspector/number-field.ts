export interface NumberFieldOptions {
    name: string;
    label: string;
    value: number;
    step: number;
    min?: number;
    max?: number;
    unit?: string;
    displayScale?: number;
    onPreview?: (value: number) => void;
    onCommit: (value: number) => Promise<boolean>;
    keyframe?: KeyframeSeatOptions;
}

export interface KeyframeSeatOptions {
    active: boolean;
    hasKeyframes: boolean;
    onToggle: () => void;
    onPrevious: () => void;
    onNext: () => void;
    onReveal: () => void;
}

export const INSPECTOR_LIVE_PREVIEW_THROTTLE_MS = 30;

export function clampNumber(value: number, min?: number, max?: number): number {
    return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

export function numericStep(
    value: number,
    direction: -1 | 1,
    step: number,
    shiftKey = false,
    min?: number,
    max?: number
): number {
    return clampNumber(value + direction * step * (shiftKey ? 10 : 1), min, max);
}

export function formatNumberStep(value: number, step: number): string {
    const fraction = String(step).split('.')[1];
    const precision = Math.min(fraction?.length ?? 0, 6);
    return String(Number(value.toFixed(precision)));
}

export function createKeyframeSeat(name: string, options?: KeyframeSeatOptions): HTMLElement {
    const group = document.createElement('span');
    group.className = 'akari-inspector-kf-controls';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = '‹';
    previous.title = '前のキーフレームへ';
    previous.setAttribute('aria-label', '前のキーフレームへ');
    previous.addEventListener('click', () => options?.onPrevious());
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'akari-inspector-kf-seat';
    button.title = options?.active ? '現在時刻のキーフレームを消す' : '現在時刻にキーフレームを打つ';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('data-akari-ui', `inspector-kf-seat:${name}`);
    button.textContent = options?.active ? '◆' : '◇';
    button.addEventListener('click', () => options?.onToggle());
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = '›';
    next.title = '次のキーフレームへ';
    next.setAttribute('aria-label', '次のキーフレームへ');
    next.addEventListener('click', () => options?.onNext());
    group.append(previous, button, next);
    if (options?.onReveal) {
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.textContent = '⤢';
        reveal.disabled = !options.hasKeyframes;
        reveal.title = options.hasKeyframes
            ? 'タイムラインのキーフレーム行を開く'
            : 'キーフレームがありません';
        reveal.setAttribute('aria-label', reveal.title);
        reveal.setAttribute('data-akari-ui', `inspector-kf-jump:${name}`);
        reveal.addEventListener('click', () => {
            if (!reveal.disabled) options.onReveal();
        });
        group.appendChild(reveal);
    }
    return group;
}

export function createNumberField(options: NumberFieldOptions): HTMLElement {
    const displayScale = options.displayScale ?? 1;
    const toDisplay = (value: number): number => value * displayScale;
    const fromDisplay = (value: number): number => value / displayScale;
    const displayValue = toDisplay(options.value);
    const displayStep = toDisplay(options.step);
    const displayMin = options.min === undefined ? undefined : toDisplay(options.min);
    const displayMax = options.max === undefined ? undefined : toDisplay(options.max);

    const container = document.createElement('div');
    container.className = 'akari-inspector-number-field';
    container.setAttribute('data-akari-ui', `field:inspector-${options.name}`);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'akari-inspector-number-handle';
    handle.title = '左右へドラッグして調整';
    handle.setAttribute('aria-label', `${options.label}をドラッグして調整`);
    handle.textContent = '↔';

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'akari-inspector-number-input';
    input.value = formatNumberStep(displayValue, displayStep);
    input.setAttribute('role', 'spinbutton');
    input.setAttribute('aria-label', options.label);
    if (displayMin !== undefined) input.setAttribute('aria-valuemin', String(displayMin));
    if (displayMax !== undefined) input.setAttribute('aria-valuemax', String(displayMax));

    const unit = document.createElement('span');
    unit.className = 'akari-inspector-number-unit';
    unit.textContent = options.unit ?? '';

    const restore = (): void => {
        input.value = formatNumberStep(displayValue, displayStep);
        options.onPreview?.(options.value);
    };
    const buttons = document.createElement('span');
    buttons.className = 'akari-inspector-number-steps';
    const up = document.createElement('button');
    const down = document.createElement('button');
    for (const [button, direction, label] of [[up, 1, '増やす'], [down, -1, '減らす']] as const) {
        button.type = 'button';
        button.textContent = direction > 0 ? '▲' : '▼';
        button.setAttribute('aria-label', `${options.label}を${label}`);
        button.addEventListener('click', event => {
            const current = Number(input.value);
            if (!Number.isFinite(current)) return;
            const displayNext = numericStep(
                current, direction, displayStep, event.shiftKey, displayMin, displayMax
            );
            const next = fromDisplay(displayNext);
            input.value = formatNumberStep(displayNext, displayStep);
            options.onPreview?.(next);
            void options.onCommit(next).then(ok => {
                if (!ok) restore();
            });
        });
    }
    buttons.append(up, down);

    const commitInput = async (): Promise<void> => {
        const parsed = Number(input.value);
        if (!Number.isFinite(parsed)) {
            restore();
            return;
        }
        const displayNext = clampNumber(parsed, displayMin, displayMax);
        const next = fromDisplay(displayNext);
        input.value = formatNumberStep(displayNext, displayStep);
        options.onPreview?.(next);
        if (!await options.onCommit(next)) restore();
    };
    input.addEventListener('blur', () => void commitInput());
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            restore();
            input.blur();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const current = Number(input.value);
            if (!Number.isFinite(current)) return;
            const displayNext = numericStep(
                current, event.key === 'ArrowUp' ? 1 : -1,
                displayStep, event.shiftKey, displayMin, displayMax
            );
            const next = fromDisplay(displayNext);
            input.value = formatNumberStep(displayNext, displayStep);
            options.onPreview?.(next);
            void options.onCommit(next).then(ok => {
                if (!ok) restore();
            });
        }
    });

    handle.addEventListener('pointerdown', downEvent => {
        if (downEvent.button !== 0) return;
        downEvent.preventDefault();
        const pointerId = downEvent.pointerId;
        const startX = downEvent.clientX;
        let current = options.value;
        let moved = false;
        let lastPreviewAt = -Infinity;
        handle.setPointerCapture(pointerId);
        const cleanup = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', cancel);
            window.removeEventListener('keydown', keydown, true);
            if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        };
        const move = (event: PointerEvent): void => {
            if (event.pointerId !== pointerId) return;
            const delta = event.clientX - startX;
            moved ||= Math.abs(delta) >= 1;
            const displayCurrent = clampNumber(
                displayValue + delta * displayStep * (event.shiftKey ? 10 : 1),
                displayMin,
                displayMax
            );
            current = fromDisplay(displayCurrent);
            input.value = formatNumberStep(displayCurrent, displayStep);
            const now = Date.now();
            if (now - lastPreviewAt >= INSPECTOR_LIVE_PREVIEW_THROTTLE_MS) {
                lastPreviewAt = now;
                options.onPreview?.(current);
            }
        };
        const finish = (event: PointerEvent): void => {
            if (event.pointerId !== pointerId) return;
            cleanup();
            if (moved) void options.onCommit(current).then(ok => {
                if (!ok) restore();
            });
        };
        const cancel = (event: PointerEvent): void => {
            if (event.pointerId !== pointerId) return;
            cleanup();
            restore();
        };
        const keydown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                cleanup();
                restore();
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', keydown, true);
    });

    container.append(handle, input, unit, buttons, createKeyframeSeat(options.name, options.keyframe));
    return container;
}
