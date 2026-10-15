import { t } from '@akari-video/i18n';
// Moved from akari-inspector-widget.ts (F-57): class-external inspector definitions.
import { captionRunRows } from '../caption-run-rows';
import type URI from '@theia/core/lib/common/uri';
import type { FileService } from '@theia/filesystem/lib/browser/file-service';
import { channelPeopleLocation, mergeSpeakerDictionary, orderChannelPeople, parseChannelPeople } from '../../../common/channel-people-reader';
import { InspectorWriteRequest, InspectorWriteResult, TimelineCaptionSelection, TimelineSelectionTarget } from '../../timeline-selection-model';
import { CAPTION_BACKGROUND_ON_OPACITY, captionEffectFromStyle, captionEffectPatch, captionEffectTransitionPatch, captionEffectColorPatch, captionEffectStrength, captionEffectStrengthPatch, captionEffectCard, captionEffectAdjustmentKeys, captionEffectAdjustmentValue, captionEffectAdjustmentPatch } from '../caption-style-effects';
import { createCaptionMotionPanel, type CaptionMotionServices } from '../caption-motion-panel';
import { CAPTION_ZONES, type CaptionAnimation, type CaptionBackgroundMode, type CaptionTextStyle } from '../../../common/caption-store';
import { composeInspectorSections } from '../section-model';
import { type InspectorFieldDef, type InspectorSection } from './types';
import { formatTimestamp, formatDurationSeconds, orDash, CAPTION_STYLE_DEFAULTS, CAPTION_PLATE_CAPSULE_HALF_HEIGHT_EM, captionStyleDisplayValue, isCaptionHexColor, effectiveCaptionBackgroundOpacity, type CaptionStyleFieldKey } from './shared-helpers';
import { ANIMATOR_SECTION } from './animator-section';
import { captionMultiTargets, commonCaptionAnimation, withCaptionMultiTargets } from '../caption-multi-targets';

const speakerNames = new Map<string, Record<string, string>>();

async function captionFiles(): Promise<{ files: FileService; project: URI } | undefined> {
    if (typeof window === 'undefined') return undefined;
    const container = (window as Window & { theia?: { container?: { get(key: unknown): unknown } } }).theia?.container;
    if (!container) return undefined;
    const [{ FileService }, { WorkspaceService }] = await Promise.all([
        import('@theia/filesystem/lib/browser/file-service'),
        import('@theia/workspace/lib/browser/workspace-service')
    ]);
    const roots = (container.get(WorkspaceService) as InstanceType<typeof WorkspaceService>).tryGetRoots();
    const project = roots[0]?.resource;
    return project ? { files: container.get(FileService) as FileService, project } : undefined;
}

function dictionaryNames(source: string): Record<string, string> {
    try {
        const root = JSON.parse(source) as { speakers?: Record<string, unknown> };
        return Object.fromEntries(Object.entries(root?.speakers ?? {}).flatMap(([id, value]) => {
            const name = typeof value === 'string' ? value : value && typeof value === 'object'
                ? (value as { name?: unknown }).name : undefined;
            return typeof name === 'string' ? [[id, name]] : [];
        }));
    } catch { return {}; }
}

function refreshSpeakerName(project: URI, files: FileService, speakerId: string): void {
    const dictionary = project.resolve('.akari/dictionary.json');
    void files.readFile(dictionary).then(result => {
        const names = dictionaryNames(result.value.toString());
        speakerNames.set(project.toString(), names);
        const row = document.querySelector<HTMLElement>('[data-akari-field="caption-speaker-name"] .akari-inspector-row-value');
        if (row) row.textContent = names[speakerId] ?? '—';
    }).catch(() => { speakerNames.set(project.toString(), {}); });
}

