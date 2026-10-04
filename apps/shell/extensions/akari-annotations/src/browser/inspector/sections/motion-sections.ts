// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { InspectorWriteRequest, InspectorWriteResult } from '../../timeline-selection-model';
import { createMotionWriteRequest, normalizeInspectorMotion, MOTION_IN_OUT_PRESETS, MOTION_LOOP_PRESETS, MOTION_EASES, MOTION_PRESET_LABELS, MOTION_DURATION_DEFAULTS, MOTION_AMOUNT_DEFAULTS, type InspectorMotionSnapshot, type InspectorMotionSlot, type InspectorMotionField } from '../motion-fields';
import { type InspectorSnapshot, type InspectorFieldDef, type InspectorSection } from './types';

export function MOTION_FIELDS<T extends InspectorMotionSnapshot>(
    snapshot: T,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef[] {
    const motion = normalizeInspectorMotion(snapshot.motion);
    return [...(snapshot.sourceKind !== 'caption' && snapshot.sourceKind !== 'captions' ? [{
        name: 'motion-draw', label: '動きを描く', getValue: () => '', actionLabel: 'プレビューで描く',
        action: () => requestWrite({ kind: 'item-field' as const, id: snapshot.id, path: 'motion-draw' as const, value: true })
    }] : []),
    ...(['in', 'loop', 'out'] as const).flatMap((slot: InspectorMotionSlot) => {
        const label = slot === 'in' ? '登場' : slot === 'out' ? '退場' : '強調';
        const seat = motion[slot];
        const amount = seat ? MOTION_AMOUNT_DEFAULTS[seat.preset] : undefined;
        const missingTitle = 'プリセットを選ぶと変更できます。';
        const write = async (_current: InspectorSnapshot, field: InspectorMotionField, input: string | null): Promise<InspectorWriteResult> => {
            try {
                return await requestWrite(createMotionWriteRequest(snapshot, slot, field, input));
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        };
        const selected = seat ? MOTION_PRESET_LABELS[seat.preset] : 'なし';
        const ease = seat?.ease ?? 'linear';
        const easeOptions: string[] = [...MOTION_EASES];
        if (!easeOptions.includes(ease)) easeOptions.push(ease);
        const frames = slot === 'loop' ? motion.loop?.period : motion[slot]?.duration;
        return ([
            {
                name: `motion-${slot}-preset`, label, inputKind: 'select',
                options: ['なし', ...(slot === 'loop' ? MOTION_LOOP_PRESETS : MOTION_IN_OUT_PRESETS).map(id => MOTION_PRESET_LABELS[id])],
                getValue: () => selected, getEditValue: () => selected, disabled: false,
                write: (current, input) => write(current, 'preset', input), reset: current => write(current, 'preset', null)
            },
            {
                name: `motion-${slot}-duration`, label: slot === 'loop' ? '周期' : `${label}の尺`,
                inputKind: 'scrub-number', unit: 'f', scrubStep: 1, displayPrecision: 0, min: 1,
                ...(slot === 'loop' ? {} : { max: snapshot.durationFrames }),
                getValue: () => String(frames ?? MOTION_DURATION_DEFAULTS[slot]),
                getEditValue: () => String(frames ?? MOTION_DURATION_DEFAULTS[slot]),
                disabled: !seat, title: seat ? undefined : missingTitle,
                write: (current, input) => write(current, 'duration', input), reset: current => write(current, 'duration', null)
            },
            {
                name: `motion-${slot}-ease`, label: `${label}のイージング`, inputKind: 'select', options: easeOptions,
                getValue: () => ease, getEditValue: () => ease,
                disabled: !seat, title: seat ? undefined : missingTitle,
                write: (current, input) => write(current, 'ease', input), reset: current => write(current, 'ease', null)
            },
            {
                name: `motion-${slot}-amount`, label: `${label}の量`, inputKind: 'scrub-number',
                unit: amount?.unit, scrubStep: amount?.unit === '倍' || amount?.unit === '量' ? 0.01 : 1,
                getValue: () => String(seat?.amount ?? amount?.value ?? 0),
                getEditValue: () => String(seat?.amount ?? amount?.value ?? 0),
                disabled: !seat || !amount, title: !seat ? missingTitle : !amount ? 'このプリセットに量はありません' : undefined,
                write: (current, input) => write(current, 'amount', input), reset: current => write(current, 'amount', null)
            }
        ] satisfies InspectorFieldDef[]).map(field => ({ ...field, keyframeDisabled: true }));
    })];
}

export function MOTION_SECTIONS(snapshot: InspectorMotionSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>): InspectorSection[] {
    const fields = MOTION_FIELDS(snapshot, requestWrite);
    return [
        { id: 'motion:draw', label: '動きを描く', fields: fields.filter(field => field.name === 'motion-draw') },
        ...([['in', '登場'], ['loop', '強調'], ['out', '退場']] as const).map(([slot, label]) => ({
            id: `motion:${slot}`, label,
            fields: fields.filter(field => field.name?.startsWith(`motion-${slot}-`))
        }))
    ].filter(section => section.fields.length > 0);
}

export function MOTION_SUMMARY_SECTION(motion: Record<string, unknown> | undefined, open?: () => void): InspectorSection {
    return { id: 'motion-summary', label: '動き', fields: [{
        name: 'motion-summary', label: '現在の動き',
        getValue: () => ['in', 'loop', 'out'].map(slot => {
            const seat = motion?.[slot] as { preset?: string } | undefined;
            return seat?.preset ? `${slot === 'in' ? '登場' : slot === 'out' ? '退場' : '強調'}: ${MOTION_PRESET_LABELS[seat.preset as keyof typeof MOTION_PRESET_LABELS] ?? seat.preset}` : '';
        }).filter(Boolean).join(' / ') || 'なし'
    }, {
        name: 'motion-open', label: '詳しい設定', getValue: () => '', actionLabel: '動きタブで開く',
        action: async () => { open?.(); return { ok: true }; }
    }] };
}

export function MOTION_EMPTY_SECTION(message = 'この要素で使える動きはまだありません'): InspectorSection {
    return { id: 'motion-empty', label: '動き', fields: [{
        name: 'motion-unavailable', label: '設定', getValue: () => message
    }] };
}
