import {
    clampNumber,
    createKeyframeSeat,
    formatNumberStep,
    INSPECTOR_LIVE_PREVIEW_THROTTLE_MS,
    type KeyframeSeatOptions
} from './number-field';

export interface SliderFieldOptions {
    name: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit?: string;
    displayScale?: number;
    onPreview?: (value: number) => void;
    onCommit: (value: number) => Promise<boolean>;
    keyframe?: KeyframeSeatOptions;
}

export function sliderToDisplay(value: number, displayScale = 1): number {
    return value * displayScale;
}

export function sliderFromDisplay(value: number, displayScale = 1): number {
    return value / displayScale;
}

export function sliderFillPercent(value: number, min: number, max: number): number {
    if (max <= min) return 0;
    return clampNumber(((value - min) / (max - min)) * 100, 0, 100);
}

export function createSliderField(options: SliderFieldOptions): HTMLElement {
    const scale = options.displayScale ?? 1;
    const displayMin = sliderToDisplay(options.min, scale);
    const displayMax = sliderToDisplay(options.max, scale);
    const displayStep = sliderToDisplay(options.step, scale);
    const displayValue = sliderToDisplay(options.value, scale);

    const container = document.createElement('div');
    container.className = 'akari-inspector-slider-field';
    container.setAttribute('data-akari-ui', `field:inspector-${options.name}`);
    container.setAttribute('data-akari-slider', options.name);
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'akari-inspector-slider-range';
    range.min = String(displayMin);
    range.max = String(displayMax);
    range.step = String(displayStep);
    range.value = String(displayValue);
    range.setAttribute('aria-label', options.label);
    range.setAttribute('data-akari-ui', `slider:inspector-${options.name}`);
    const number = document.createElement('input');
    number.type = 'text';
    number.inputMode = 'decimal';
    number.className = 'akari-inspector-slider-number';
    number.value = formatNumberStep(displayValue, displayStep);
    const unit = document.createElement('span');
    unit.className = 'akari-inspector-slider-unit';
    unit.textContent = options.unit ?? '';
    const seat = createKeyframeSeat(options.name, options.keyframe);

    const updateFill = (internal: number): void => {
        container.style.setProperty('--akari-slider-fill', `${sliderFillPercent(internal, options.min, options.max)}%`);
    };
    updateFill(options.value);
    const restore = (): void => {
        range.value = String(displayValue);
        number.value = formatNumberStep(displayValue, displayStep);
        updateFill(options.value);
        options.onPreview?.(options.value);
    };
    const applyDisplay = (raw: number): number => {
        const display = clampNumber(raw, displayMin, displayMax);
        const internal = sliderFromDisplay(display, scale);
        range.value = String(display);
        number.value = formatNumberStep(display, displayStep);
        updateFill(internal);
        return internal;
    };
    let lastPreviewAt = -Infinity;
    range.addEventListener('input', () => {
        const internal = applyDisplay(Number(range.value));
        const now = Date.now();
        if (now - lastPreviewAt >= INSPECTOR_LIVE_PREVIEW_THROTTLE_MS) {
            lastPreviewAt = now;
            options.onPreview?.(internal);
        }
    });
    range.addEventListener('change', () => {
        const internal = applyDisplay(Number(range.value));
        void options.onCommit(internal).then(ok => {
            if (!ok) restore();
        });
    });
    range.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            restore();
        }
    });
    const commitNumber = async (): Promise<void> => {
        const parsed = Number(number.value);
        if (!Number.isFinite(parsed)) {
            restore();
            return;
        }
        const internal = applyDisplay(parsed);
        options.onPreview?.(internal);
        if (!await options.onCommit(internal)) restore();
    };
    number.addEventListener('blur', () => void commitNumber());
    number.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            number.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            restore();
            number.blur();
        }
    });
    container.append(range, number, unit, seat);
    return container;
}
