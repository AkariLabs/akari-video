import { t } from '@akari-video/i18n';
// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { isScene3dItem, type ItemV2 } from '@akari-video/edit-store';
import { InspectorWriteRequest, InspectorWriteResult, LivePreviewRequest, LivePreviewTarget, TimelineOverlaySelection, TimelineTreeItemSnapshot } from '../../timeline-selection-model';
import { enableShapeStroke, shapeControlGroups, shapeNumber, shapeOptionValue, swapShapeEnds } from '../shape-fields';
import { shapeLiveMarkup } from '../shape-live';
import { itemMotionMarks } from '../motion-marks';
import { composeInspectorSections } from '../section-model';
import { type InspectorFieldDef, type InspectorSection } from './types';
import { formatTimestamp, formatDurationSeconds } from './shared-helpers';
import { CROP_FIELDS, PERSPECTIVE_FIELDS } from './transform-fields';
import { MASK_FIELDS, PHOTO_FLIP_FIELDS, PHOTO_FRAME_FIELDS, PHOTO_CROP_OPEN_FIELD } from './photo-fields';
import { MOTION_SECTIONS, MOTION_SUMMARY_SECTION } from './motion-sections';
import { ANIMATOR_SECTION } from './animator-section';
import { scene3dSection, type Scene3dSectionContext } from '../scene3d-section';

