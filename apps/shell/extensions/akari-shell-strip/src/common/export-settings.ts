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
    readonly label: '形式' | '画素数' | '音' | '色';
    readonly value: string;
}

export const EXPORT_QUALITY_CHOICES: readonly ExportQualityChoice[] = Object.freeze([
    {
        id: 'standard', label: '標準', recommended: true,
        description: '投稿・共有にちょうどいい画質。ふつうはこれ。', crf: 23, hardwareMbps: 8
    },
    {
        id: 'high', label: '高画質',
        description: '納品・保存用。時間はかかるが最もきれい。', crf: 18, hardwareMbps: 12
    },
    {
        id: 'light', label: '軽量',
        description: '確認用の下書き。すぐ出て軽い。', crf: 26, hardwareMbps: 5
    }
]);

export const EXPORT_FORMAT_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    { id: 'h264', label: 'MP4 · H.264', description: 'SNS・Web・ふつうの納品', available: true, exit: 'GPU 直結' },
    { id: 'hevc', label: 'MP4 · H.265（HEVC）', description: '容量ほぼ半分。X は非対応', available: true, exit: 'GPU 直結のまま', tooltip: 'H.265: GPU 直結のまま容量を約半分に。X は非対応です。' },
    { id: 'prores422', label: 'MOV · ProRes 422 HQ', description: '制作会社・TV への納品マスター', available: false, exit: 'GPU で描く → ffmpeg で包む', tooltip: 'ProRes 422 HQ: 制作会社向けの高品質な納品形式。近日' },
    { id: 'prores4444', label: 'MOV · ProRes 4444（透過）', description: '透過つきのテロップ素材', available: false, exit: 'GPU で描く → ffmpeg で包む', tooltip: 'ProRes 4444: 透過つきの動画を書き出します。近日' },
    { id: 'vp9', label: 'WebM · VP9（透過）', description: 'Web で使う透過動画', available: false, exit: 'GPU で描く → ffmpeg で包む', tooltip: 'WebM VP9: Web 向けの透過動画を書き出します。近日' },
    { id: 'png', label: '連番 PNG', description: 'VFX・After Effects へ渡す', available: false, exit: 'OSR', tooltip: '連番 PNG: 1 コマずつ画像として書き出します。近日' }
]);

export const EXPORT_RESOLUTION_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    { id: 'source', label: 'そのまま', description: 'edit.json の画素数を維持', available: true },
    { id: '720p', label: '720p', description: '1280 × 720', available: true, tooltip: '画角を保ったまま短辺 720 px にします。' },
    { id: '1440p', label: '1440p', description: '2560 × 1440', available: true, tooltip: '画角を保ったまま短辺 1440 px にします。' },
    { id: '4k', label: '4K', description: '3840 × 2160', available: true, tooltip: '画角を保ったまま短辺 2160 px にします。' },
    { id: 'custom', label: '自由指定', description: '幅から高さを自動計算', available: true, tooltip: '幅を指定し、画角を保って高さを計算します。' },
    { id: 'unlock-aspect', label: '画角を外す', description: '余白または切り取りが必要', available: false, tooltip: '画角を外す: 幅と高さを別々に指定します。近日' }
]);

export const EXPORT_AUDIO_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    { id: 'aac', label: 'AAC 48 kHz', description: '映像配信の標準', available: true },
    { id: 'lufs-14', label: '−14 LUFS', description: 'YouTube・配信向け', available: false, tooltip: 'ラウドネス −14 LUFS を画面から指定できるようになります。近日' },
    { id: 'lufs-16', label: '−16 LUFS', description: 'Apple 系配信向け', available: false, tooltip: 'ラウドネス −16 LUFS を選べるようになります。近日' },
    { id: 'lufs-23', label: '−23 LUFS', description: '放送向け', available: false, tooltip: 'ラウドネス −23 LUFS を選べるようになります。近日' },
    { id: 'noise-reduction', label: 'ノイズ低減', description: '弱・強を選択', available: false, tooltip: 'ノイズ低減の強さを選べるようになります。近日' },
    { id: 'bitrate', label: 'ビットレート', description: '128〜320 kbps', available: false, tooltip: '音声ビットレートを選べるようになります。近日' }
]);

export const EXPORT_COLOR_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    { id: 'rec709', label: '8-bit · Rec.709 · tv', description: '現在の固定出力', available: true },
    { id: '10bit', label: '10-bit', description: '階調を多く保持', available: false, tooltip: '10-bit: ProRes などの高精度形式で使えるようになります。近日' },
    { id: 'full-range', label: 'フルレンジ', description: 'pc レンジ', available: false, tooltip: 'フルレンジ: pc レンジの映像を書き出せるようになります。近日' },
    { id: 'hdr-hlg', label: 'HDR · HLG', description: 'Rec.2020 HLG', available: false, tooltip: 'HDR HLG: 広色域の配信向け出力です。近日' },
    { id: 'hdr-pq', label: 'HDR · PQ', description: 'Rec.2020 PQ', available: false, tooltip: 'HDR PQ: 広色域のマスター向け出力です。近日' }
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
    return (id === 'h264' || id === 'hevc')
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
    const dimensions = width && height ? `${width} × ${height}` : 'edit.json のまま';
    const fps = settings.fps ?? sourceFps;
    const resolved = resolveOutputResolution({ width, height }, settings);
    const resolutionLabel: Readonly<Record<ExportResolution, string>> = {
        native: 'そのまま', '720p': '720p', '1440p': '1440p', '4k': '4K', custom: '自由指定'
    };
    const modeLabel: Readonly<Record<OutputScaleMode, string>> = {
        up: '拡大', down: '縮小', none: 'そのまま'
    };
    const pixelValue = (settings.resolution ?? 'native') === 'native'
        ? `そのまま（${dimensions}${fps ? ` · ${fps} fps` : ''}）`
        : `${resolved.width} × ${resolved.height}（${resolutionLabel[settings.resolution]}・${modeLabel[resolved.mode]}${fps ? ` · ${fps} fps` : ''}）`;
    return [
        { label: '形式', value: settings.codec === 'hevc' ? 'MP4 · H.265（HEVC） / AAC 48 kHz' : 'MP4 · H.264 / AAC 48 kHz' },
        { label: '画素数', value: pixelValue },
        { label: '音', value: 'ラウドネス −14 LUFS（既定）' },
        { label: '色', value: '8-bit · Rec.709' }
    ];
}
