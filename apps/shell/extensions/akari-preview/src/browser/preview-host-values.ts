// F-50: akari-preview-open-handler.ts から機械移設した this 非依存の関数（本文は無改変。インデント 4 を除き、宣言行に export を足しただけ）。
import { TEXTSTYLE_CATALOG, captionRunStyleFromLook } from '@akari-video/edit-store';
import { captionRunOmittedNotice } from '../common/caption-run-style-notice';
import { PREVIEW_RATE_PRESETS } from '../common/preview-playback-rate';
import type { CaptionWriteRequest, ReviewAnnotationStrokeRequest, PreviewSessionSettings } from './preview-host-types';

export function defaultSessionSettings(): PreviewSessionSettings {
    return {
        muted: false,
        captionsVisible: true,
        hiddenTracks: new Set<number>(),
        hiddenTracksByScope: { cuts: new Set<number>(), layers: new Set<number>(), audio: new Set<number>() },
        mutedTracksByScope: { cuts: new Set<number>(), audio: new Set<number>(), layers: new Set<number>() },
        allTracksHiddenByScope: { cuts: false, layers: false, audio: false },
        allTracksMutedByScope: { cuts: false, audio: false, layers: false }
    };
}

// strokes[].frame.cutIndex は同一 source 秒が複数カットに含まれる場合の多義解決に使う
// （最初に見つかった有効な cutIndex を採用。ストローク群は同一 annotation・同一カットの想定）。
export function resolveReviewStrokeCutIndex(
    strokes: ReviewAnnotationStrokeRequest['strokes']
): number | null {
    for (const stroke of strokes) {
        const cutIndex = stroke.frame?.cutIndex;
        if (Number.isInteger(cutIndex) && (cutIndex as number) >= 0) {
            return cutIndex as number;
        }
    }
    return null;
}

export function nearestPreviewRatePreset(rate: number): number {
    return PREVIEW_RATE_PRESETS.reduce((closest, preset) =>
        Math.abs(preset - rate) < Math.abs(closest - rate) ? preset : closest
    );
}

export function runStyleChoices(saved: Array<{ id: string; name: string;
    parts: Array<{ kind: string; text_style?: unknown }> }>, baseSize: number): Array<{
        id: string; name: string; style: ReturnType<typeof captionRunStyleFromLook>['style']; notice: string | undefined
    }> {
    return [
        ...saved.flatMap(item => item.parts.filter(part => part.kind === 'look').map(part => ({
            id: `mine:${item.id}`, name: item.name, look: part.text_style as Record<string, unknown>
        }))),
        ...Object.values(TEXTSTYLE_CATALOG).map(item => ({
            id: `preset:${item.id}`, name: item.name, look: item.style as Record<string, unknown>
        }))
    ].map(item => {
        const converted = captionRunStyleFromLook(item.id.startsWith('preset:')
            ? { ...item.look,
                ...(typeof item.look.size_px === 'number'
                    && typeof (item.look.stroke as { width_px?: unknown } | undefined)?.width_px === 'number'
                    ? { stroke: { ...item.look.stroke as Record<string, unknown>,
                        width_px: (item.look.stroke as { width_px: number }).width_px
                            * baseSize / item.look.size_px } } : {}) }
            : item.look,
            item.id.startsWith('preset:') ? Number(item.look.size_px) : baseSize);
        return { id: item.id, name: item.name, style: converted.style,
            notice: captionRunOmittedNotice(converted.omitted) };
    });
}

export function detectUnsupportedGltfExtensions(bytes: Uint8Array): string[] {
    const UNSUPPORTED_GLTF_EXTENSIONS = ['KHR_draco_mesh_compression', 'KHR_texture_basisu'];
    try {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
            return [];
        }
        const jsonChunkLength = view.getUint32(12, true);
        const jsonChunkType = view.getUint32(16, true);
        if (jsonChunkType !== 0x4e4f534a || view.byteLength < 20 + jsonChunkLength) {
            return [];
        }
        const jsonBytes = bytes.subarray(20, 20 + jsonChunkLength);
        const json = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes)) as { extensionsUsed?: unknown };
        const used = new Set(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []);
        return UNSUPPORTED_GLTF_EXTENSIONS.filter(extension => used.has(extension));
    } catch {
        return [];
    }
}

// ㉓ layerWrite/cutWrite と同型だが対象ファイルは captions.json（edit.json ではない）。
// text_style.zone または text をフィールド単位で上書き（他フィールド・他キャプションは無傷）。
// 空白だけの text は captions.schema が保持できないため、対象 cue の削除として扱う。
// captions.json は array ルート / {captions:[...], default_text_style} object ルートの
// どちらも許容（schemas/captions.schema.json oneOf）ため両形を読む。
export function captionWriteLabel(request: CaptionWriteRequest): string {
    const patch = request.patch;
    if ('cueGeometryReset' in patch || 'cuePositionReset' in patch) return '字幕の位置を既定に戻す';
    if ('toolStyle' in patch || 'run' in patch) return '字幕の見た目を変更';
    if ('plateTransform' in patch) return patch.plateTransform.wrapWidthPct === undefined ? '字幕を拡縮・回転' : '文字の折り返し幅を変更';
    if ('cuePosition' in patch || 'cuePositions' in patch || 'groupPosition' in patch) return '字幕を移動';
    if ('text' in patch) return '字幕の文字を変更';
    return '字幕の配置を変更';
}

export function objectRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
