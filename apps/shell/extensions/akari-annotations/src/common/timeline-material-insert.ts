import { computeCutTrackSegments, EditCut, TimelineTrackKind } from './edit-store';

/**
 * 素材追加コマンド（akari.timeline.addMaterialAtPlayhead / D&D ドロップ）の挿入要素を組み立てる
 * 純関数 (task 2026-08-10-timeline-clip-menu 指示5、2026-08-10-material-dnd-timeline で D&D 用に拡張)。
 * DOM に一切依存しないため node --test で検証できる。受理判定・id 採番（既存 layer id との
 * 衝突回避・nextCopyId の流儀）・v2 本編トラックへの挿入をここに集約する。
 * 書き込み自体（全文スナップショット方式）は呼び出し側 (akari-annotations-widget.ts) が担う。
 *
 * 2026-08-18 (task 2026-08-18-timeline-dnd-p0p1) の変更点:
 * - 総尺による拒否・クランプを全面撤廃（末尾より後ろへ置ける／尺が切られない）
 * - 音源トラック行が 0 本でも受理する（音源が永久に落とせなかった実質バグの解消）
 * - 本編（cuts）への D&D 挿入を追加
 */
/**
 * ドロップ先の行グループ（task 2026-08-18-timeline-dnd-p0p1）。`cuts` は本編（メイン時間軸）、
 * `layers` は重ねる映像、`audio` は音源。素材の種別と、カーソルがどの帯にあるかで決まる。
 */
export type MaterialDropZone = 'cuts' | 'layers' | 'audio';

/** image 素材をタイムラインへ挿入する際の既定尺（task 2026-08-10-material-dnd-timeline 司令塔裁定3）。 */
export const IMAGE_LAYER_DEFAULT_DURATION_SECONDS = 5;

export type MaterialDragKind = 'video' | 'audio' | 'image';

export type MaterialDropDecision =
    | { readonly accept: true; readonly zone: MaterialDropZone }
    | { readonly accept: false; readonly reason: string };

/**
 * ドロップ先トラック行の受理判定（task 2026-08-18-timeline-dnd-p0p1 で 2026-08-10 版を拡張）。
 *
 * - video / image: `layers`（重ねる映像）と `cuts`（本編カット）の両方を受理する。
 *   2026-08-10 版は layers だけを受理していたため「動画を本編に置く」導線が D&D に無かった。
 * - audio: `audio` 帯を受理する。**trackKind が undefined（＝音源トラック行が 1 本も無い）でも
 *   受理する** — 旧版はここを reject していたが、音源帯は `audio.sfx[]` / `audio.narration[]` が
 *   1 件以上ないと描画されないため（derive-timeline-tracks.ts）、BGM しか無い通常のプロジェクトでは
 *   音源を**永久に落とせない**という実質バグになっていた。受理して新しい音源トラックを作る。
 * - video / image で trackKind が undefined のとき（対象行が 1 本も無いプロジェクト）は
 *   layers 扱いで受理する（2026-08-10 司令塔裁定2 の明示要求を踏襲）。
 *
 * 拒否時は**理由文字列**を返す。無言 no-op は「壊れている」と区別が付かない（オーナー実機報告
 * 2026-08-18）ため、呼び出し側はこれをフッターに出す。
 */
export function materialDropDecision(
    materialKind: MaterialDragKind,
    trackKind: TimelineTrackKind | undefined
): MaterialDropDecision {
    if (materialKind === 'audio') {
        if (trackKind === 'audio' || trackKind === undefined) {
            return { accept: true, zone: 'audio' };
        }
        return { accept: false, reason: '音は音の段へドロップしてください。' };
    }
    if (trackKind === 'layers' || trackKind === undefined) {
        return { accept: true, zone: 'layers' };
    }
    if (trackKind === 'cuts') {
        return { accept: true, zone: 'cuts' };
    }
    return {
        accept: false,
        reason: '映像は映像の段へ、音は音の段へドロップしてください。'
    };
}

export interface MaterialGhostRange {
    readonly start: number;
    readonly end: number;
}

/**
 * D&D ゴーストの表示区間を計算する純関数。
 *
 * task 2026-08-18-timeline-dnd-p0p1 で**総尺による拒否とクランプを撤廃**した。旧版は
 * `t >= 総尺` を拒否し `duration = min(尺, 総尺 - t)` に切り詰めていたため、(1) 末尾より後ろに
 * 置けない (2) 末尾寄りに置くと素材が黙って短く切られる、という二重の詰まりがあった。
 * 総尺はコンテンツ側（cuts / layers / sfx の終端）から導出されるので、後ろに置けば総尺は
 * そのぶん自然に伸びる（akari-annotations-widget.ts の contentEndDuration）。
 */
