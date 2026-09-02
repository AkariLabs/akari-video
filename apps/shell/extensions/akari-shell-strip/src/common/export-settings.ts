import { QuickExportEncoder, QuickExportEngine, QuickExportQuality } from './quick-export-cli';

export interface ExportSettings {
    readonly quality: QuickExportQuality;
    readonly engine: QuickExportEngine;
    readonly encoder: QuickExportEncoder;
    readonly fps: number | undefined;
    readonly outputDirectoryUri: string | undefined;
    readonly rerunLint: boolean;
    readonly saveAsDefault: boolean;
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
    { id: 'h265', label: 'MP4 · H.265（HEVC）', description: '容量ほぼ半分。X は非対応', available: false, exit: 'GPU 直結のまま', tooltip: 'H.265: GPU 直結のまま容量を約半分に。近日' },
    { id: 'prores422', label: 'MOV · ProRes 422 HQ', description: '制作会社・TV への納品マスター', available: false, exit: 'GPU で描く → ffmpeg で包む', tooltip: 'ProRes 422 HQ: 制作会社向けの高品質な納品形式。近日' },
    { id: 'prores4444', label: 'MOV · ProRes 4444（透過）', description: '透過つきのテロップ素材', available: false, exit: 'GPU で描く → ffmpeg で包む', tooltip: 'ProRes 4444: 透過つきの動画を書き出します。近日' },
    { id: 'vp9', label: 'WebM · VP9（透過）', description: 'Web で使う透過動画', available: false, exit: 'GPU で描く → ffmpeg で包む', tooltip: 'WebM VP9: Web 向けの透過動画を書き出します。近日' },
    { id: 'png', label: '連番 PNG', description: 'VFX・After Effects へ渡す', available: false, exit: 'OSR', tooltip: '連番 PNG: 1 コマずつ画像として書き出します。近日' }
]);

export const EXPORT_RESOLUTION_SEATS: readonly ExportSettingSeat[] = Object.freeze([
    { id: 'source', label: 'そのまま', description: 'edit.json の画素数を維持', available: true },
    { id: '720p', label: '720p', description: '1280 × 720', available: false, tooltip: '720p: 軽い確認用サイズへ縮小します。近日' },
    { id: '1440p', label: '1440p', description: '2560 × 1440', available: false, tooltip: '1440p: 高精細な配信用サイズへ拡大します。近日' },
    { id: '4k', label: '4K', description: '3840 × 2160', available: false, tooltip: '4K: GPU の描画サイズを上げて出力します。近日' },
    { id: 'custom', label: '自由指定', description: '幅から高さを自動計算', available: false, tooltip: '自由指定: 幅を指定し、画角を保って高さを計算します。近日' },
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

function finitePositive(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
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
    return [
        { label: '形式', value: 'MP4 · H.264 / AAC 48 kHz' },
        { label: '画素数', value: `そのまま（${dimensions}${fps ? ` · ${fps} fps` : ''}）` },
        { label: '音', value: 'ラウドネス −14 LUFS（既定）' },
        { label: '色', value: '8-bit · Rec.709' }
    ];
}
