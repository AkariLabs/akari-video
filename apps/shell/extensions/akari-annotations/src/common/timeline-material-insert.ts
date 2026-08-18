import { computeCutTrackSegments, EditCut, EditLayer, EditTimelineTrack, TimelineTrackKind } from './edit-store';

/**
 * 素材追加コマンド（akari.timeline.addMaterialAtPlayhead / D&D ドロップ）の挿入要素を組み立てる
 * 純関数 (task 2026-08-10-timeline-clip-menu 指示5、2026-08-10-material-dnd-timeline で D&D 用に拡張)。
 * DOM に一切依存しないため node --test で検証できる。受理判定・id 採番（既存 layer id との
 * 衝突回避・nextCopyId の流儀）・cuts への挿入（v0 → v1 マイグレーションを含む）をここに集約する。
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
    /** v0（単一ソース）から v1（マルチソース）へ移行したか。呼び出し側は利用者に伝える。 */
    readonly migratedToV1: boolean;
    /** 利用者に伝えるべき注意（現状は v0 の freeze × gap-aware 併用不可のみ）。 */
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
 * 明示 at / 非 0 track が 1 つでもあると、render-cut は v0 でも gap-aware 経路へ切り替わる
 * （packages/render-cut/src/cut-timeline.mjs の同名判定と同じ規則）。v0 の `freeze` は
 * gap-aware と併用できない（edit.schema.json cutFreeze の $comment）ため、その組み合わせだけ
 * 利用者に警告する。
 */
function requiresGapAwareTimeline(cuts: readonly EditCut[]): boolean {
    const segments = computeCutTrackSegments(cuts);
    let cursor = 0;
    for (const segment of segments) {
        if (segment.track !== 0) {
            return true;
        }
        if (Math.abs(segment.at - cursor) > 1e-6) {
            return true;
        }
        cursor = segment.end;
    }
    return false;
}

/**
 * 素材（動画 / 静止画）を本編トラック `cuts[]` へ挿入した edit.json 値を返す純関数
 * （task 2026-08-18-timeline-dnd-p0p1 / P1-a）。
 *
 * 設計上の要点:
 * - **末尾に append する**。新しいカットは明示 `at` を持つので、配列末尾に足す限り既存カットの
 *   レイアウトは 1 ミリも動かない（computeCutTrackSegments は配列順・トラック別カーソルで解決し、
 *   明示 at のカットは前カットの transitionOut 重なりも受けない）。したがって既存カットの
 *   `at` を凍結する前処理は不要。
 * - **ソース解決**: v1（`sources[]` あり）は同じ path の source を再利用し、無ければ採番して追加。
 *   v0（`source` 単体）は、落とした素材が既定ソースと同じなら v0 のまま（cutV0 は `src` を
 *   持てない — edit.schema.json の `not: {required: ["src"]}`）、違うなら **v1 へ移行**する
 *   （`sources[0]` に既定ソースを移し、既存カット全部に `src` を付け、`version` を 1 にして
 *   `source` を落とす）。docs/contract-2026-07-18-edit-json-v1-sources.md §移行手順のとおり。
 * - 静止画も同じ経路に乗る（docs/contract-2026-08-12-still-image-cut-source-v0.md 裁定1:
 *   判定は拡張子のみでスキーマに新フィールドを足さない）。`in: 0` / `out: 表示尺`。
 */
