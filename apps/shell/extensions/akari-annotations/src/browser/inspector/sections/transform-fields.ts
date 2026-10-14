import { t as translate } from '@akari-video/i18n';
// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { InspectorWriteRequest, InspectorWriteResult, TimelineCutSelection } from '../../timeline-selection-model';
import { createInspectorCropWriteRequest, INSPECTOR_CROP_DISPLAY_SCALE, INSPECTOR_CROP_SCRUB_STEP, inspectorCropAxisMaximum, normalizeInspectorCrop, type InspectorCropAxis } from '../crop-fields';
import { normalizeInspectorPerspective, updateInspectorPerspective, validateInspectorPerspective, type InspectorPerspectiveCorner, type InspectorPerspectiveAxis } from '../perspective-fields';
import { addCutFramingKeyframe, createCutFramingCropWriteRequest, readCutFraming, removeCutFramingKeyframe, replaceCutFramingKeyframe, type CutFramingKeyframe } from '../framing-fields';
import { createCutFreezeWriteRequest, cutPlaybackDuration, resolveCutFreezeDisplayAt } from '../freeze-fields';
import { type InspectorFieldDef } from './types';

export function CROP_FIELDS<TSnapshot extends { id: string; crop?: unknown }>(
    snapshot: TSnapshot,
    targetKind: 'layer' | 'item',
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TSnapshot>[] {
    const crop = normalizeInspectorCrop(snapshot.crop);
    const rows: ReadonlyArray<{ axis: InspectorCropAxis; label: string }> = [
        { axis: 'x', label: translate('inspector.transformFields.label.left') },
        { axis: 'y', label: translate('inspector.transformFields.label.up') },
        { axis: 'w', label: translate('inspector.transformFields.label.width') },
        { axis: 'h', label: translate('inspector.transformFields.label.height') }
    ];
    return rows.map(({ axis, label }) => ({
        name: `crop-${axis}`,
        label,
        unit: '%',
        displayScale: INSPECTOR_CROP_DISPLAY_SCALE,
        getValue: () => String(crop[axis]),
        getEditValue: () => String(crop[axis]),
        inputKind: 'scrub-number',
        scrubStep: INSPECTOR_CROP_SCRUB_STEP,
        liveField: `crop.${axis}`,
        min: 0,
        max: inspectorCropAxisMaximum(crop, axis),
        removable: true,
        write: async (_snapshot, value) => requestWrite(createInspectorCropWriteRequest(
            { kind: targetKind, id: snapshot.id }, axis, Number(value)
        )),
        reset: () => requestWrite(createInspectorCropWriteRequest(
            { kind: targetKind, id: snapshot.id }, axis, null
        ))
    }));
}

export function PERSPECTIVE_FIELDS<TSnapshot extends {
    id: string; perspective?: Record<string, unknown>; keyframes?: readonly Record<string, unknown>[];
}>(
    snapshot: TSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TSnapshot>[] {
    const corners = normalizeInspectorPerspective(snapshot.perspective);
    const rows: ReadonlyArray<{ corner: InspectorPerspectiveCorner; label: string }> = [
        { corner: 'tl', label: translate('inspector.transformFields.corner.topLeft') }, { corner: 'tr', label: translate('inspector.transformFields.label.top') },
        { corner: 'bl', label: translate('inspector.transformFields.label.bottomLeft') }, { corner: 'br', label: translate('inspector.transformFields.label.rightBottom') }
    ];
    const write = async (
        current: TSnapshot, corner: InspectorPerspectiveCorner, axis: InspectorPerspectiveAxis, input: number | null
    ): Promise<InspectorWriteResult> => {
        try {
            const value = updateInspectorPerspective(current.perspective, corner, axis, input);
            if (value) validateInspectorPerspective(value.corners);
            return await requestWrite({ kind: 'item-field', id: current.id, path: 'perspective', value });
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    };
    const fields = rows.flatMap(({ corner, label }, index) => (['x', 'y'] as const)
        .map((axis, coordinate): InspectorFieldDef<TSnapshot> => ({
            name: `perspective-${corner}-${axis}`, label: `${label} ${axis.toUpperCase()}`,
            unit: '%', displayScale: 100, inputKind: 'scrub-number',
            scrubStep: 0.005, min: 0, max: 1,
            getValue: () => String(corners[index][coordinate]),
            getEditValue: () => String(corners[index][coordinate]),
            liveField: `perspective.${corner}.${axis}`,
            write: (current, input) => write(current, corner, axis, Number(input)),
            reset: current => write(current, corner, axis, null)
        })));
    fields.push({
        name: 'perspective-clear', label: translate('inspector.transformFields.action.remove'), actionLabel: translate('inspector.transformFields.action.remove'), getValue: () => '',
        disabled: snapshot.perspective === undefined,
        action: current => requestWrite({ kind: 'item-field', id: current.id, path: 'perspective', value: null })
    });
    return fields;
}

export const CUT_FRAMING_CROP_DISABLED_TITLE = translate('inspector.transformFields.label.whenZoomKfPresentWindowIgnored');

export function cutFramingFields(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TimelineCutSelection>[] {
    const framing = readCutFraming(snapshot.framing);
    const crop = normalizeInspectorCrop(framing.crop);
    const keyframes = framing.keyframes ?? [];
    const cropDisabled = keyframes.length > 0;
    const duration = Math.max(0, snapshot.outputEnd - snapshot.outputStart);
    const cropRows: ReadonlyArray<{ axis: InspectorCropAxis; label: string }> = [
        { axis: 'x', label: translate('inspector.transformFields.label.left') },
        { axis: 'y', label: translate('inspector.transformFields.label.up') },
        { axis: 'w', label: translate('inspector.transformFields.label.width') },
        { axis: 'h', label: translate('inspector.transformFields.label.height') }
    ];
    const fields: InspectorFieldDef<TimelineCutSelection>[] = cropRows.map(({ axis, label }) => ({
        name: `framing-crop-${axis}`,
        label,
        unit: '%',
        displayScale: INSPECTOR_CROP_DISPLAY_SCALE,
        getValue: () => String(crop[axis]),
        getEditValue: () => String(crop[axis]),
        inputKind: 'scrub-number',
        scrubStep: INSPECTOR_CROP_SCRUB_STEP,
        min: 0,
        max: inspectorCropAxisMaximum(crop, axis),
        disabled: cropDisabled,
        title: cropDisabled ? CUT_FRAMING_CROP_DISABLED_TITLE : undefined,
        write: async (_snapshot, value) => requestWrite(
            createCutFramingCropWriteRequest(snapshot.index, axis, Number(value))
        ),
        reset: () => requestWrite(createCutFramingCropWriteRequest(snapshot.index, axis, null))
    }));

    const replace = async (
        index: number,
        patch: Partial<CutFramingKeyframe>
    ): Promise<InspectorWriteResult> => {
        try {
            return requestWrite({
                kind: 'cut-framing-keyframes',
                index: snapshot.index,
                value: replaceCutFramingKeyframe(keyframes, index, patch)
            });
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    };
    keyframes.forEach((point, index) => {
        const prefix = `framing-keyframe-${index}`;
        const remove = {
            label: translate('inspector.transformFields.action.removeKf'),
            action: async (): Promise<InspectorWriteResult> => requestWrite({
                kind: 'cut-framing-keyframes',
                index: snapshot.index,
                value: removeCutFramingKeyframe(keyframes, index)
            })
        };
        fields.push({
            name: `${prefix}-t`, label: translate('inspector.transformFields.label.kfTime', { index: index + 1 }), unit: translate('inspector.transformFields.label.seconds'),
            getValue: () => String(point.t), getEditValue: () => String(point.t),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: duration,
            menuAction: remove,
            write: async (_snapshot, value) => {
                const t = Number(value);
                return !Number.isFinite(t) || t < 0 || t > duration
                    ? { ok: false, message: translate('inspector.transformFields.message.kfTimeShouldBeEnteredWithinRange', { duration: duration, n: duration }) }
                    : replace(index, { t });
            }
        }, {
            name: `${prefix}-scale`, label: translate('inspector.transformFields.label.kfMagnification', { index: index + 1 }), unit: '×',
            getValue: () => String(point.scale), getEditValue: () => String(point.scale),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 1, max: 10,
            menuAction: remove,
            write: async (_snapshot, value) => {
                const scale = Number(value);
                return !Number.isFinite(scale) || scale < 1 || scale > 10
                    ? { ok: false, message: translate('inspector.transformFields.message.enterKfMagnificationRangeFrom110') }
                    : replace(index, { scale });
            }
        }, ...(['cx', 'cy'] as const).map((axis): InspectorFieldDef<TimelineCutSelection> => ({
            name: `${prefix}-${axis}`,
            label: translate('inspector.transformFields.label.kfCenter', { index: index + 1, axis: axis === 'cx' ? 'X' : 'Y' }),
            unit: '%', displayScale: 100,
            getValue: () => String(point[axis] ?? 0.5),
            getEditValue: () => String(point[axis] ?? 0.5),
            inputKind: 'scrub-number', scrubStep: 0.005, min: 0, max: 1,
            menuAction: remove,
            write: async (_snapshot, value) => {
                const coordinate = Number(value);
                return !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1
                    ? { ok: false, message: translate('inspector.transformFields.message.enterKfCenterRangeFrom0100', { percent: axis === 'cx' ? 'X' : 'Y' }) }
                    : replace(index, { [axis]: coordinate });
            },
            reset: () => replace(index, { [axis]: undefined })
        })));
    });
    fields.push({
        name: 'framing-keyframe-add', label: translate('inspector.transformFields.action.add'), actionLabel: translate('inspector.transformFields.label.addZoomKf'),
        getValue: () => '',
        action: async () => {
            const playhead = Math.max(0, Math.min(
                duration,
                (snapshot.playheadSeconds ?? snapshot.outputStart) - snapshot.outputStart
            ));
            try {
                return requestWrite({
                    kind: 'cut-framing-keyframes',
                    index: snapshot.index,
                    value: addCutFramingKeyframe(keyframes, playhead, duration)
                });
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        }
    });
    return fields;
}

export function cutFreezeFields(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TimelineCutSelection>[] {
    const duration = cutPlaybackDuration({
        in: snapshot.sourceIn,
        out: snapshot.sourceOut,
        ...(snapshot.speed !== undefined ? { speed: snapshot.speed } : {})
    });
    const at = resolveCutFreezeDisplayAt(
        snapshot.freeze,
        snapshot.playheadSeconds,
        snapshot.outputStart,
        duration
    );
    return [{
        name: 'freeze-at', label: translate('inspector.transformFields.label.stationaryTime'), unit: translate('inspector.transformFields.label.seconds'),
        getValue: () => String(at), getEditValue: () => String(at),
        inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: duration,
        write: async (_snapshot, value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return { ok: false, message: translate('inspector.transformFields.message.enterTimeLimit') };
            return requestWrite(createCutFreezeWriteRequest(snapshot.index, 'at', parsed));
        }
    }, {
        name: 'freeze-duration', label: translate('inspector.transformFields.label.freezeDuration'), unit: translate('inspector.transformFields.label.seconds'), removable: true,
        getValue: () => String(snapshot.freeze?.duration_sec ?? 0),
        getEditValue: () => String(snapshot.freeze?.duration_sec ?? 0),
        inputKind: 'scrub-number', scrubStep: 0.01, min: 0,
        write: async (_snapshot, value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, message: translate('inspector.transformFields.message.enterStaticScaleLimit0More') };
            return requestWrite(createCutFreezeWriteRequest(snapshot.index, 'duration', parsed));
        },
        reset: () => requestWrite(createCutFreezeWriteRequest(snapshot.index, 'duration', null))
    }];
}
