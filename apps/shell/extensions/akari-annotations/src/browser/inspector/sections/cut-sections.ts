// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { InspectorWriteRequest, InspectorWriteResult, TimelineCutSelection } from '../../timeline-selection-model';
import { composeInspectorSections } from '../section-model';
import { GENERATION_SECTION_ID, type InspectorFieldDef, type InspectorSection } from './types';
import { formatTimestamp, formatDurationSeconds, formatDecimal1, withDefaultNumber } from './shared-helpers';
import { cutTransitionFields, cutFramingFields, cutFreezeFields } from './transform-fields';
import { MOTION_FIELDS, MOTION_SUMMARY_SECTION, MOTION_EMPTY_SECTION } from './motion-sections';

export function CUT_SECTIONS(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    generation?: InspectorFieldDef<TimelineCutSelection>[],
    openMotion?: () => void
): InspectorSection[] {
    const photoItemId = /\.(png|jpe?g|webp|bmp|gif)$/iu.test(snapshot.sourcePath ?? '') ? snapshot.itemId : undefined;
    const photoFrameFields: InspectorFieldDef<TimelineCutSelection>[] = photoItemId ? [{
        name: 'photo-frame-width', label: '枠線の太さ', inputKind: 'scrub-number', unit: 'px', min: 0, max: 100,
        getValue: () => String(snapshot.frame?.stroke?.width ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: photoItemId,
            path: 'frame.stroke.width', value: Number(value) })
    }, {
        name: 'photo-frame-color', label: '枠線の色', inputKind: 'color',
        getValue: () => snapshot.frame?.stroke?.color ?? '#ffffff',
        write: (_current, value) => requestWrite({ kind: 'item-field', id: photoItemId,
            path: 'frame.stroke.color', value })
    }, {
        name: 'photo-frame-radius', label: '角の丸み', inputKind: 'scrub-number', unit: '%', min: 0, max: 100,
        getValue: () => String(snapshot.frame?.cornerRadius ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: photoItemId,
            path: 'frame.cornerRadius', value: Number(value) })
    }] : [];
    const transformFields: InspectorFieldDef<TimelineCutSelection>[] = [
        {
            name: 'transform-x', label: 'X', unit: 'px',
            getValue: () => String(snapshot.transform?.x ?? 0),
            getEditValue: () => String(snapshot.transform?.x ?? 0),
            inputKind: 'scrub-number', scrubStep: 1, liveField: 'x',
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed)) return { ok: false, message: 'X は有限数値で入力してください。' };
                return requestWrite({ kind: 'cut-transform-x', index: snapshot.index, value: parsed });
            },
            reset: () => requestWrite({ kind: 'cut-transform-x', index: snapshot.index, value: null })
        },
        {
            name: 'transform-y', label: 'Y', unit: 'px',
            getValue: () => String(snapshot.transform?.y ?? 0),
            getEditValue: () => String(snapshot.transform?.y ?? 0),
            inputKind: 'scrub-number', scrubStep: 1, liveField: 'y',
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed)) return { ok: false, message: 'Y は有限数値で入力してください。' };
                return requestWrite({ kind: 'cut-transform-y', index: snapshot.index, value: parsed });
            },
            reset: () => requestWrite({ kind: 'cut-transform-y', index: snapshot.index, value: null })
        },
        {
            name: 'transform-scale', label: '拡縮', unit: '%', removable: true,
            getValue: () => String((snapshot.transform?.scale ?? 1) * 100),
            getEditValue: () => String((snapshot.transform?.scale ?? 1) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue) / 100;
                if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, message: '拡縮は正の数で入力してください。' };
                return requestWrite({ kind: 'cut-scale', index: snapshot.index, value: parsed });
            },
            reset: () => requestWrite({ kind: 'cut-scale', index: snapshot.index, value: null })
        },
        {
            name: 'transform-rotate', label: '回転', unit: '°', removable: true,
            getValue: () => String(snapshot.transform?.rotate ?? 0),
            getEditValue: () => String(snapshot.transform?.rotate ?? 0),
            inputKind: 'scrub-number', scrubStep: 0.1, liveField: 'rotate',
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed)) return { ok: false, message: '回転は有限数値で入力してください。' };
                return requestWrite({ kind: 'cut-rotate', index: snapshot.index, value: parsed });
            },
            reset: () => requestWrite({ kind: 'cut-rotate', index: snapshot.index, value: null })
        }
    ];
    return composeInspectorSections([
        {
            id: 'time', label: '時間', fields: [
                { name: 'output-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                // Same source extensions as isStillImageCut; empty/planned frames are PNG cards.
                /\.(png|jpe?g|webp|bmp|gif)$/iu.test(snapshot.sourcePath ?? '') ? {
                    name: 'duration', label: '長さ', unit: '秒',
                    getValue: () => String(snapshot.outputEnd - snapshot.outputStart),
                    getEditValue: () => String(snapshot.outputEnd - snapshot.outputStart),
                    inputKind: 'scrub-number', scrubStep: 0.5, displayPrecision: 1, min: 0.5,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) return { ok: false, message: '長さは有限数で入力してください。' };
                        return requestWrite({ kind: 'cut-source-out', index: snapshot.index,
                            value: Math.round(parsed * 10) / 10 });
                    }
                } : { name: 'duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.outputEnd - snapshot.outputStart) },
                ...cutTransitionFields(snapshot, requestWrite)
            ]
        },
        { id: 'transform', label: '変形', fields: transformFields },
        MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
        ...(snapshot.itemId && snapshot.durationFrames ? (() => {
            const fields = MOTION_FIELDS({ id: snapshot.itemId, durationFrames: snapshot.durationFrames,
                motion: snapshot.motion }, requestWrite);
            return ([['draw', '動きを描く'], ['in', '登場'], ['loop', '強調'], ['out', '退場']] as const)
                .map(([slot, label]) => ({ id: `motion:${slot}`, label,
                    fields: fields.filter(field => slot === 'draw' ? field.name === 'motion-draw'
                        : field.name?.startsWith(`motion-${slot}-`)) }))
                .filter(section => section.fields.length > 0);
        })() : [MOTION_EMPTY_SECTION()]),
        { id: 'framing', label: 'フレーミング', fields: cutFramingFields(snapshot, requestWrite) },
        { id: 'freeze', label: 'フリーズ', fields: cutFreezeFields(snapshot, requestWrite) },
        ...(generation ? [{ id: GENERATION_SECTION_ID, label: '生成', fields: generation }] : []),
        {
            id: 'appearance', label: '外観', fields: [
                {
                    name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
                    getValue: () => String(snapshot.opacity ?? 1), getEditValue: () => String(snapshot.opacity ?? 1),
                    inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1, liveField: 'opacity',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return { ok: false, message: '不透明度は 0〜100% の範囲で入力してください。' };
                        return requestWrite({ kind: 'cut-opacity', index: snapshot.index, value: parsed });
                    },
                    reset: () => requestWrite({ kind: 'cut-opacity', index: snapshot.index, value: null })
                },
                ...(photoItemId ? [{
                    name: 'photo-crop-open', label: '切り抜き', getValue: () => '', actionLabel: '切り抜き',
                    action: () => requestWrite({ kind: 'item-field', id: photoItemId,
                        path: 'photo-crop-open', value: null })
                }, ...photoFrameFields] : [])
            ]
        },
        {
            id: 'timing', label: '再生', fields: [
                {
                    name: 'speed', label: 'speed',
                    getValue: () => withDefaultNumber(snapshot.speed, 1, formatDecimal1),
                    getEditValue: () => String(snapshot.speed ?? 1),
                    inputKind: 'scrub-number', scrubStep: 0.01, min: 0.01,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, message: 'speed は正の数で入力してください。' };
                        return requestWrite({ kind: 'cut-speed', index: snapshot.index, value: parsed });
                    }
                }
            ]
        },
        {
            id: 'audio', label: '埋め込み音声', fields: [
                {
                    name: 'gain-db', label: '音量', unit: 'dB', removable: true,
                    getValue: () => String(snapshot.audioGainDb ?? 0) + (snapshot.audioMute === true ? '（ミュート中）' : ''),
                    getEditValue: () => String(snapshot.audioGainDb ?? 0),
                    inputKind: 'scrub-number', scrubStep: 0.5, min: -60, max: 12,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < -60 || parsed > 12) {
                            return { ok: false, message: '埋め込み音声の音量は -60〜12 dB の範囲で入力してください。' };
                        }
                        return requestWrite({ kind: 'cut-audio-gain', index: snapshot.index, value: parsed });
                    },
                    reset: () => requestWrite({ kind: 'cut-audio-gain', index: snapshot.index, value: null })
                },
                {
                    name: 'mute', label: 'ミュート',
                    getValue: () => String(snapshot.audioMute === true),
                    getEditValue: () => String(snapshot.audioMute === true),
                    inputKind: 'boolean-select',
                    write: async (_snapshot, nextValue) => requestWrite({
                        kind: 'cut-audio-mute', index: snapshot.index, value: nextValue === 'true'
                    })
                }
            ]
        },
        {
            id: 'info', label: '情報', collapsedByDefault: true,
            fields: [
                { name: 'track', label: 'トラック', getValue: () => snapshot.trackName },
                { name: 'clip', label: 'クリップ', getValue: () => snapshot.clipName },
                { name: 'src', label: 'src', getValue: () => snapshot.src ?? snapshot.sourceName }
            ]
        }
    ]);
}
