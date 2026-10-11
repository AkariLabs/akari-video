import { t } from '@akari-video/i18n';
// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { InspectorWriteRequest, InspectorWriteResult, TimelineCutSelection, TimelineLayerSelection, TimelineTreeItemSnapshot } from '../../timeline-selection-model';
import { isInspectorStillImage } from '../edit-target';
import { createMaskWriteRequest, maskOptionLabel, maskOptionLabels } from '../mask-fields';
import { openPhotoEditPanel } from '../photo-edit-panel';
import { nextPhotoBrushItem } from '../photo-brush-state';
import { type InspectorFieldDef, type InspectorSection } from './types';

export const LAYER_BLEND_OPTIONS = [
    'normal', 'screen', 'multiply', 'add', 'difference',
    'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
] as const;

export const photoBrushSettings: { mode: 'erase' | 'restore'; size: number; hardness: number } = {
    mode: 'erase', size: 0.05, hardness: 0.8
};
export let activePhotoBrushItemId: string | null = null;

export function PHOTO_PANEL_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot | TimelineCutSelection>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>, available = true
): InspectorFieldDef<T>[] {
    const sourcePath = snapshot.kind === 'cut' ? snapshot.sourcePath : snapshot.sourcePath ?? snapshot.src;
    if (!snapshot.photo && !isInspectorStillImage(sourcePath)) return [];
    return [{
        name: 'photo-cutout-panel', label: t('inspector.photoFields.label.removeBackground'), getValue: () => '', actionLabel: t('inspector.photoFields.action.openBackgroundTransmission'),
        disabled: !available, title: available ? undefined : t('inspector.photoFields.label.backgroundTransmissionOnlyAvailableMac'),
        action: async (current: T) => { openPhotoEditPanel({ id: current.kind === 'cut' ? current.itemId ?? '' : current.id, write: requestWrite,
            mode: 'cutout', available, maskFeather: current.maskFeather, regions: current.regions,
            adjust: current.adjust as Record<string, any> }); return { ok: true }; }
    }, {
        name: 'photo-region-panel', label: t('inspector.photoFields.label.nagoyaArea'), getValue: () => '', actionLabel: t('inspector.photoFields.action.selectArea'),
        disabled: !available, title: available ? undefined : t('inspector.photoFields.label.backgroundTransmissionOnlyAvailableMac'),
        action: async (current: T) => { openPhotoEditPanel({ id: current.kind === 'cut' ? current.itemId ?? '' : current.id, write: requestWrite,
            mode: 'regions', available, maskFeather: current.maskFeather, regions: current.regions,
            adjust: current.adjust as Record<string, any> }); return { ok: true }; }
    }];
}

export function photoMaskSectionsForAvailability(sections: InspectorSection[], available: boolean | undefined): InspectorSection[] {
    if (available === true) return sections;
    const reason = available === false ? t('inspector.photoFields.label.backgroundTransmissionOnlyAvailableMac') : t('inspector.photoFields.message.backgroundTransmissionConfirmed');
    const maskActions = new Set(['photo-cutout-panel', 'photo-region-panel', 'photo-mask-generate']);
    return sections.map(section => ({ ...section, fields: section.fields.map(field =>
        maskActions.has(field.name ?? '') ? { ...field, disabled: true, title: reason } : field) }));
}

