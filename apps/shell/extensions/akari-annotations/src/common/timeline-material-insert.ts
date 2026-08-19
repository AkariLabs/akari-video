import { computeCutTrackSegments, EditCut, EditLayer, EditTimelineTrack, TimelineTrackKind } from './edit-store';

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
        return { accept: false, reason: '音源は音源トラック（一番下の帯）にドロップしてください。' };
    }
    if (trackKind === 'layers' || trackKind === undefined) {
        return { accept: true, zone: 'layers' };
    }
    if (trackKind === 'cuts') {
        return { accept: true, zone: 'cuts' };
    }
    const label = materialKind === 'image' ? '画像' : '動画';
    return {
        accept: false,
        reason: `${label}は本編トラックかレイヤートラックにドロップしてください（字幕・オーバーレイの帯には置けません）。`
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

/** audio.sfx[] の最小形（sfxItem スキーマ必須: path, t。track は既定 0 を明示する）。 */
export interface TimelineSfxElement {
    readonly path: string;
    readonly t: number;
    readonly track: number;
}

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
 * track は省略時 0（既存呼び出し = 再生ヘッド追加コマンドとの後方互換、task
 * 2026-08-10-material-dnd-timeline 指示6）。kind は常に 'video' 固定 — image は schema が src の
 * 拡張子を制限しないため、image 素材もこのまま流用してよい。
 *
 * task 2026-08-18-timeline-dnd-p0p1: 総尺による拒否とクランプを撤廃した
 * （理由は computeMaterialGhostRange のコメントを参照）。素材は落とした尺のまま入り、
 * 総尺のほうが伸びる。
 */
export function buildLayerElement(
    existingIds: readonly string[],
    relativePath: string,
    t: number,
    durationSeconds: number,
    track = 0
): EditLayer {
    return {
        id: nextAvailableId(materialIdBase(relativePath), existingIds),
        t: Math.max(0, t),
        duration: Math.max(0, durationSeconds),
        kind: 'video',
        src: relativePath,
        track
    };
}

/**
 * audio 素材を audio.sfx[] へ挿入する要素を組み立てる。in/out は省略し素材全長の
 * 既存意味に任せる（司令塔裁定4）。track は省略時 0（後方互換）。
 * task 2026-08-18-timeline-dnd-p0p1: 総尺による拒否を撤廃した。
 */
export function buildSfxElement(
    relativePath: string,
    t: number,
    track = 0
): TimelineSfxElement {
    return { path: relativePath, t: Math.max(0, t), track };
}

// --- task 2026-08-10-dnd-ghost-and-insert-fix: 行間ドロップ(insertTrack)の繰り上げ ---

/**
 * insertTrack 以上の layers[].track を +1 する（widget shiftTrackStateForInsert
 * `apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts:7307` と同じ
 * 「挿入先以上を1つ上へずらす」規則の layers[] 版・司令塔裁定3）。track 省略時は 0 として扱う。
 * 繰り上げが不要な要素は参照をそのまま返す（track フィールドを新規に生やさない — 元データの
 * 忠実性を保つ）。
 */
export function shiftLayerTracksForInsert(
    layers: readonly EditLayer[],
    insertTrack: number
): EditLayer[] {
    return layers.map(layer => {
        const current = layer.track ?? 0;
        return current >= insertTrack ? { ...layer, track: current + 1 } : layer;
    });
}

/**
 * layers 系の宣言トラック（timeline.tracks の kind: 'layers'）へ、insertTrack の位置へ新規行を
 * 挿入する純関数（司令塔裁定3）。widget 側 `insertedTimelineTracks`
 * (`apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts:4651-4684`、
 * アイテムドラッグの行間挿入と共用・タスク契約上の編集禁止)の kind='layers' 相当を写した純関数。
 * 同メソッドは Theia DI に依存する widget クラスの protected メソッドで node --test から
 * 直接検証できないため、D&D 新規追加フロー（既存アイテムの移動を伴わない新規挿入）向けにここへ
 * 複製する（derive-timeline-tracks.ts と同型の契約上の複製 — アルゴリズムを変更する場合は
 * 両ファイルを同期させること）。呼び出し側は pinAudioGroupToBottom 相当の並び（audio 先頭）を
 * 適用済みの tracks を渡すこと。
 */
export function insertedLayerTimelineTracks(
    tracks: readonly EditTimelineTrack[],
    insertTrack: number
): EditTimelineTrack[] {
    return insertedTimelineTracksOfKind(tracks, 'layers', insertTrack);
}

/**
 * `insertedLayerTimelineTracks` の kind 一般化（task 2026-08-18-timeline-dnd-p0p1）。
 * 本編（cuts）への行間ドロップでも同じ「挿入先以上を 1 つ上へずらして新規行を差し込む」規則を
 * 使うため、kind を引数に取れる形へ切り出した。挙動は kind='layers' のとき従来と完全に同じ。
 */
export function insertedTimelineTracksOfKind(
    tracks: readonly EditTimelineTrack[],
    kind: TimelineTrackKind,
    insertTrack: number
): EditTimelineTrack[] {
    const shifted = tracks.map(track => ({
        ...track,
        ...(track.kind === kind && (track.ref ?? 0) >= insertTrack ? { ref: (track.ref ?? 0) + 1 } : {})
    }));
    const ids = new Set(shifted.map(track => track.id));
    let serial = shifted.length + 1;
    while (ids.has(`t${serial}`)) {
        serial++;
    }
    const entry: EditTimelineTrack = { id: `t${serial}`, kind, ref: insertTrack };
    const lowerIndex = shifted.reduce(
        (found, track, index) =>
            track.kind === kind && (track.ref ?? 0) === insertTrack - 1 ? index : found,
        -1
    );
    if (lowerIndex >= 0) {
        shifted.splice(lowerIndex + 1, 0, entry);
    } else {
        const higherIndex = shifted.findIndex(
            track => track.kind === kind && (track.ref ?? 0) > insertTrack
        );
        shifted.splice(higherIndex >= 0 ? higherIndex : shifted.length, 0, entry);
    }
    return shifted;
}

/**
 * 明示 `timeline.tracks` に audio 種別が 1 本も無いとき、ref 0 の音源トラックを 1 本足す
 * （task 2026-08-18-timeline-dnd-p0p1 / P0-a）。音源帯は `audio.sfx[]` / `audio.narration[]` から
 * 派生するため、`timeline.tracks` を明示していないプロジェクトでは sfx を足すだけで行が生える。
 * 明示している場合だけこの補完が要る。並びは pinAudioGroupToBottom の流儀（audio は配列先頭 =
 * 画面最下段）に合わせて先頭へ入れる。既に audio があれば参照をそのまま複製して返す。
 */
export function ensuredAudioTimelineTracks(
    tracks: readonly EditTimelineTrack[]
): EditTimelineTrack[] {
    if (tracks.some(track => track.kind === 'audio')) {
        return [...tracks];
    }
    const ids = new Set(tracks.map(track => track.id));
    let serial = tracks.length + 1;
    while (ids.has(`t${serial}`)) {
        serial++;
    }
    return [{ id: `t${serial}`, kind: 'audio', ref: 0 }, ...tracks];
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
        tracks.unshift({ id: `v${serial}`, lane: 'visual', name: '本編', items: [] });
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

export function insertLayerIntoV2(
    input: Readonly<Record<string, unknown>>,
    relativePath: string,
    t: number,
    durationSeconds: number,
    trackRef: number,
    insertTrack?: number
): Record<string, unknown> {
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
    const visualIndexes = tracks.flatMap((trackValue, index) => isRecord(trackValue)
        && trackValue.lane === 'visual' && Array.isArray(trackValue.items) ? [index] : []);
    const layerIndexes = visualIndexes.slice(1);
    let targetIndex = layerIndexes[trackRef];
    if (targetIndex === undefined || insertTrack !== undefined) {
        const ids = new Set(tracks.filter(isRecord).map(trackValue => String(trackValue.id ?? '')));
        let serial = 1;
        while (ids.has(`v-layer-${serial}`)) serial++;
        const created = { id: `v-layer-${serial}`, lane: 'visual', name: `レイヤー ${trackRef + 1}`, items: [] };
        const insertAt = insertTrack === undefined
            ? tracks.length
            : Math.min(tracks.length, Math.max(visualIndexes[0] === undefined ? 0 : visualIndexes[0] + 1, insertTrack));
        tracks.splice(insertAt, 0, created);
        targetIndex = insertAt;
    }
    const target = tracks[targetIndex] as Record<string, any>;
    const allIds = new Set(tracks.filter(isRecord).flatMap(trackValue => Array.isArray(trackValue.items)
        ? trackValue.items.filter(isRecord).map(item => String(item.id ?? '')) : []));
    let serial = 1;
    while (allIds.has(`layer-${serial}`)) serial++;
    const fps = isRecord(input.output) && Number.isInteger(input.output.fps) && input.output.fps > 0
        ? input.output.fps : 30;
    const at = Math.round(Math.max(0, t) * fps);
    const end = Math.round((Math.max(0, t) + Math.max(0.001, durationSeconds)) * fps);
    target.items.push({
        id: `layer-${serial}`, at, duration: Math.max(1, end - at),
        source: { kind: 'media', src: srcId, in: 0, out: Math.max(0.001, durationSeconds) }
    });
    tracks[targetIndex] = target;
    value.tracks = tracks;
    return value;
}

export function ensureV2AudioTrack(input: Readonly<Record<string, unknown>>, ref: number): Record<string, unknown> {
    const value = { ...input };
    const tracks = Array.isArray(input.tracks) ? [...input.tracks] : [];
    const audioTracks = tracks.filter(trackValue => isRecord(trackValue) && trackValue.lane === 'audio');
    if (!audioTracks[ref]) {
        const ids = new Set(tracks.filter(isRecord).map(trackValue => String(trackValue.id ?? '')));
        let serial = 1;
        while (ids.has(`a${serial}`)) serial++;
        tracks.push({ id: `a${serial}`, lane: 'audio', name: `オーディオ ${ref + 1}`, items: [] });
    }
    value.tracks = tracks;
    return value;
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
export function firstFreeCutStart(
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
