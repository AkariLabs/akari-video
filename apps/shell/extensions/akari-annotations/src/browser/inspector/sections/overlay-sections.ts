import { t } from '@akari-video/i18n';
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
import { scene3dOwnedKnobVars } from '../../../common/scene3d-item';
import { scene3dSection, type Scene3dSectionContext } from '../scene3d-section';

export function OVERLAY_SECTIONS(
    snapshot: TimelineOverlaySelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    knobs: readonly InspectorKnob[] = [],
    openMotion?: () => void,
    fontFaces: ReadonlyMap<string, string> = new Map(),
    scene3d: Scene3dSectionContext = {}
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
        : typeof source.path === 'string' ? source.path
            : typeof snapshot.payload.html === 'string' ? snapshot.payload.html : '';
    const sourceVars = source.vars && typeof source.vars === 'object' ? source.vars as Record<string, unknown>
        : snapshot.payload.vars && typeof snapshot.payload.vars === 'object'
            ? snapshot.payload.vars as Record<string, unknown> : {};
    const rotationVars = ['--akari-3d-rot-x', '--akari-3d-rot-y', '--akari-3d-rot-z'];
    const scene3dItem = /(^|\/)scene3d\//u.test(sourcePath.replace(/\\/gu, '/'))
        || rotationVars.some(name => name in sourceVars)
        || (snapshot.keyframes?.some(point => point.vars && typeof point.vars === 'object'
            && rotationVars.some(name => name in (point.vars as Record<string, unknown>))) ?? false);
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
            name: 'transform-scale', label: isTelop ? t('inspector.overlaySections.label.scaleFactor') : t('inspector.overlaySections.label.scale'), unit: '%', removable: true,
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
            name: `transform-${axis}`, label: index === 0 ? t('inspector.overlaySections.label.width') : t('inspector.overlaySections.label.height'), unit: '%', removable: true,
            getValue: () => String(number(axis, number('scale', 1)) * 100),
            getEditValue: () => String(number(axis, number('scale', 1)) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: axis,
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: Number(value) / 100
            }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: null })
        })) : []),
        ...(!scene3dItem || number('rotate', 0) !== 0 ? [{
            name: 'transform-rotate', label: t('inspector.overlaySections.label.rotation'), unit: '°', removable: true,
            getValue: () => String(number('rotate', 0)), getEditValue: () => String(number('rotate', 0)),
            inputKind: 'scrub-number' as const, scrubStep: 0.1,
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: Number(value) }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: null })
        }] : [])
    ];
    const groups = new Map<string, InspectorFieldDef<TimelineOverlaySelection>[]>();
    const groupLabels = new Map<string, string>();
    const rawVars = snapshot.payload.vars;
    const variableEntries = rawVars && typeof rawVars === 'object' && !Array.isArray(rawVars)
        ? Object.entries(rawVars as Record<string, unknown>) : [];
    const ownedVars = scene3dItem ? scene3dOwnedKnobVars(scene3d.meta) : new Set<string>();
    for (const knob of knobs) {
        if (scene3dItem && ownedVars.has(knob.name)) continue;
        if (variableEntries.some(([name]) => findKnobForVar([knob], name))) continue;
        // The preview fragment lives in a separate webview; its computed CSS is unavailable here.
        const fallback = knob.default ?? (knob.type === 'slider' ? knob.min ?? 0
            : knob.type === 'checkbox' ? false : knob.type === 'color' ? '#000000'
                : knob.type === 'dropdown' ? knob.options?.[0] ?? '' : '');
        variableEntries.push([knob.name, fallback]);
    }
    for (const [name, value] of variableEntries) {
        if (scene3dItem && (ownedVars.has(name) || name === '--akari-3d-clip'
            || /^--akari-3d-rot-[xyz]$/u.test(name))) continue;
        const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
        const knob = findKnobForVar(knobs, name);
        const group = knob?.group ?? t('inspector.overlaySections.label.controls');
        groupLabels.set(group, knob?.groupLabel ?? group);
        const fields = groups.get(group) ?? [];
        const kind = knob ? knobControlKind(knob.type) : 'text';
        const fontKnob = knob ? isFontFamilyKnob(knob) : false;
        const fontOptions = fontKnob ? renderableCaptionFonts(CAPTION_PANEL_FONTS, fontFaces)
            .map(font => fontFaces.get(font.id) ?? font.family) : [];
        if (fontKnob && typeof value === 'string' && value && !fontOptions.includes(value)) fontOptions.unshift(value);
        const label = knob?.label ?? `vars.${name}`;
        fields.push({
                name: `var-${name.replace(/[^a-z0-9_-]+/giu, '-')}`,
                label,
                title: label,
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
        label: groupLabels.get(group) || t('inspector.overlaySections.label.controls'), fields
    }));
    const opacity = typeof snapshot.payload.opacity === 'number' ? snapshot.payload.opacity : 1;
    const blend = typeof snapshot.payload.blend === 'string' ? snapshot.payload.blend : 'normal';
    return composeInspectorSections([
        {
            id: 'time', label: t('inspector.overlaySections.label.time'),
            fields: [
                { name: 'overlay-start', label: t('inspector.overlaySections.label.outputPosition'), getValue: () => formatTimestamp(snapshot.outputStart) },
                { name: 'overlay-duration', label: t('inspector.overlaySections.label.duration'), getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        { id: 'transform', label: t('inspector.overlaySections.label.transform'), fields: transformFields },
        ...(scene3dItem ? [scene3dSection(snapshot, requestWrite, scene3d)] : []),
        { id: 'crop', label: t('inspector.overlaySections.label.crop'), fields: cropFields },
        MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
        ...(snapshot.durationFrames ? MOTION_SECTIONS({
            id: snapshot.id, durationFrames: snapshot.durationFrames, motion: snapshot.motion
        }, requestWrite) : [MOTION_EMPTY_SECTION()]),
        {
            id: 'appearance', label: t('inspector.overlaySections.label.appearance'), fields: [
                {
                    name: 'opacity', label: t('inspector.overlaySections.label.opacity'), unit: '%', displayScale: 100,
                    getValue: () => String(opacity), getEditValue: () => String(opacity),
                    inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1,
                    write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: Number(value) }),
                    reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: null })
                },
                {
                    name: 'blend', label: t('inspector.overlaySections.label.blendMode'), getValue: () => blend, getEditValue: () => blend,
                    inputKind: 'select', options: LAYER_BLEND_OPTIONS,
                    write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'blend', value })
                }
            ]
        },
        ...knobSections,
        {
            id: 'info', label: t('inspector.overlaySections.label.info'), collapsedByDefault: true, fields: [
                { name: 'overlay-kind', label: 'kind', getValue: () => deriveOverlayType(snapshot.payload) },
                { name: 'overlay-html', label: 'html', getValue: () => formatPayloadValue(snapshot.payload.html) },
                { name: 'overlay-track', label: t('inspector.overlaySections.label.track'), getValue: () => snapshot.trackName },
                { name: 'overlay-clip', label: t('inspector.overlaySections.label.clip'), getValue: () => snapshot.clipName }
            ]
        }
    ]);
}