export function computeMaterialGhostRange(
    t: number,
    durationSeconds: number
): MaterialGhostRange {
    const start = Math.max(0, t);
    return { start, end: start + Math.max(0, durationSeconds) };
}

export interface MaterialDropTargetLike {
    readonly rejected: boolean;
    readonly insertTrack?: number;
}

export interface MaterialGhostVisibility {
    readonly showGhost: boolean;
    readonly showInsertIndicator: boolean;
}

/**
 * ドロップ先帯に応じたゴースト本体・行間挿入インジケータの表示可否（task
 * 2026-08-10-dnd-ghost-and-insert-fix 司令塔裁定1・2）。rejected（対象外の帯）のときは
 * 両方非表示にする — trackAtClientY の最終 fallthrough が rejected でも top に最上段レイヤー行を
 * 返すため、本体ゴーストを描いてしまうと「関係ない行に点線」に見える不具合を断つ。
 * 非rejectedで insertTrack があり audio 以外なら、本体ゴースト（新行が入る位置）+
 * 挿入インジケータを併用する。
 */
export function materialGhostVisibility(
    kind: MaterialDragKind, target: MaterialDropTargetLike
): MaterialGhostVisibility {
    if (target.rejected) {
        return { showGhost: false, showInsertIndicator: false };
    }
    return { showGhost: true, showInsertIndicator: kind !== 'audio' && target.insertTrack !== undefined };
}

/** cuts[] の out - in が 0 になると validate-edit の `out > in` に落ちるため、最小尺を敷く。 */
const CUT_MIN_DURATION_SECONDS = 0.15;

