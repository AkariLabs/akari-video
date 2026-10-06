// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { captionRunRows } from '../caption-run-rows';
import { InspectorWriteRequest, InspectorWriteResult, TimelineCaptionSelection, TimelineSelectionTarget } from '../../timeline-selection-model';
import { CAPTION_BACKGROUND_ON_OPACITY, captionEffectFromStyle, captionEffectPatch, captionEffectTransitionPatch, captionEffectColorPatch, captionEffectStrength, captionEffectStrengthPatch, captionEffectCard, captionEffectAdjustmentKeys, captionEffectAdjustmentValue, captionEffectAdjustmentPatch } from '../caption-style-effects';
import { createCaptionMotionPanel, type CaptionMotionServices } from '../caption-motion-panel';
import { CAPTION_ZONES, type CaptionBackgroundMode, type CaptionTextStyle } from '../../../common/caption-store';
import { composeInspectorSections } from '../section-model';
import { type InspectorFieldDef, type InspectorSection } from './types';
import { formatTimestamp, formatDurationSeconds, orDash, CAPTION_STYLE_DEFAULTS, CAPTION_PLATE_CAPSULE_HALF_HEIGHT_EM, captionStyleDisplayValue, isCaptionHexColor, effectiveCaptionBackgroundOpacity, type CaptionStyleFieldKey } from './shared-helpers';
import { ANIMATOR_SECTION } from './animator-section';