async function chooseCaptionPerson(speakerId: string): Promise<InspectorWriteResult> {
    const context = await captionFiles();
    if (!context) return { ok: false, message: t('inspector.captionSections.message.openProject') };
    const { files, project } = context;
    const [{ default: URI }, { BinaryBuffer }] = await Promise.all([
        import('@theia/core/lib/common/uri'), import('@theia/core/lib/common/buffer')
    ]);
    const location = channelPeopleLocation(project.toString());
    let people = [] as ReturnType<typeof parseChannelPeople>;
    if (location) {
        try { people = orderChannelPeople(parseChannelPeople((await files.readFile(new URI(location.peopleUri))).value.toString())); }
        catch { /* 名前は入力できる */ }
    }
    document.querySelector('[data-akari-caption-person-popup]')?.remove();
    const anchor = document.querySelector<HTMLElement>('[data-akari-field="caption-speaker"]');
    const rect = anchor?.getBoundingClientRect();
    const popup = document.createElement('div'); popup.dataset.akariCaptionPersonPopup = 'true';
    Object.assign(popup.style, { position: 'fixed', zIndex: '1000', width: '240px', padding: '8px',
        display: 'flex', flexDirection: 'column', gap: '5px', borderRadius: '8px',
        background: 'var(--akari-elevated)', color: 'var(--akari-ink)',
        border: '1px solid var(--akari-line)', boxShadow: '0 8px 24px #0006',
        left: `${Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 248))}px`,
        top: `${Math.max(8, Math.min(rect?.bottom ?? 8, window.innerHeight - 320))}px` });
    const heading = document.createElement('strong'); heading.textContent = t('inspector.captionSections.text.linkPerson'); popup.append(heading);
    const save = async (value: { name: string; person?: string } | undefined): Promise<void> => {
        try {
            const folder = project.resolve('.akari'); const dictionary = folder.resolve('dictionary.json');
            const old = await files.readFile(dictionary).then(result => result.value.toString()).catch(() => '');
            if (!(await files.exists(folder))) await files.createFolder(folder);
            const merged = mergeSpeakerDictionary(old, speakerId, value);
            await files.writeFile(dictionary, BinaryBuffer.fromString(merged));
            speakerNames.set(project.toString(), dictionaryNames(merged));
            const row = document.querySelector<HTMLElement>('[data-akari-field="caption-speaker-name"] .akari-inspector-row-value');
            if (row) row.textContent = value?.name ?? '—';
            popup.remove();
        } catch (error) { heading.textContent = String(error); }
    };
    const button = (label: string, onClick: () => void): HTMLButtonElement => {
        const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
        Object.assign(node.style, { textAlign: 'left', padding: '5px', color: 'inherit',
            background: 'transparent', border: '0', cursor: 'pointer' });
        node.addEventListener('click', onClick); return node;
    };
    for (const person of people) popup.append(button(`${person.hasVoiceSample ? '♪ ' : ''}${person.name}`,
        () => void save({ name: person.name, person: `${location!.channel}/${person.id}` })));
    const input = document.createElement('input'); input.placeholder = t('inspector.captionSections.placeholder.nameOnly');
    input.setAttribute('aria-label', t('inspector.captionSections.placeholder.nameOnly'));
    const saveName = () => { if (input.value.trim()) void save({ name: input.value.trim() }); };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') saveName(); });
    popup.append(input, button(t('inspector.captionSections.placeholder.nameOnly'), saveName));
    if (location) {
        popup.append(button(t('inspector.captionSections.button.unlink'), () => void save(undefined)));
        const note = document.createElement('small'); note.style.color = 'var(--akari-muted)';
        note.textContent = t('inspector.captionSections.text.voiceBasedSuggestionsComingSoonRegisterVoice');
        popup.append(note);
    }
    document.body.append(popup);
    return { ok: true };
}

