import { t } from './shell-text';
import { QuickExportLintFinding } from './quick-export-protocol';

export interface ExportEngineReason {
    readonly kind: string;
    readonly id: string;
    readonly reason: string;
}

export interface ExportEngineEvent {
    readonly engine: 'gpu' | 'osr';
    readonly reasons: readonly ExportEngineReason[];
}

export interface ExportRefusalEvent {
    readonly code: string;
    readonly message: string;
}

declare module './quick-export-protocol' {
    interface QuickExportStatus {
        readonly exportEngine?: ExportEngineEvent;
        readonly exportRefusal?: ExportRefusalEvent;
    }
}

const MOTION_LABELS = (): Readonly<Record<string, string>> => ({
    'push-left': t('shell.export.engineReason.pushLeftLabel'), 'push-right': t('shell.export.engineReason.pushRightLabel'),
    'push-up': t('shell.export.engineReason.pushUpLabel'), 'push-down': t('shell.export.engineReason.pushDownLabel'),
    typewriter: t('shell.export.engineReason.typewriterLabel'), 'wipe-left': t('shell.export.engineReason.wipeLeftLabel'),
    'wipe-right': t('shell.export.engineReason.wipeRightLabel'), glitch: t('shell.export.engineReason.glitchLabel'), swing: t('shell.export.engineReason.swingStatus')
});

const LOOK_LABELS = (): Readonly<Record<string, string>> => ({
    stroke_inner: t('shell.export.engineReason.innerStrokeLabel'), fill_gradient: t('shell.export.engineReason.gradientFillLabel'), extrude: t('shell.export.engineReason.extrudeLabel')
});

const OVERLAY_LABELS = (): Readonly<Record<string, string>> => ({
    'absolute-external-url': t('shell.export.engineReason.externalUrlLabel'),
    'font-face-external-resource': t('shell.export.engineReason.externalFontLabel'),
    'image-external-resource': t('shell.export.engineReason.externalImageLabel'),
    'background-image-external-resource': t('shell.export.engineReason.externalBackgroundImageText'),
    'embedded-context': t('shell.export.engineReason.embeddedContentLabel'),
    'css-3d-transform': t('shell.export.engineReason.value3dTransformLabel'),
    'css-3d-backface-hidden': t('shell.export.engineReason.hidden3dBackfaceText'),
    'self-driving-clock': t('shell.export.engineReason.independentClockLabel'),
    'media-element': t('shell.export.engineReason.videoAudioElementText'),
    'vgpu-runtime': t('shell.export.engineReason.gpuSceneLabel'),
    'three-or-canvas-runtime': t('shell.export.engineReason.value3dCanvasRenderingStatus'),
    'script-runtime': t('shell.export.engineReason.scriptExecutionLabel'),
    'animation-timing': t('shell.export.engineReason.animationTimingStatus'),
    'advanced-css': t('shell.export.engineReason.advancedCssEffectsText'),
    'item-keyframes': t('shell.export.engineReason.itemKeyframesLabel'),
    'vgpu-invalid-declaration': t('shell.export.engineReason.invalidGpuSceneDeclarationText'),
    'three-or-canvas-runtime(data-akari-3d-scene)': t('shell.export.engineReason.combined3dScenesText')
});

function japaneseOverlayReason(code: string): string {
    const prefix = code.startsWith('three-sampled-condition:') ? t('shell.export.engineReason.unsupported3dSamplingStatus')
        : code.startsWith('vgpu-condition:') ? t('shell.export.engineReason.unsupportedGpuSceneText')
            : code.startsWith('forced-dom:') ? t('shell.export.engineReason.gpuPathUnavailableStatus') : '';
    const conditions = (prefix ? code.slice(code.indexOf(':') + 1) : code).split(/,\s*/u);
    if (!conditions.every(condition => Object.prototype.hasOwnProperty.call(OVERLAY_LABELS(), condition))) return code;
    return `${prefix}${conditions.map(condition => OVERLAY_LABELS()[condition]).join(t('shell.export.engineReason.reasonSeparator'))}`;
}

