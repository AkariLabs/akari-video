// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { InspectorWriteRequest, InspectorWriteResult, TimelineAudioSelection, TimelineAudioMasterSnapshot } from '../../timeline-selection-model';
import { AUDIO_MASTER_DEFAULT_LOUDNORM, AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP } from '../audio-master';
import { createAudioClipFxWriteRequest, type AudioClipFxRow } from '../audio-clip-fx';
import { composeInspectorSections } from '../section-model';
import { type AudioInspectorSnapshot, type InspectorFieldDef, type InspectorSection } from './types';
import { formatTimestamp, formatDurationSeconds, formatDecimal1, formatDecimal2, withDefaultNumber, withDefaultBoolean, orDash, formatAudioKindLabel } from './shared-helpers';
import type {
    AudioEnvelopeKeyframePayload
} from '../../../common/akari-annotations-protocol';

export const AUDIO_DUCK_DEFAULTS = { duckDb: -12, duckAttack: 0.3, duckRelease: 0.8 } as const;
export const AUDIO_KEYFRAME_EASING_OPTIONS = ['linear', 'hold', 'ease-in-out'] as const;

export function duckingFields(
    snapshot: AudioInspectorSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef[] {
    const duckWriteRequest = (
        field: 'duck-db' | 'duck-attack' | 'duck-release',
        value: number
    ): InspectorWriteRequest => {
        if (snapshot.audioKind === 'bgm') {
            if (field === 'duck-db') return { kind: 'bgm-duck-db', value };
            if (field === 'duck-attack') return { kind: 'bgm-duck-attack', value };
            return { kind: 'bgm-duck-release', value };
        }
        if (field === 'duck-db') return { kind: 'sfx-duck-db', id: snapshot.id, value };
        if (field === 'duck-attack') return { kind: 'sfx-duck-attack', id: snapshot.id, value };
        return { kind: 'sfx-duck-release', id: snapshot.id, value };
    };
    const numberField = (
        name: string, label: string, field: 'duck-db' | 'duck-attack' | 'duck-release',
        raw: number | undefined, fallback: number, min: number, max: number, step: number, unit: string
    ): InspectorFieldDef => ({
        name, label, unit,
        getValue: () => withDefaultNumber(raw, fallback, value => String(value)),
        getEditValue: () => String(raw ?? fallback),
        inputKind: 'scrub-number', scrubStep: step, min, max,
        write: async (_snapshot, nextValue) => {
            const parsed = Number(nextValue);
            if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
                return { ok: false, message: `${label} は ${min}〜${max} の範囲で入力してください。` };
            }
            return requestWrite(duckWriteRequest(field, parsed));
        }
    });
    const duckDb = numberField(
        'audio-duck-db', 'duck_db', 'duck-db', snapshot.duckDb,
        AUDIO_DUCK_DEFAULTS.duckDb, -40, 0, 0.5, 'dB'
    );
    return [
        {
            name: 'audio-ducking', label: 'ducking',
            getValue: () => withDefaultBoolean(snapshot.ducking, false),
            getEditValue: () => String(snapshot.ducking ?? false),
            inputKind: 'boolean-select',
            write: async (_snapshot, nextValue) => requestWrite(snapshot.audioKind === 'bgm'
                ? { kind: 'bgm-ducking', value: nextValue === 'true' }
                : { kind: 'sfx-ducking', id: snapshot.id, value: nextValue === 'true' })
        },
        duckDb,
        {
            name: 'audio-duck-preset', label: 'プリセット',
            getValue: () => String(snapshot.duckDb ?? AUDIO_DUCK_DEFAULTS.duckDb),
            getEditValue: () => String(snapshot.duckDb ?? AUDIO_DUCK_DEFAULTS.duckDb),
            inputKind: 'select', options: ['-3', '-6', '-12'],
            write: duckDb.write
        },
        numberField(
            'audio-duck-attack', 'duck_attack（詳細）', 'duck-attack', snapshot.duckAttack,
            AUDIO_DUCK_DEFAULTS.duckAttack, 0, 2, 0.01, 's'
        ),
        numberField(
            'audio-duck-release', 'duck_release（詳細）', 'duck-release', snapshot.duckRelease,
            AUDIO_DUCK_DEFAULTS.duckRelease, 0, 5, 0.05, 's'
        )
    ];
}

