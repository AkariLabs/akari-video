import { t } from './shell-text';
import { QuickExportCodec, QuickExportEncoder, QuickExportEngine, QuickExportQuality } from './quick-export-cli';

export interface ExportSettings {
    readonly quality: QuickExportQuality;
    readonly engine: QuickExportEngine;
    readonly encoder: QuickExportEncoder;
    readonly codec: QuickExportCodec;
    readonly fps: number | undefined;
    readonly resolution: ExportResolution;
    readonly customWidth?: number;
    readonly outputDirectoryUri: string | undefined;
    readonly rerunLint: boolean;
    readonly saveAsDefault: boolean;
}

export type ExportResolution = 'native' | '720p' | '1440p' | '4k' | 'custom';
export type OutputScaleMode = 'up' | 'down' | 'none';

export interface ResolvedOutputResolution {
    readonly width: number;
    readonly height: number;
    readonly mode: OutputScaleMode;
}

export interface ExportQualityChoice {
    readonly id: Exclude<QuickExportQuality, 'master'>;
    readonly label: string;
    readonly description: string;
    readonly recommended?: boolean;
    readonly crf: number;
    readonly hardwareMbps: number;
}

export interface ExportSettingSeat {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly available: boolean;
    readonly tooltip?: string;
    readonly exit?: string;
}

export interface OutputDescriptionLine {
    readonly label: string;
    readonly value: string;
}

const CONTAINERS = Object.freeze({
    h264: Object.freeze({ ext: 'mp4' as const, kind: 'file' as const }),
    hevc: Object.freeze({ ext: 'mp4' as const, kind: 'file' as const }),
    prores422: Object.freeze({ ext: 'mov' as const, kind: 'file' as const }),
    png: Object.freeze({ ext: null, kind: 'directory' as const })
});

export function containerForCodec(codec: QuickExportCodec): { ext: 'mp4' | 'mov' | null; kind: 'file' | 'directory' } {
    return { ...CONTAINERS[codec] };
}

export const EXPORT_QUALITY_CHOICES: readonly ExportQualityChoice[] = Object.freeze([
    {
        id: 'standard', get label() { return t('shell.export.settings.standardLabel'); }, recommended: true,
        get description() { return t('shell.export.settings.goodQualityPostingSharingRecommendedMostUsesMessage'); }, crf: 23, hardwareMbps: 8
    },
    {
        id: 'high', get label() { return t('shell.export.settings.highQualityLabel'); },
        get description() { return t('shell.export.settings.bestQualityDeliveryArchivingTakesLongerMessage'); }, crf: 18, hardwareMbps: 12
    },
    {
        id: 'light', get label() { return t('shell.export.settings.compactLabel'); },
        get description() { return t('shell.export.settings.quickSmallDraftReviewMessage'); }, crf: 26, hardwareMbps: 5
    }
]);

export const EXPORT_FORMAT_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    { id: 'h264', label: 'MP4 · H.264', get description() { return t('shell.export.settings.socialMediaWebStandardDeliveryText'); }, available: true, get exit() { return t('shell.export.settings.directGpuPathText'); } },
    { id: 'hevc', get label() { return t('shell.export.settings.mp4H265HevcText'); }, get description() { return t('shell.export.settings.aboutHalfFileSizeNotSupportedXMessage'); }, available: true, get exit() { return t('shell.export.settings.staysDirectGpuPathText'); }, get tooltip() { return t('shell.export.settings.h265AboutHalfFileSizeStayingDirectGpuPathMessage'); } },
    { id: 'prores422', label: 'MOV · ProRes 422 HQ', get description() { return t('shell.export.settings.deliveryMasterProductionCompaniesTvText'); }, available: true, get exit() { return t('shell.export.settings.renderGpuPackageFfmpegText'); }, get tooltip() { return t('shell.export.settings.prores422HqHighQualityDeliveryFormatProductionCompaniesMessage'); } },
    { id: 'prores4444', get label() { return t('shell.export.settings.movProres4444AlphaText'); }, get description() { return t('shell.export.settings.textOverlayAssetsTransparencyText'); }, available: false, get exit() { return t('shell.export.settings.renderGpuPackageFfmpegText'); }, get tooltip() { return t('shell.export.settings.prores4444ExportVideoTransparencyComingSoonMessage'); } },
    { id: 'vp9', get label() { return t('shell.export.settings.webmVp9AlphaText'); }, get description() { return t('shell.export.settings.transparentVideoWebText'); }, available: false, get exit() { return t('shell.export.settings.renderGpuPackageFfmpegText'); }, get tooltip() { return t('shell.export.settings.webmVp9ExportTransparentVideoWebComingSoonMessage'); } },
    { id: 'png', get label() { return t('shell.export.settings.pngSequenceLabel'); }, get description() { return t('shell.export.settings.vfxEffectsLabel'); }, available: true, exit: 'OSR', get tooltip() { return t('shell.export.settings.pngSequenceExportEachFrameImageMessage'); } }
]);