export function CAPTION_SECTIONS(
    snapshot: TimelineCaptionSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    options: {
        mixedFields?: ReadonlySet<CaptionStyleFieldKey>;
        targets?: readonly TimelineSelectionTarget[];
        zoneHover?: (zone: string | null) => void;
        zonePreset?: (zone: string) => void;
        motionServices?: CaptionMotionServices;
    } = {}
): InspectorSection[] {
    const ensureCompactCaptionZoneStyle = (): void => {
        if (typeof document === 'undefined' || document.getElementById('akari-caption-zone-compact-style')) return;
        const style = document.createElement('style');
        style.id = 'akari-caption-zone-compact-style';
        style.textContent = `.akari-inspector-widget [data-akari-field="caption-zone"] .akari-caption-zone-grid {
            grid-template-columns: repeat(3, 22px); width: max-content; gap: 2px;
        }
        .akari-inspector-widget [data-akari-field="caption-zone"] .akari-caption-zone-cell {
            width: 22px; min-width: 22px; height: 22px; font-size: 11px;
        }
        .akari-inspector-widget [data-akari-field="caption-zone"] .akari-caption-zone-cell svg {
            width: 13px; height: 13px;
        }`;
        document.head.appendChild(style);
    };
    const captionPositionPercent = (style: CaptionTextStyle | undefined, axis: 'x' | 'y'): number => {
        const explicit = style?.position?.[axis];
        if (typeof explicit === 'number' && Number.isFinite(explicit)) return Math.round(explicit * 10000) / 100;
        const zone = style?.zone ?? 'bottom';
        if (axis === 'x') {
            const width = style?.wrapWidthPct ?? 92;
            return zone.endsWith('left') || zone === 'left' ? 4
                : zone.endsWith('right') || zone === 'right' ? Math.max(0, 96 - width)
                    : Math.max(0, (100 - width) / 2);
        }
        return zone.startsWith('top') ? 7 : zone === 'center' || zone === 'left' || zone === 'right' ? 50 : 93;
    };
    ensureCompactCaptionZoneStyle();
    const raw = snapshot.textStyle;
    const effective = snapshot.effectiveTextStyle;
    const currentEffect = captionEffectFromStyle(effective);
    const requestOptions = options.targets ? { targets: options.targets } : {};
    const colorField = (
        label: string,
        fieldKey: CaptionStyleFieldKey,
        rawValue: string | undefined,
        effectiveValue: string | undefined,
        fallback: string,
        kind: 'caption-style-color' | 'caption-style-stroke-color' | 'caption-style-bg-color'
    ): InspectorFieldDef<TimelineCaptionSelection> => ({
        name: `caption-${fieldKey}`, revealName: kind, label,
        getValue: () => options.mixedFields?.has(fieldKey)
            ? '—' : captionStyleDisplayValue(rawValue, effectiveValue, fallback),
        getEditValue: () => options.mixedFields?.has(fieldKey) ? '—' : effectiveValue ?? fallback,
        inputKind: 'color',
        write: async (_snapshot, nextValue) => {
            if (!isCaptionHexColor(nextValue)) {
                return { ok: false, message: '色は #RGB / #RRGGBB / #RRGGBBAA で入力してください。' };
            }
            return requestWrite({ kind, id: snapshot.id, value: nextValue, ...requestOptions });
        }
    });
    const numberField = (
        label: string,
        fieldKey: CaptionStyleFieldKey,
        rawValue: number | undefined,
        effectiveValue: number | undefined,
        fallback: number,
        kind: 'caption-style-size' | 'caption-style-stroke-width'
            | 'caption-style-bg-opacity' | 'caption-style-bg-radius'
            | 'caption-style-line-height' | 'caption-style-letter-spacing'
            | 'caption-style-bg-padding',
        min: number,
        max: number | undefined,
        step: number,
        unit: 'px' | '%' | 'em' | '',
        invalidMessage: string
    ): InspectorFieldDef<TimelineCaptionSelection> => ({
        name: `caption-${fieldKey}`, label,
        getValue: () => options.mixedFields?.has(fieldKey)
            ? '—' : captionStyleDisplayValue(rawValue, effectiveValue, fallback,
                value => fieldKey === 'background-opacity' ? `${Math.round(value * 100)}%` : String(value)),
        getEditValue: () => options.mixedFields?.has(fieldKey) ? '—' : String(effectiveValue ?? fallback),
        inputKind: 'slider-number',
        scrubStep: step,
        sliderMax: fieldKey === 'size' ? 320 : fieldKey === 'stroke-width' ? 20
            : fieldKey === 'line-height' ? 2.2 : fieldKey === 'letter-spacing' ? 0.4
                : fieldKey === 'background-padding' ? 40
                    : fieldKey === 'background-opacity' ? 1
                        : Math.round(((effective?.sizePx ?? CAPTION_STYLE_DEFAULTS.sizePx)
                            * CAPTION_PLATE_CAPSULE_HALF_HEIGHT_EM
                            + (effective?.background?.paddingPx ?? CAPTION_STYLE_DEFAULTS.backgroundPaddingPx)) * 2) / 2,
        unit,
        ...(fieldKey === 'background-opacity' ? { displayScale: 100 } : {}),
        min,
        ...(max !== undefined ? { max } : {}),
        write: async (_snapshot, nextValue) => {
            const parsed = Number(nextValue);
            if (!Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max)
                || (kind === 'caption-style-size' && parsed === 0)) {
                return { ok: false, message: invalidMessage };
            }
            return requestWrite({ kind, id: snapshot.id, value: parsed, ...requestOptions });
        }
    });
    const sections = composeInspectorSections<InspectorSection>([
        {
            id: 'time', label: '時間', fields: [
                {
                    name: 'caption-output-start', label: '出力位置',
                    getValue: () => snapshot.outputStart === undefined ? '—' : formatTimestamp(snapshot.outputStart)
                },
                {
                    name: 'caption-output-duration', label: '尺', getValue: () =>
                        snapshot.outputStart === undefined || snapshot.outputEnd === undefined
                            ? '—' : formatDurationSeconds(snapshot.outputEnd - snapshot.outputStart)
                }
            ]
        },
        {
            id: 'content', label: '内容',
            fields: [
                {
                    name: 'caption-text', label: 'テキスト', inputKind: 'caption-text',
                    getValue: () => snapshot.text,
                    write: async (_snapshot, nextValue) => {
                        if (!nextValue.trim()) {
                            return { ok: false, message: '字幕のテキストは空にできません。' };
                        }
                        return requestWrite({ kind: 'caption-text', id: snapshot.id, value: nextValue });
                    }
                },
                {
                    name: 'caption-speaker', label: '話者',
                    getValue: () => orDash(snapshot.speaker, value => value),
                    getEditValue: () => snapshot.speaker ?? '',
                    write: async (_snapshot, nextValue) => requestWrite({
                        kind: 'caption-speaker',
                        id: snapshot.id,
                        value: nextValue.trim().length > 0 ? nextValue : null
                    })
                },
                { name: 'caption-edited', label: '編集済み', getValue: () => snapshot.edited ? 'はい' : 'いいえ' }
            ]
        },
        {
            id: 'style', label: '文字',
            fields: [
                colorField(
                    '色',
                    'color',
                    raw?.color,
                    effective?.color,
                    CAPTION_STYLE_DEFAULTS.color,
                    'caption-style-color'
                ),
                numberField(
                    '大きさ',
                    'size',
                    raw?.sizePx,
                    effective?.sizePx,
                    CAPTION_STYLE_DEFAULTS.sizePx,
                    'caption-style-size',
                    0,
                    undefined,
                    1,
                    'px',
                    'サイズは正の数で入力してください。'
                ),
                {
                    name: 'caption-wrap-width', label: '折り返し幅', inputKind: 'scrub-number',
                    unit: '%', min: 0.1, max: 100, scrubStep: 0.5,
                    getValue: () => options.mixedFields?.has('wrap-width') ? '—'
                        : raw?.wrapWidthPct === undefined ? '自動' : String(effective?.wrapWidthPct ?? raw.wrapWidthPct),
                    getEditValue: () => options.mixedFields?.has('wrap-width') ? '—'
                        : String(effective?.wrapWidthPct ?? 100),
                    write: async (_snapshot, nextValue) => {
                        const width = Number(nextValue);
                        if (!Number.isFinite(width) || width <= 0 || width > 100) {
                            return { ok: false, message: '折り返し幅は 0 より大きく 100% 以下で入力してください。' };
                        }
                        return requestWrite({ kind: 'caption-style-wrap-width', id: snapshot.id,
                            value: width, ...requestOptions });
                    }
                },
                {
                    name: 'caption-font-weight', label: '太さ', inputKind: 'caption-weight',
                    getValue: () => options.mixedFields?.has('font-weight') ? '—'
                        : captionStyleDisplayValue(raw?.weight ?? raw?.fontWeight,
                            effective?.weight ?? effective?.fontWeight, CAPTION_STYLE_DEFAULTS.fontWeight),
                    getEditValue: () => options.mixedFields?.has('font-weight') ? '—'
                        : String(effective?.weight ?? effective?.fontWeight ?? CAPTION_STYLE_DEFAULTS.fontWeight),
                    write: async (_snapshot, value) => {
                        const weight = Number(value);
                        if (![400, 700, 900].includes(weight)) return { ok: false, message: '太さを選んでください。' };
                        return requestWrite({ kind: 'caption-style-font-weight', id: snapshot.id,
                            value: weight, ...requestOptions });
                    }
                },
                numberField('行間', 'line-height', raw?.lineHeight, effective?.lineHeight,
                    CAPTION_STYLE_DEFAULTS.lineHeight, 'caption-style-line-height',
                    0.9, 2.2, 0.05, '', '行間は 0.9〜2.2 で入力してください。'),
                numberField('字間', 'letter-spacing', raw?.letterSpacingEm, effective?.letterSpacingEm,
                    CAPTION_STYLE_DEFAULTS.letterSpacingEm, 'caption-style-letter-spacing',
                    -0.1, 0.4, 0.01, 'em', '字間は -0.1〜0.4 で入力してください。'),
                colorField(
                    '色',
                    'stroke-color',
                    raw?.stroke?.color,
                    effective?.stroke?.color,
                    CAPTION_STYLE_DEFAULTS.strokeColor,
                    'caption-style-stroke-color'
                ),
                numberField(
                    '太さ',
                    'stroke-width',
                    raw?.stroke?.widthPx,
                    effective?.stroke?.widthPx,
                    CAPTION_STYLE_DEFAULTS.strokeWidthPx,
                    'caption-style-stroke-width',
                    0,
                    undefined,
                    0.5,
                    'px',
                    '縁取り太さは 0 以上で入力してください。'
                ),
                {
                    name: 'caption-style-bg-enabled', label: '表示', inputKind: 'caption-toggle',
                    getValue: () => options.mixedFields?.has('background-opacity') ? '—'
                        : effectiveCaptionBackgroundOpacity(effective) > 0 ? 'true' : 'false',
                    getEditValue: () => options.mixedFields?.has('background-opacity') ? '—'
                        : effectiveCaptionBackgroundOpacity(effective) > 0 ? 'true' : 'false',
                    write: async (_snapshot, nextValue) => requestWrite({
                        kind: 'caption-style-bg-opacity', id: snapshot.id,
                        value: nextValue === 'true' ? CAPTION_BACKGROUND_ON_OPACITY : 0,
                        ...requestOptions
                    })
                },
                {
                    name: 'caption-background-mode', label: '形',
                    getValue: () => options.mixedFields?.has('background-mode') ? '—'
                        : captionStyleDisplayValue(raw?.background?.mode, effective?.background?.mode,
                            CAPTION_STYLE_DEFAULTS.backgroundMode),
                    getEditValue: () => options.mixedFields?.has('background-mode') ? '—'
                        : effective?.background?.mode ?? CAPTION_STYLE_DEFAULTS.backgroundMode,
                    inputKind: 'caption-mode', options: ['per-line', 'block'],
                    write: async (_snapshot, nextValue) => {
                        if (nextValue !== 'per-line' && nextValue !== 'block') {
                            return { ok: false, message: '座布団の形を2つの候補から選んでください。' };
                        }
                        return requestWrite({ kind: 'caption-style-bg-mode', id: snapshot.id,
                            value: nextValue as CaptionBackgroundMode, ...requestOptions });
                    }
                },
                colorField(
                    '色',
                    'background-color',
                    raw?.background?.color,
                    effective?.background?.color,
                    CAPTION_STYLE_DEFAULTS.backgroundColor,
                    'caption-style-bg-color'
                ),
                numberField(
                    '不透明度',
                    'background-opacity',
                    raw?.background?.opacity,
                    effectiveCaptionBackgroundOpacity(effective),
                    CAPTION_STYLE_DEFAULTS.backgroundOpacity,
                    'caption-style-bg-opacity',
                    0,
                    1,
                    0.01,
                    '%',
                    '座布団不透明度は 0〜1 の範囲で入力してください。'
                ),
                numberField('余白', 'background-padding', raw?.background?.paddingPx,
                    effective?.background?.paddingPx, CAPTION_STYLE_DEFAULTS.backgroundPaddingPx,
                    'caption-style-bg-padding', 0, undefined, 1, 'px', '余白は 0 以上で入力してください。'),
                numberField(
                    '角丸',
                    'background-radius',
                    raw?.background?.radiusPx,
                    effective?.background?.radiusPx,
                    CAPTION_STYLE_DEFAULTS.backgroundRadiusPx,
                    'caption-style-bg-radius',
                    0,
                    undefined,
                    1,
                    'px',
                    '座布団角丸は 0 以上で入力してください。'
                ),
                {
                    name: 'caption-style-effect', label: '種類', inputKind: 'caption-effect',
                    getValue: () => options.mixedFields?.has('effect') ? '—' : currentEffect,
                    write: async (_snapshot, nextValue) => {
                        if (!['none', 'shadow', 'raised', 'neon', 'outline'].includes(nextValue)
                            && !captionEffectCard(nextValue)) {
                            return { ok: false, message: '効果を選んでください。' };
                        }
                        return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                            value: { ...captionEffectTransitionPatch(nextValue as Parameters<typeof captionEffectPatch>[0],
                                effective?.color ?? CAPTION_STYLE_DEFAULTS.color, effective),
                                ...(nextValue === 'none' && (currentEffect.startsWith('bg-')
                                    || currentEffect === 'combo-band-outline') ? { background: { opacity: 0 } } : {}) },
                            ...requestOptions });
                    }
                },
                {
                    name: 'caption-style-effect-color', label: '効果の色', inputKind: 'color',
                    getValue: () => options.mixedFields?.has('effect') ? '—'
                        : currentEffect === 'neon' ? effective?.glow?.color ?? '#39D5FF'
                            : currentEffect === 'outline' ? effective?.stroke?.color ?? '#000000'
                                : effective?.shadow?.color ?? '#000000',
                    getEditValue: () => currentEffect === 'neon' ? effective?.glow?.color ?? '#39D5FF'
                        : currentEffect === 'outline' ? effective?.stroke?.color ?? '#000000'
                            : effective?.shadow?.color ?? '#000000',
                    write: async (_snapshot, value) => {
                        if (!isCaptionHexColor(value)) return { ok: false, message: '色は hex で入力してください。' };
                        return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                            value: captionEffectColorPatch(effective ?? {}, value), ...requestOptions });
                    }
                },
                {
                    name: 'caption-style-effect-strength', label: '強さ', inputKind: 'slider-number',
                    getValue: () => options.mixedFields?.has('effect') ? '—'
                        : captionStyleDisplayValue(
                            currentEffect === 'neon' ? raw?.glow?.spread
                                : currentEffect === 'outline' ? raw?.stroke?.widthPx
                                    : raw?.shadow?.distancePx,
                            captionEffectStrength(effective ?? {}),
                            currentEffect === 'outline' ? 6 : 1),
                    getEditValue: () => String(captionEffectStrength(effective ?? {})),
                    min: 0, sliderMax: currentEffect === 'outline' ? 20 : 8,
                    scrubStep: currentEffect === 'outline' ? 0.5 : 0.1,
                    unit: currentEffect === 'outline' ? 'px' : '',
                    write: async (_snapshot, value) => {
                        const strength = Number(value);
                        if (!Number.isFinite(strength) || strength < 0) {
                            return { ok: false, message: '強さは 0 以上で入力してください。' };
                        }
                        return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                            value: captionEffectStrengthPatch(effective ?? {}, strength), ...requestOptions });
                    }
                },
                {
                    name: 'caption-zone', label: '位置',
                    getValue: () => options.mixedFields?.has('zone')
                        ? '—'
                        : captionStyleDisplayValue(
                            raw?.zone,
                            effective?.zone,
                            CAPTION_STYLE_DEFAULTS.zone
                        ),
                    getEditValue: () => options.mixedFields?.has('zone')
                        ? '—' : raw?.position ? '' : effective?.zone ?? '',
                    inputKind: 'zone-grid',
                    options: CAPTION_ZONES,
                    write: async () => ({ ok: true }),
                    zoneHover: options.zoneHover,
                    zonePreset: zone => options.zonePreset?.(`cue:${snapshot.id}:zone:${zone}`)
                },
                ...(['x', 'y'] as const).map(axis => ({
                    name: `caption-position-${axis}`, label: axis === 'x' ? 'X（左端）' : 'Y',
                    inputKind: 'slider-number' as const, min: 0, sliderMax: 100,
                    scrubStep: 0.1, unit: '%' as const,
                    getValue: () => `${captionPositionPercent(effective, axis)}%`,
                    getEditValue: () => String(captionPositionPercent(effective, axis)),
                    write: async (_snapshot: TimelineCaptionSelection, value: string) => {
                        const percent = Number(value);
                        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
                            return { ok: false, message: '位置は 0〜100% で入力してください。' };
                        }
                        options.zonePreset?.(`cue:${snapshot.id}:${axis}:${percent}`);
                        return { ok: true };
                    }
                }))
            ]
        },
        {
            id: 'timing', label: 'タイミング',
            fields: [
                { name: 'caption-start', label: 'start', getValue: () => formatTimestamp(snapshot.sourceStart) },
                { name: 'caption-end', label: 'end', getValue: () => formatTimestamp(snapshot.sourceEnd) },
                {
                    name: 'caption-duration', label: '尺',
                    getValue: () => formatDurationSeconds(snapshot.sourceEnd - snapshot.sourceStart)
                },
                {
                    name: 'caption-source-segment', label: 'sourceRef.segment',
                    getValue: () => orDash(snapshot.sourceRef?.segment, value => String(value))
                }
            ]
        },
        { id: 'motion:caption', label: '動き', fields: [], body: () => createCaptionMotionPanel(snapshot,
            requestWrite, options.motionServices) },
        ...(snapshot.animatorOwner ? [ANIMATOR_SECTION(
            snapshot.animatorOwner.id,
            `袋 ${snapshot.animatorOwner.id} のアニメーター（全 cue に効く）`,
            snapshot.animatorOwner.animator,
            requestWrite
        )] : []),
        {
            id: 'info', label: '情報', collapsedByDefault: true, fields: [
                { name: 'caption-id', label: 'clip', getValue: () => snapshot.id },
                {
                    name: 'caption-source-ref', label: 'sourceRef.segment',
                    getValue: () => orDash(snapshot.sourceRef?.segment, value => String(value))
                }
            ]
        }
    ]);
    return sections.flatMap(section => {
        if (section.id !== 'style') return [section];
        const fields = section.fields;
        return [
            { id: 'style', label: '文字', fields: [
                ...fields.slice(0, 6),
                ...(snapshot.runs?.length ? captionRunRows(snapshot.displayText ?? snapshot.text, snapshot.runs)
                    .map((run, index): InspectorFieldDef<TimelineCaptionSelection> => ({
                    name: `caption-run-${index}`, label: index === 0 ? '文字範囲' : ' ',
                    getValue: () => '',
                    actions: [{ name: 'select', label: `${run.from + 1}〜${run.to}文字目 「${run.text}」 ${run.chip}`,
                        title: 'プレビューで文字範囲を選ぶ', action: async () => {
                            window.dispatchEvent(new CustomEvent('akari.preview.selectCaptionRun', { detail: {
                                captionId: snapshot.id, from: run.from, to: run.to } }));
                            return { ok: true };
                        } },
                    { name: 'remove', label: '外す', title: '文字範囲を外す', action: () =>
                        requestWrite({ kind: 'caption-run-remove', id: snapshot.id, index }) }]
                })) : [])
            ] },
            { id: 'style:stroke', label: '縁取り', fields: fields.slice(6, 8) },
            { id: 'style:background', label: '座布団', fields: fields.slice(8, 14), body: () => {
                const note = document.createElement('p');
                note.className = 'akari-caption-radius-note';
                note.textContent = '角丸を最大にすると文字に沿った丸い座布団（カプセル）になる';
                return note;
            } },
            { id: 'style:effect', label: '効果', fields: [fields[14],
                ...(options.mixedFields?.has('effect') ? [] : captionEffectAdjustmentKeys(currentEffect).map(path => {
                    const labels: Record<string, string> = {
                        'shadow.color': '影の色', 'shadow.opacity': '影の濃さ',
                        'shadow.distancePx': '距離', 'shadow.angleDeg': '角度', 'shadow.blurPx': 'ぼかし',
                        'glow.color': '光の色', 'glow.density': '光の強さ', 'glow.spread': '広がり',
                        'stroke.color': '縁の色', 'stroke.widthPx': '縁の太さ',
                        'strokeInner.color': '内縁の色', 'strokeInner.widthPx': '内縁の太さ',
                        'fillGradient.color0': '色 1', 'fillGradient.color1': '色 2',
                        'fillGradient.color2': '色 3', 'fillGradient.angleDeg': '角度',
                        'extrude.depthPx': '奥行き', 'extrude.color': '奥行きの色',
                        'extrude.colorEnd': '奥の色', 'extrude.angleDeg': '向き',
                        'background.color': '帯の色', 'background.opacity': '帯の濃さ',
                        'background.radiusPx': '角丸', 'background.paddingPx': '余白'
                    };
                    return {
                        name: `caption-effect-adjust-${path.replace('.', '-')}`,
                        label: labels[path] ?? path,
                        inputKind: /\.color(?:End|[0-2])?$/u.test(path) ? 'color' as const : 'scrub-number' as const,
                        getValue: () => captionEffectAdjustmentValue(effective ?? {}, path),
                        getEditValue: () => captionEffectAdjustmentValue(effective ?? {}, path),
                        min: 0, max: path.endsWith('.opacity') ? 1 : undefined,
                        scrubStep: path.endsWith('.opacity') ? .05 : 1,
                        unit: path.endsWith('Px') ? 'px' : path.endsWith('Deg') ? '°' : '',
                        write: async (_snapshot: TimelineCaptionSelection, value: string) => {
                            try {
                                return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                                    value: captionEffectAdjustmentPatch(effective ?? {}, path, value), ...requestOptions });
                            } catch (error) {
                                return { ok: false, message: error instanceof Error ? error.message : '値を確認してください。' };
                            }
                        }
                    };
                }))] },
            { id: 'style:position', label: '位置', fields: fields.slice(17) }
        ];
    });
}