export function insertCutIntoEdit(
    input: Readonly<Record<string, unknown>>,
    relativePath: string,
    plan: CutDropPlan,
    durationSeconds: number,
    track: number
): CutInsertionResult {
    const value: Record<string, unknown> = { ...input };
    const cuts: EditCut[] = Array.isArray(input.cuts) ? [...(input.cuts as EditCut[])] : [];
    let srcId: string | undefined;
    let migratedToV1 = false;

    if (Array.isArray(input.sources)) {
        const sources = [...(input.sources as unknown[])];
        const existing = sources.find(source => isRecord(source) && source.path === relativePath);
        if (isRecord(existing) && typeof existing.id === 'string') {
            srcId = existing.id;
        } else {
            srcId = nextSourceId(sources);
            sources.push({ id: srcId, path: relativePath, proxy: null });
        }
        value.sources = sources;
    } else {
        const defaultSource = isRecord(input.source) ? input.source : undefined;
        if (defaultSource && defaultSource.path === relativePath) {
            srcId = undefined;
        } else {
            migratedToV1 = true;
            const sources: Record<string, unknown>[] = [];
            if (defaultSource) {
                sources.push({
                    id: 's1',
                    path: defaultSource.path,
                    proxy: defaultSource.proxy ?? null,
                    ...(defaultSource.chroma_key !== undefined ? { chroma_key: defaultSource.chroma_key } : {})
                });
            }
            srcId = nextSourceId(sources);
            sources.push({ id: srcId, path: relativePath, proxy: null });
            // 既存カットは移行前の既定ソースを指していた。既定ソースが無い壊れた v0 の場合だけ、
            // やむを得ず新しいソースへ寄せる（そのままでは v1 の必須 src を満たせないため）。
            const inheritedSrc = defaultSource ? 's1' : srcId;
            for (let index = 0; index < cuts.length; index++) {
                const cut = cuts[index];
                if (isRecord(cut) && typeof cut.src !== 'string') {
                    cuts[index] = { src: inheritedSrc, ...cut } as EditCut;
                }
            }
            value.sources = sources;
            value.version = 1;
            delete value.source;
        }
    }

    // 明示配置（at/track）を書くのは、そのプロジェクトが既にそう宣言している v0 の
    // gap-aware タイムラインのときだけ（plan.mode === 'free'）。順次連結のプロジェクトへ
    // at を書き足すと、v1 の描画経路が at を無視して連結するため「見えている位置」と
    // 「焼き上がり」がずれる（edit-lint の cuts.at-render-unsupported）。
    const inserted: EditCut = plan.mode === 'free'
        ? {
            ...(srcId !== undefined ? { src: srcId } : {}),
            at: Math.max(0, plan.at), track,
            in: 0, out: Math.max(CUT_MIN_DURATION_SECONDS, durationSeconds)
        }
        : {
            ...(srcId !== undefined ? { src: srcId } : {}),
            in: 0, out: Math.max(CUT_MIN_DURATION_SECONDS, durationSeconds)
        };
    cuts.splice(Math.min(Math.max(0, plan.insertIndex), cuts.length), 0, inserted);
    value.cuts = cuts;

    const warnings: string[] = [];
    if (plan.mode === 'free' && !migratedToV1 && !Array.isArray(input.sources)
        && cuts.some(cut => isRecord(cut) && cut['freeze']) && requiresGapAwareTimeline(cuts)) {
        warnings.push(
            'このプロジェクトは v0 形式で freeze（静止）を使っているため、'
            + '本編の自由配置（明示の位置・トラック）と併用できません。freeze を外してください。'
        );
    }
    if (plan.mode === 'free' && (migratedToV1 || Array.isArray(input.sources))) {
        warnings.push(
            '複数ソース（v1）では本編の明示位置が描画に反映されず、カットは順に連結されます。'
        );
    }
    return { value, migratedToV1, warnings };
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
 * `mode` が 2 つあるのは、cuts の描画意味論がプロジェクトの形で変わるから:
 * - **sequential**: `cuts[]` は配列順に連結される（v0 の既定・v1 は常にこれ。v1 の描画経路は
 *   `at`/`track` を無視する — edit-lint の `cuts.at-render-unsupported` / `cuts.track-render-unsupported`）。
 *   ドロップは「落とした位置に一番近いカット境界へ割り込む」= 以降のカットが後ろへずれる。
 *   `at` は書かない（書くと見えている位置と焼き上がりがずれる）。
 * - **free**: 既に明示 `at` / 非 0 `track` を持つ v0 の gap-aware タイムライン。そのプロジェクトは
 *   自由配置を宣言済みなので、落とした位置へそのまま置く（重なりだけは `cuts.track-overlap`
 *   が error なので firstFreeCutStart で空きへ寄せる）。以降のカットは `at` で固定されているため動かない。
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
