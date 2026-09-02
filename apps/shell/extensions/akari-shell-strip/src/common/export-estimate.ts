import { QuickExportEncoder, QuickExportEngine, QuickExportQuality } from './quick-export-cli';

const REFERENCE_PIXELS = 1920 * 1080;
const FIXED_OVERHEAD_SECONDS = 9;
const AUDIO_BITRATE_MBPS = 0.192;

export interface ExportLastRun {
    readonly frames: number;
    readonly width: number;
    readonly height: number;
    readonly elapsedMs: number;
    readonly engine: 'gpu' | 'osr';
}

export interface ExportEstimateInput {
    readonly frames: number;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly quality: QuickExportQuality;
    readonly encoder: QuickExportEncoder;
    readonly engine: QuickExportEngine;
    readonly lastRun?: ExportLastRun;
}

export interface ExportEstimate {
    readonly seconds: number;
    readonly bytes: number;
}

export interface FormattedExportEstimate {
    readonly time: string;
    readonly size: string;
}

const X264_QUALITY_FACTOR: Readonly<Record<QuickExportQuality, number>> = {
    master: 1.6,
    high: 1.2,
    standard: 1,
    light: 0.9
};

const HARDWARE_BITRATE_MBPS: Readonly<Record<QuickExportQuality, number>> = {
    master: 12,
    high: 12,
    standard: 8,
    light: 5
};

const X264_BITRATE_MBPS: Readonly<Record<QuickExportQuality, number>> = {
    master: 16,
    high: 10,
    standard: 6,
    light: 3.5
};

function positive(value: number, fallback: number): number {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** auto は GPU 直結として見積もり、実測との照合にも同じ正規化を使う。 */
function effectiveEngine(engine: QuickExportEngine): 'gpu' | 'osr' {
    return engine === 'osr' ? 'osr' : 'gpu';
}

/**
 * UI に出す概算値。前回実測を使える場合も、解像度差だけを画素数比で補正する。
 * 実測値の fps は既に frames に折り込まれているため、別の fps 係数は掛けない。
 */
export function estimateExport(input: ExportEstimateInput): ExportEstimate {
    const frames = Math.max(0, Math.round(Number.isFinite(input.frames) ? input.frames : 0));
    const width = positive(input.width, 1920);
    const height = positive(input.height, 1080);
    const fps = positive(input.fps, 30);
    const pixelRatio = (width * height) / REFERENCE_PIXELS;
    const engine = effectiveEngine(input.engine);
    const lastRun = input.lastRun;

    let millisecondsPerFrame: number;
    if (lastRun
        && lastRun.engine === engine
        && lastRun.frames > 0
        && lastRun.width > 0
        && lastRun.height > 0
        && lastRun.elapsedMs > 0) {
        const lastPixels = lastRun.width * lastRun.height;
        millisecondsPerFrame = (lastRun.elapsedMs / lastRun.frames) * (width * height / lastPixels);
    } else if (engine === 'gpu') {
        millisecondsPerFrame = 8 * pixelRatio;
    } else if (input.encoder === 'x264') {
        millisecondsPerFrame = 45 * pixelRatio;
    } else {
        millisecondsPerFrame = 25 * pixelRatio;
    }

    if (input.encoder === 'x264') {
        millisecondsPerFrame *= X264_QUALITY_FACTOR[input.quality];
    }

    const seconds = FIXED_OVERHEAD_SECONDS + frames * millisecondsPerFrame / 1000;
    const videoBitrate = (input.encoder === 'x264'
        ? X264_BITRATE_MBPS[input.quality]
        : HARDWARE_BITRATE_MBPS[input.quality]) * pixelRatio;
    const durationSeconds = frames / fps;
    const bytes = (videoBitrate + AUDIO_BITRATE_MBPS) * 1_000_000 * durationSeconds / 8;
    return { seconds, bytes };
}

export function formatEstimate(seconds: number, bytes: number): FormattedExportEstimate {
    const roundedSeconds = Math.max(10, Math.round(Math.max(0, seconds) / 10) * 10);
    let time: string;
    if (roundedSeconds < 60) {
        time = `約 ${roundedSeconds} 秒`;
    } else {
        const minutes = Math.floor(roundedSeconds / 60);
        const rest = roundedSeconds % 60;
        time = rest === 0 ? `約 ${minutes} 分` : `約 ${minutes} 分 ${rest} 秒`;
    }

    const megabytes = Math.max(0, bytes) / 1_000_000;
    const size = megabytes >= 1000
        ? `約 ${(megabytes / 1000).toFixed(1)} GB`
        : `約 ${Math.max(1, Math.round(megabytes))} MB`;
    return { time, size };
}
