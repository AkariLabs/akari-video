import { createInspectorIcon } from './icons';
import { isImeCompositionKeydown } from 'akari-preview/lib/common/review-tool-mode';

export interface NumberFieldOptions {
    name: string;
    label: string;
    value: number;
    step: number;
    min?: number;
    max?: number;
    unit?: string;
    displayScale?: number;
    displayOffset?: number;
    displayPrecision?: number;
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

export function formatNumberStep(value: number, step: number, precision?: number): string {
    if (precision !== undefined) return value.toFixed(precision);
    const fraction = String(step).split('.')[1];
    const inferredPrecision = Math.min(fraction?.length ?? 0, 6);
    return String(Number(value.toFixed(inferredPrecision)));
}

export function createKeyframeSeat(name: string, options?: KeyframeSeatOptions): HTMLElement {
    const group = document.createElement('span');
    group.className = 'akari-inspector-kf-controls';
    const control = (icon: 'left' | 'diamond' | 'right' | 'more' | 'jump', label: string): HTMLButtonElement => {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.append(createInspectorIcon(icon));
        return button;
    };
    const previous = control('left', '前のキーフレームへ');
    previous.disabled = !options?.hasKeyframes;
    previous.addEventListener('click', () => options?.onPrevious());
    const button = control('diamond', options?.active
        ? '現在時刻のキーフレームを消す' : '現在時刻にキーフレームを打つ');
    button.className = 'akari-inspector-kf-seat';
    button.disabled = !options;
    button.setAttribute('aria-pressed', String(options?.active === true));
    button.setAttribute('data-akari-ui', `inspector-kf-seat:${name}`);
    button.addEventListener('click', () => options?.onToggle());
    const next = control('right', '次のキーフレームへ');
    next.disabled = !options?.hasKeyframes;
    next.addEventListener('click', () => options?.onNext());
    const more = control('more', 'キーフレームのその他の操作');
    more.disabled = !options?.onReveal;
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('data-akari-ui', `inspector-kf-more:${name}`);
    let closeMenu: (() => void) | undefined;
    more.addEventListener('click', () => {
        if (closeMenu) { closeMenu(); return; }
        if (more.disabled || !options) return;
        const menu = document.createElement('div');
        menu.className = 'akari-inspector-kf-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'キーフレームの操作');
        menu.setAttribute('popover', 'auto');
        const reveal = control('jump', 'タイムラインのキーフレーム行を開く');
        const label = document.createElement('span');
        label.textContent = reveal.title;
        reveal.append(label);
        reveal.disabled = !options.hasKeyframes;
        if (reveal.disabled) reveal.title = 'キーフレームがありません';
        reveal.setAttribute('role', 'menuitem');
        reveal.setAttribute('data-akari-ui', `inspector-kf-jump:${name}`);
        menu.append(reveal);
        // The top layer avoids clipping by the inspector's horizontal scroll guard.
        document.body.append(menu);
        const close = (): void => {
            if (closeMenu !== close) return;
            observer.disconnect();
            window.removeEventListener('resize', close);
            document.removeEventListener('scroll', close, true);
            menu.remove();
            more.setAttribute('aria-expanded', 'false');
            closeMenu = undefined;
        };
        const observer = new MutationObserver(() => {
            if (!more.isConnected || more.disabled) close();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
        closeMenu = close;
        window.addEventListener('resize', close);
        document.addEventListener('scroll', close, true);
        menu.addEventListener('toggle', event => {
            if ((event as ToggleEvent).newState === 'closed') close();
        });
        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
                more.focus();
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                if (!reveal.disabled) reveal.focus();
            }
        });
        reveal.addEventListener('click', () => {
            if (reveal.disabled) return;
            close();
            more.focus();
            options.onReveal();
        });
        menu.showPopover();
        const anchor = more.getBoundingClientRect();
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(4, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 4))}px`;
        menu.style.top = `${Math.max(4, Math.min(anchor.bottom + 4, window.innerHeight - rect.height - 4))}px`;
        more.setAttribute('aria-expanded', 'true');
        if (!reveal.disabled) reveal.focus();
    });
    group.append(previous, button, next, more);
    return group;
}

export function createNumberField(options: NumberFieldOptions): HTMLElement {
    const displayScale = options.displayScale ?? 1;
    const displayOffset = options.displayOffset ?? 0;
    const toDisplay = (value: number): number => value * displayScale + displayOffset;
    const fromDisplay = (value: number): number => (value - displayOffset) / displayScale;
    const displayValue = toDisplay(options.value);
    const displayStep = options.step * displayScale;
    const displayMin = options.min === undefined ? undefined : toDisplay(options.min);
    const displayMax = options.max === undefined ? undefined : toDisplay(options.max);

    const container = document.createElement('div');
    container.className = 'akari-inspector-number-field'
        + (options.keyframe === undefined ? ' akari-inspector-number-field-seatless' : '');
    container.setAttribute('data-akari-ui', `field:inspector-${options.name}`);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'akari-inspector-number-handle';
    handle.title = '左右へドラッグして調整';
    handle.setAttribute('aria-label', `${options.label}をドラッグして調整`);
    handle.append(createInspectorIcon('scrub'));

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'akari-inspector-number-input';
    input.value = formatNumberStep(displayValue, displayStep, options.displayPrecision);
    input.setAttribute('role', 'spinbutton');
    input.setAttribute('aria-label', options.label);
    if (displayMin !== undefined) input.setAttribute('aria-valuemin', String(displayMin));
    if (displayMax !== undefined) input.setAttribute('aria-valuemax', String(displayMax));

    const unit = document.createElement('span');
    unit.className = 'akari-inspector-number-unit';
    unit.textContent = options.unit ?? '';

    let composing = false;
    let lastInputPreviewAt = -Infinity;
    let inputPreviewTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelInputPreview = (): void => {
        if (inputPreviewTimer !== undefined) clearTimeout(inputPreviewTimer);
        inputPreviewTimer = undefined;
    };
    const restore = (): void => {
        cancelInputPreview();
        input.value = formatNumberStep(displayValue, displayStep, options.displayPrecision);
        options.onPreview?.(options.value);
    };
    const buttons = document.createElement('span');
    buttons.className = 'akari-inspector-number-steps';
    const up = document.createElement('button');
    const down = document.createElement('button');
    for (const [button, direction, label] of [[up, 1, '増やす'], [down, -1, '減らす']] as const) {
        button.type = 'button';
        button.append(createInspectorIcon(direction > 0 ? 'up' : 'down'));
        button.setAttribute('aria-label', `${options.label}を${label}`);
        button.addEventListener('click', event => {
            cancelInputPreview();
            const current = Number(input.value);
            if (!Number.isFinite(current)) return;
            const displayNext = numericStep(
                current, direction, displayStep, event.shiftKey, displayMin, displayMax
            );
            const next = fromDisplay(displayNext);
            input.value = formatNumberStep(displayNext, displayStep, options.displayPrecision);
            options.onPreview?.(next);
            void options.onCommit(next).then(ok => {
                if (!ok) restore();
            });
        });
    }
    buttons.append(up, down);

    const commitInput = async (): Promise<void> => {
        cancelInputPreview();
        const parsed = Number(input.value);
        if (!Number.isFinite(parsed)) {
            restore();
            return;
        }
        const displayNext = clampNumber(parsed, displayMin, displayMax);
        const next = fromDisplay(displayNext);
        input.value = formatNumberStep(displayNext, displayStep, options.displayPrecision);
        options.onPreview?.(next);
        if (!await options.onCommit(next)) restore();
    };
    const previewInput = (): void => {
        cancelInputPreview();
        if (composing) return;
        // Number('') / Number('1.') are finite, but these are unfinished edits.
        const text = input.value.trim();
        const parsed = /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
        if (!Number.isFinite(parsed)) return;
        const next = fromDisplay(clampNumber(parsed, displayMin, displayMax));
        if (!Number.isFinite(next)) return;
        const remaining = INSPECTOR_LIVE_PREVIEW_THROTTLE_MS - (Date.now() - lastInputPreviewAt);
        if (remaining > 0) {
            inputPreviewTimer = setTimeout(previewInput, remaining);
            return;
        }
        lastInputPreviewAt = Date.now();
        options.onPreview?.(next);
    };
    input.addEventListener('compositionstart', () => {
        composing = true;
        cancelInputPreview();
    });
    input.addEventListener('compositionend', () => {
        composing = false;
        previewInput();
    });
    input.addEventListener('input', event => {
        if ((event as InputEvent).isComposing) {
            cancelInputPreview();
            return;
        }
        previewInput();
    });
    input.addEventListener('blur', () => void commitInput());
    const stepInput = (key: string, shiftKey: boolean): void => {
        cancelInputPreview();
        const current = Number(input.value);
        if (!Number.isFinite(current)) return;
        const displayNext = numericStep(
            current, key === 'ArrowUp' ? 1 : -1,
            displayStep, shiftKey, displayMin, displayMax
        );
        const next = fromDisplay(displayNext);
        input.value = formatNumberStep(displayNext, displayStep, options.displayPrecision);
        options.onPreview?.(next);
        void options.onCommit(next).then(ok => {
            if (!ok) restore();
        });
    };
    input.addEventListener('akari.inspector.numberStepShortcut', event => {
        const detail = (event as CustomEvent<{ key: string; shiftKey: boolean }>).detail;
        if (detail?.key === 'ArrowUp' || detail?.key === 'ArrowDown') stepInput(detail.key, detail.shiftKey);
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            restore();
            input.blur();
        } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown')
            && (event.altKey || event.metaKey || event.ctrlKey)) {
            // The four registered bindings handle plain/Shift arrows. Other modifiers kept the
            // same numeric step in the old input handler and have no dedicated shortcut entry.
            if (composing || event.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            stepInput(event.key, event.shiftKey);
        }
    });

    handle.addEventListener('pointerdown', downEvent => {
        if (downEvent.button !== 0) return;
        cancelInputPreview();
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
            input.value = formatNumberStep(displayCurrent, displayStep, options.displayPrecision);
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
            // IME 変換中の Escape は変換の取り消しなので、ドラッグの巻き戻しに食わせない（issue #51）。
            if (isImeCompositionKeydown(event)) return;
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

    container.append(handle, input, unit, buttons);
    if (options.keyframe !== undefined) {
        container.appendChild(createKeyframeSeat(options.name, options.keyframe));
    }
    return container;
}