export const EXPORT_RESOLUTION_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    { id: 'source', get label() { return t('shell.export.settings.keepCurrentAction'); }, get description() { return t('shell.export.settings.keepResolutionEditJsonText'); }, available: true },
    { id: '720p', label: '720p', description: '1280 × 720', available: true, get tooltip() { return t('shell.export.settings.setShortSide720PxPreservingOrientationMessage'); } },
    { id: '1440p', label: '1440p', description: '2560 × 1440', available: true, get tooltip() { return t('shell.export.settings.setShortSide1440PxPreservingOrientationMessage'); } },
    { id: '4k', label: '4K', description: '3840 × 2160', available: true, get tooltip() { return t('shell.export.settings.setShortSide2160PxPreservingOrientationMessage'); } },
    { id: 'custom', get label() { return t('shell.export.settings.customLabel'); }, get description() { return t('shell.export.settings.calculateHeightWidthText'); }, available: true, get tooltip() { return t('shell.export.settings.setWidthCalculateHeightPreservingOrientationMessage'); } },
    { id: 'unlock-aspect', get label() { return t('shell.export.settings.unlockOrientationLabel'); }, get description() { return t('shell.export.settings.requiresPaddingCroppingStatus'); }, available: false, get tooltip() { return t('shell.export.settings.unlockOrientationSetWidthHeightSeparatelyComingSoonMessage'); } }
]);

export const EXPORT_AUDIO_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    { id: 'aac', label: 'AAC 48 kHz', get description() { return t('shell.export.settings.streamingStandardLabel'); }, available: true },
    { id: 'lufs-14', label: '−14 LUFS', get description() { return t('shell.export.settings.youtubeStreamingStatus'); }, available: false, get tooltip() { return t('shell.export.settings.choose14LufsLoudnessUiComingSoonMessage'); } },
    { id: 'lufs-16', label: '−16 LUFS', get description() { return t('shell.export.settings.applePlatformStreamingStatus'); }, available: false, get tooltip() { return t('shell.export.settings.choose16LufsLoudnessComingSoonMessage'); } },
    { id: 'lufs-23', label: '−23 LUFS', get description() { return t('shell.export.settings.broadcastLabel'); }, available: false, get tooltip() { return t('shell.export.settings.choose23LufsLoudnessComingSoonMessage'); } },
    { id: 'noise-reduction', get label() { return t('shell.export.settings.noiseReductionLabel'); }, get description() { return t('shell.export.settings.chooseLowHighAction'); }, available: false, get tooltip() { return t('shell.export.settings.chooseNoiseReductionStrengthComingSoonMessage'); } },
    { id: 'bitrate', get label() { return t('shell.export.settings.bitrateLabel'); }, description: t('shell.export.settings.value128320KbpsText'), available: false, get tooltip() { return t('shell.export.settings.chooseAudioBitrateComingSoonMessage'); } }
]);

export const EXPORT_COLOR_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    { id: 'rec709', label: '8-bit · Rec.709 · tv', get description() { return t('shell.export.settings.currentFixedOutputText'); }, available: true },
    { id: '10bit', label: '10-bit', get description() { return t('shell.export.settings.preserveMoreTonalDetailText'); }, available: false, get tooltip() { return t('shell.export.settings.value10BitAvailableHighPrecisionFormatsSuchProresComingSoonMessage'); } },
    { id: 'full-range', get label() { return t('shell.export.settings.fullRangeLabel'); }, get description() { return t('shell.export.settings.pcRangeLabel'); }, available: false, get tooltip() { return t('shell.export.settings.fullRangeExportVideoPcRangeComingSoonMessage'); } },
    { id: 'hdr-hlg', label: 'HDR · HLG', description: 'Rec.2020 HLG', available: false, get tooltip() { return t('shell.export.settings.hdrHlgWideGamutOutputStreamingComingSoonMessage'); } },
    { id: 'hdr-pq', label: 'HDR · PQ', description: 'Rec.2020 PQ', available: false, get tooltip() { return t('shell.export.settings.hdrPqWideGamutOutputMastersComingSoonMessage'); } }
]);

export const EXPORT_SETTING_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    ...EXPORT_FORMAT_SEATS,
    ...EXPORT_RESOLUTION_SEATS,
    ...EXPORT_AUDIO_SEATS,
    ...EXPORT_COLOR_SEATS
]);

export function qualityChoiceForCli(value: QuickExportQuality): ExportQualityChoice | undefined {
    return EXPORT_QUALITY_CHOICES.find(choice => choice.id === value);
}

