import { t, getLanguage, translatedKnobLabel, localizedKnobGroup } from '@akari-video/i18n';
export type InspectorKnobType = 'text' | 'color' | 'slider' | 'dropdown' | 'checkbox' | 'media';

export interface InspectorKnob {
    name: string;
    type: InspectorKnobType;
    group: string;
    groupLabel?: string;
    label?: string;
    min?: number;
    max?: number;
    unit?: string;
    options?: readonly string[];
    default?: number | string;
}

export function knobControlKind(type: InspectorKnobType): string {
    return ({
        slider: 'slider', color: 'color', dropdown: 'select', checkbox: 'boolean-select',
        text: 'text', media: 'readonly'
    } as const)[type];
}

export function isFontFamilyKnob(knob: InspectorKnob): boolean {
    return knob.name === '--fontFamily'
        || (knob.type === 'text' && knob.group === 'typography' && /font/iu.test(knob.name));
}

export function parseInspectorKnobs(value: unknown, language = getLanguage()): InspectorKnob[] {
    if (!value || typeof value !== 'object' || !Array.isArray((value as { knobs?: unknown }).knobs)) return [];
    return (value as { knobs: unknown[] }).knobs.flatMap(raw => {
        if (!raw || typeof raw !== 'object') return [];
        const knob = raw as Record<string, unknown>;
        const name = typeof knob.cssVar === 'string' ? knob.cssVar
            : typeof knob.param === 'string' ? knob.param : undefined;
        const types = new Set<InspectorKnobType>(['text', 'color', 'slider', 'dropdown', 'checkbox', 'media']);
        if (!name || typeof knob.type !== 'string' || !types.has(knob.type as InspectorKnobType)) return [];
        const translated = translatedKnobLabel(value as { i18n?: Record<string, { knobs?: Record<string, string> }> },
            { name }, language);
        const label = translated ?? (typeof knob.label === 'string' ? knob.label : undefined);
        const group = typeof knob.group === 'string' && knob.group.trim() ? knob.group : t('inspector.knobResolver.label.controls');
        return [{
            name,
            type: knob.type as InspectorKnobType,
            group,
            groupLabel: localizedKnobGroup(value as { i18n?: Record<string, { groups?: Record<string, string> }> }, group, language),
            ...(label !== undefined ? { label } : {}),
            ...(typeof knob.min === 'number' ? { min: knob.min } : {}),
            ...(typeof knob.max === 'number' ? { max: knob.max } : {}),
            ...(typeof knob.unit === 'string' ? { unit: knob.unit } : {}),
            ...((knob.type === 'slider' && typeof knob.default === 'number' && Number.isFinite(knob.default))
                || (knob.type !== 'slider' && typeof knob.default === 'string') ? { default: knob.default as number | string } : {}),
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