export function MASK_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    if (snapshot.maskSourceOptions === undefined) return [];
    const options = maskOptionLabels(snapshot.maskSourceOptions);
    const selected = maskOptionLabel(snapshot.maskSourceOptions, snapshot.mask);
    if (!options.includes(selected)) options.push(selected);
    const disabled = snapshot.maskSourceOptions.length === 0;
    const title = snapshot.photo ? t('inspector.photoFields.label.pngTransparencyMask') : t('inspector.photoFields.label.grayScaleVideoWhiteDisplayBlackTransmission');
    return [{
        name: 'mask', label: t('inspector.photoFields.label.mask'), inputKind: 'select', options,
        getValue: () => selected, getEditValue: () => selected,
        disabled, title: disabled ? t('inspector.photoFields.label.noMaskProject', { title: title }) : title,
        write: async (current, value) => {
            try {
                if (disabled) return { ok: false, message: t('inspector.photoFields.message.noMasksProject') };
                return await requestWrite(createMaskWriteRequest(current, value));
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        },
        reset: current => requestWrite(createMaskWriteRequest(current, t('inspector.photoFields.label.none')))
    }, ...(snapshot.photo ? [{
        name: 'photo-mask-generate', label: t('inspector.photoFields.label.background'), getValue: () => '',
        actionLabel: t('inspector.photoFields.action.removeBackgroundComputer'),
        busyLabel: t('inspector.photoFields.status.removingBackground'),
        action: (current: T) => requestWrite({ kind: 'item-field', id: current.id, path: 'photo-mask', value: null })
    }, {
        name: 'photo-mask-remove', label: t('inspector.photoFields.label.mask'), getValue: () => '',
        actionLabel: t('inspector.photoFields.action.removeMask'),
        action: (current: T) => requestWrite({ kind: 'item-field', id: current.id, path: 'mask', value: null })
    }, {
        name: 'photo-brush-mode', label: t('inspector.photoFields.label.eraser'), inputKind: 'select' as const,
        options: [t('inspector.photoFields.action.erase'), t('inspector.photoFields.action.back')], getValue: () => photoBrushSettings.mode === 'erase' ? t('inspector.photoFields.action.erase') : t('inspector.photoFields.action.back'),
        write: async (_current: T, value: string) => {
            photoBrushSettings.mode = value === t('inspector.photoFields.action.back') ? 'restore' : 'erase';
            return { ok: true };
        }
    }, {
        name: 'photo-brush-size', label: t('inspector.photoFields.label.size'), inputKind: 'scrub-number' as const,
        getValue: () => String(photoBrushSettings.size * 100), getEditValue: () => String(photoBrushSettings.size * 100),
        min: 0.1, max: 100, unit: '%', write: async (_current: T, value: string) => {
            const size = Number(value) / 100;
            if (!Number.isFinite(size) || size <= 0 || size > 1) return { ok: false, message: t('inspector.photoFields.message.size0100') };
            photoBrushSettings.size = size;
            return { ok: true };
        }
    }, {
        name: 'photo-brush-hardness', label: t('inspector.photoFields.label.hardness'), inputKind: 'scrub-number' as const,
        getValue: () => String(photoBrushSettings.hardness * 100), getEditValue: () => String(photoBrushSettings.hardness * 100),
        min: 0, max: 100, unit: '%', write: async (_current: T, value: string) => {
            const hardness = Number(value) / 100;
            if (!Number.isFinite(hardness) || hardness < 0 || hardness > 1) return { ok: false, message: t('inspector.photoFields.message.specifyHardness0100') };
            photoBrushSettings.hardness = hardness;
            return { ok: true };
        }
    }, {
        name: 'photo-brush-start', label: t('inspector.photoFields.label.eraser'), getValue: () => '', actionLabel: t('inspector.photoFields.label.eraser'),
        pressed: () => activePhotoBrushItemId === snapshot.id,
        action: async (current: T) => {
            const previous = activePhotoBrushItemId;
            const next = nextPhotoBrushItem(activePhotoBrushItemId, current.id);
            activePhotoBrushItemId = next;
            try {
                const result = await requestWrite({ kind: 'item-field', id: current.id,
                    path: 'photo-brush-toggle', value: next ? { ...photoBrushSettings } : null });
                if (!result.ok) activePhotoBrushItemId = previous;
                return result;
            } catch (error) {
                activePhotoBrushItemId = previous;
                throw error;
            }
        }
    }] : [])];
}

export function PHOTO_FLIP_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    if (!snapshot.photo) return [];
    return (['h', 'v'] as const).map(axis => ({
        name: `photo-flip-${axis}`, label: axis === 'h' ? t('inspector.photoFields.label.leftRight') : t('inspector.photoFields.label.upDown'),
        inputKind: 'select' as const, options: [t('inspector.photoFields.label.yes'), t('inspector.photoFields.label.no')],
        getValue: () => snapshot.flip?.[axis] ? t('inspector.photoFields.label.yes') : t('inspector.photoFields.label.no'),
        getEditValue: () => snapshot.flip?.[axis] ? t('inspector.photoFields.label.yes') : t('inspector.photoFields.label.no'),
        write: (_current: T, value: string) => requestWrite({
            kind: 'item-field', id: snapshot.id, path: `flip.${axis}`, value: value === t('inspector.photoFields.label.yes')
        })
    }));
}

export function PHOTO_FRAME_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    if (!snapshot.photo) return [];
    return [{
        name: 'photo-frame-width', label: t('inspector.photoFields.label.frameLineThickness'), inputKind: 'scrub-number', unit: 'px',
        min: 0, max: 100, scrubStep: 1,
        getValue: () => String(snapshot.frame?.stroke?.width ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'frame.stroke.width', value: Number(value) })
    }, {
        name: 'photo-frame-color', label: t('inspector.photoFields.label.frameLineColor'), inputKind: 'color',
        getValue: () => snapshot.frame?.stroke?.color ?? '#ffffff',
        write: (_current, value) => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'frame.stroke.color', value })
    }, {
        name: 'photo-frame-radius', label: t('inspector.photoFields.label.cornerRound'), inputKind: 'scrub-number', unit: '%',
        min: 0, max: 100, scrubStep: 1,
        getValue: () => String(snapshot.frame?.cornerRadius ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'frame.cornerRadius', value: Number(value) })
    }];
}

export function PHOTO_CROP_OPEN_FIELD<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    return snapshot.photo ? [{ name: 'photo-crop-open', label: t('inspector.photoFields.label.cutOut'), getValue: () => '',
        actionLabel: t('inspector.photoFields.label.cutOut'), action: () => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'photo-crop-open', value: null }) }] : [];
}
export function clearActivePhotoBrushItem(): void { activePhotoBrushItemId = null; }
