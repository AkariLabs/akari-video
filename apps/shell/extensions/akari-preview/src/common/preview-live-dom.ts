import type { PreviewLiveOverride } from './preview-live-override';

interface LiveDomContext {
    stage: HTMLElement;
    layersStage: HTMLElement;
    captionRows: Map<string, { caption: { id: string; sourceCueId?: string;
        textStyle?: { stroke?: { color?: string } } }; plate: HTMLElement }>;
    layerEntries: Array<{ spec: { id: string; adjust?: { basic?: Record<string, number> } } }>;
    video: HTMLElement;
    computeAdjustCssVisual: (adjust: unknown, transition: unknown, scale: number) => { filter: string } | undefined;
    next: (current: PreviewLiveOverride | undefined, key: string, field: string,
        value: number, clear?: boolean) => PreviewLiveOverride | undefined;
}

export function createPreviewLiveDomController(context: LiveDomContext) {
    const captionLiveVariables = ['--caption-font-size', 'font-size', '--caption-line-height',
        '--caption-letter-spacing', '--caption-webkit-text-stroke'];
    const captionLiveFields = ['caption.size', 'caption.lineHeight', 'caption.letterSpacing', 'caption.strokeWidth'];
    let liveOverride: PreviewLiveOverride | undefined;
    let liveOverlayCss: Record<string, string> | undefined;
    let liveShapeKey: string | undefined;
    const liveMarked = new Set<HTMLElement>();
    const liveCaptionBase = new Map<HTMLElement, Map<string, { value: string; priority: string }>>();
    const liveShapeBase = new Map<HTMLElement, string>();
    const clear = (): void => {
        for (const element of liveMarked) element.removeAttribute('data-akari-live-override');
        for (const [element, base] of liveCaptionBase) {
            for (const [name, value] of base) element.style.setProperty(name, value.value, value.priority);
        }
        for (const [element, html] of liveShapeBase) element.innerHTML = html;
        liveMarked.clear();
        liveCaptionBase.clear();
        liveShapeBase.clear();
        liveShapeKey = undefined;
        liveOverlayCss = undefined;
        liveOverride = undefined;
    };
    const update = (key: string, field: string, value: number): void => {
        if (liveOverride && liveOverride.key !== key || liveShapeKey !== undefined && liveShapeKey !== key) clear();
        liveOverride = context.next(liveOverride, key, field, value);
    };
    const updateShape = (key: string, html: string): void => {
        if (liveShapeKey !== undefined && liveShapeKey !== key || liveOverride && liveOverride.key !== key) clear();
        const divider = key.indexOf(':');
        const id = key.slice(divider + 1);
        const overlay = Array.from(context.stage.querySelectorAll<HTMLElement>('[data-overlay-id]'))
            .find(element => element.dataset.overlayId === id);
        if (!overlay) return;
        if (!liveShapeBase.has(overlay)) liveShapeBase.set(overlay, overlay.innerHTML);
        overlay.innerHTML = html;
        overlay.setAttribute('data-akari-live-override', '1');
        liveMarked.add(overlay);
        liveShapeKey = key;
    };
    const captureOverlayCss = (overlay: HTMLElement): void => {
        liveOverlayCss = Object.fromEntries(['--x', '--y', '--scale', '--scale-x', '--scale-y',
            '--rotate', 'opacity'].map(name => [name, overlay.style.getPropertyValue(name)])
            .filter(([, value]) => value));
    };
    const paint = (): void => {
        if (!liveOverride) return;
        const mark = (element?: HTMLElement | null): element is HTMLElement => {
            if (!element) return false;
            element.setAttribute('data-akari-live-override', '1');
            liveMarked.add(element);
            return true;
        };
        const divider = liveOverride.key.indexOf(':');
        const kind = liveOverride.key.slice(0, divider);
        const id = liveOverride.key.slice(divider + 1);
        const values = liveOverride.values;
        if (kind === 'item') {
            const overlay = Array.from(context.stage.querySelectorAll<HTMLElement>('[data-overlay-id]'))
                .find(element => element.dataset.overlayId === id);
            if (mark(overlay) && liveOverlayCss) for (const [name, value] of Object.entries(liveOverlayCss)) {
                overlay.style.setProperty(name, value);
            }
            const media = Array.from(context.layersStage.querySelectorAll<HTMLElement>('[data-akari-layer-id]'))
                .find(element => element.dataset.akariLayerId === id);
            if (mark(media)) {
                for (const [name, dataName] of [['x', 'akariTransformX'], ['y', 'akariTransformY'],
                    ['scale', 'akariTransformScale'], ['scaleX', 'akariTransformScaleX'],
                    ['scaleY', 'akariTransformScaleY'], ['rotate', 'akariTransformRotate']]) {
                    if (Number.isFinite(values[name])) media.dataset[dataName] = String(values[name]);
                }
                if (Number.isFinite(values.opacity)) media.style.opacity = String(values.opacity);
                const liveBasic: Record<string, number> = {};
                for (const [name, value] of Object.entries(values)) {
                    if (name.startsWith('adjust.basic.') && Number.isFinite(value)) {
                        liveBasic[name.slice('adjust.basic.'.length)] = value;
                    }
                }
                if (Object.keys(liveBasic).length > 0) {
                    const entry = context.layerEntries.find(row => String(row.spec.id) === id);
                    const basic = { ...(entry?.spec.adjust?.basic || {}), ...liveBasic };
                    const visual = context.computeAdjustCssVisual({ basic }, undefined, 1);
                    if (visual) media.style.filter = visual.filter;
                }
            }
        } else if (kind === 'cut') {
            const media = context.video.dataset.akariCutIndex === id ? context.video : null;
            if (mark(media)) for (const [name, dataName] of [['x', 'akariTransformX'], ['y', 'akariTransformY'],
                ['scale', 'akariTransformScale'], ['rotate', 'akariTransformRotate']]) {
                if (Number.isFinite(values[name])) media.dataset[dataName] = String(values[name]);
            }
        } else if (kind === 'caption'
            && captionLiveFields.some(field => Number.isFinite(values[field]))) {
            const row = Array.from(context.captionRows.values()).find(row =>
                (row.caption.sourceCueId || row.caption.id) === id);
            const plate = row?.plate;
            if (mark(plate)) {
                if (!liveCaptionBase.has(plate)) liveCaptionBase.set(plate, new Map(captionLiveVariables.map(name => [name, {
                    value: plate.style.getPropertyValue(name), priority: plate.style.getPropertyPriority(name)
                }])));
                if (Number.isFinite(values['caption.size'])) {
                    plate.style.setProperty('--caption-font-size', String(values['caption.size']) + 'px');
                    plate.style.setProperty('font-size', String(values['caption.size']) + 'px');
                }
                if (Number.isFinite(values['caption.lineHeight'])) {
                    plate.style.setProperty('--caption-line-height', String(values['caption.lineHeight']));
                }
                if (Number.isFinite(values['caption.letterSpacing'])) {
                    plate.style.setProperty('--caption-letter-spacing',
                        String(values['caption.letterSpacing']) + 'em');
                }
                if (Number.isFinite(values['caption.strokeWidth'])) {
                    plate.style.setProperty('--caption-webkit-text-stroke', String(values['caption.strokeWidth'] * 2)
                        + 'px ' + (row?.caption.textStyle?.stroke?.color ?? 'rgba(0,0,0,.9)'));
                }
            }
        }
    };
    return { key: (): string | undefined => liveOverride?.key, update, updateShape,
        captureOverlayCss, paint, clear };
}
