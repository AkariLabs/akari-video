export type InspectorKnobType = 'text' | 'color' | 'slider' | 'dropdown' | 'checkbox' | 'media';

export interface InspectorKnob {
    name: string;
    type: InspectorKnobType;
    group: string;
    label?: string;
    min?: number;
    max?: number;
    unit?: string;
    options?: readonly string[];
}

export function knobControlKind(type: InspectorKnobType): string {
    return ({
        slider: 'slider', color: 'color', dropdown: 'select', checkbox: 'boolean-select',
        text: 'text', media: 'readonly'
    } as const)[type];
}

export function parseInspectorKnobs(value: unknown): InspectorKnob[] {
    if (!value || typeof value !== 'object' || !Array.isArray((value as { knobs?: unknown }).knobs)) return [];
    return (value as { knobs: unknown[] }).knobs.flatMap(raw => {
        if (!raw || typeof raw !== 'object') return [];
        const knob = raw as Record<string, unknown>;
        const name = typeof knob.cssVar === 'string' ? knob.cssVar
            : typeof knob.param === 'string' ? knob.param : undefined;
        const types = new Set<InspectorKnobType>(['text', 'color', 'slider', 'dropdown', 'checkbox', 'media']);
        if (!name || typeof knob.type !== 'string' || !types.has(knob.type as InspectorKnobType)) return [];
        return [{
            name,
            type: knob.type as InspectorKnobType,
            group: typeof knob.group === 'string' && knob.group.trim() ? knob.group : 'ツマミ',
            ...(typeof knob.label === 'string' ? { label: knob.label } : {}),
            ...(typeof knob.min === 'number' ? { min: knob.min } : {}),
            ...(typeof knob.max === 'number' ? { max: knob.max } : {}),
            ...(typeof knob.unit === 'string' ? { unit: knob.unit } : {}),
            ...(Array.isArray(knob.options) && knob.options.every(option => typeof option === 'string')
                ? { options: knob.options as string[] } : {})
        }];
    });
}

export function overlayMetaPath(htmlPath: string): string | undefined {
    const clean = htmlPath.split(/[?#]/u)[0].replace(/\\/gu, '/');
    if (!clean || /^(?:https?:|data:)/iu.test(clean)) return undefined;
    const slash = clean.lastIndexOf('/');
    return slash < 0 ? 'meta.json' : `${clean.slice(0, slash + 1)}meta.json`;
}

export function findKnobForVar(knobs: readonly InspectorKnob[], name: string): InspectorKnob | undefined {
    return knobs.find(knob => knob.name === name
        || knob.name.replace(/^--/u, '') === name.replace(/^--/u, ''));
}