export function audioKeyframeRequest(
    snapshot: AudioInspectorSnapshot,
    points: readonly AudioEnvelopeKeyframePayload[]
): InspectorWriteRequest {
    return {
        kind: 'audio-keyframes', id: snapshot.id, audioKind: snapshot.audioKind,
        value: points.length === 0 ? null : points
            .map(point => ({ ...point, gain_db: point.gain_db ?? 0 }))
            .sort((left, right) => left.t - right.t)
    };
}

export function keyframeSeconds(snapshot: AudioInspectorSnapshot, point: AudioEnvelopeKeyframePayload): number {
    return snapshot.keyframeFrames ? point.t / Math.max(1, snapshot.fps ?? 30) : point.t;
}

export function keyframeRawTime(snapshot: AudioInspectorSnapshot, seconds: number): number {
    return snapshot.keyframeFrames
        ? Math.round(seconds * Math.max(1, snapshot.fps ?? 30))
        : Math.round(seconds * 1000) / 1000;
}

export function audioKeyframeFields(
    snapshot: AudioInspectorSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef[] {
    const points = [...(snapshot.keyframes ?? [])].sort((left, right) => left.t - right.t);
    const replace = (index: number, point: AudioEnvelopeKeyframePayload): Promise<InspectorWriteResult> => {
        const next = points.map((candidate, candidateIndex) => candidateIndex === index ? point : candidate);
        return requestWrite(audioKeyframeRequest(snapshot, next));
    };
    const fields: InspectorFieldDef[] = [{
        name: 'audio-keyframe-add', label: '追加', actionLabel: '再生ヘッド位置に追加',
        getValue: () => '',
        action: async () => {
            const relative = Math.max(0, Math.min(
                snapshot.duration,
                (snapshot.playheadSeconds ?? snapshot.outputStart) - snapshot.outputStart
            ));
            const t = keyframeRawTime(snapshot, relative);
            const duplicate = points.some(point => snapshot.keyframeFrames
                ? point.t === t : Math.abs(point.t - t) < 1e-3);
            if (duplicate) return { ok: false, message: 'この位置には既に音量キーフレームがあります。' };
            return requestWrite(audioKeyframeRequest(snapshot, [...points, { t, gain_db: 0 }]));
        }
    }];
    points.forEach((point, index) => {
        const prefix = `audio-keyframe-${index}`;
        const easing = typeof point.easing === 'string' ? point.easing : 'linear';
        const easingOptions = AUDIO_KEYFRAME_EASING_OPTIONS.includes(
            easing as typeof AUDIO_KEYFRAME_EASING_OPTIONS[number]
        ) ? AUDIO_KEYFRAME_EASING_OPTIONS : [...AUDIO_KEYFRAME_EASING_OPTIONS, easing];
        fields.push({
            name: `${prefix}-t`, label: `#${index + 1} t`, unit: 's',
            getValue: () => String(keyframeSeconds(snapshot, point)),
            getEditValue: () => String(keyframeSeconds(snapshot, point)),
            inputKind: 'scrub-number', scrubStep: snapshot.keyframeFrames ? 1 / Math.max(1, snapshot.fps ?? 30) : 0.001,
            min: 0, max: snapshot.duration,
            write: async (_snapshot, nextValue) => {
                const seconds = Number(nextValue);
                if (!Number.isFinite(seconds) || seconds < 0 || seconds > snapshot.duration) {
                    return { ok: false, message: `t は 0〜${snapshot.duration} 秒の範囲で入力してください。` };
                }
                const t = keyframeRawTime(snapshot, seconds);
                const duplicate = points.some((candidate, candidateIndex) => candidateIndex !== index
                    && (snapshot.keyframeFrames ? candidate.t === t : Math.abs(candidate.t - t) < 1e-3));
                if (duplicate) return { ok: false, message: 'この位置には既に音量キーフレームがあります。' };
                return replace(index, { ...point, t });
            }
        }, {
            name: `${prefix}-gain-db`, label: `#${index + 1} gain_db`, unit: 'dB',
            getValue: () => String(point.gain_db ?? 0), getEditValue: () => String(point.gain_db ?? 0),
            inputKind: 'scrub-number', scrubStep: 0.5, min: -60, max: 12,
            write: async (_snapshot, nextValue) => {
                const gainDb = Number(nextValue);
                return !Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12
                    ? { ok: false, message: 'gain_db は -60〜12 の範囲で入力してください。' }
                    : replace(index, { ...point, gain_db: gainDb });
            }
        }, {
            name: `${prefix}-easing`, label: `#${index + 1} easing`,
            getValue: () => easing, getEditValue: () => easing,
            inputKind: 'select', options: easingOptions,
            write: async (_snapshot, nextValue) => replace(index, { ...point, easing: nextValue })
        }, {
            name: `${prefix}-delete`, label: `#${index + 1}`, actionLabel: '削除', getValue: () => '',
            action: async () => requestWrite(audioKeyframeRequest(
                snapshot, points.filter((_candidate, candidateIndex) => candidateIndex !== index)
            ))
        });
    });
    return fields;
}

export function AUDIO_SECTIONS(
    snapshot: AudioInspectorSnapshot,
    requestWrite: (
        request: InspectorWriteRequest
    ) => Promise<InspectorWriteResult>
): InspectorSection[] {
    const autoLevelField: InspectorFieldDef = {
        name: 'audio-auto-level', label: 'レベル', actionLabel: '自動レベル', getValue: () => '',
        action: async () => requestWrite({
            kind: 'audio-auto-level', id: snapshot.id, audioKind: snapshot.audioKind
        })
    };
    const basicFields: InspectorFieldDef[] = [
        {
            name: 'gain-db', label: 'gain_db', unit: 'dB',
            getValue: () => withDefaultNumber(snapshot.gainDb, 0, formatDecimal1),
            getEditValue: () => String(snapshot.gainDb ?? 0),
            inputKind: 'scrub-number',
            scrubStep: 0.1,
            min: -60,
            max: 12,
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed) || parsed < -60 || parsed > 12) {
                    return { ok: false, message: 'gain_db は -60〜12 の範囲で入力してください。' };
                }
                return snapshot.audioKind === 'bgm'
                    ? requestWrite({ kind: 'bgm-gain', value: parsed })
                    : snapshot.audioKind === 'narration'
                        ? requestWrite({ kind: 'narration-gain', id: snapshot.id, value: parsed })
                        : requestWrite({ kind: 'sfx-gain', id: snapshot.id, value: parsed });
            }
        },
        ...(snapshot.audioKind === 'narration' ? [autoLevelField] : [])
    ];
    const tabs: InspectorSection[] = [
        {
            id: 'time', label: '時間', fields: [
                { name: 'audio-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                { name: 'audio-duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        { id: 'audio', label: '音声', fields: basicFields }
    ];
    if (snapshot.audioKind === 'bgm') {
        tabs.push({
            id: 'audio:fades', label: 'フェード・ダッキング',
            fields: [
                autoLevelField,
                {
                    name: 'audio-fade-in', label: 'fadeIn', unit: 's',
                    getValue: () => withDefaultNumber(snapshot.fadeIn, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeIn ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeIn は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'bgm-fade-in', value: parsed });
                    }
                },
                {
                    name: 'audio-fade-out', label: 'fadeOut', unit: 's',
                    getValue: () => withDefaultNumber(snapshot.fadeOut, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeOut ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeOut は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'bgm-fade-out', value: parsed });
                    }
                },
                ...duckingFields(snapshot, requestWrite)
            ]
        });
    } else if (snapshot.audioKind === 'sfx') {
        tabs.push({
            id: 'audio:fades', label: 'フェード・ダッキング',
            fields: [
                autoLevelField,
                {
                    name: 'audio-fade-in', label: 'fadeIn', unit: 's',
                    getValue: () => withDefaultNumber(snapshot.fadeIn, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeIn ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeIn は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'sfx-fade-in', id: snapshot.id, value: parsed });
                    }
                },
                {
                    name: 'audio-fade-out', label: 'fadeOut', unit: 's',
                    getValue: () => withDefaultNumber(snapshot.fadeOut, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeOut ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeOut は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'sfx-fade-out', id: snapshot.id, value: parsed });
                    }
                },
                ...duckingFields(snapshot, requestWrite)
            ]
        });
    }
    tabs.push({
        id: 'audio:keyframes', label: '音量キーフレーム',
        fields: audioKeyframeFields(snapshot, requestWrite)
    });
    tabs.push({
        id: 'info', label: '情報', collapsedByDefault: true,
        fields: [
            { name: 'audio-kind', label: '種別', getValue: () => formatAudioKindLabel(snapshot.audioKind) },
            { name: 'audio-path', label: 'path', getValue: () => snapshot.label },
            { name: 'audio-track', label: 'トラック', getValue: () => snapshot.trackName },
            { name: 'audio-clip', label: 'クリップ', getValue: () => snapshot.clipName },
            ...(snapshot.audioKind === 'narration'
                ? [{ name: 'audio-script', label: 'script', getValue: () => orDash(snapshot.script, value => value) }]
                : [])
        ]
    });
    tabs.push(...AUDIO_CLIP_FX_SECTIONS(snapshot, requestWrite));
    return [
        tabs.find(section => section.id === 'audio')!,
        ...composeInspectorSections(tabs.filter(section => section.id !== 'audio'))
    ];
}

