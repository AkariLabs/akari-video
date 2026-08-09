import { EditLayer, TimelineTrackKind } from './edit-store';

/**
 * 素材追加コマンド（akari.timeline.addMaterialAtPlayhead / D&D ドロップ）の挿入要素を組み立てる
 * 純関数 (task 2026-08-10-timeline-clip-menu 指示5、2026-08-10-material-dnd-timeline で D&D 用に拡張)。
 * DOM に一切依存しないため node --test で検証できる。id 採番（既存 layer id との衝突回避・
 * nextCopyId の流儀）・duration クランプ・t の拒否判定（司令塔裁定4）をここに集約する。
 * 書き込み自体（全文スナップショット方式）は呼び出し側 (akari-annotations-widget.ts) が担う。
 */
export interface TimelineMaterialInsertRejected {
    readonly ok: false;
    readonly reason: 'beyond-content-duration';
}

/** image 素材をタイムラインへ挿入する際の既定尺（task 2026-08-10-material-dnd-timeline 司令塔裁定3）。 */
export const IMAGE_LAYER_DEFAULT_DURATION_SECONDS = 5;

export type MaterialDragKind = 'video' | 'audio' | 'image';

/**
 * ドロップ先トラック行の受理判定（司令塔裁定2）。video/image は layers トラック、audio は
 * audio トラックのみ受理する。trackKind が undefined は「対象種別のトラック行が 1 本も無い」
 * ことを表す — video/image はこの場合も新トラック扱いで受理する（layers 行が 0 本のプロジェクトでも
 * 挿入できること、という裁定 2 の明示要求）。audio には同じ救済を適用しない（既存ルール踏襲）。
 */
export function materialDropAcceptance(
    materialKind: MaterialDragKind,
    trackKind: TimelineTrackKind | undefined
): 'accept' | 'reject' {
    if (materialKind === 'audio') {
        return trackKind === 'audio' ? 'accept' : 'reject';
    }
    return trackKind === 'layers' || trackKind === undefined ? 'accept' : 'reject';
}

export interface MaterialGhostRange {
    readonly start: number;
    readonly end: number;
}

export type MaterialGhostResult =
    | { readonly ok: true; readonly range: MaterialGhostRange }
    | TimelineMaterialInsertRejected;

/**
 * D&D ゴーストの表示区間を計算する純関数（司令塔裁定5・6）。buildLayerElement と同じクランプ
 * 規則（duration = min(尺, 総尺 − t)）・拒否規則（t が総尺以上）を、要素組み立て（id 採番等）を
 * 伴わない形で提供する。dragover のたびに呼べるよう副作用を持たない。
 */
export function computeMaterialGhostRange(
    t: number,
    durationSeconds: number,
    contentDuration: number
): MaterialGhostResult {
    if (!(t < contentDuration)) {
        return { ok: false, reason: 'beyond-content-duration' };
    }
    const remaining = Math.max(0, contentDuration - t);
    const duration = Math.min(Math.max(0, durationSeconds), remaining);
    return { ok: true, range: { start: t, end: t + duration } };
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
 * video/image 素材を layers[] へ挿入する要素を組み立てる。
 * duration = min(実尺, 総尺 − t)（司令塔裁定4）。t が総尺以上なら拒否する。track は省略時 0
 * （既存呼び出し = 再生ヘッド追加コマンドとの後方互換、task 2026-08-10-material-dnd-timeline 指示6）。
 * kind は常に 'video' 固定 — image は schema が src の拡張子を制限しないため、image 素材も
 * このまま流用してよい（レンダリング側の image 対応は並走タスク 2026-08-10-image-layer-parity）。
 */
export function buildLayerElement(
    existingIds: readonly string[],
    relativePath: string,
    t: number,
    durationSeconds: number,
    contentDuration: number,
    track = 0
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
            track
        }
    };
}

/**
 * audio 素材を audio.sfx[] へ挿入する要素を組み立てる。in/out は省略し素材全長の
 * 既存意味に任せる（司令塔裁定4）。t が総尺以上なら拒否する。track は省略時 0（後方互換）。
 */
export function buildSfxElement(
    relativePath: string,
    t: number,
    contentDuration: number,
    track = 0
): SfxInsertResult {
    if (!(t < contentDuration)) {
        return { ok: false, reason: 'beyond-content-duration' };
    }
    return { ok: true, element: { path: relativePath, t, track } };
}
