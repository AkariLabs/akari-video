import { t } from '@akari-video/i18n';
// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { InspectorWriteRequest, InspectorWriteResult } from '../../timeline-selection-model';
import { buildRgbCurveEditor, buildHueCurveEditor, buildColorWheelEditor, type AdjustEditorWrite } from '../adjust-editors';
import { INSPECTOR_LOOK_PRESETS, inspectorLookPresetLabel, matchLookPreset } from '../look-presets';
import { buildLutOptions } from '../lut-options';
import { createInspectorAdjustWriteRequest, formatInspectorAdjustValue, INSPECTOR_ADJUST_BASIC_FIELDS, readInspectorAdjustSnapshot } from '../adjust-fields';
import { INSPECTOR_ADJUST_FX, InspectorAdjustFx, addInspectorAdjustFx, removeInspectorAdjustFx, moveInspectorAdjustFx, updateInspectorAdjustFxParam } from '../adjust-fx-fields';
import { ACTIVE_ADJUST_SECTIONS } from '../tab-model';
import { type InspectorSnapshot, type InspectorFieldDef, type InspectorSection } from './types';

export function ADJUST_SECTIONS(
    snapshot: InspectorSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    adjustLutOptions: { projectLutRefs: readonly string[]; importLut?: () => Promise<InspectorWriteResult> }
): InspectorSection[] {
    if (snapshot.kind === 'caption' || snapshot.kind === 'audio') return [];
    const itemId = snapshot.kind === 'cut' ? snapshot.itemId ?? `cut:${snapshot.index}` : snapshot.id;
    const adjust = readInspectorAdjustSnapshot(snapshot.adjust);
    const basicEnabled = adjust.sections.basic;
    const lutEnabled = adjust.sections.lut;
    const fxEnabled = adjust.sections.fx;
    const disabledTitle = t('inspector.adjustSections.error.sectionsOffCannotBeChanged');
    const editorWrite = (section: 'curves' | 'wheels' | 'hue'): AdjustEditorWrite => async (path, value) =>
        adjust.sections[section]
            ? requestWrite(createInspectorAdjustWriteRequest(itemId, path, value))
            : { ok: false, message: disabledTitle };
    const basicFields: InspectorFieldDef[] = INSPECTOR_ADJUST_BASIC_FIELDS.map(field => ({
        name: `adjust-basic-${field.key}`,
        label: field.label,
        getValue: () => formatInspectorAdjustValue(field.key, adjust.basic[field.key]),
        getEditValue: () => String(adjust.basic[field.key]),
        inputKind: 'scrub-number',
        scrubStep: field.scrubStep,
        min: field.minimum,
        max: field.maximum,
        unit: field.unit,
        displayScale: field.displayScale,
        displayOffset: field.displayOffset,
        displayPrecision: field.displayPrecision,
        liveField: `adjust.basic.${field.key}` as const,
        keyframeDisabled: true,
        disabled: !basicEnabled,
        title: basicEnabled ? undefined : disabledTitle,
        write: async (_snapshot, value) => basicEnabled
            ? requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                `adjust.basic.${field.key}`,
                Number(value)
            ))
            : { ok: false, message: disabledTitle },
        reset: () => requestWrite(createInspectorAdjustWriteRequest(
            itemId,
            `adjust.basic.${field.key}`,
            null
        ))
    }));
    const lookName = (): string => {
        const preset = INSPECTOR_LOOK_PRESETS.find(item => item.id === matchLookPreset(adjust));
        return preset ? inspectorLookPresetLabel(preset) : t('inspector.adjustSections.label.custom');
    };
    basicFields.unshift({
        name: 'adjust-look', label: t('inspector.adjustSections.label.look'), inputKind: 'select',
        options: [t('inspector.adjustSections.label.custom'), ...INSPECTOR_LOOK_PRESETS.map(inspectorLookPresetLabel)],
        keyframeDisabled: true, disabled: !basicEnabled, title: basicEnabled ? undefined : disabledTitle,
        getValue: lookName, getEditValue: lookName,
        write: async (_snapshot, value) => {
            if (!basicEnabled) return { ok: false, message: disabledTitle };
            if (value === t('inspector.adjustSections.label.custom')) return { ok: true };
            const preset = INSPECTOR_LOOK_PRESETS.find(candidate => inspectorLookPresetLabel(candidate) === value);
            if (!preset) return { ok: false, message: t('inspector.adjustSections.message.selectLookFromList') };
            return requestWrite(createInspectorAdjustWriteRequest(itemId, 'adjust', {
                basic: preset.adjust.basic, wheels: preset.adjust.wheels
            }));
        }
    });
    const lutOptions = buildLutOptions(adjustLutOptions.projectLutRefs);
    const lutId = lutOptions.find(option => option.value === (adjust.lut?.lut ?? null))?.label ?? adjust.lut!.lut;
    const lutFields: InspectorFieldDef[] = [{
        name: 'adjust-lut-preset',
        label: t('inspector.adjustSections.label.preset'),
        getValue: () => lutId,
        getEditValue: () => lutId,
        inputKind: 'select',
        options: lutOptions.map(option => option.label),
        disabled: !lutEnabled,
        title: lutEnabled ? undefined : disabledTitle,
        write: async (_snapshot, value) => {
            if (!lutEnabled) return { ok: false, message: disabledTitle };
            const option = lutOptions.find(candidate => candidate.label === value);
            if (!option) {
                return { ok: false, message: t('inspector.adjustSections.message.selectLutPresetFromList') };
            }
            return requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                'adjust.lut.lut',
                option.value
            ));
        },
        reset: () => requestWrite(createInspectorAdjustWriteRequest(
            itemId,
            'adjust.lut.lut',
            null
        ))
    }, {
        name: 'adjust-lut-intensity',
        label: t('inspector.adjustSections.label.strength'),
        getValue: () => `${Math.round((adjust.lut?.intensity ?? 1) * 100)}%`,
        getEditValue: () => String(adjust.lut?.intensity ?? 1),
        inputKind: 'scrub-number',
        scrubStep: 0.01,
        min: 0,
        max: 1,
        unit: '%',
        displayScale: 100,
        keyframeDisabled: true,
        disabled: !lutEnabled || !adjust.lut,
        title: !lutEnabled ? disabledTitle
            : !adjust.lut ? t('inspector.adjustSections.message.canChangeLut') : undefined,
        write: async (_snapshot, value) => lutEnabled && adjust.lut
            ? requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                'adjust.lut.intensity',
                Number(value)
            ))
            : { ok: false, message: !lutEnabled ? disabledTitle : t('inspector.adjustSections.action.selectLut') },
        reset: () => requestWrite(createInspectorAdjustWriteRequest(
            itemId,
            'adjust.lut.intensity',
            null
        ))
    }];
    lutFields.push({
        name: 'adjust-lut-import', label: t('inspector.adjustSections.label.loading'), getValue: () => '',
        actionLabel: t('inspector.adjustSections.action.readLut'), keyframeDisabled: true, disabled: !lutEnabled,
        title: lutEnabled ? undefined : disabledTitle,
        action: async () => lutEnabled && adjustLutOptions.importLut
            ? adjustLutOptions.importLut() : { ok: false, message: disabledTitle }
    });
    const writeFx = async (update: () => InspectorAdjustFx[]): Promise<InspectorWriteResult> => {
        if (!fxEnabled) return { ok: false, message: disabledTitle };
        try {
            return await requestWrite(createInspectorAdjustWriteRequest(itemId, 'adjust.fx', update()));
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : t('inspector.adjustSections.error.changeEffect') };
        }
    };
    const fxFields: InspectorFieldDef[] = [{
        name: 'adjust-fx-add', label: t('inspector.adjustSections.label.addEffect'), inputKind: 'select',
        options: [t('inspector.adjustSections.action.select'), ...INSPECTOR_ADJUST_FX.map(effect => effect.label)],
        getValue: () => t('inspector.adjustSections.action.select'), getEditValue: () => t('inspector.adjustSections.action.select'),
        keyframeDisabled: true, disabled: !fxEnabled, title: fxEnabled ? undefined : disabledTitle,
        write: async (_snapshot, value) => {
            if (!fxEnabled) return { ok: false, message: disabledTitle };
            if (value === t('inspector.adjustSections.action.select')) return { ok: true };
            const effect = INSPECTOR_ADJUST_FX.find(candidate => candidate.label === value);
            if (!effect) return { ok: false, message: t('inspector.adjustSections.message.selectEffectFromList') };
            return writeFx(() => addInspectorAdjustFx(adjust.fx, effect.id));
        }
    }];
    adjust.fx.forEach((effect, index) => {
        const definition = INSPECTOR_ADJUST_FX.find(candidate => candidate.id === effect.id)!;
        fxFields.push({
            name: `adjust-fx-${effect.id}`, label: definition.label, getValue: () => '',
            keyframeDisabled: true, disabled: !fxEnabled, title: fxEnabled ? undefined : disabledTitle,
            actions: [{
                name: 'up', label: '↑', title: t('inspector.adjustSections.title.moveUp', { label: definition.label }), disabled: index === 0,
                action: () => writeFx(() => moveInspectorAdjustFx(adjust.fx, index, -1))
            }, {
                name: 'down', label: '↓', title: t('inspector.adjustSections.title.moveDown', { label: definition.label }), disabled: index === adjust.fx.length - 1,
                action: () => writeFx(() => moveInspectorAdjustFx(adjust.fx, index, 1))
            }, {
                name: 'remove', label: t('inspector.adjustSections.label.delete'), title: t('inspector.adjustSections.title.remove', { label: definition.label }),
                action: () => writeFx(() => removeInspectorAdjustFx(adjust.fx, index))
            }]
        });
        for (const param of definition.params) {
            const value = (effect as Record<string, unknown>)[param.key] as number | undefined ?? param.default;
            fxFields.push({
                name: `adjust-fx-${effect.id}-${param.key}`, label: param.label,
                getValue: () => `${Number((value * param.displayScale).toFixed(1))} ${param.unit}`,
                getEditValue: () => String(value), inputKind: 'scrub-number',
                min: param.min, max: param.max, scrubStep: param.step,
                unit: param.unit, displayScale: param.displayScale,
                displayPrecision: param.step * param.displayScale < 1 ? 1 : 0,
                keyframeDisabled: true, disabled: !fxEnabled, title: fxEnabled ? undefined : disabledTitle,
                write: (_snapshot, input) => writeFx(() => updateInspectorAdjustFxParam(
                    adjust.fx, index, param.key, input.trim() ? Number(input) : NaN
                )),
                reset: () => writeFx(() => updateInspectorAdjustFxParam(adjust.fx, index, param.key, null))
            });
        }
    });
    return [{
        id: 'adjust:basic',
        label: ACTIVE_ADJUST_SECTIONS[0],
        fields: basicFields,
        enable: {
            name: 'adjust-basic-enabled',
            label: t('inspector.adjustSections.label.enableBasicCorrection'),
            checked: basicEnabled,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                'adjust.sections.basic',
                enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:curves',
        label: ACTIVE_ADJUST_SECTIONS[1],
        fields: [],
        body: () => buildRgbCurveEditor(adjust, editorWrite('curves')),
        enable: {
            name: 'adjust-curves-enabled',
            label: t('inspector.adjustSections.label.enableRgbRgb'),
            checked: adjust.sections.curves,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId, 'adjust.sections.curves', enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:wheels',
        label: ACTIVE_ADJUST_SECTIONS[2],
        fields: [],
        body: () => buildColorWheelEditor(adjust, editorWrite('wheels')),
        enable: {
            name: 'adjust-wheels-enabled',
            label: t('inspector.adjustSections.label.enableColorWheel'),
            checked: adjust.sections.wheels,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId, 'adjust.sections.wheels', enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:hue',
        label: ACTIVE_ADJUST_SECTIONS[3],
        fields: [],
        body: () => buildHueCurveEditor(adjust, editorWrite('hue')),
        enable: {
            name: 'adjust-hue-enabled',
            label: t('inspector.adjustSections.label.enableHue'),
            checked: adjust.sections.hue,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId, 'adjust.sections.hue', enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:lut',
        label: ACTIVE_ADJUST_SECTIONS[4],
        fields: lutFields,
        enable: {
            name: 'adjust-lut-enabled',
            label: t('inspector.adjustSections.label.enableLut'),
            checked: lutEnabled,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                'adjust.sections.lut',
                enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:fx',
        label: ACTIVE_ADJUST_SECTIONS[5],
        fields: fxFields,
        enable: {
            name: 'adjust-fx-enabled', label: t('inspector.adjustSections.label.enableEffects'), checked: fxEnabled,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId, 'adjust.sections.fx', enabled ? null : false
            ))
        }
    }];
}
