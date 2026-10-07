// F-50: akari-preview-open-handler.ts から機械移設した this 非依存の関数（本文は無改変。インデント 4 を除き、宣言行に export を足しただけ）。
import type {
    OverlayTransform,
    OverlayWriteRequest,
    OverlayWriteBatchRequest,
    LayerCropPatch,
    LayerPerspectivePatch,
    LayerWriteRequest,
    CutWriteRequest,
    CaptionWriteRequest,
    PreviewCaptionSelectedRequest,
    HevcFallbackRequest,
    OpenOutputRequest,
    PreviewReviewStrokeStartRequest,
    PreviewReviewStrokeEndRequest,
    PreviewReviewRectStartRequest,
    PreviewReviewRectEndRequest,
    PreviewReviewToolModeRequest,
    PreviewPlaybackTickRequest,
    PreviewPlaybackRateRequest,
    PreviewOverlaySelectedRequest,
    PreviewLayerSelectedRequest,
    PreviewCutSelectedRequest,
    PreviewReviewTransportRequest
} from './preview-host-types';

export function isPlaybackTickRequest(message: any): message is PreviewPlaybackTickRequest {
    return message?.type === 'akari-preview-playback-tick'
        && Number.isFinite(message.time)
        && typeof message.playing === 'boolean'
        && (message.rate === undefined || (Number.isFinite(message.rate) && message.rate > 0));
}

export function isPlaybackRateRequest(message: any): message is PreviewPlaybackRateRequest {
    return message?.type === 'akari-preview-playback-rate'
        && Number.isFinite(message.rate)
        && message.rate >= 0.5
        && message.rate <= 3;
}

export function isReviewTransportRequest(message: any): message is PreviewReviewTransportRequest {
    const event = message?.event;
    if (message?.type !== 'akari-preview-review-transport-event' || !event) {
        return false;
    }
    if ((event.type === 'play' || event.type === 'pause')
        && Number.isFinite(event.timelineT)) {
        return true;
    }
    if (event.type === 'seek' && Number.isFinite(event.from) && Number.isFinite(event.to)) {
        return true;
    }
    return event.type === 'rate' && Number.isFinite(event.value) && event.value > 0
        && Number.isFinite(event.timelineT);
}

export function isReviewStrokeStartRequest(message: any): message is PreviewReviewStrokeStartRequest {
    const frame = message?.frame;
    return message?.type === 'akari-preview-review-stroke-start'
        && Number.isFinite(frame?.timelineT)
        && Number.isFinite(frame?.sourceT)
        && (frame?.cutIndex === null
            || (Number.isInteger(frame?.cutIndex) && frame.cutIndex >= 0));
}

export function isReviewStrokeEndRequest(message: any): message is PreviewReviewStrokeEndRequest {
    return message?.type === 'akari-preview-review-stroke-end'
        && Array.isArray(message.points);
}

// task.md 指示4: rect ツールの start/end -- pen の isReviewStrokeStartRequest/
// forwardReviewStrokeStart と対をなす配線。
export function isReviewRectStartRequest(message: any): message is PreviewReviewRectStartRequest {
    const frame = message?.frame;
    return message?.type === 'akari-preview-review-rect-start'
        && Number.isFinite(frame?.timelineT)
        && Number.isFinite(frame?.sourceT)
        && (frame?.cutIndex === null
            || (Number.isInteger(frame?.cutIndex) && frame.cutIndex >= 0));
}

export function isReviewRectEndRequest(message: any): message is PreviewReviewRectEndRequest {
    const box = message?.box;
    return message?.type === 'akari-preview-review-rect-end'
        && Array.isArray(box) && box.length === 4 && box.every((value: unknown) => Number.isFinite(value));
}

// task.md 指示3: pen-toggle（既存入口）からの mode request。右パネルのボタン/ショートカット
// と同じ ReviewSessionRecorder.setToolMode に着地させる（正本は host 側の 1 箇所のみ）。
export function isReviewToolModeRequest(message: any): message is PreviewReviewToolModeRequest {
    return message?.type === 'akari-preview-review-tool-mode-request'
        && ['neutral', 'pen', 'rect', 'select'].includes(message?.mode);
}

export function isOverlaySelectedRequest(message: any): message is PreviewOverlaySelectedRequest {
    return message?.type === 'akari-preview-overlay-selected'
        && (typeof message.overlayId === 'string' || message.overlayId === null)
        && (message.overlayIds === undefined || (Array.isArray(message.overlayIds)
            && message.overlayIds.every((id: unknown) => typeof id === 'string')))
        && (message.scopeId === undefined || message.scopeId === null || typeof message.scopeId === 'string');
}