export function TREE_ITEM_SECTIONS(
    snapshot: TimelineTreeItemSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    openMotion?: () => void,
    requestLivePreview?: (request: LivePreviewRequest) => void,
    scene3d: Scene3dSectionContext = {}
): InspectorSection[] {
    const scene3dItem = snapshot.source?.kind === 'html' && isScene3dItem({
        source: snapshot.source, keyframes: snapshot.keyframes as ItemV2['keyframes']
    });
    const scene3dSnapshot: TimelineOverlaySelection = {
        kind: 'overlay', id: snapshot.id, outputStart: snapshot.outputStart,
        playheadSeconds: snapshot.playheadSeconds, duration: snapshot.duration,
        durationFrames: snapshot.durationFrames, keyframes: snapshot.keyframes,
        trackName: snapshot.trackName, clipName: snapshot.clipName,
        payload: { source: snapshot.source, vars: snapshot.source?.kind === 'html' ? snapshot.source.vars : undefined }
    };
    const number = (key: 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate', fallback: number): number =>
        typeof snapshot.transform?.[key] === 'number' ? snapshot.transform[key]! : fallback;
    const axisScale = (axis: 'scaleX' | 'scaleY'): number => number(axis, number('scale', 1));
    const overallScale = (): number => Math.sqrt(axisScale('scaleX') * axisScale('scaleY'));
    const cropFields = CROP_FIELDS(snapshot, 'item', requestWrite);
    const maskFields = MASK_FIELDS(snapshot, requestWrite);
    const perspectiveSection = {
        id: 'perspective', label: t('inspector.treeItemSections.label.fourCornerPerspective'), collapsedByDefault: true,
        fields: PERSPECTIVE_FIELDS(snapshot, requestWrite)
    };
    const transformFields: InspectorFieldDef<TimelineTreeItemSnapshot>[] = [
        {
            name: 'transform-x', label: 'X', unit: 'px', getValue: () => String(number('x', 0)),
            getEditValue: () => String(number('x', 0)), inputKind: 'scrub-number', scrubStep: 1,
            liveField: 'x', write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.x', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.x', value: null })
        },
        {
            name: 'transform-y', label: 'Y', unit: 'px', getValue: () => String(number('y', 0)),
            getEditValue: () => String(number('y', 0)), inputKind: 'scrub-number', scrubStep: 1,
            liveField: 'y', write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.y', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.y', value: null })
        },
        {
            name: 'transform-scale', label: t('inspector.treeItemSections.label.scale'), unit: '%', removable: true,
            getValue: () => String(overallScale() * 100), getEditValue: () => String(overallScale() * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: Number(value) / 100
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: null })
        },
        ...(['scaleX', 'scaleY'] as const).map((axis, index): InspectorFieldDef<TimelineTreeItemSnapshot> => ({
            name: `transform-${axis}`, label: index === 0 ? t('inspector.treeItemSections.label.width') : t('inspector.treeItemSections.label.height'), unit: '%', removable: true,
            getValue: () => String(axisScale(axis) * 100), getEditValue: () => String(axisScale(axis) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: axis,
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: Number(value) / 100
            }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: null })
        })),
        ...(!scene3dItem || number('rotate', 0) !== 0 ? [{
            name: 'transform-rotate', label: t('inspector.treeItemSections.label.rotation'), unit: '°', removable: true,
            getValue: () => String(number('rotate', 0)), getEditValue: () => String(number('rotate', 0)),
            inputKind: 'scrub-number' as const, scrubStep: 0.1, liveField: 'rotate' as const,
            write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: null })
        }] : [])
    ];
    const opacity = snapshot.opacity ?? 1;
    const shapeGroups = shapeControlGroups(snapshot.shape, snapshot.shapeParams);
    const liveShape = (key: string, value: string | number | undefined): void => {
        if (!requestLivePreview) return;
        const target: LivePreviewTarget = { kind: 'item', id: snapshot.id };
        if (value === undefined) {
            requestLivePreview({ target, field: 'shape', value: 0, clear: true });
            return;
        }
        const shapeHtml = shapeLiveMarkup({
            itemId: snapshot.id,
            shape: snapshot.shape,
            params: snapshot.shapeParams,
            outputWidth: snapshot.outputWidth,
            transform: snapshot.transform
        }, key, value);
        if (shapeHtml !== undefined) requestLivePreview({ target, field: 'shape', value: 0, shapeHtml });
    };
    const shapeFields = (id: 'appearance' | 'bubble'): InspectorFieldDef<TimelineTreeItemSnapshot>[] =>
        (shapeGroups.find(group => group.id === id)?.fields ?? []).map(field => ({
            name: `shape-${field.key}`, label: field.label, inputKind: field.kind === 'number' ? 'scrub-number' : field.kind,
            ...(field.options ? { options: field.options } : {}),
            ...(field.min === undefined ? {} : { min: field.min }),
            ...(field.max === undefined ? {} : { max: field.max }),
            ...(field.kind === 'number' ? { scrubStep: 1 } : {}),
            ...(field.kind === 'number' ? { liveShape: (value: number | undefined) => liveShape(field.key, value) } : {}),
            ...(field.kind === 'color' ? { liveColor: (value: string) => liveShape(field.key, value) } : {}),
            ...(field.kind === 'select' ? { liveSelect: (value: string | undefined) => liveShape(field.key, value) } : {}),
            getValue: () => field.value, getEditValue: () => field.value,
            write: async (_snapshot, value) => {
                const key = field.key.endsWith('Mode') ? field.key.slice(0, -4) : field.key;
                const next = field.key.endsWith('Mode') ? value === t('inspector.treeItemSections.label.none') ? 'none'
                    : key === 'fill' ? snapshot.shape === 'bubble' ? '#ffffff' : '#a6a6a6' : '#000000'
                    : field.kind === 'number' ? snapshot.shape === 'line' && key === 'strokeWidth'
                        ? Math.max(1, shapeNumber(key, value) ?? 1) : shapeNumber(key, value)
                        : field.kind === 'select' ? shapeOptionValue(key, value) : value;
                if (next === undefined) return { ok: false, message: t('inspector.treeItemSections.message.selectValue') };
                if (field.key === 'strokeMode' && value === t('inspector.treeItemSections.label.color')
                    && !(Number(snapshot.shapeParams?.strokeWidth ?? 0) > 0)) {
                    return requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.params',
                        value: enableShapeStroke(snapshot.shapeParams ?? {}) });
                }
                return requestWrite({ kind: 'item-field', id: snapshot.id, path: `source.params.${key}`, value: next });
            }
        }));
    const shapeAppearance = shapeFields('appearance');
    if (snapshot.shape === 'line' || snapshot.shape === 'arrow') shapeAppearance.push({
        name: 'shape-swap-ends', label: t('inspector.treeItemSections.label.firstLast'), getValue: () => '', actionLabel: t('inspector.treeItemSections.action.replace'),
        action: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.params',
            value: swapShapeEnds(snapshot.shapeParams ?? {}) })
    });
    const shapeBubble = shapeFields('bubble');
    if (snapshot.shape === 'bubble') shapeBubble.push({
        name: 'shape-next-seed', label: t('inspector.treeItemSections.label.shapeChange'), getValue: () => '', actionLabel: t('inspector.treeItemSections.action.makeDifferentShapes'),
        action: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.params.seed',
            value: Number(snapshot.shapeParams?.seed ?? 0) + 1 })
    });
    return composeInspectorSections([
        ...(snapshot.itemKind === 'group' ? [{ id: 'canvas', label: t('inspector.treeItemSections.label.canvas'), fields: [
            { name: 'canvas-name', label: t('inspector.treeItemSections.label.name'), inputKind: 'text' as const,
                getValue: () => snapshot.clipName, getEditValue: () => snapshot.clipName,
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'name', value
                }) },
            { name: 'canvas-intent', label: t('inspector.treeItemSections.label.intent'), inputKind: 'text' as const,
                getValue: () => snapshot.canvas?.intent ?? '', getEditValue: () => snapshot.canvas?.intent ?? '',
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'source.canvas.intent', value
                }) },
            { name: 'canvas-duration', label: t('inspector.treeItemSections.label.duration'), inputKind: 'number' as const, min: 0.01, unit: t('inspector.treeItemSections.unit.seconds'),
                getValue: () => String(snapshot.duration), getEditValue: () => String(snapshot.duration),
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'duration', value: Number(value)
                }) },
            { name: 'canvas-background-mode', label: t('inspector.treeItemSections.label.background'), inputKind: 'select' as const,
                options: [t('inspector.treeItemSections.label.none'), t('inspector.treeItemSections.label.color')],
                getValue: () => snapshot.canvas?.background?.type === 'color' ? t('inspector.treeItemSections.label.color') : t('inspector.treeItemSections.label.none'),
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'source.canvas.background',
                    value: value === t('inspector.treeItemSections.label.color') ? { type: 'color', color: snapshot.canvas?.background?.color ?? '#142644' } : { type: 'none' }
                }) },
            ...(snapshot.canvas?.background?.type === 'color' ? [{ name: 'canvas-background-color',
                label: t('inspector.treeItemSections.label.backgroundColor'), inputKind: 'color' as const,
                getValue: () => snapshot.canvas?.background?.color ?? '#142644',
                getEditValue: () => snapshot.canvas?.background?.color ?? '#142644',
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => /^#[0-9a-fA-F]{6}$/u.test(value)
                    ? requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.canvas.background',
                        value: { type: 'color', color: value } })
                    : { ok: false, message: t('inspector.treeItemSections.message.rrggbb') } }] : [])
        ] }] : []),
        { id: 'time', label: t('inspector.treeItemSections.label.time'), fields: [
            { name: 'item-start', label: t('inspector.treeItemSections.label.outputPosition'), getValue: () => formatTimestamp(snapshot.outputStart) },
            { name: 'item-duration', label: t('inspector.treeItemSections.label.duration'), getValue: () => formatDurationSeconds(snapshot.duration) }
        ] },
        { id: 'transform', label: t('inspector.treeItemSections.label.transform'), fields: (['group', 'bag'].includes(snapshot.itemKind)
            ? transformFields.filter(field => field.name !== 'transform-scaleX' && field.name !== 'transform-scaleY')
            : transformFields).map(field => ({ ...field,
                markers: itemMotionMarks(snapshot, `transform.${field.name?.slice('transform-'.length)}`) })) },
        ...(scene3dItem ? [scene3dSection(scene3dSnapshot, requestWrite, scene3d)] : []),
        { id: 'crop', label: t('inspector.treeItemSections.label.crop'), fields: cropFields.map(field => ({ ...field,
            markers: itemMotionMarks(snapshot, 'crop') })) },
        perspectiveSection,
        ...(snapshot.itemKind === 'captions' || snapshot.itemKind === 'caption' ? [] : [
            MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
            ...MOTION_SECTIONS(snapshot, requestWrite)
        ]),
        ...(snapshot.itemKind === 'captions' || snapshot.itemKind === 'caption' ? [
            ANIMATOR_SECTION(snapshot.id, t('inspector.treeItemSections.label.animator'), snapshot.animator, requestWrite)
        ] : []),
        { id: 'appearance', label: t('inspector.treeItemSections.label.appearance'), fields: [{
            name: 'opacity', label: t('inspector.treeItemSections.label.opacity'), unit: '%', displayScale: 100,
            markers: itemMotionMarks(snapshot, 'opacity'),
            getValue: () => String(opacity), getEditValue: () => String(opacity),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1, liveField: 'opacity',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'opacity', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: null })
        }, ...shapeAppearance, ...(!snapshot.photo ? maskFields : []),
        ...(snapshot.photo ? [...PHOTO_FLIP_FIELDS(snapshot, requestWrite),
            ...PHOTO_CROP_OPEN_FIELD(snapshot, requestWrite), ...PHOTO_FRAME_FIELDS(snapshot, requestWrite)] : [])] },
        ...(shapeBubble.length ? [{ id: 'bubble', label: t('inspector.treeItemSections.label.speechBubble'), fields: shapeBubble }] : []),
        { id: 'info', label: t('inspector.treeItemSections.label.info'), collapsedByDefault: true, fields: [
            { name: 'item-kind', label: t('inspector.treeItemSections.label.type'), getValue: () => snapshot.sourceKind === 'group' ? t('inspector.treeItemSections.label.canvas') : snapshot.sourceKind },
            { name: 'item-track', label: t('inspector.treeItemSections.label.track'), getValue: () => snapshot.trackName },
            { name: 'item-clip', label: t('inspector.treeItemSections.label.clip'), getValue: () => snapshot.clipName }
        ] }
    ]);
}