export function AUDIO_CLIP_FX_SECTIONS(
    snapshot: TimelineAudioSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorSection[] {
    const write = async (row: AudioClipFxRow, value: string | null): Promise<InspectorWriteResult> => {
        try {
            return await requestWrite(createAudioClipFxWriteRequest(snapshot, row, value));
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    };
    const sections: InspectorSection[] = [];
    if (snapshot.audioKind !== 'narration') {
        const formantLabel = snapshot.formant === 'shift' ? '移動' : '保持';
        sections.push({
            id: 'audio:pitch-time', label: 'ピッチ・タイム',
            caption: '速度はピッチを保ったまま変わります（タイムライン上の開始位置は不変・実効尺 = 素材尺 ÷ 速度）',
            fields: [{
                name: 'audio-speed', label: '速度', unit: '×',
                getValue: () => formatDecimal2(snapshot.speed ?? 1),
                getEditValue: () => String(snapshot.speed ?? 1),
                inputKind: 'scrub-number', min: 0.25, max: 4, scrubStep: 0.05, displayPrecision: 2,
                reset: () => write('speed', null),
                write: async (_rowSnapshot, value) => write('speed', value)
            }, {
                name: 'audio-pitch', label: 'ピッチ', unit: 'st',
                getValue: () => String(snapshot.pitchSemitones ?? 0),
                getEditValue: () => String(snapshot.pitchSemitones ?? 0),
                inputKind: 'scrub-number', min: -24, max: 24, scrubStep: 1,
                reset: () => write('pitch_semitones', null),
                write: async (_rowSnapshot, value) => write('pitch_semitones', value)
            }, {
                name: 'audio-formant', label: 'フォルマント',
                getValue: () => formantLabel, getEditValue: () => formantLabel,
                inputKind: 'select', options: ['保持', '移動'],
                reset: () => write('formant', null),
                write: async (_rowSnapshot, value) => write('formant', value)
            }]
        });
    }
    const denoiseLabel = snapshot.denoise?.method === 'fft' ? 'FFT'
        : snapshot.denoise?.method === 'nlm' ? 'NLM' : 'オフ';
    sections.push({
        id: 'audio:enhancement', label: '音声強調',
        fields: [{
            name: 'audio-denoise-method', label: 'ノイズ除去',
            getValue: () => denoiseLabel, getEditValue: () => denoiseLabel,
            inputKind: 'select', options: ['オフ', 'FFT', 'NLM'],
            reset: () => write('denoise-method', null),
            write: async (_rowSnapshot, value) => write('denoise-method', value)
        }, {
            name: 'audio-denoise-strength', label: '強さ', unit: '%',
            getValue: () => String(Math.round((snapshot.denoise?.strength ?? 0.5) * 100)),
            getEditValue: () => String(snapshot.denoise?.strength ?? 0.5),
            inputKind: 'scrub-number', min: 0, max: 1, scrubStep: 0.05,
            displayScale: 100, displayPrecision: 0,
            disabled: snapshot.denoise === undefined,
            title: snapshot.denoise === undefined ? 'ノイズ除去をオンにすると変更できます。' : undefined,
            reset: () => write('denoise-strength', null),
            write: async (_rowSnapshot, value) => write('denoise-strength', value)
        }, {
            name: 'audio-lowcut', label: 'ローカット', unit: 'Hz',
            getValue: () => String(snapshot.lowcutHz ?? 0),
            getEditValue: () => String(snapshot.lowcutHz ?? 0),
            inputKind: 'scrub-number', min: 0, max: 400, scrubStep: 5,
            reset: () => write('lowcut_hz', null),
            write: async (_rowSnapshot, value) => write('lowcut_hz', value)
        }]
    });
    return sections;
}

export function AUDIO_MASTER_SECTION(
    snapshot: TimelineAudioMasterSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorSection {
    const denoiseLabel = snapshot.denoise === 'strong' ? '強'
        : snapshot.denoise === 'std' ? '標準' : 'オフ';
    const disabledTitle = snapshot.enabled ? undefined : 'マスタリングをオンにすると変更できます。';
    return {
        id: 'audio:master',
        label: 'マスター（書き出し全体）',
        caption: 'プロジェクト全体に適用・プレビューは未対応（書き出し時のみ）',
        fields: [{
            name: 'audio-master-enabled', label: 'マスタリング',
            getValue: () => snapshot.enabled ? 'オン' : 'オフ',
            getEditValue: () => snapshot.enabled ? 'オン' : 'オフ',
            inputKind: 'select', options: ['オフ', 'オン'],
            write: async (_rowSnapshot, value) => requestWrite({
                kind: 'audio-master-enabled', value: value === 'オン'
            })
        }, {
            name: 'audio-master-denoise', label: 'ノイズ除去',
            getValue: () => denoiseLabel, getEditValue: () => denoiseLabel,
            inputKind: 'select', options: ['オフ', '標準', '強'],
            disabled: !snapshot.enabled, title: disabledTitle,
            reset: () => requestWrite({ kind: 'audio-master-denoise', value: null }),
            write: async (_rowSnapshot, value) => requestWrite({
                kind: 'audio-master-denoise',
                value: value === '強' ? 'strong' : value === '標準' ? 'std' : 'off'
            })
        }, {
            name: 'audio-master-loudnorm', label: 'ラウドネス目標', unit: 'LUFS',
            getValue: () => String(snapshot.loudnorm ?? AUDIO_MASTER_DEFAULT_LOUDNORM),
            getEditValue: () => String(snapshot.loudnorm ?? AUDIO_MASTER_DEFAULT_LOUDNORM),
            inputKind: 'scrub-number', scrubStep: 0.5, min: -70, max: 0,
            disabled: !snapshot.enabled, title: disabledTitle,
            reset: () => requestWrite({ kind: 'audio-master-loudnorm', value: null }),
            write: async (_rowSnapshot, value) => {
                const parsed = Number(value);
                return !Number.isFinite(parsed) || parsed < -70 || parsed > 0
                    ? { ok: false, message: 'ラウドネス目標は -70〜0 の範囲で入力してください。' }
                    : requestWrite({ kind: 'audio-master-loudnorm', value: parsed });
            }
        }, {
            name: 'audio-master-true-peak', label: 'True Peak 上限', unit: 'dBTP',
            getValue: () => String(snapshot.truePeakDbtp ?? AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP),
            getEditValue: () => String(snapshot.truePeakDbtp ?? AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP),
            inputKind: 'scrub-number', scrubStep: 0.1, min: -9, max: 0,
            disabled: !snapshot.enabled, title: disabledTitle,
            reset: () => requestWrite({ kind: 'audio-master-true-peak', value: null }),
            write: async (_rowSnapshot, value) => {
                const parsed = Number(value);
                return !Number.isFinite(parsed) || parsed < -9 || parsed > 0
                    ? { ok: false, message: 'True Peak 上限は -9〜0 の範囲で入力してください。' }
                    : requestWrite({ kind: 'audio-master-true-peak', value: parsed });
            }
        }]
    };
}