export function isLayerSelectedRequest(message: any): message is PreviewLayerSelectedRequest {
    return message?.type === 'akari-preview-layer-selected'
        && (typeof message.layerId === 'string' || message.layerId === null);
}

export function isCutSelectedRequest(message: any): message is PreviewCutSelectedRequest {
    return message?.type === 'akari-preview-cut-selected'
        && (typeof message.cutId === 'string' || message.cutId === null);
}

export function isCaptionSelectedRequest(message: any): message is PreviewCaptionSelectedRequest {
    return message?.type === 'akari-preview-caption-selected'
        && (typeof message.captionId === 'string' || message.captionId === null);
}

export function isOverlayWriteBatchRequest(message: any): message is OverlayWriteBatchRequest {
    return message?.type === 'akari-preview-overlay-write-batch'
        && typeof message.requestId === 'string'
        && Array.isArray(message.writes) && message.writes.length > 0
        && message.writes.every((write: any) => write && typeof write.overlayId === 'string'
            && write.overlayId.length > 0 && write.patch && typeof write.patch === 'object'
            && !Array.isArray(write.patch) && !('element' in write.patch)
            && (!('text' in write.patch) || typeof write.patch.text === 'string'));
}

export function isOverlayWriteRequest(message: any): message is OverlayWriteRequest {
    return message?.type === 'akari-preview-overlay-write'
        && typeof message.requestId === 'string'
        && typeof message.overlayId === 'string'
        && message.patch
        && typeof message.patch === 'object'
        && (!('text' in message.patch) || typeof message.patch.text === 'string')
        && (!('element' in message.patch) || (message.patch.element
            && typeof message.patch.element.ref === 'string'
            && typeof message.patch.element.tag === 'string'
            && message.patch.element.style && typeof message.patch.element.style === 'object'
            && !Array.isArray(message.patch.element.style)));
}

// CF-write: layerTransform の schema 定義（edit.schema.json #layerTransform — x/y/rotate は数値・
// scale は正の数）と同じ制約をここで先に弾く。edit-lint（呼び出しのみ）は layers[].transform の
// 数値レンジまでは検証しないため、この事前チェックが実質的な「不正値は書き込まない」の担保になる。
export function validateLayerTransformPatch(patch: OverlayTransform | undefined): string | undefined {
    if (!patch) {
        return undefined;
    }
    for (const field of ['x', 'y', 'rotate'] as const) {
        if (field in patch && !Number.isFinite(patch[field])) {
            return `transform.${field} は有限数値である必要があります。`;
        }
    }
    if ('scale' in patch && !(Number.isFinite(patch.scale) && (patch.scale as number) > 0)) {
        return 'transform.scale は正の数である必要があります。';
    }
    return undefined;
}

// ㉔ layers[].crop の schema 定義（edit.schema.json #layerCrop — 0..1 正規化・x+w<=1・y+h<=1）と
// 同じ制約をここで先に弾く（validateLayerTransformPatch と同じ「不正値は書き込まない」の担保）。
export function validateLayerCropPatch(patch: LayerCropPatch | undefined): string | undefined {
    if (!patch) {
        return undefined;
    }
    for (const field of ['x', 'y'] as const) {
        if (!Number.isFinite(patch[field]) || patch[field] < 0 || patch[field] > 1) {
            return `crop.${field} は 0 から 1 の範囲の有限数である必要があります。`;
        }
    }
    for (const field of ['w', 'h'] as const) {
        if (!Number.isFinite(patch[field]) || patch[field] <= 0 || patch[field] > 1) {
            return `crop.${field} は 0 より大きく 1 以下の有限数である必要があります。`;
        }
    }
    if (patch.x + patch.w > 1 + 1e-9) {
        return 'crop.x + crop.w は 1 以下である必要があります。';
    }
    if (patch.y + patch.h > 1 + 1e-9) {
        return 'crop.y + crop.h は 1 以下である必要があります。';
    }
    if (patch.rotate !== undefined && (!Number.isFinite(patch.rotate) || patch.rotate < -45 || patch.rotate > 45)) {
        return 'crop.rotate は -45 から 45 度の範囲である必要があります。';
    }
    return undefined;
}