function captionMotionWriteForTargets(request: InspectorWriteRequest,
    targets: readonly TimelineSelectionTarget[], common?: CaptionAnimation): InspectorWriteRequest {
    const prepared = withCaptionMultiTargets(request, targets, common);
    if (request.kind !== 'caption-style-my-style' || request.value.replace_all_motion !== true
        || prepared.kind !== 'caption-style-my-style') return prepared;
    const parts = Array.isArray(request.value.parts) ? request.value.parts : [];
    const motion = parts.find(part => part && typeof part === 'object' && part.kind === 'motion');
    if (!motion) return prepared;
    const animation = motion && typeof motion === 'object' && motion.animation
        && typeof motion.animation === 'object' ? motion.animation as Record<string, unknown> : {};
    const delta = prepared.value.multi_motion_delta as { set: Record<string, unknown>; remove: string[] };
    return { ...prepared, value: { ...prepared.value, multi_motion_delta: {
        ...delta, remove: ['in', 'loop', 'out'].filter(slot => !animation[slot])
    } } };
}

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
    let speakerProjectKey = '';
    if (snapshot.speaker && typeof window !== 'undefined') {
        void captionFiles().then(context => {
            if (!context) return;
            speakerProjectKey = context.project.toString();
            refreshSpeakerName(context.project, context.files, snapshot.speaker!);
        });
    }
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
                return { ok: false, message: t('inspector.captionSections.message.enterColorAsRgbRrggbbRrggbbaa') };
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
            id: 'time', label: t('inspector.captionSections.label.time'), fields: [
                {
                    name: 'caption-output-start', label: t('inspector.captionSections.label.outputPosition'),
                    getValue: () => snapshot.outputStart === undefined ? '—' : formatTimestamp(snapshot.outputStart)
                },
                {
                    name: 'caption-output-duration', label: t('inspector.captionSections.label.duration'), getValue: () =>
                        snapshot.outputStart === undefined || snapshot.outputEnd === undefined
                            ? '—' : formatDurationSeconds(snapshot.outputEnd - snapshot.outputStart)
                }
            ]
        },
        {
            id: 'content', label: t('inspector.captionSections.label.content'),
            fields: [
                {
                    name: 'caption-text', label: t('inspector.captionSections.label.text'), inputKind: 'caption-text',
                    getValue: () => snapshot.text,
                    write: async (_snapshot, nextValue, phase) => {
                        if (!nextValue.trim()) {
                            return { ok: false, message: t('inspector.captionSections.message.subtitleTextCannotBeEmpty') };
                        }
                        return requestWrite({ kind: 'caption-text', id: snapshot.id, value: nextValue, phase });
                    }
                },
                {
                    name: 'caption-speaker', label: t('inspector.captionSections.label.speaker'),
                    getValue: () => orDash(snapshot.speaker, value => value),
                    getEditValue: () => snapshot.speaker ?? '',
                    ...(snapshot.speaker ? { menuAction: { label: t('inspector.captionSections.text.linkPerson'),
                        action: () => chooseCaptionPerson(snapshot.speaker!) } } : {}),
                    write: async (_snapshot, nextValue) => requestWrite({
                        kind: 'caption-speaker',
                        id: snapshot.id,
                        value: nextValue.trim().length > 0 ? nextValue : null
                    })
                },
                { name: 'caption-speaker-name', label: t('inspector.captionSections.label.name'),
                    getValue: () => snapshot.speaker
                        ? speakerNames.get(speakerProjectKey)?.[snapshot.speaker] ?? '—' : '—' },
                { name: 'caption-edited', label: t('inspector.captionSections.label.edited'), getValue: () => snapshot.edited ? t('inspector.captionSections.label.yes') : t('inspector.captionSections.label.no') }
            ]
        },
        {
            id: 'style', label: t('inspector.captionSections.label.textOverlay'),
            fields: [
                colorField(
                    t('inspector.captionSections.label.color'),
                    'color',
                    raw?.color,
                    effective?.color,
                    CAPTION_STYLE_DEFAULTS.color,
                    'caption-style-color'
                ),
                numberField(
                    t('inspector.captionSections.label.size'),
                    'size',
                    raw?.sizePx,
                    effective?.sizePx,
                    CAPTION_STYLE_DEFAULTS.sizePx,
                    'caption-style-size',
                    0,
                    undefined,
                    1,
                    'px',
                    t('inspector.captionSections.label.enterPositiveSize')
                ),
                {
                    name: 'caption-wrap-width', label: t('inspector.captionSections.label.wrapWidth'), inputKind: 'scrub-number',
                    unit: '%', min: 0.1, max: 100, scrubStep: 0.5,
                    getValue: () => options.mixedFields?.has('wrap-width') ? '—'
                        : raw?.wrapWidthPct === undefined ? t('inspector.captionSections.label.auto') : String(effective?.wrapWidthPct ?? raw.wrapWidthPct),
                    getEditValue: () => options.mixedFields?.has('wrap-width') ? '—'
                        : String(effective?.wrapWidthPct ?? 100),
                    write: async (_snapshot, nextValue) => {
                        const width = Number(nextValue);
                        if (!Number.isFinite(width) || width <= 0 || width > 100) {
                            return { ok: false, message: t('inspector.captionSections.message.enterWrapWidthGreaterThan0Most') };
                        }
                        return requestWrite({ kind: 'caption-style-wrap-width', id: snapshot.id,
                            value: width, ...requestOptions });
                    }
                },
                {
                    name: 'caption-font-weight', label: t('inspector.captionSections.label.weight'), inputKind: 'caption-weight',
                    getValue: () => options.mixedFields?.has('font-weight') ? '—'
                        : captionStyleDisplayValue(raw?.weight ?? raw?.fontWeight,
                            effective?.weight ?? effective?.fontWeight, CAPTION_STYLE_DEFAULTS.fontWeight),
                    getEditValue: () => options.mixedFields?.has('font-weight') ? '—'
                        : String(effective?.weight ?? effective?.fontWeight ?? CAPTION_STYLE_DEFAULTS.fontWeight),
                    write: async (_snapshot, value) => {
                        const weight = Number(value);
                        if (![400, 700, 900].includes(weight)) return { ok: false, message: t('inspector.captionSections.message.chooseWeight') };
                        return requestWrite({ kind: 'caption-style-font-weight', id: snapshot.id,
                            value: weight, ...requestOptions });
                    }
                },
                numberField(t('inspector.captionSections.label.lineSpacing'), 'line-height', raw?.lineHeight, effective?.lineHeight,
                    CAPTION_STYLE_DEFAULTS.lineHeight, 'caption-style-line-height',
                    0.9, 2.2, 0.05, '', t('inspector.captionSections.label.enterLineSpacingFrom092')),
                numberField(t('inspector.captionSections.label.letterSpacing'), 'letter-spacing', raw?.letterSpacingEm, effective?.letterSpacingEm,
                    CAPTION_STYLE_DEFAULTS.letterSpacingEm, 'caption-style-letter-spacing',
                    -0.1, 0.4, 0.01, 'em', t('inspector.captionSections.label.enterLetterSpacingFrom010')),
                colorField(
                    t('inspector.captionSections.label.color'),
                    'stroke-color',
                    raw?.stroke?.color,
                    effective?.stroke?.color,
                    CAPTION_STYLE_DEFAULTS.strokeColor,
                    'caption-style-stroke-color'
                ),
                numberField(
                    t('inspector.captionSections.label.weight'),
                    'stroke-width',
                    raw?.stroke?.widthPx,
                    effective?.stroke?.widthPx,
                    CAPTION_STYLE_DEFAULTS.strokeWidthPx,
                    'caption-style-stroke-width',
                    0,
                    undefined,
                    0.5,
                    'px',
                    t('inspector.captionSections.label.enterOutlineWidth0Greater')
                ),
                {
                    name: 'caption-style-bg-enabled', label: t('inspector.captionSections.label.show'), inputKind: 'caption-toggle',
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
                    name: 'caption-background-mode', label: t('inspector.captionSections.label.shape'),
                    getValue: () => options.mixedFields?.has('background-mode') ? '—'
                        : captionStyleDisplayValue(raw?.background?.mode, effective?.background?.mode,
                            CAPTION_STYLE_DEFAULTS.backgroundMode),
                    getEditValue: () => options.mixedFields?.has('background-mode') ? '—'
                        : effective?.background?.mode ?? CAPTION_STYLE_DEFAULTS.backgroundMode,
                    inputKind: 'caption-mode', options: ['per-line', 'block'],
                    write: async (_snapshot, nextValue) => {
                        if (nextValue !== 'per-line' && nextValue !== 'block') {
                            return { ok: false, message: t('inspector.captionSections.message.chooseOneTwoTextBackgroundShapes') };
                        }
                        return requestWrite({ kind: 'caption-style-bg-mode', id: snapshot.id,
                            value: nextValue as CaptionBackgroundMode, ...requestOptions });
                    }
                },
                colorField(
                    t('inspector.captionSections.label.color'),
                    'background-color',
                    raw?.background?.color,
                    effective?.background?.color,
                    CAPTION_STYLE_DEFAULTS.backgroundColor,
                    'caption-style-bg-color'
                ),
                numberField(
                    t('inspector.captionSections.label.opacity'),
                    'background-opacity',
                    raw?.background?.opacity,
                    effectiveCaptionBackgroundOpacity(effective),
                    CAPTION_STYLE_DEFAULTS.backgroundOpacity,
                    'caption-style-bg-opacity',
                    0,
                    1,
                    0.01,
                    '%',
                    t('inspector.captionSections.label.enterTextBackgroundOpacityFrom01')
                ),
                numberField(t('inspector.captionSections.label.padding'), 'background-padding', raw?.background?.paddingPx,
                    effective?.background?.paddingPx, CAPTION_STYLE_DEFAULTS.backgroundPaddingPx,
                    'caption-style-bg-padding', 0, undefined, 1, 'px', t('inspector.captionSections.label.enterPadding0Greater')),
                numberField(
                    t('inspector.captionSections.label.cornerRadius'),
                    'background-radius',
                    raw?.background?.radiusPx,
                    effective?.background?.radiusPx,
                    CAPTION_STYLE_DEFAULTS.backgroundRadiusPx,
                    'caption-style-bg-radius',
                    0,
                    undefined,
                    1,
                    'px',
                    t('inspector.captionSections.label.enterTextBackgroundCornerRadius0Greater')
                ),
                {
                    name: 'caption-style-effect', label: t('inspector.captionSections.label.type'), inputKind: 'caption-effect',
                    getValue: () => options.mixedFields?.has('effect') ? '—' : currentEffect,
                    write: async (_snapshot, nextValue) => {
                        if (!['none', 'shadow', 'raised', 'neon', 'outline'].includes(nextValue)
                            && !captionEffectCard(nextValue)) {
                            return { ok: false, message: t('inspector.captionSections.message.selectEffect') };
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
                    name: 'caption-style-effect-color', label: t('inspector.captionSections.label.effectColor'), inputKind: 'color',
                    getValue: () => options.mixedFields?.has('effect') ? '—'
                        : currentEffect === 'neon' ? effective?.glow?.color ?? '#39D5FF'
                            : currentEffect === 'outline' ? effective?.stroke?.color ?? '#000000'
                                : effective?.shadow?.color ?? '#000000',
                    getEditValue: () => currentEffect === 'neon' ? effective?.glow?.color ?? '#39D5FF'
                        : currentEffect === 'outline' ? effective?.stroke?.color ?? '#000000'
                            : effective?.shadow?.color ?? '#000000',
                    write: async (_snapshot, value) => {
                        if (!isCaptionHexColor(value)) return { ok: false, message: t('inspector.captionSections.message.enterHexColor') };
                        return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                            value: captionEffectColorPatch(effective ?? {}, value), ...requestOptions });
                    }
                },
                {
                    name: 'caption-style-effect-strength', label: t('inspector.captionSections.label.strength'), inputKind: 'slider-number',
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
                            return { ok: false, message: t('inspector.captionSections.message.enterStrength0Greater') };
                        }
                        return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                            value: captionEffectStrengthPatch(effective ?? {}, strength), ...requestOptions });
                    }
                },
                {
                    name: 'caption-zone', label: t('inspector.captionSections.label.position'),
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
                    name: `caption-position-${axis}`, label: axis === 'x' ? t('inspector.captionSections.label.xLeft') : 'Y',
                    inputKind: 'slider-number' as const, min: 0, sliderMax: 100,
                    scrubStep: 0.1, unit: '%' as const,
                    getValue: () => `${captionPositionPercent(effective, axis)}%`,
                    getEditValue: () => String(captionPositionPercent(effective, axis)),
                    write: async (_snapshot: TimelineCaptionSelection, value: string) => {
                        const percent = Number(value);
                        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
                            return { ok: false, message: t('inspector.captionSections.message.enterPositionFrom0100') };
                        }
                        options.zonePreset?.(`cue:${snapshot.id}:${axis}:${percent}`);
                        return { ok: true };
                    }
                }))
            ]
        },
        {
            id: 'timing', label: t('inspector.captionSections.label.timing'),
            fields: [
                { name: 'caption-start', label: 'start', getValue: () => formatTimestamp(snapshot.sourceStart) },
                { name: 'caption-end', label: 'end', getValue: () => formatTimestamp(snapshot.sourceEnd) },
                {
                    name: 'caption-duration', label: t('inspector.captionSections.label.duration'),
                    getValue: () => formatDurationSeconds(snapshot.sourceEnd - snapshot.sourceStart)
                },
                {
                    name: 'caption-source-segment', label: 'sourceRef.segment',
                    getValue: () => orDash(snapshot.sourceRef?.segment, value => String(value))
                }
            ]
        },
        { id: 'motion:caption', label: t('inspector.captionSections.label.motion'), fields: [], body: () => createCaptionMotionPanel(snapshot,
            requestWrite, options.motionServices) },
        ...(snapshot.animatorOwner ? [ANIMATOR_SECTION(
            snapshot.animatorOwner.id,
            t('inspector.captionSections.label.animatorGroupAppliesAllCues', { id: snapshot.animatorOwner.id }),
            snapshot.animatorOwner.animator,
            requestWrite
        )] : []),
        {
            id: 'info', label: t('inspector.captionSections.label.info'), collapsedByDefault: true, fields: [
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
            { id: 'style', label: t('inspector.captionSections.label.textOverlay'), fields: [
                ...fields.slice(0, 6),
                ...(snapshot.runs?.length ? captionRunRows(snapshot.displayText ?? snapshot.text, snapshot.runs)
                    .map((run, index): InspectorFieldDef<TimelineCaptionSelection> => ({
                    name: `caption-run-${index}`, label: index === 0 ? t('inspector.captionSections.label.textRange') : ' ',
                    getValue: () => '',
                    actions: [{ name: 'select', label: t('inspector.captionSections.label.characters', { start: run.from + 1, end: run.to, text: run.text, chip: run.chip }),
                        title: t('inspector.captionSections.title.selectTextRangePreview'), action: async () => {
                            window.dispatchEvent(new CustomEvent('akari.preview.selectCaptionRun', { detail: {
                                captionId: snapshot.id, from: run.from, to: run.to } }));
                            return { ok: true };
                        } },
                    { name: 'remove', label: t('inspector.captionSections.label.remove'), title: t('inspector.captionSections.title.removeTextRange'), action: () =>
                        requestWrite({ kind: 'caption-run-remove', id: snapshot.id, index }) }]
                })) : [])
            ] },
            { id: 'style:stroke', label: t('inspector.captionSections.label.outline'), fields: fields.slice(6, 8) },
            { id: 'style:background', label: t('inspector.captionSections.label.textBackground'), fields: fields.slice(8, 14), body: () => {
                const note = document.createElement('p');
                note.className = 'akari-caption-radius-note';
                note.textContent = t('inspector.captionSections.text.setCornerRadiusItsMaximumCapsuleShaped');
                return note;
            } },
            { id: 'style:effect', label: t('inspector.captionSections.label.effect'), fields: [fields[14],
                ...(options.mixedFields?.has('effect') ? [] : captionEffectAdjustmentKeys(currentEffect).map(path => {
                    const labels: Record<string, string> = {
                        'shadow.color': t('inspector.captionSections.label.shadowColor'), 'shadow.opacity': t('inspector.captionSections.label.shadowOpacity'),
                        'shadow.distancePx': t('inspector.captionSections.label.distance'), 'shadow.angleDeg': t('inspector.captionSections.label.angle'), 'shadow.blurPx': t('inspector.captionSections.label.blur'),
                        'glow.color': t('inspector.captionSections.label.glowColor'), 'glow.density': t('inspector.captionSections.label.glowStrength'), 'glow.spread': t('inspector.captionSections.label.spread'),
                        'stroke.color': t('inspector.captionSections.label.outlineColor'), 'stroke.widthPx': t('inspector.captionSections.label.outlineWidth'),
                        'strokeInner.color': t('inspector.captionSections.label.innerOutlineColor'), 'strokeInner.widthPx': t('inspector.captionSections.label.innerOutlineWidth'),
                        'fillGradient.color0': t('inspector.captionSections.label.color1'), 'fillGradient.color1': t('inspector.captionSections.label.color2'),
                        'fillGradient.color2': t('inspector.captionSections.label.color3'), 'fillGradient.angleDeg': t('inspector.captionSections.label.angle'),
                        'extrude.depthPx': t('inspector.captionSections.label.depth'), 'extrude.color': t('inspector.captionSections.label.extrusionColor'),
                        'extrude.colorEnd': t('inspector.captionSections.label.endColor'), 'extrude.angleDeg': t('inspector.captionSections.label.orientation'),
                        'background.color': t('inspector.captionSections.label.bandColor'), 'background.opacity': t('inspector.captionSections.label.bandOpacity'),
                        'background.radiusPx': t('inspector.captionSections.label.cornerRadius'), 'background.paddingPx': t('inspector.captionSections.label.padding')
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
                                return { ok: false, message: error instanceof Error ? error.message : t('inspector.captionSections.label.checkValue') };
                            }
                        }
                    };
                }))] },
            { id: 'style:position', label: t('inspector.captionSections.label.position'), fields: fields.slice(17) }
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
        motionServices?: CaptionMotionServices;
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
    const commonAnimation = commonCaptionAnimation(snapshots);
    const aggregate: TimelineCaptionSelection = {
        ...snapshots[0],
        textStyle: { ...effectiveStyle, animation: commonAnimation },
        effectiveTextStyle: { ...effectiveStyle, animation: commonAnimation }
    };
    const targets = captionMultiTargets(snapshots);
    const styleCards = CAPTION_SECTIONS(aggregate, requestWrite, { mixedFields, targets, ...zoneActions })
        .filter(section => section.id === 'style' || section.id.startsWith('style:'));
    const motion = CAPTION_SECTIONS(aggregate,
        request => requestWrite(captionMotionWriteForTargets(request, targets, commonAnimation)),
        { motionServices: zoneActions.motionServices })
        .filter(section => section.id === 'motion:caption');
    const placedCount = snapshots.filter(snapshot =>
        (snapshot as TimelineCaptionSelection & { timeDomain?: string }).timeDomain === 'output').length;
    return [
        {
            id: 'content', label: t('inspector.captionSections.label.contentsMultiple'),
            fields: [
                {
                    name: 'caption-multi-count', label: t('inspector.captionSections.label.selection'), getValue: () => t('inspector.captionSections.label.items', { count: snapshots.length, n: snapshots.length })
                }
            ]
        },
        ...styleCards,
        ...motion,
        { id: 'info', label: t('inspector.captionSections.label.info'), fields: [
            { name: 'caption-multi-info-count', label: t('inspector.captionSections.label.selection'), getValue: () => t('inspector.captionSections.label.items', { count: snapshots.length, n: snapshots.length }) },
            { name: 'caption-multi-info-kinds', label: t('inspector.captionSections.label.type'), getValue: () =>
                t('inspector.captionSections.label.captionsTextOverlays', { captions: snapshots.length - placedCount, textOverlays: placedCount }) }
        ] }
    ];
}

export function CAPTION_BAG_MOTION_SECTION(
    load: () => Promise<{ ids: string[]; snapshot: TimelineCaptionSelection }>,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    services: (snapshot: TimelineCaptionSelection, ids: string[]) => CaptionMotionServices
): InspectorSection {
    return { id: 'motion:caption', label: t('inspector.captionSections.label.motion'), fields: [], body: () => {
        const host = document.createElement('div');
        host.textContent = t('inspector.captionSections.text.loadingCaptionMotion');
        void load().then(({ ids, snapshot }) => {
            if (!host.isConnected) return;
            const targets = captionMultiTargets(ids.map(id => ({ id })));
            host.replaceChildren(createCaptionMotionPanel(snapshot,
                request => requestWrite(captionMotionWriteForTargets(request, targets,
                    snapshot.effectiveTextStyle?.animation)), services(snapshot, ids)));
        }).catch(error => {
            if (host.isConnected) host.textContent = error instanceof Error ? error.message : String(error);
        });
        return host;
    } };
}