export function isMasterSelectable(encoder: QuickExportEncoder): boolean {
    return encoder === 'x264';
}

export function isFormatSelectable(id: string): id is QuickExportCodec {
    return (id === 'h264' || id === 'hevc' || id === 'prores422' || id === 'png')
        && EXPORT_FORMAT_SEATS.some(seat => seat.id === id && seat.available);
}

function finitePositive(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function even(value: number): number {
    return Math.max(2, Math.round(value / 2) * 2);
}

function customWidth(value: number | undefined, fallback: number): number {
    const clamped = Math.min(7680, Math.max(320, finitePositive(value) ?? fallback));
    return Math.min(7680, Math.max(320, even(clamped)));
}

export function resolveOutputResolution(
    video: { readonly width?: number; readonly height?: number },
    settings: Pick<ExportSettings, 'resolution' | 'customWidth'>
): ResolvedOutputResolution {
    const sourceWidth = even(finitePositive(video.width) ?? 1920);
    const sourceHeight = even(finitePositive(video.height) ?? 1080);
    const resolution = settings.resolution ?? 'native';
    let width = sourceWidth;
    let height = sourceHeight;
    if (resolution === 'custom') {
        width = customWidth(settings.customWidth, sourceWidth);
        height = even(width * sourceHeight / sourceWidth);
    } else if (resolution !== 'native') {
        const shortEdge = resolution === '720p' ? 720 : resolution === '1440p' ? 1440 : 2160;
        if (sourceWidth >= sourceHeight) {
            height = shortEdge;
            width = even(shortEdge * sourceWidth / sourceHeight);
        } else {
            width = shortEdge;
            height = even(shortEdge * sourceHeight / sourceWidth);
        }
    }
    const sourcePixels = sourceWidth * sourceHeight;
    const outputPixels = width * height;
    return {
        width,
        height,
        mode: outputPixels > sourcePixels ? 'up' : outputPixels < sourcePixels ? 'down' : 'none'
    };
}

export function describeOutput(settings: ExportSettings, edit: unknown): readonly OutputDescriptionLine[] {
    const output = edit && typeof edit === 'object' && 'output' in edit
        ? (edit as { output?: unknown }).output
        : undefined;
    const outputRecord = output && typeof output === 'object' ? output as Record<string, unknown> : {};
    const width = finitePositive(outputRecord.width);
    const height = finitePositive(outputRecord.height);
    const sourceFps = finitePositive(outputRecord.fps);
    const dimensions = width && height ? `${width} × ${height}` : t('shell.export.settings.keepEditJsonSettingsText');
    const fps = settings.fps ?? sourceFps;
    const resolved = resolveOutputResolution({ width, height }, settings);
    const resolutionLabel: Readonly<Record<ExportResolution, string>> = {
        native: t('shell.export.settings.keepCurrentAction'), '720p': '720p', '1440p': '1440p', '4k': '4K', custom: t('shell.export.settings.customLabel')
    };
    const modeLabel: Readonly<Record<OutputScaleMode, string>> = {
        up: t('shell.export.settings.upscaleLabel'), down: t('shell.export.settings.downscaleLabel'), none: t('shell.export.settings.keepCurrentAction')
    };
    const pixelValue = (settings.resolution ?? 'native') === 'native'
        ? t('shell.export.settings.keepCurrentDimensions', { value1: dimensions, value2: fps ? ` · ${fps} fps` : '' })
        : t('shell.export.settings.resolutionDimensionsAndScale', { value1: resolved.width, value2: resolved.height, value3: resolutionLabel[settings.resolution], value4: modeLabel[resolved.mode], value5: fps ? ` · ${fps} fps` : '' });
    const formatValue: Readonly<Record<QuickExportCodec, string>> = {
        h264: 'MP4 · H.264 / AAC 48 kHz',
        hevc: t('shell.export.settings.mp4H265HevcAac48KhzText'),
        prores422: 'MOV · ProRes 422 HQ / PCM 48 kHz',
        png: t('shell.export.settings.pngSequenceWav48KhzText')
    };
    return [
        { get label() { return t('shell.export.settings.formatLabel'); }, value: formatValue[settings.codec] },
        { get label() { return t('shell.export.settings.resolutionLabel'); }, value: pixelValue },
        { get label() { return t('shell.export.settings.audioLabel'); }, value: t('shell.export.settings.value48Khz14LufsLoudnessDefaultText', { value1: settings.codec === 'h264' || settings.codec === 'hevc' ? 'AAC' : settings.codec === 'png' ? 'WAV' : 'PCM' }) },
        { get label() { return t('shell.export.settings.colorLabel'); }, value: settings.codec === 'prores422' ? '10-bit · Rec.709' : '8-bit · Rec.709' }
    ];
}