export function japaneseExportReason(code: string): string {
    const motion = /^caption-motion-(.+)-unsupported$/u.exec(code)?.[1];
    if (motion) return Object.prototype.hasOwnProperty.call(MOTION_LABELS(), motion) ? t('shell.export.engineReason.motionLabel', { value1: MOTION_LABELS()[motion] }) : code;
    const look = /^caption-rich-look-(.+)-unsupported$/u.exec(code)?.[1];
    if (look) return Object.prototype.hasOwnProperty.call(LOOK_LABELS(), look) ? LOOK_LABELS()[look] : code;
    if (code === 'caption-karaoke-fill-unsupported') return t('shell.export.engineReason.karaokeFillLabel');
    if (code === 'caption-text-style-vertical-unsupported') return t('shell.export.engineReason.verticalTextLabel');
    if (code === 'caption-run-plate-words-native') return t('shell.export.engineReason.wordDisplayRunEffectsText');
    if (code === 'caption-run-effects-typewriter') return t('shell.export.engineReason.typewriterRunEffectsText');
    if (code === 'words-native-color-and-geometry-mixed') return t('shell.export.engineReason.perCharacterColorShapeTogetherText');
    if (code === 'GPU Electron launcher unavailable') return t('shell.export.engineReason.gpuLaunchEnvironmentUnavailableStatus');
    if (code === 'caption-measure-unstable') return t('shell.export.engineReason.captionPositionUnstableText');
    if (code === 'hevc-unsupported') return t('shell.export.engineReason.gpuDoesNotSupportSelectedCodecText');
    if (code === 'memory-hard-stop') return t('shell.export.engineReason.gpuMemoryLimitExceededText');
    if (code.startsWith('caption-font-unavailable:')) return t('shell.export.engineReason.unavailableFontStatus', { value1: code.slice('caption-font-unavailable:'.length) });
    if (code.startsWith('caption-style-unsupported:')) return t('shell.export.engineReason.captionStyleLabel', { value1: code.slice('caption-style-unsupported:'.length) });
    return japaneseOverlayReason(code);
}

export function summarizeExportReasons(reasons: readonly ExportEngineReason[]): string[] {
    const groups = new Map<string, { count: number; label: string; kind: string }>();
    for (const item of reasons) {
        const label = japaneseExportReason(item.reason);
        const key = `${item.kind}:${item.reason}`;
        const group = groups.get(key) ?? { count: 0, label, kind: item.kind };
        group.count += 1;
        groups.set(key, group);
    }
    return [...groups.values()].map(group => {
        if (group.kind === 'caption') return t('shell.export.engineReason.captionCountReason', { value1: group.count, n: group.count, value2: group.label });
        if (group.kind === 'overlay') return t('shell.export.engineReason.overlayCountReason', { value1: group.count, value2: group.label });
        return group.label;
    });
}

export function exportEngineSummary(event: ExportEngineEvent): string {
    if (event.engine === 'gpu') return t('shell.export.engineReason.exportingGpuLabel');
    const reasons = summarizeExportReasons(event.reasons);
    return reasons.length > 0
        ? t('shell.export.engineReason.exportingOsrTimeReasonText', { value1: reasons.join(t('shell.export.engineReason.reasonSeparator')) })
        : t('shell.export.engineReason.exportingOsrTimeText');
}

export function exportEngineReasonCopyText(event: ExportEngineEvent): string {
    return [exportEngineSummary(event), ...event.reasons.map(reason =>
        t('shell.export.engineReason.reasonCopyLine', { kind: reason.kind === 'caption' ? t('shell.export.engineReason.captionsLabel') : reason.kind === 'overlay' ? t('shell.export.engineReason.overlaysLabel') : reason.kind, id: reason.id, reason: japaneseExportReason(reason.reason), code: reason.reason })
    )].join('\n');
}

export function lintRefusalSummary(findings: readonly QuickExportLintFinding[]): string | undefined {
    const messages = (severity: string): string[] => findings.filter(finding => finding.severity === severity)
        .map(finding => finding.message).filter((message): message is string => !!message);
    return (messages('error').length ? messages('error') : messages('warning')).slice(0, 3).join(t('shell.export.engineReason.reasonSeparator')) || undefined;
}

export function parseExportEventLine(line: string): ExportEngineEvent | ExportRefusalEvent | undefined {
    if (line === 'ENGINE gpu') return { engine: 'gpu', reasons: [] };
    if (line.startsWith('ENGINE osr reasons=')) {
        try {
            const reasons: unknown = JSON.parse(line.slice('ENGINE osr reasons='.length));
            if (Array.isArray(reasons) && reasons.every(item => item && typeof item.kind === 'string'
                && typeof item.id === 'string' && typeof item.reason === 'string')) {
                return { engine: 'osr', reasons };
            }
        } catch { /* Incomplete or malformed lines do not change the current engine. */ }
    }
    const refused = /^REFUSED code=([^ ]+) detail=(.+)$/u.exec(line);
    if (refused) {
        try {
            const detail: unknown = JSON.parse(refused[2]);
            if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
                return { code: refused[1], message: detail.message };
            }
        } catch { /* Keep the normal error reporting path. */ }
    }
    return undefined;
}

export class ExportEventLineParser {
    private pending = '';

    push(chunk: string): readonly (ExportEngineEvent | ExportRefusalEvent)[] {
        const lines = (this.pending + chunk).split(/\r?\n/u);
        this.pending = lines.pop() ?? '';
        if (this.pending.length > 8192) this.pending = this.pending.slice(-8192);
        return lines.map(parseExportEventLine).filter((item): item is ExportEngineEvent | ExportRefusalEvent => !!item);
    }
}