// ㉖ layers[].perspective の schema 定義（edit.schema.json #layerPerspective — corners は
// [TL,TR,BL,BR] の 4 要素・各 [x,y] は 0..1）と同じ制約をここで先に弾く。patch.perspective ===
// null（明示的な解除）は常に有効。退化四角形（面積がほぼ 0）の拒否も
// packages/schemas/bin/validate-edit.mjs の validateLayerPerspective と同じシューレース公式で
// 揃える（意図的なコード重複 — 検収ゲートを edit-lint に一本化する契約どおり、ここでの拒否は
// 「早期に分かりやすいエラーを返す」ための先弾きであり、真の正本は edit-lint 経由の schema 検証）。
export function validateLayerPerspectivePatch(patch: LayerPerspectivePatch | null | undefined): string | undefined {
    if (patch === undefined || patch === null) {
        return undefined;
    }
    const corners = patch.corners;
    if (!Array.isArray(corners) || corners.length !== 4) {
        return 'perspective.corners は [TL,TR,BL,BR] の 4 要素配列である必要があります。';
    }
    const names = ['TL', 'TR', 'BL', 'BR'];
    for (let i = 0; i < 4; i += 1) {
        const corner = corners[i];
        if (!Array.isArray(corner) || corner.length !== 2) {
            return `perspective.corners[${i}] (${names[i]}) は [x, y] の 2 要素配列である必要があります。`;
        }
        const [x, y] = corner;
        if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
            return `perspective.corners[${i}] (${names[i]}) は 0 から 1 の範囲の有限数である必要があります。`;
        }
    }
    const [tl, tr, bl, br] = corners;
    const ring = [tl, tr, br, bl];
    let area2 = 0;
    for (let i = 0; i < ring.length; i += 1) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        area2 += x1 * y2 - x2 * y1;
    }
    if (Math.abs(area2) < 1e-4) {
        return 'perspective.corners は退化した四角形（面積がほぼ 0）であってはなりません。';
    }
    return undefined;
}

export function isCutWriteRequest(message: any): message is CutWriteRequest {
    return message?.type === 'akari-preview-cut-write'
        && typeof message.requestId === 'string'
        && Number.isInteger(message.cutIndex)
        && message.cutIndex >= 0
        && (message.cutId === undefined || typeof message.cutId === 'string')
        && message.patch
        && typeof message.patch === 'object';
}

