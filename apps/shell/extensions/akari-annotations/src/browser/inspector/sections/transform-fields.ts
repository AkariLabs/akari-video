// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import { InspectorWriteRequest, InspectorWriteResult, TimelineCutSelection } from '../../timeline-selection-model';
import { createInspectorCropWriteRequest, INSPECTOR_CROP_DISPLAY_SCALE, INSPECTOR_CROP_SCRUB_STEP, inspectorCropAxisMaximum, normalizeInspectorCrop, type InspectorCropAxis } from '../crop-fields';
import { normalizeInspectorPerspective, updateInspectorPerspective, validateInspectorPerspective, type InspectorPerspectiveCorner, type InspectorPerspectiveAxis } from '../perspective-fields';
import { createCutTransitionWriteRequest, transitionOptionLabel } from '../transition-fields';
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
        { axis: 'x', label: '左' },
        { axis: 'y', label: '上' },
        { axis: 'w', label: '幅' },
        { axis: 'h', label: '高さ' }
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
        { corner: 'tl', label: '左上' }, { corner: 'tr', label: '右上' },
        { corner: 'bl', label: '左下' }, { corner: 'br', label: '右下' }
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
        name: 'perspective-clear', label: '解除', actionLabel: '解除', getValue: () => '',
        disabled: snapshot.perspective === undefined,
        action: current => requestWrite({ kind: 'item-field', id: current.id, path: 'perspective', value: null })
    });
    return fields;
}

export function cutTransitionFields(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TimelineCutSelection>[] {
    const options: string[] = ['なし', ...TRANSITION_VOCABULARY.map(entry => entry.labelJa)];
    const selected = transitionOptionLabel(snapshot.transitionOut?.type);
    if (!options.includes(selected)) options.push(selected);
    const blocked = snapshot.transitionOutBlocked !== undefined;
    const write = async (
        current: TimelineCutSelection, row: 'transition-type' | 'transition-duration', input: string | null
    ): Promise<InspectorWriteResult> => {
        try {
            return await requestWrite(createCutTransitionWriteRequest(current, row, input));
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    };
    return [{
        name: 'transition-type', label: 'トランジション', inputKind: 'select', options,
        getValue: () => selected, getEditValue: () => selected,
        disabled: blocked, title: snapshot.transitionOutBlocked,
        write: (current, input) => write(current, 'transition-type', input)
    }, {
        name: 'transition-duration', label: 'トランジション尺', inputKind: 'scrub-number',
        unit: 's', min: 0.1, max: 3, scrubStep: 0.05, displayPrecision: 2,
        getValue: () => String(snapshot.transitionOut?.duration ?? 0.5),
        getEditValue: () => String(snapshot.transitionOut?.duration ?? 0.5),
        disabled: blocked || !snapshot.transitionOut,
        title: snapshot.transitionOutBlocked ?? (!snapshot.transitionOut ? 'トランジションを選ぶと変更できます' : undefined),
        write: (current, input) => write(current, 'transition-duration', input),
        reset: current => write(current, 'transition-duration', null)
    }];
}

export const CUT_FRAMING_CROP_DISABLED_TITLE = 'ズーム KF があるときは窓は無視されます';

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
        { axis: 'x', label: '左' },
        { axis: 'y', label: '上' },
        { axis: 'w', label: '幅' },
        { axis: 'h', label: '高さ' }
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
            label: 'この KF を削除',
            action: async (): Promise<InspectorWriteResult> => requestWrite({
                kind: 'cut-framing-keyframes',
                index: snapshot.index,
                value: removeCutFramingKeyframe(keyframes, index)
            })
        };
        fields.push({
            name: `${prefix}-t`, label: `KF ${index + 1} 時刻`, unit: '秒',
            getValue: () => String(point.t), getEditValue: () => String(point.t),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: duration,
            menuAction: remove,
            write: async (_snapshot, value) => {
                const t = Number(value);
                return !Number.isFinite(t) || t < 0 || t > duration
                    ? { ok: false, message: `KF 時刻は 0〜${duration} 秒の範囲で入力してください。` }
                    : replace(index, { t });
            }
        }, {
            name: `${prefix}-scale`, label: `KF ${index + 1} 倍率`, unit: '×',
            getValue: () => String(point.scale), getEditValue: () => String(point.scale),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 1, max: 10,
            menuAction: remove,
            write: async (_snapshot, value) => {
                const scale = Number(value);
                return !Number.isFinite(scale) || scale < 1 || scale > 10
                    ? { ok: false, message: 'KF 倍率は 1〜10 の範囲で入力してください。' }
                    : replace(index, { scale });
            }
        }, ...(['cx', 'cy'] as const).map((axis): InspectorFieldDef<TimelineCutSelection> => ({
            name: `${prefix}-${axis}`,
            label: `KF ${index + 1} 中心 ${axis === 'cx' ? 'X' : 'Y'}`,
            unit: '%', displayScale: 100,
            getValue: () => String(point[axis] ?? 0.5),
            getEditValue: () => String(point[axis] ?? 0.5),
            inputKind: 'scrub-number', scrubStep: 0.005, min: 0, max: 1,
            menuAction: remove,
            write: async (_snapshot, value) => {
                const coordinate = Number(value);
                return !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1
                    ? { ok: false, message: `KF 中心 ${axis === 'cx' ? 'X' : 'Y'} は 0〜100% の範囲で入力してください。` }
                    : replace(index, { [axis]: coordinate });
            },
            reset: () => replace(index, { [axis]: undefined })
        })));
    });
    fields.push({
        name: 'framing-keyframe-add', label: '追加', actionLabel: '＋ ズーム KF を追加',
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
        name: 'freeze-at', label: '静止時刻', unit: '秒',
        getValue: () => String(at), getEditValue: () => String(at),
        inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: duration,
        write: async (_snapshot, value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return { ok: false, message: '静止時刻は有限数で入力してください。' };
            return requestWrite(createCutFreezeWriteRequest(snapshot.index, 'at', parsed));
        }
    }, {
        name: 'freeze-duration', label: '静止尺', unit: '秒', removable: true,
        getValue: () => String(snapshot.freeze?.duration_sec ?? 0),
        getEditValue: () => String(snapshot.freeze?.duration_sec ?? 0),
        inputKind: 'scrub-number', scrubStep: 0.01, min: 0,
        write: async (_snapshot, value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, message: '静止尺は 0 以上の有限数で入力してください。' };
            return requestWrite(createCutFreezeWriteRequest(snapshot.index, 'duration', parsed));
        },
        reset: () => requestWrite(createCutFreezeWriteRequest(snapshot.index, 'duration', null))
    }];
}
