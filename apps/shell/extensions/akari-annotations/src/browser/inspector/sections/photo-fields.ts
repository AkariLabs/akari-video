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
        name: 'photo-cutout-panel', label: '背景透過', getValue: () => '', actionLabel: '背景透過を開く',
        disabled: !available, title: available ? undefined : '背景透過は Mac でだけ使えます',
        action: async (current: T) => { openPhotoEditPanel({ id: current.kind === 'cut' ? current.itemId ?? '' : current.id, write: requestWrite,
            mode: 'cutout', available, maskFeather: current.maskFeather, regions: current.regions,
            adjust: current.adjust as Record<string, any> }); return { ok: true }; }
    }, {
        name: 'photo-region-panel', label: '選択エリア', getValue: () => '', actionLabel: 'エリアを選択',
        disabled: !available, title: available ? undefined : '背景透過は Mac でだけ使えます',
        action: async (current: T) => { openPhotoEditPanel({ id: current.kind === 'cut' ? current.itemId ?? '' : current.id, write: requestWrite,
            mode: 'regions', available, maskFeather: current.maskFeather, regions: current.regions,
            adjust: current.adjust as Record<string, any> }); return { ok: true }; }
    }];
}

export function photoMaskSectionsForAvailability(sections: InspectorSection[], available: boolean | undefined): InspectorSection[] {
    if (available === true) return sections;
    const reason = available === false ? '背景透過は Mac でだけ使えます' : '背景透過を確認しています…';
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
    const title = snapshot.photo ? 'PNG（白 = 表示・黒 = 透過）' : 'グレースケール動画（白 = 表示・黒 = 透過）';
    return [{
        name: 'mask', label: 'マスク', inputKind: 'select', options,
        getValue: () => selected, getEditValue: () => selected,
        disabled, title: disabled ? `プロジェクトにマスクがありません。${title}` : title,
        write: async (current, value) => {
            try {
                if (disabled) return { ok: false, message: 'プロジェクトにマスクがありません' };
                return await requestWrite(createMaskWriteRequest(current, value));
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        },
        reset: current => requestWrite(createMaskWriteRequest(current, 'なし'))
    }, ...(snapshot.photo ? [{
        name: 'photo-mask-generate', label: '背景', getValue: () => '',
        actionLabel: '背景を消す（このパソコンで）',
        busyLabel: '背景を消しています…',
        action: (current: T) => requestWrite({ kind: 'item-field', id: current.id, path: 'photo-mask', value: null })
    }, {
        name: 'photo-mask-remove', label: 'マスク', getValue: () => '',
        actionLabel: 'マスクを外す',
        action: (current: T) => requestWrite({ kind: 'item-field', id: current.id, path: 'mask', value: null })
    }, {
        name: 'photo-brush-mode', label: '消しゴム', inputKind: 'select' as const,
        options: ['消す', '戻す'], getValue: () => photoBrushSettings.mode === 'erase' ? '消す' : '戻す',
        write: async (_current: T, value: string) => {
            photoBrushSettings.mode = value === '戻す' ? 'restore' : 'erase';
            return { ok: true };
        }
    }, {
        name: 'photo-brush-size', label: '大きさ', inputKind: 'scrub-number' as const,
        getValue: () => String(photoBrushSettings.size * 100), getEditValue: () => String(photoBrushSettings.size * 100),
        min: 0.1, max: 100, unit: '%', write: async (_current: T, value: string) => {
            const size = Number(value) / 100;
            if (!Number.isFinite(size) || size <= 0 || size > 1) return { ok: false, message: '大きさは 0〜100% で指定してください' };
            photoBrushSettings.size = size;
            return { ok: true };
        }
    }, {
        name: 'photo-brush-hardness', label: '硬さ', inputKind: 'scrub-number' as const,
        getValue: () => String(photoBrushSettings.hardness * 100), getEditValue: () => String(photoBrushSettings.hardness * 100),
        min: 0, max: 100, unit: '%', write: async (_current: T, value: string) => {
            const hardness = Number(value) / 100;
            if (!Number.isFinite(hardness) || hardness < 0 || hardness > 1) return { ok: false, message: '硬さは 0〜100% で指定してください' };
            photoBrushSettings.hardness = hardness;
            return { ok: true };
        }
    }, {
        name: 'photo-brush-start', label: '消しゴム', getValue: () => '', actionLabel: '消しゴム',
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
        name: `photo-flip-${axis}`, label: axis === 'h' ? '左右反転' : '上下反転',
        inputKind: 'select' as const, options: ['する', 'しない'],
        getValue: () => snapshot.flip?.[axis] ? 'する' : 'しない',
        getEditValue: () => snapshot.flip?.[axis] ? 'する' : 'しない',
        write: (_current: T, value: string) => requestWrite({
            kind: 'item-field', id: snapshot.id, path: `flip.${axis}`, value: value === 'する'
        })
    }));
}

export function PHOTO_FRAME_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    if (!snapshot.photo) return [];
    return [{
        name: 'photo-frame-width', label: '枠線の太さ', inputKind: 'scrub-number', unit: 'px',
        min: 0, max: 100, scrubStep: 1,
        getValue: () => String(snapshot.frame?.stroke?.width ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'frame.stroke.width', value: Number(value) })
    }, {
        name: 'photo-frame-color', label: '枠線の色', inputKind: 'color',
        getValue: () => snapshot.frame?.stroke?.color ?? '#ffffff',
        write: (_current, value) => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'frame.stroke.color', value })
    }, {
        name: 'photo-frame-radius', label: '角の丸み', inputKind: 'scrub-number', unit: '%',
        min: 0, max: 100, scrubStep: 1,
        getValue: () => String(snapshot.frame?.cornerRadius ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'frame.cornerRadius', value: Number(value) })
    }];
}

export function PHOTO_CROP_OPEN_FIELD<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    return snapshot.photo ? [{ name: 'photo-crop-open', label: '切り抜き', getValue: () => '',
        actionLabel: '切り抜き', action: () => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'photo-crop-open', value: null }) }] : [];
}
export function clearActivePhotoBrushItem(): void { activePhotoBrushItemId = null; }
