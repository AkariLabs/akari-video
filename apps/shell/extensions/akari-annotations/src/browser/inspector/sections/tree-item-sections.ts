// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { InspectorWriteRequest, InspectorWriteResult, LivePreviewRequest, LivePreviewTarget, TimelineTreeItemSnapshot } from '../../timeline-selection-model';
import { enableShapeStroke, shapeControlGroups, shapeNumber, shapeOptionValue, swapShapeEnds } from '../shape-fields';
import { shapeLiveMarkup } from '../shape-live';
import { itemMotionMarks } from '../motion-marks';
import { composeInspectorSections } from '../section-model';
import { type InspectorFieldDef, type InspectorSection } from './types';
import { formatTimestamp, formatDurationSeconds } from './shared-helpers';
import { CROP_FIELDS, PERSPECTIVE_FIELDS } from './transform-fields';
import { MASK_FIELDS, PHOTO_FLIP_FIELDS, PHOTO_FRAME_FIELDS, PHOTO_CROP_OPEN_FIELD } from './photo-fields';
import { MOTION_FIELDS, MOTION_SECTIONS, MOTION_SUMMARY_SECTION } from './motion-sections';
import { ANIMATOR_SECTION } from './animator-section';

export function TREE_ITEM_SECTIONS(
    snapshot: TimelineTreeItemSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    openMotion?: () => void,
    requestLivePreview?: (request: LivePreviewRequest) => void
): InspectorSection[] {
    const number = (key: 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate', fallback: number): number =>
        typeof snapshot.transform?.[key] === 'number' ? snapshot.transform[key]! : fallback;
    const axisScale = (axis: 'scaleX' | 'scaleY'): number => number(axis, number('scale', 1));
    const overallScale = (): number => Math.sqrt(axisScale('scaleX') * axisScale('scaleY'));
    const cropFields = CROP_FIELDS(snapshot, 'item', requestWrite);
    const maskFields = MASK_FIELDS(snapshot, requestWrite);
    const perspectiveSection = {
        id: 'perspective', label: 'パース（4 隅）', collapsedByDefault: true,
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
            name: 'transform-scale', label: '拡縮', unit: '%', removable: true,
            getValue: () => String(overallScale() * 100), getEditValue: () => String(overallScale() * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: Number(value) / 100
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: null })
        },
        ...(['scaleX', 'scaleY'] as const).map((axis, index): InspectorFieldDef<TimelineTreeItemSnapshot> => ({
            name: `transform-${axis}`, label: index === 0 ? '幅' : '高さ', unit: '%', removable: true,
            getValue: () => String(axisScale(axis) * 100), getEditValue: () => String(axisScale(axis) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: axis,
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: Number(value) / 100
            }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: null })
        })),
        {
            name: 'transform-rotate', label: '回転', unit: '°', removable: true,
            getValue: () => String(number('rotate', 0)), getEditValue: () => String(number('rotate', 0)),
            inputKind: 'scrub-number', scrubStep: 0.1, liveField: 'rotate',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: null })
        }
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
            getValue: () => field.value, getEditValue: () => field.value,
            write: async (_snapshot, value) => {
                const key = field.key.endsWith('Mode') ? field.key.slice(0, -4) : field.key;
                const next = field.key.endsWith('Mode') ? value === 'なし' ? 'none'
                    : key === 'fill' ? snapshot.shape === 'bubble' ? '#ffffff' : '#a6a6a6' : '#000000'
                    : field.kind === 'number' ? snapshot.shape === 'line' && key === 'strokeWidth'
                        ? Math.max(1, shapeNumber(key, value) ?? 1) : shapeNumber(key, value)
                        : field.kind === 'select' ? shapeOptionValue(key, value) : value;
                if (next === undefined) return { ok: false, message: '値を選び直してください。' };
                if (field.key === 'strokeMode' && value === '色'
                    && !(Number(snapshot.shapeParams?.strokeWidth ?? 0) > 0)) {
                    return requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.params',
                        value: enableShapeStroke(snapshot.shapeParams ?? {}) });
                }
                return requestWrite({ kind: 'item-field', id: snapshot.id, path: `source.params.${key}`, value: next });
            }
        }));
    const shapeAppearance = shapeFields('appearance');
    if (snapshot.shape === 'line' || snapshot.shape === 'arrow') shapeAppearance.push({
        name: 'shape-swap-ends', label: '始点と終点', getValue: () => '', actionLabel: '入れ替え',
        action: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.params',
            value: swapShapeEnds(snapshot.shapeParams ?? {}) })
    });
    const shapeBubble = shapeFields('bubble');
    if (snapshot.shape === 'bubble') shapeBubble.push({
        name: 'shape-next-seed', label: '形の変化', getValue: () => '', actionLabel: '別の形にする',
        action: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.params.seed',
            value: Number(snapshot.shapeParams?.seed ?? 0) + 1 })
    });
    return composeInspectorSections([
        ...(snapshot.itemKind === 'group' ? [{ id: 'canvas', label: 'キャンバス', fields: [
            { name: 'canvas-name', label: '名前', inputKind: 'text' as const,
                getValue: () => snapshot.clipName, getEditValue: () => snapshot.clipName,
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'name', value
                }) },
            { name: 'canvas-intent', label: '意図', inputKind: 'text' as const,
                getValue: () => snapshot.canvas?.intent ?? '', getEditValue: () => snapshot.canvas?.intent ?? '',
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'source.canvas.intent', value
                }) },
            { name: 'canvas-duration', label: '尺', inputKind: 'number' as const, min: 0.01, unit: '秒',
                getValue: () => String(snapshot.duration), getEditValue: () => String(snapshot.duration),
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'duration', value: Number(value)
                }) },
            { name: 'canvas-background-mode', label: '背景', inputKind: 'select' as const,
                options: ['なし', '色'],
                getValue: () => snapshot.canvas?.background?.type === 'color' ? '色' : 'なし',
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'source.canvas.background',
                    value: value === '色' ? { type: 'color', color: snapshot.canvas?.background?.color ?? '#142644' } : { type: 'none' }
                }) },
            ...(snapshot.canvas?.background?.type === 'color' ? [{ name: 'canvas-background-color',
                label: '背景色', inputKind: 'color' as const,
                getValue: () => snapshot.canvas?.background?.color ?? '#142644',
                getEditValue: () => snapshot.canvas?.background?.color ?? '#142644',
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => /^#[0-9a-fA-F]{6}$/u.test(value)
                    ? requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.canvas.background',
                        value: { type: 'color', color: value } })
                    : { ok: false, message: '色は #RRGGBB で入力してください。' } }] : [])
        ] }] : []),
        { id: 'time', label: '時間', fields: [
            { name: 'item-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
            { name: 'item-duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
        ] },
        { id: 'transform', label: '変形', fields: (['group', 'bag'].includes(snapshot.itemKind)
            ? transformFields.filter(field => field.name !== 'transform-scaleX' && field.name !== 'transform-scaleY')
            : transformFields).map(field => ({ ...field,
                markers: itemMotionMarks(snapshot, `transform.${field.name?.slice('transform-'.length)}`) })) },
        { id: 'crop', label: 'クロップ', fields: cropFields.map(field => ({ ...field,
            markers: itemMotionMarks(snapshot, 'crop') })) },
        perspectiveSection,
        MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
        ...(snapshot.itemKind === 'captions' || snapshot.itemKind === 'caption'
            ? [{ id: 'motion', label: '動き', fields: MOTION_FIELDS({ ...snapshot,
                sourceKind: 'caption' }, requestWrite) }] : MOTION_SECTIONS(snapshot, requestWrite)),
        ...(snapshot.itemKind === 'captions' || snapshot.itemKind === 'caption' ? [
            ANIMATOR_SECTION(snapshot.id, 'アニメーター', snapshot.animator, requestWrite)
        ] : []),
        { id: 'appearance', label: '外観', fields: [{
            name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
            markers: itemMotionMarks(snapshot, 'opacity'),
            getValue: () => String(opacity), getEditValue: () => String(opacity),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1, liveField: 'opacity',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'opacity', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: null })
        }, ...shapeAppearance, ...(!snapshot.photo ? maskFields : []),
        ...(snapshot.photo ? [...PHOTO_FLIP_FIELDS(snapshot, requestWrite),
            ...PHOTO_CROP_OPEN_FIELD(snapshot, requestWrite), ...PHOTO_FRAME_FIELDS(snapshot, requestWrite)] : [])] },
        ...(shapeBubble.length ? [{ id: 'bubble', label: '吹き出し', fields: shapeBubble }] : []),
        { id: 'info', label: '情報', collapsedByDefault: true, fields: [
            { name: 'item-kind', label: '種類', getValue: () => snapshot.sourceKind === 'group' ? 'キャンバス' : snapshot.sourceKind },
            { name: 'item-track', label: 'トラック', getValue: () => snapshot.trackName },
            { name: 'item-clip', label: 'クリップ', getValue: () => snapshot.clipName }
        ] }
    ]);
}