export interface CutInsertionResult {
    /** 書き戻す edit.json の値。入力オブジェクトは変更しない（浅いコピー + 差し替え）。 */
    readonly value: Record<string, unknown>;
    /** 利用者に伝えるべき注意。 */
    readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** `s1`, `s2`, ... のうち既存 id と衝突しないものを返す。 */
function nextSourceId(sources: readonly unknown[]): string {
    const used = new Set(
        sources.map(source => (isRecord(source) && typeof source.id === 'string' ? source.id : ''))
    );
    let serial = 1;
    while (used.has(`s${serial}`)) {
        serial++;
    }
    return `s${serial}`;
}

/**
 * 素材（動画 / 静止画）を本編トラック `cuts[]` へ挿入した edit.json 値を返す純関数
 * （task 2026-08-18-timeline-dnd-p0p1 / P1-a）。
 *
 * 設計上の要点:
 * - plan の `insertIndex` へ item を挿入する。既存 item の整数フレーム `at` は変更しない。
 * - **ソース解決**: v2 `sources[]` に同じ path があれば再利用し、無ければ採番して追加。
 *   本編 visual track へ整数フレームの item を挿入する。
 */
export function insertCutIntoEdit(
    input: Readonly<Record<string, unknown>>,
    relativePath: string,
    plan: CutDropPlan,
    durationSeconds: number,
    _track: number
): CutInsertionResult {
    const value: Record<string, unknown> = { ...input };
    const sources = Array.isArray(input.sources) ? [...input.sources] : [];
    const existing = sources.find(source => isRecord(source) && source.path === relativePath);
    const srcId = isRecord(existing) && typeof existing.id === 'string' ? existing.id : nextSourceId(sources);
    if (!existing) sources.push({ id: srcId, path: relativePath, proxy: null });
    value.sources = sources;

    const tracks = Array.isArray(input.tracks)
        ? input.tracks.map(trackValue => isRecord(trackValue)
            ? { ...trackValue, ...(Array.isArray(trackValue.items) ? { items: [...trackValue.items] } : {}) }
            : trackValue)
        : [];
    let mainIndex = tracks.findIndex(trackValue => isRecord(trackValue)
        && trackValue.lane === 'visual' && Array.isArray(trackValue.items));
    if (mainIndex < 0) {
        const ids = new Set(tracks.filter(isRecord).map(trackValue => String(trackValue.id ?? '')));
        let serial = 1;
        while (ids.has(`v${serial}`)) serial++;
        tracks.unshift({ id: `v${serial}`, lane: 'visual', items: [] });
        mainIndex = 0;
    }
    const main = tracks[mainIndex] as Record<string, any>;
    const items = [...main.items];
    const usedIds = new Set(tracks.filter(isRecord).flatMap(trackValue => Array.isArray(trackValue.items)
        ? trackValue.items.filter(isRecord).map(item => String(item.id ?? '')) : []));
    let idSerial = 1;
    while (usedIds.has(`cut-${idSerial}`)) idSerial++;
    const fps = isRecord(input.output) && Number.isInteger(input.output.fps) && input.output.fps > 0
        ? input.output.fps : 30;
    const at = Math.round(Math.max(0, plan.at) * fps);
    const end = Math.round((Math.max(0, plan.at) + Math.max(CUT_MIN_DURATION_SECONDS, durationSeconds)) * fps);
    const inserted = {
        id: `cut-${idSerial}`,
        at,
        duration: Math.max(1, end - at),
        source: { kind: 'media', src: srcId, in: 0, out: Math.max(CUT_MIN_DURATION_SECONDS, durationSeconds) }
    };
    items.splice(Math.min(Math.max(0, plan.insertIndex), items.length), 0, inserted);
    main.items = items;
    tracks[mainIndex] = main;
    value.tracks = tracks;
    return { value, warnings: [] };
}

/**
 * 本編（cuts）トラック上で、素材を丸ごと置ける最初の位置を返す純関数
 * （task 2026-08-18-timeline-dnd-p0p1 / P1-a）。
 *
 * 同一トラックのカット同士の重なりは edit-lint の `cuts.track-overlap` が **error** で弾く
 * （layers の同名ルールは warning なのでレイヤーは重ねてよい）。したがって本編へのドロップだけは
 * 「重ならない位置へ寄せる」必要がある。挙動は素直な 1 つだけ:
 *   落とした位置から後ろへ向かって、素材の尺がまるごと収まる最初の空きへ着地する。
 * 既存カットの上に落としたら「そのカットの直後」、狭い隙間なら「その次の空き」。
 * 尺を切り詰める・既存カットを押しのける、はしない（P1-b の思想 = 黙って変えない）。
 *
 * occupied は同一トラックの占有区間（出力秒）。順不同でよい。
 */
function firstFreeCutStart(
    occupied: ReadonlyArray<{ readonly start: number; readonly end: number }>,
    t: number,
    durationSeconds: number
): number {
    const epsilon = 1e-6;
    const duration = Math.max(epsilon, durationSeconds);
    const sorted = [...occupied]
        .filter(interval => interval.end > interval.start + epsilon)
        .sort((left, right) => left.start - right.start);
    let candidate = Math.max(0, t);
    // candidate は毎回 hit.end（> candidate）へ進むので必ず停止する。
    for (let guard = 0; guard <= sorted.length; guard++) {
        const hit = sorted.find(
            interval => candidate < interval.end - epsilon && candidate + duration > interval.start + epsilon
        );
        if (!hit) {
            return candidate;
        }
        candidate = hit.end;
    }
    return candidate;
}

/**
 * 本編（cuts）へのドロップ計画（task 2026-08-18-timeline-dnd-p0p1 / P1-a）。
 *
 * - **sequential**: `at` を持たない互換ビュー向け。最も近いカット境界へ割り込む。
 * - **free**: v2 の絶対配置互換ビュー向け。落とした位置を使い、重なりだけは
 *   `cuts.track-overlap` が error なので firstFreeCutStart で空きへ寄せる。
 *
 * `at` は着地時刻（ゴーストにもこの値を出す = 見えている場所が入る場所）、
 * `insertIndex` は `cuts[]` 配列内の挿入位置。
 */
export interface CutDropPlan {
    readonly mode: 'sequential' | 'free';
    readonly at: number;
    readonly insertIndex: number;
}

export function planCutDrop(
    cuts: readonly EditCut[],
    track: number,
    t: number,
    durationSeconds: number
): CutDropPlan {
    const segments = computeCutTrackSegments(cuts);
    const onTrack = segments.filter(segment => segment.track === track);
    const dropAt = Math.max(0, t);
    // 「落とした時刻より手前に始まるカット」の数 = そのカットたちの後ろへ入る。
    let position = 0;
    while (position < onTrack.length && onTrack[position].at < dropAt) {
        position++;
    }
    const insertIndex = position < onTrack.length ? onTrack[position].index : cuts.length;
    const gapAware = cuts.some(
        cut => (typeof cut.at === 'number' && Number.isFinite(cut.at)) || (cut.track ?? 0) !== 0
    );
    if (!gapAware) {
        return {
            mode: 'sequential',
            at: position === 0 ? 0 : onTrack[position - 1].end,
            insertIndex
        };
    }
    return {
        mode: 'free',
        at: firstFreeCutStart(
            onTrack.map(segment => ({ start: segment.at, end: segment.end })), dropAt, durationSeconds
        ),
        insertIndex
    };
}
