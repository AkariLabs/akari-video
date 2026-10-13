import { t } from '@akari-video/i18n';
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
        name: 'motion-draw', label: t('inspector.motionSections.label.movement'), getValue: () => '', actionLabel: t('inspector.motionSections.action.drawingPreview'),
        action: () => requestWrite({ kind: 'item-field' as const, id: snapshot.id, path: 'motion-draw' as const, value: true })
    }] : []),
    ...(['in', 'loop', 'out'] as const).flatMap((slot: InspectorMotionSlot) => {
        const label = slot === 'in' ? t('inspector.motionSections.label.entrance') : slot === 'out' ? t('inspector.motionSections.label.exit') : t('inspector.motionSections.label.emphasis');
        const seat = motion[slot];
        const amount = seat ? MOTION_AMOUNT_DEFAULTS[seat.preset] : undefined;
        const missingTitle = t('inspector.motionSections.message.canChangePreset');
        const write = async (_current: InspectorSnapshot, field: InspectorMotionField, input: string | null): Promise<InspectorWriteResult> => {
            try {
                return await requestWrite(createMotionWriteRequest(snapshot, slot, field, input));
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        };
        const selected = seat ? MOTION_PRESET_LABELS[seat.preset] : t('inspector.motionSections.label.none');
        const ease = seat?.ease ?? 'linear';
        const easeOptions: string[] = [...MOTION_EASES];
        if (!easeOptions.includes(ease)) easeOptions.push(ease);
        const frames = slot === 'loop' ? motion.loop?.period : motion[slot]?.duration;
        return ([
            {
                name: `motion-${slot}-preset`, label, inputKind: 'select',
                options: [t('inspector.motionSections.label.none'), ...(slot === 'loop' ? MOTION_LOOP_PRESETS : MOTION_IN_OUT_PRESETS).map(id => MOTION_PRESET_LABELS[id])],
                getValue: () => selected, getEditValue: () => selected, disabled: false,
                write: (current, input) => write(current, 'preset', input), reset: current => write(current, 'preset', null)
            },
            {
                name: `motion-${slot}-duration`, label: slot === 'loop' ? t('inspector.motionSections.label.cycle') : t('inspector.motionSections.label.motionDuration', { label: label }),
                inputKind: 'scrub-number', unit: 'f', scrubStep: 1, displayPrecision: 0, min: 1,
                ...(slot === 'loop' ? {} : { max: snapshot.durationFrames }),
                getValue: () => String(frames ?? MOTION_DURATION_DEFAULTS[slot]),
                getEditValue: () => String(frames ?? MOTION_DURATION_DEFAULTS[slot]),
                disabled: !seat, title: seat ? undefined : missingTitle,
                write: (current, input) => write(current, 'duration', input), reset: current => write(current, 'duration', null)
            },
            {
                name: `motion-${slot}-ease`, label: t('inspector.motionSections.label.easing', { label: label }), inputKind: 'select', options: easeOptions,
                getValue: () => ease, getEditValue: () => ease,
                disabled: !seat, title: seat ? undefined : missingTitle,
                write: (current, input) => write(current, 'ease', input), reset: current => write(current, 'ease', null)
            },
            {
                name: `motion-${slot}-amount`, label: t('inspector.motionSections.label.motionAmount', { label: label }), inputKind: 'scrub-number',
                unit: amount?.unit, scrubStep: amount?.unit === t('inspector.motionSections.label.double') || amount?.unit === t('inspector.motionSections.label.amount') ? 0.01 : 1,
                getValue: () => String(seat?.amount ?? amount?.value ?? 0),
                getEditValue: () => String(seat?.amount ?? amount?.value ?? 0),
                disabled: !seat || !amount, title: !seat ? missingTitle : !amount ? t('inspector.motionSections.label.noQuantityPreset') : undefined,
                write: (current, input) => write(current, 'amount', input), reset: current => write(current, 'amount', null)
            }
        ] satisfies InspectorFieldDef[]).map(field => ({ ...field, keyframeDisabled: true }));
    })];
}

export function MOTION_SECTIONS(snapshot: InspectorMotionSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>): InspectorSection[] {
    const fields = MOTION_FIELDS(snapshot, requestWrite);
    return [
        { id: 'motion:draw', label: t('inspector.motionSections.label.movement'), fields: fields.filter(field => field.name === 'motion-draw') },
        ...([['in', t('inspector.motionSections.label.entrance')], ['loop', t('inspector.motionSections.label.emphasis')], ['out', t('inspector.motionSections.label.exit')]] as const).map(([slot, label]) => ({
            id: `motion:${slot}`, label,
            fields: fields.filter(field => field.name?.startsWith(`motion-${slot}-`))
        }))
    ].filter(section => section.fields.length > 0);
}

export function MOTION_SUMMARY_SECTION(motion: Record<string, unknown> | undefined, open?: () => void): InspectorSection {
    return { id: 'motion-summary', label: t('inspector.motionSections.label.motion'), fields: [{
        name: 'motion-summary', label: t('inspector.motionSections.label.currentMovement'),
        getValue: () => ['in', 'loop', 'out'].map(slot => {
            const seat = motion?.[slot] as { preset?: string } | undefined;
            return seat?.preset ? `${slot === 'in' ? t('inspector.motionSections.label.entrance') : slot === 'out' ? t('inspector.motionSections.label.exit') : t('inspector.motionSections.label.emphasis')}: ${MOTION_PRESET_LABELS[seat.preset as keyof typeof MOTION_PRESET_LABELS] ?? seat.preset}` : '';
        }).filter(Boolean).join(' / ') || t('inspector.motionSections.label.none')
    }, {
        name: 'motion-open', label: t('inspector.motionSections.label.detailedSettings'), getValue: () => '', actionLabel: t('inspector.motionSections.action.openMotionTab'),
        action: async () => { open?.(); return { ok: true }; }
    }] };
}

export function MOTION_EMPTY_SECTION(message = t('inspector.motionSections.message.thereNoMovementAvailableElement')): InspectorSection {
    return { id: 'motion-empty', label: t('inspector.motionSections.label.motion'), fields: [{
        name: 'motion-unavailable', label: t('inspector.motionSections.label.settings'), getValue: () => message
    }] };
}