export function isCaptionWriteRequest(message: any): message is CaptionWriteRequest {
    const hasZone = typeof message?.patch?.zone === 'string';
    const hasText = typeof message?.patch?.text === 'string';
    const run = message?.patch?.run;
    const hasRun = !!run && (run.kind === 'remove' ? Number.isInteger(run.index) && run.index >= 0
        : Number.isInteger(run.from) && Number.isInteger(run.to) && run.from >= 0 && run.to > run.from
            && (run.kind === 'role' ? typeof run.role === 'string' && run.role.length > 0
                : run.kind === 'style' && run.style && typeof run.style === 'object'));
    const hasGroupZone = typeof message?.patch?.groupZone === 'string';
    const groupPosition = message?.patch?.groupPosition;
    const hasGroupPosition = groupPosition
        && ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].includes(groupPosition.anchor)
        && groupPosition.position && typeof groupPosition.position === 'object'
        && Number.isFinite(groupPosition.position.y)
        && (groupPosition.position.x === undefined
            || Number.isFinite(groupPosition.position.x));
    const cuePosition = message?.patch?.cuePosition;
    const hasCuePosition = cuePosition
        && ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].includes(cuePosition.anchor)
        && cuePosition.position && typeof cuePosition.position === 'object'
        && Number.isFinite(cuePosition.position.y)
        && (cuePosition.position.x === undefined
            || Number.isFinite(cuePosition.position.x));
    const cuePositions = message?.patch?.cuePositions;
    const hasCuePositions = Array.isArray(cuePositions) && cuePositions.length > 1
        && cuePositions.every((entry: any) => typeof entry?.captionId === 'string'
            && ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].includes(entry.value?.anchor)
            && (entry.value?.position?.x === undefined
                || Number.isFinite(entry.value?.position?.x))
            && Number.isFinite(entry.value?.position?.y));
    const hasCuePositionReset = message?.patch?.cuePositionReset === true;
    const geometryReset = message?.patch?.cueGeometryReset;
    const hasGeometryReset = !!geometryReset && Array.isArray(geometryReset.captionIds)
        && geometryReset.captionIds.length > 0
        && geometryReset.captionIds.every((id: unknown) => typeof id === 'string' && id.length > 0);
    const toolStyle = message?.patch?.toolStyle;
    const hasToolStyle = !!toolStyle && Array.isArray(toolStyle.captionIds)
        && toolStyle.captionIds.length > 0
        && toolStyle.captionIds.every((id: unknown) => typeof id === 'string' && id.length > 0)
        && ['font_weight', 'color', 'stroke.color', 'background.color', 'background.opacity']
            .includes(toolStyle.change?.field)
        && (toolStyle.change.field === 'font_weight'
            ? toolStyle.change.value === null || (Number.isInteger(toolStyle.change.value)
                && toolStyle.change.value >= 100 && toolStyle.change.value <= 900)
            : toolStyle.change.field === 'background.opacity'
                ? Number.isFinite(toolStyle.change.value) && toolStyle.change.value >= 0 && toolStyle.change.value <= 1
                : typeof toolStyle.change.value === 'string' && /^#[0-9a-fA-F]{6}$/.test(toolStyle.change.value));
    const plateTransform = message?.patch?.plateTransform;
    const plateCuePosition = plateTransform?.cuePosition;
    const hasValidPlateCuePosition = plateCuePosition === undefined || (
        typeof plateCuePosition.captionId === 'string' && plateCuePosition.captionId.length > 0
        && ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].includes(plateCuePosition.value?.anchor)
        && plateCuePosition.value?.position && typeof plateCuePosition.value.position === 'object'
        && Number.isFinite(plateCuePosition.value.position.y)
        && (plateCuePosition.value.position.x === undefined
            || Number.isFinite(plateCuePosition.value.position.x))
    );
    const hasPlateScale = plateTransform?.scale !== undefined
        && Number.isFinite(plateTransform.scale)
        && plateTransform.scale >= 0.4 && plateTransform.scale <= 3;
    const hasPlateRotate = plateTransform?.rotate !== undefined
        && Number.isFinite(plateTransform.rotate)
        && plateTransform.rotate >= -180 && plateTransform.rotate <= 180;
    const hasWrapWidth = plateTransform?.wrapWidthPct !== undefined
        && Number.isFinite(plateTransform.wrapWidthPct)
        && plateTransform.wrapWidthPct > 0 && plateTransform.wrapWidthPct <= 100;
    const hasPlateTransform = !!plateTransform
        && Array.isArray(plateTransform.captionIds)
        && plateTransform.captionIds.length > 0
        && plateTransform.captionIds.every((id: unknown) => typeof id === 'string' && id.length > 0)
        && (hasPlateScale || hasPlateRotate || hasWrapWidth)
        && (plateTransform.scale === undefined || hasPlateScale)
        && (plateTransform.rotate === undefined || hasPlateRotate)
        && (plateTransform.wrapWidthPct === undefined || hasWrapWidth)
        && (plateTransform.backgroundPaddingPx === undefined || plateTransform.backgroundPaddingPx === 0)
        && hasValidPlateCuePosition;
    const duplicate = message?.patch?.duplicate;
    const hasDuplicate = duplicate && ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].includes(duplicate.anchor)
        && Number.isFinite(duplicate.position?.x) && Number.isFinite(duplicate.position?.y);
    return message?.type === 'akari-preview-caption-write'
        && typeof message.requestId === 'string'
        && typeof message.captionId === 'string'
        && message.patch
        && typeof message.patch === 'object'
        && [hasZone, hasText, hasRun, hasGroupZone, !!hasGroupPosition,
            !!hasCuePosition, hasCuePositions, hasCuePositionReset, hasPlateTransform, hasToolStyle,
            hasGeometryReset, hasDuplicate].filter(Boolean).length === 1;
}

export function isLayerWriteRequest(message: any): message is LayerWriteRequest {
    return message?.type === 'akari-preview-layer-write'
        && typeof message.requestId === 'string'
        && typeof message.layerId === 'string'
        && message.patch
        && typeof message.patch === 'object';
}

export function isHevcFallbackRequest(message: any): message is HevcFallbackRequest {
    return message?.type === 'akari-preview-hevc-fallback-request'
        && typeof message.requestId === 'string'
        && typeof message.errorCode === 'number'
        && (message.videoUri === undefined || typeof message.videoUri === 'string');
}

export function isOpenOutputRequest(message: any): message is OpenOutputRequest {
    return message?.type === 'akari-preview-open-output-request';
}
