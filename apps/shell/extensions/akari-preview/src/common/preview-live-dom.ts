import type { PreviewLiveOverride } from './preview-live-override';

interface LiveDomContext {
    stage: HTMLElement;
    layersStage: HTMLElement;
    captionRows: Map<string, { caption: { id: string; sourceCueId?: string }; plate: HTMLElement }>;
    layerEntries: Array<{ spec: { id: string; adjust?: { basic?: Record<string, number> } } }>;
    video: HTMLElement;
    computeAdjustCssVisual: (adjust: unknown, transition: unknown, scale: number) => { filter: string } | undefined;
    next: (current: PreviewLiveOverride | undefined, key: string, field: string,
        value: number, clear?: boolean) => PreviewLiveOverride | undefined;
}

export function createPreviewLiveDomController(context: LiveDomContext) {
    let liveOverride: PreviewLiveOverride | undefined;
    let liveOverlayCss: Record<string, string> | undefined;
    const liveMarked = new Set<HTMLElement>();
    const liveCaptionBase = new Map<HTMLElement, { variable: { value: string; priority: string };
        font: { value: string; priority: string } }>();
    const clear = (): void => {
        for (const element of liveMarked) element.removeAttribute('data-akari-live-override');
        for (const [element, base] of liveCaptionBase) {
            element.style.setProperty('--caption-font-size', base.variable.value, base.variable.priority);
            element.style.setProperty('font-size', base.font.value, base.font.priority);
        }
        liveMarked.clear();
        liveCaptionBase.clear();
        liveOverlayCss = undefined;
        liveOverride = undefined;
    };
    const update = (key: string, field: string, value: number): void => {
        if (liveOverride && liveOverride.key !== key) clear();
        liveOverride = context.next(liveOverride, key, field, value);
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
                if (Number.isFinite(values['adjust.basic.exposure'])) {
                    const entry = context.layerEntries.find(row => String(row.spec.id) === id);
                    const basic = { ...(entry?.spec.adjust?.basic || {}), exposure: values['adjust.basic.exposure'] };
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
        } else if (kind === 'caption' && Number.isFinite(values['caption.size'])) {
            const row = Array.from(context.captionRows.values()).find(row =>
                (row.caption.sourceCueId || row.caption.id) === id);
            const plate = row?.plate;
            if (mark(plate)) {
                if (!liveCaptionBase.has(plate)) {
                    const base = (name: string): { value: string; priority: string } => ({
                        value: plate.style.getPropertyValue(name), priority: plate.style.getPropertyPriority(name)
                    });
                    liveCaptionBase.set(plate, { variable: base('--caption-font-size'), font: base('font-size') });
                }
                plate.style.setProperty('--caption-font-size', String(values['caption.size']) + 'px');
                plate.style.setProperty('font-size', String(values['caption.size']) + 'px');
            }
        }
    };
    return { key: (): string | undefined => liveOverride?.key, update, captureOverlayCss, paint, clear };
}