export function commonCaptionValue<T>(
    snapshots: readonly TimelineCaptionSelection[],
    getValue: (snapshot: TimelineCaptionSelection) => T
): { mixed: boolean; value: T } {
    const value = getValue(snapshots[0]);
    return {
        value,
        mixed: snapshots.slice(1).some(snapshot => !Object.is(getValue(snapshot), value))
    };
}

export function MULTI_CAPTION_SECTIONS(
    snapshots: readonly TimelineCaptionSelection[],
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    zoneActions: {
        zoneHover: (zone: string | null) => void;
        zonePreset: (zone: string) => void;
    }
): InspectorSection[] {
    const mixedFields = new Set<CaptionStyleFieldKey>();
    const common = <T>(
        field: CaptionStyleFieldKey,
        getValue: (snapshot: TimelineCaptionSelection) => T
    ): T => {
        const result = commonCaptionValue(snapshots, getValue);
        if (result.mixed) {
            mixedFields.add(field);
        }
        return result.value;
    };
    const effectiveStyle: CaptionTextStyle = {
        color: common('color', snapshot =>
            snapshot.effectiveTextStyle?.color ?? CAPTION_STYLE_DEFAULTS.color),
        sizePx: common('size', snapshot =>
            snapshot.effectiveTextStyle?.sizePx ?? CAPTION_STYLE_DEFAULTS.sizePx),
        wrapWidthPct: common('wrap-width', snapshot => snapshot.effectiveTextStyle?.wrapWidthPct),
        fontWeight: common('font-weight', snapshot =>
            snapshot.effectiveTextStyle?.weight ?? snapshot.effectiveTextStyle?.fontWeight
                ?? CAPTION_STYLE_DEFAULTS.fontWeight),
        lineHeight: common('line-height', snapshot =>
            snapshot.effectiveTextStyle?.lineHeight ?? CAPTION_STYLE_DEFAULTS.lineHeight),
        letterSpacingEm: common('letter-spacing', snapshot =>
            snapshot.effectiveTextStyle?.letterSpacingEm ?? CAPTION_STYLE_DEFAULTS.letterSpacingEm),
        stroke: {
            color: common('stroke-color', snapshot =>
                snapshot.effectiveTextStyle?.stroke?.color ?? CAPTION_STYLE_DEFAULTS.strokeColor),
            widthPx: common('stroke-width', snapshot =>
                snapshot.effectiveTextStyle?.stroke?.widthPx ?? CAPTION_STYLE_DEFAULTS.strokeWidthPx)
        },
        background: {
            color: common('background-color', snapshot =>
                snapshot.effectiveTextStyle?.background?.color ?? CAPTION_STYLE_DEFAULTS.backgroundColor),
            opacity: common('background-opacity', snapshot =>
                effectiveCaptionBackgroundOpacity(snapshot.effectiveTextStyle)),
            radiusPx: common('background-radius', snapshot =>
                snapshot.effectiveTextStyle?.background?.radiusPx ?? CAPTION_STYLE_DEFAULTS.backgroundRadiusPx),
            paddingPx: common('background-padding', snapshot =>
                snapshot.effectiveTextStyle?.background?.paddingPx ?? CAPTION_STYLE_DEFAULTS.backgroundPaddingPx),
            mode: common('background-mode', snapshot =>
                snapshot.effectiveTextStyle?.background?.mode ?? CAPTION_STYLE_DEFAULTS.backgroundMode)
        },
        zone: common('zone', snapshot =>
            snapshot.effectiveTextStyle?.zone ?? CAPTION_STYLE_DEFAULTS.zone)
    };
    const effect = common('effect', snapshot => captionEffectFromStyle(snapshot.effectiveTextStyle));
    if (!mixedFields.has('effect')) {
        if (effect === 'shadow' || effect === 'raised' || effect.startsWith('sh-')
            || effect === 'combo-neon-shadow' || effect === 'combo-outline-shadow') {
            effectiveStyle.shadow = snapshots[0].effectiveTextStyle?.shadow;
        }
        if (effect === 'neon' || effect.startsWith('neon-') || effect.startsWith('gl-')
            || effect === 'combo-neon-shadow') {
            effectiveStyle.glow = snapshots[0].effectiveTextStyle?.glow;
        }
    }
    const aggregate: TimelineCaptionSelection = {
        ...snapshots[0],
        textStyle: effectiveStyle,
        effectiveTextStyle: effectiveStyle
    };
    const targets: TimelineSelectionTarget[] = snapshots.map(snapshot => ({
        kind: 'caption',
        id: snapshot.id
    }));
    const styleCards = CAPTION_SECTIONS(aggregate, requestWrite, { mixedFields, targets, ...zoneActions })
        .filter(section => section.id === 'style' || section.id.startsWith('style:'));
    return [
        {
            id: 'content', label: '内容（複数）',
            fields: [
                {
                    name: 'caption-multi-count', label: '選択', getValue: () => `${snapshots.length} 件`
                }
            ]
        },
        ...styleCards
    ];
}
