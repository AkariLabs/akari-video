// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { InspectorWriteRequest, InspectorWriteResult, TimelineLayerSelection } from '../../timeline-selection-model';
import { composeInspectorSections } from '../section-model';
import { chromaControlValue, telopParamControlKind } from '../field-mappings';
import { GENERATION_SECTION_ID, type InspectorFieldDef, type InspectorSection } from './types';
import { formatTimestamp, formatDurationSeconds, orDash } from './shared-helpers';
import { CROP_FIELDS, PERSPECTIVE_FIELDS } from './transform-fields';
import { LAYER_BLEND_OPTIONS, MASK_FIELDS, PHOTO_FLIP_FIELDS, PHOTO_FRAME_FIELDS, PHOTO_CROP_OPEN_FIELD } from './photo-fields';
import { MOTION_SECTIONS, MOTION_SUMMARY_SECTION } from './motion-sections';

export interface LayerAudioControls {
    audio: boolean;
    gain_db: number;
    detached: boolean;
    write: (field: 'audio' | 'gain_db', value: boolean | number) => Promise<InspectorWriteResult>;
}
export const layerAudioControls = new WeakMap<TimelineLayerSelection, LayerAudioControls | null>();

export function LAYER_SECTIONS(
    snapshot: TimelineLayerSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    layerAudio?: LayerAudioControls | null,
    generation?: InspectorFieldDef<TimelineLayerSelection>[],
    openMotion?: () => void
): InspectorSection[] {
    const chromaSimilarity = chromaControlValue(snapshot.chromaKey, 'similarity', 0.1);
    const chromaBlend = chromaControlValue(snapshot.chromaKey, 'blend', 0);
    const cropFields = CROP_FIELDS(snapshot, 'layer', requestWrite);
    const maskFields = MASK_FIELDS(snapshot, requestWrite);
    const perspectiveSection = {
        id: 'perspective', label: 'パース（4 隅）', collapsedByDefault: true,
        fields: PERSPECTIVE_FIELDS(snapshot, requestWrite)
    };
    const transformFields: InspectorFieldDef<TimelineLayerSelection>[] = [
        {
            name: 'transform-x', label: 'X', unit: 'px', getValue: () => String(snapshot.transform?.x ?? 0),
            getEditValue: () => String(snapshot.transform?.x ?? 0), inputKind: 'scrub-number', scrubStep: 1,
            liveField: 'x', write: async (_snapshot, value) => requestWrite({ kind: 'layer-transform-x', id: snapshot.id, value: Number(value) }),
            reset: () => requestWrite({ kind: 'layer-transform-x', id: snapshot.id, value: null })
        },
        {
            name: 'transform-y', label: 'Y', unit: 'px', getValue: () => String(snapshot.transform?.y ?? 0),
            getEditValue: () => String(snapshot.transform?.y ?? 0), inputKind: 'scrub-number', scrubStep: 1,
            liveField: 'y', write: async (_snapshot, value) => requestWrite({ kind: 'layer-transform-y', id: snapshot.id, value: Number(value) }),
            reset: () => requestWrite({ kind: 'layer-transform-y', id: snapshot.id, value: null })
        },
        {
            name: 'transform-scale', label: '拡縮', unit: '%', removable: true,
            getValue: () => String((snapshot.transform?.scale ?? 1) * 100), getEditValue: () => String((snapshot.transform?.scale ?? 1) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: Number(value) / 100 }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: null })
        },
        {
            name: 'transform-rotate', label: '回転', unit: '°', removable: true,
            getValue: () => String(snapshot.transform?.rotate ?? 0), getEditValue: () => String(snapshot.transform?.rotate ?? 0),
            inputKind: 'scrub-number', scrubStep: 0.1, liveField: 'rotate',
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: Number(value) }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: null })
        }
    ];
    const telopFields: InspectorFieldDef<TimelineLayerSelection>[] = Object.entries(snapshot.params ?? {})
        .flatMap(([name, value]) => {
            const inputKind = telopParamControlKind(value);
            if (!inputKind) return [];
            return [{
                name: `telop-param-${name}`,
                label: name,
                getValue: () => String(value),
                getEditValue: () => String(value),
                inputKind,
                ...(inputKind === 'scrub-number' ? { scrubStep: 1 } : {}),
                write: async (_snapshot: TimelineLayerSelection, nextValue: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: `source.params.${name}`,
                    value: inputKind === 'scrub-number'
                        ? Number(nextValue) : inputKind === 'boolean-select'
                            ? nextValue === 'true' : nextValue
                })
            }];
        });
    return composeInspectorSections([
        {
            id: 'time', label: '時間', fields: [
                { name: 'output-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                { name: 'duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        { id: 'transform', label: '変形', fields: transformFields },
        { id: 'crop', label: 'クロップ', fields: cropFields },
        perspectiveSection,
        MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
        ...MOTION_SECTIONS(snapshot, requestWrite),
        ...(generation ? [{ id: GENERATION_SECTION_ID, label: '生成', fields: generation }] : []),
        {
            id: 'appearance', label: '外観', fields: [
                {
                    name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
                    getValue: () => String(snapshot.opacity ?? 1),
                    getEditValue: () => String(snapshot.opacity ?? 1),
                    inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1,
                    liveField: 'opacity',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return { ok: false, message: '不透明度は 0〜100% の範囲で入力してください。' };
                        return requestWrite({ kind: 'layer-opacity', id: snapshot.id, value: parsed });
                    },
                    reset: () => requestWrite({ kind: 'layer-opacity', id: snapshot.id, value: null })
                },
                {
                    name: 'blend', label: 'ブレンドモード',
                    getValue: () => snapshot.blend ?? 'normal',
                    getEditValue: () => snapshot.blend ?? 'normal',
                    inputKind: 'select', options: LAYER_BLEND_OPTIONS,
                    write: async (_snapshot, nextValue) =>
                        requestWrite({ kind: 'layer-blend', id: snapshot.id, value: nextValue })
                },
                { name: 'chroma-color', label: 'クロマキー色', getValue: () => orDash(snapshot.chromaKey?.color, value => value) },
                {
                    name: 'chroma-similarity', label: '類似度', unit: '%', displayScale: 100,
                    getValue: () => chromaSimilarity === undefined ? '—' : String(chromaSimilarity),
                    ...(chromaSimilarity === undefined ? {} : {
                        getEditValue: () => String(chromaSimilarity),
                        inputKind: 'scrub-number' as const, scrubStep: 0.01, min: 0, max: 1,
                        write: async (_snapshot: TimelineLayerSelection, nextValue: string) => requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: 'source.chroma_key.similarity', value: Number(nextValue)
                        }),
                        reset: () => requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: 'source.chroma_key.similarity', value: null
                        })
                    })
                },
                {
                    name: 'chroma-blend', label: '境界ぼかし', unit: '%', displayScale: 100,
                    getValue: () => chromaBlend === undefined ? '—' : String(chromaBlend),
                    ...(chromaBlend === undefined ? {} : {
                        getEditValue: () => String(chromaBlend),
                        inputKind: 'scrub-number' as const, scrubStep: 0.01, min: 0, max: 1,
                        write: async (_snapshot: TimelineLayerSelection, nextValue: string) => requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: 'source.chroma_key.blend', value: Number(nextValue)
                        }),
                        reset: () => requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: 'source.chroma_key.blend', value: null
                        })
                    })
                },
                ...(!snapshot.photo ? maskFields : []),
                ...(snapshot.photo ? [...PHOTO_FLIP_FIELDS(snapshot, requestWrite),
                    ...PHOTO_CROP_OPEN_FIELD(snapshot, requestWrite), ...PHOTO_FRAME_FIELDS(snapshot, requestWrite)] : [])
            ]
        },
        ...(snapshot.layerKind === 'video' ? [{ id: 'audio', label: '音声', fields: [
            {
                name: 'layer-audio', label: '音声', inputKind: 'select' as const,
                options: ['鳴らす', 'ミュート'], disabled: !layerAudio || layerAudio.detached, keyframeDisabled: true,
                getValue: () => layerAudio?.audio === false ? 'ミュート' : '鳴らす',
                getEditValue: () => layerAudio?.audio === false ? 'ミュート' : '鳴らす',
                write: async (_snapshot: TimelineLayerSelection, value: string) => layerAudio
                    ? layerAudio.write('audio', value === '鳴らす') : { ok: false, message: '音声設定を読み込み中です。' }
            },
            {
                name: 'layer-gain-db', label: '音量', unit: 'dB', inputKind: 'scrub-number' as const,
                scrubStep: 0.5, min: -60, max: 12, disabled: !layerAudio, keyframeDisabled: true,
                getValue: () => String(layerAudio?.gain_db ?? 0),
                getEditValue: () => String(layerAudio?.gain_db ?? 0),
                write: async (_snapshot: TimelineLayerSelection, value: string) => {
                    const gain = Number(value);
                    if (!Number.isFinite(gain) || gain < -60 || gain > 12) {
                        return { ok: false, message: '音量は -60〜12 dB の範囲で入力してください。' };
                    }
                    return layerAudio ? layerAudio.write('gain_db', gain)
                        : { ok: false, message: '音声設定を読み込み中です。' };
                }
            }
        ] }] : []),
        ...(telopFields.length > 0 ? [{ id: 'telop', label: 'テキスト', fields: telopFields }] : []),
        {
            id: 'info', label: '情報', collapsedByDefault: true,
            fields: [
                { name: 'src', label: 'src', getValue: () => snapshot.src ?? '—' },
                { name: 'kind', label: 'kind', getValue: () => snapshot.layerKind },
                { name: 'preset', label: 'preset', getValue: () => snapshot.preset ?? '—' },
                { name: 'track', label: 'トラック', getValue: () => snapshot.trackName },
                { name: 'clip', label: 'クリップ', getValue: () => snapshot.clipName }
            ]
        }
    ]);
}
