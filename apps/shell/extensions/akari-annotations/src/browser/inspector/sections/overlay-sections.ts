// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { CAPTION_PANEL_FONTS } from '../../../common/caption-panel-catalog';
import { renderableCaptionFonts } from '../../../common/caption-panel-state';
import { InspectorWriteRequest, InspectorWriteResult, TimelineOverlaySelection } from '../../timeline-selection-model';
import { composeInspectorSections } from '../section-model';
import { findKnobForVar, isFontFamilyKnob, InspectorKnob, knobControlKind } from '../knob-resolver';
import { type InspectorFieldDef, type InspectorSection } from './types';
import { formatTimestamp, formatDurationSeconds, formatPayloadValue, deriveOverlayType } from './shared-helpers';
import { CROP_FIELDS } from './transform-fields';
import { LAYER_BLEND_OPTIONS } from './photo-fields';
import { MOTION_SECTIONS, MOTION_SUMMARY_SECTION, MOTION_EMPTY_SECTION } from './motion-sections';

export function OVERLAY_SECTIONS(
    snapshot: TimelineOverlaySelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    knobs: readonly InspectorKnob[] = [],
    openMotion?: () => void,
    fontFaces: ReadonlyMap<string, string> = new Map()
): InspectorSection[] {
    const transform = snapshot.payload.transform && typeof snapshot.payload.transform === 'object'
        && !Array.isArray(snapshot.payload.transform)
        ? snapshot.payload.transform as Record<string, unknown> : {};
    const number = (key: string, fallback: number): number =>
        typeof transform[key] === 'number' ? transform[key] as number : fallback;
    const overallScale = (): number => Math.sqrt(number('scaleX', number('scale', 1))
        * number('scaleY', number('scale', 1)));
    const source = snapshot.payload.source && typeof snapshot.payload.source === 'object'
        ? snapshot.payload.source as Record<string, unknown> : {};
    const sourcePath = typeof source.html === 'string' ? source.html
        : typeof source.path === 'string' ? source.path : '';
    const isTelop = /^telop-/u.test(snapshot.id)
        || /(?:^|[\\/])overlay[\\/]telop-[^\\/]+(?:[\\/]|$)/iu.test(sourcePath);
    const cropFields = CROP_FIELDS(snapshot, 'item', requestWrite);
    const transformFields: InspectorFieldDef<TimelineOverlaySelection>[] = [
        {
            name: 'transform-x', label: 'X', unit: 'px', getValue: () => String(number('x', 0)),
            getEditValue: () => String(number('x', 0)), inputKind: 'scrub-number', scrubStep: 1,
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.x', value: Number(value) }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.x', value: null })
        },
        {
            name: 'transform-y', label: 'Y', unit: 'px', getValue: () => String(number('y', 0)),
            getEditValue: () => String(number('y', 0)), inputKind: 'scrub-number', scrubStep: 1,
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.y', value: Number(value) }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.y', value: null })
        },
        {
            name: 'transform-scale', label: isTelop ? '倍率' : '拡縮', unit: '%', removable: true,
            getValue: () => String(overallScale() * 100), getEditValue: () => String(overallScale() * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, value) => {
                const scale = Number(value) / 100;
                if (isTelop && (transform.scaleX !== undefined || transform.scaleY !== undefined)) {
                    await requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scaleX', value: scale });
                    return requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scaleY', value: scale });
                }
                return requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: scale });
            },
            reset: async () => {
                if (isTelop) {
                    await requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scaleX', value: null });
                    await requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scaleY', value: null });
                }
                return requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: null });
            }
        },
        ...(!isTelop ? (['scaleX', 'scaleY'] as const).map((axis, index): InspectorFieldDef<TimelineOverlaySelection> => ({
            name: `transform-${axis}`, label: index === 0 ? '幅' : '高さ', unit: '%', removable: true,
            getValue: () => String(number(axis, number('scale', 1)) * 100),
            getEditValue: () => String(number(axis, number('scale', 1)) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: axis,
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: Number(value) / 100
            }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: null })
        })) : []),
        {
            name: 'transform-rotate', label: '回転', unit: '°', removable: true,
            getValue: () => String(number('rotate', 0)), getEditValue: () => String(number('rotate', 0)),
            inputKind: 'scrub-number', scrubStep: 0.1,
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: Number(value) }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: null })
        }
    ];
    const groups = new Map<string, InspectorFieldDef<TimelineOverlaySelection>[]>();
    const rawVars = snapshot.payload.vars;
    const variableEntries = rawVars && typeof rawVars === 'object' && !Array.isArray(rawVars)
        ? Object.entries(rawVars as Record<string, unknown>) : [];
    for (const knob of knobs) {
        if (variableEntries.some(([name]) => findKnobForVar([knob], name))) continue;
        // The preview fragment lives in a separate webview; its computed CSS is unavailable here.
        const fallback = knob.default ?? (knob.type === 'slider' ? knob.min ?? 0
            : knob.type === 'checkbox' ? false : knob.type === 'color' ? '#000000'
                : knob.type === 'dropdown' ? knob.options?.[0] ?? '' : '');
        variableEntries.push([knob.name, fallback]);
    }
    for (const [name, value] of variableEntries) {
            const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
            const knob = findKnobForVar(knobs, name);
            const group = knob?.group ?? 'ツマミ';
            const fields = groups.get(group) ?? [];
            const kind = knob ? knobControlKind(knob.type) : 'text';
            const fontKnob = knob ? isFontFamilyKnob(knob) : false;
            const fontOptions = fontKnob ? renderableCaptionFonts(CAPTION_PANEL_FONTS, fontFaces)
                .map(font => fontFaces.get(font.id) ?? font.family) : [];
            if (fontKnob && typeof value === 'string' && value && !fontOptions.includes(value)) fontOptions.unshift(value);
            fields.push({
                name: `var-${name.replace(/[^a-z0-9_-]+/giu, '-')}`,
                label: knob?.label ?? `vars.${name}`,
                getValue: () => formatPayloadValue(value),
                getEditValue: () => knob?.type === 'slider' && typeof value === 'string'
                    ? String(Number.parseFloat(value)) : String(value ?? ''),
                inputKind: fontKnob ? 'select' : kind === 'readonly' ? 'media'
                    : kind === 'slider' ? 'scrub-number' : kind as InspectorFieldDef['inputKind'],
                ...(fontKnob ? { options: fontOptions } : knob?.options ? { options: knob.options } : {}),
                ...(knob?.min !== undefined ? { min: knob.min } : {}),
                ...(knob?.max !== undefined ? { max: knob.max } : {}),
                ...(knob?.unit ? { unit: knob.unit } : {}),
                ...(knob?.type === 'slider' ? { scrubStep: Math.max(0.001, ((knob.max ?? 1) - (knob.min ?? 0)) / 100) } : {}),
                ...(isPrimitive && knob?.type !== 'media' ? {
                    write: async (_snapshot: TimelineOverlaySelection, nextValue: string) => {
                        if (!knob) return requestWrite({ kind: 'overlay-var', id: snapshot.id, name, value: nextValue });
                        const typedValue: number | string | boolean = knob.type === 'slider'
                            ? knob.unit ? `${Number(nextValue)}${knob.unit}` : Number(nextValue)
                            : knob.type === 'checkbox' ? String(nextValue === 'true') : nextValue;
                        return requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: `source.vars.${name}`, value: typedValue
                        });
                    }
                } : {})
            });
            groups.set(group, fields);
    }
    const knobSections: InspectorSection<TimelineOverlaySelection>[] = [...groups].map(([group, fields], index) => ({
        id: `knobs:${index}-${group.replace(/[^a-z0-9_-]+/giu, '-') || 'default'}`,
        label: group || 'ツマミ', fields
    }));
    const opacity = typeof snapshot.payload.opacity === 'number' ? snapshot.payload.opacity : 1;
    const blend = typeof snapshot.payload.blend === 'string' ? snapshot.payload.blend : 'normal';
    return composeInspectorSections([
        {
            id: 'time', label: '時間',
            fields: [
                { name: 'overlay-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                { name: 'overlay-duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        { id: 'transform', label: '変形', fields: transformFields },
        { id: 'crop', label: 'クロップ', fields: cropFields },
        MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
        ...(snapshot.durationFrames ? MOTION_SECTIONS({
            id: snapshot.id, durationFrames: snapshot.durationFrames, motion: snapshot.motion
        }, requestWrite) : [MOTION_EMPTY_SECTION()]),
        {
            id: 'appearance', label: '外観', fields: [
                {
                    name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
                    getValue: () => String(opacity), getEditValue: () => String(opacity),
                    inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1,
                    write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: Number(value) }),
                    reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: null })
                },
                {
                    name: 'blend', label: 'ブレンドモード', getValue: () => blend, getEditValue: () => blend,
                    inputKind: 'select', options: LAYER_BLEND_OPTIONS,
                    write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'blend', value })
                }
            ]
        },
        ...knobSections,
        {
            id: 'info', label: '情報', collapsedByDefault: true, fields: [
                { name: 'overlay-kind', label: 'kind', getValue: () => deriveOverlayType(snapshot.payload) },
                { name: 'overlay-html', label: 'html', getValue: () => formatPayloadValue(snapshot.payload.html) },
                { name: 'overlay-track', label: 'トラック', getValue: () => snapshot.trackName },
                { name: 'overlay-clip', label: 'クリップ', getValue: () => snapshot.clipName }
            ]
        }
    ]);
}
