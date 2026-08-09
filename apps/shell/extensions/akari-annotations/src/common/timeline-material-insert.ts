import { EditLayer } from './edit-store';

/**
 * 素材追加コマンド（akari.timeline.addMaterialAtPlayhead）の挿入要素を組み立てる純関数
 * (task 2026-08-10-timeline-clip-menu 指示5)。DOM に一切依存しないため node --test で検証できる。
 * id 採番（既存 layer id との衝突回避・nextCopyId の流儀）・duration クランプ・t の拒否判定
 * （司令塔裁定4）をここに集約する。書き込み自体（全文スナップショット方式）は呼び出し側
 * (akari-annotations-widget.ts) が担う。
 */
export interface TimelineMaterialInsertRejected {
    readonly ok: false;
    readonly reason: 'beyond-content-duration';
}

export interface LayerInsertAccepted {
    readonly ok: true;
    readonly element: EditLayer;
}

export type LayerInsertResult = LayerInsertAccepted | TimelineMaterialInsertRejected;

/** audio.sfx[] の最小形（sfxItem スキーマ必須: path, t。track は既定 0 を明示する）。 */
export interface TimelineSfxElement {
    readonly path: string;
    readonly t: number;
    readonly track: number;
}

export interface SfxInsertAccepted {
    readonly ok: true;
    readonly element: TimelineSfxElement;
}

export type SfxInsertResult = SfxInsertAccepted | TimelineMaterialInsertRejected;

/** 素材パスのファイル名から layer id の基底文字列を作る（英数字以外は '-' に畳む）。 */
function materialIdBase(relativePath: string): string {
    const fileName = relativePath.split('/').pop() || relativePath;
    const withoutExt = fileName.replace(/\.[^./]+$/u, '');
    const slug = withoutExt.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
    return `layer-${slug || 'material'}`;
}

/** 既存 id 集合と衝突しない id を返す（既存 nextCopyId と同じ「未衝突ならそのまま・以降は -2, -3...」の流儀）。 */
function nextAvailableId(base: string, existingIds: readonly string[]): string {
    const used = new Set(existingIds);
    if (!used.has(base)) {
        return base;
    }
    let sequence = 2;
    while (used.has(`${base}-${sequence}`)) {
        sequence++;
    }
    return `${base}-${sequence}`;
}

/**
 * video 素材を layers[] へ挿入する要素を組み立てる。
 * duration = min(実尺, 総尺 − t)（司令塔裁定4）。t が総尺以上なら拒否する。
 */
export function buildLayerElement(
    existingIds: readonly string[],
    relativePath: string,
    t: number,
    durationSeconds: number,
    contentDuration: number
): LayerInsertResult {
    if (!(t < contentDuration)) {
        return { ok: false, reason: 'beyond-content-duration' };
    }
    const remaining = Math.max(0, contentDuration - t);
    const duration = Math.min(durationSeconds, remaining);
    return {
        ok: true,
        element: {
            id: nextAvailableId(materialIdBase(relativePath), existingIds),
            t,
            duration,
            kind: 'video',
            src: relativePath,
            track: 0
        }
    };
}

/**
 * audio 素材を audio.sfx[] へ挿入する要素を組み立てる。in/out は省略し素材全長の
 * 既存意味に任せる（司令塔裁定4）。t が総尺以上なら拒否する。
 */
export function buildSfxElement(relativePath: string, t: number, contentDuration: number): SfxInsertResult {
    if (!(t < contentDuration)) {
        return { ok: false, reason: 'beyond-content-duration' };
    }
    return { ok: true, element: { path: relativePath, t, track: 0 } };
}
