/**
 * プロジェクトカードのサムネ（ポスター 1 枚 + ホバー時のループ用コマ）の純ロジック。
 * fs / ffmpeg を触る glue は `akari-project-service.ts` 側が持ち、ここには
 * 「どの動画から」「どの時刻を」抜くかの決定論だけを置く（node --test で単体検証するため）。
 *
 * 生成先は `.akari/cache/project-card/<key>/`。project-structure-v0 契約 §1 の
 * 「キャッシュ（サムネ・プロキシ等の再生成可能物）= `.akari/cache/`」に従う
 * （§2-2 の削除安全の定義どおり、消えても原本の動画から作り直せる）。
 *
 * キャッシュキーは既存の `deriveThumbnailCacheKey`（path + size + mtime）を
 * 素材サムネと共有する。これにより「書き出し直したらキーが変わって作り直る」=
 * 実質「出力完了がトリガー」になる（render-cut のコードには手を入れない）。
 */

/** カードで持つコマ数（ポスター 1 枚 + ホバーでループする残り）。 */
export const PROJECT_CARD_FRAME_COUNT = 5;

/** プロジェクトルートからのキャッシュ置き場（`.akari/cache/` 配下・削除安全）。 */
export const PROJECT_CARD_CACHE_DIRECTORY = '.akari/cache/project-card';

/** サムネ元として認める動画拡張子。 */
export const PROJECT_CARD_SOURCE_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'];

/**
 * サムネの由来。プロジェクトの進み具合そのままの 3 段で、良いほうが勝つ:
 *
 * - `export`   — 書き出しが終わっている。完成品そのものの絵（テロップ・オーバーレイ込み）
 * - `edit`     — `edit.json` で既に編集されている。**組んだタイムラインの絵**
 *                （どのカットの・どの瞬間か。ただしテロップ等の重ね物は乗らない — 後述）
 * - `material` — まだ素材があるだけ。`assets/` の動画からの暫定の絵
 *
 * `edit` 段でテロップ／オーバーレイが乗らないのは、それを焼くにはヘッドレス Chrome での
 * ラスタライズ = 実質レンダーが要るため（一覧を開くたびに走らせられない）。書き出しが
 * 済めば `export` 段が上書きするので、完成後の絵には必ず重ね物が入る。
 */
export type ProjectCardThumbnailOrigin = 'export' | 'edit' | 'material';

/**
 * `.akari/render.json` のうち本モジュールが読む部分だけを写した最小形。
 * 未知・欠落・型違いはすべて「無かった」扱いにする（render.json は別契約が正本であり、
 * ここはその形に依存しすぎないように読む側で防御する）。
 */
export interface RenderStateSummary {
    artifacts?: unknown;
    contact_sheet?: unknown;
    plan?: unknown;
}

/**
 * 書き出し済み成果物のパスを render.json から取り出す。`artifacts[].path`
 * （render-cut が verify 後に必ず書く検収済み出力）を最優先し、無ければ
 * `plan.output`（dry-run 時点の予定出力先）へ落ちる。返す文字列は render-cut の
 * `relativeOrAbsolute` と同じく「プロジェクト内なら相対・外なら絶対」なので、
 * 呼び出し側が root 基準で解決する。
 */
export function selectRenderedOutputPath(state: RenderStateSummary | undefined): string | undefined {
    if (!state) {
        return undefined;
    }
    const artifacts = Array.isArray(state.artifacts) ? state.artifacts : [];
    for (const artifact of artifacts) {
        const path = (artifact as { path?: unknown } | undefined)?.path;
        if (typeof path === 'string' && path.trim()) {
            return path;
        }
    }
    const output = (state.plan as { output?: unknown } | undefined)?.output;
    return typeof output === 'string' && output.trim() ? output : undefined;
}

/**
 * render-cut がコンタクトシート用に導出した代表時刻（カット境界の直後・オーバーレイの
 * 中点・冒頭・終盤）を読む。同じ時刻を使い回せば、カードの絵が「レポートで見た絵」と
 * 揃う。値が無い・数値でないものは捨てる。
 */
export function readContactSheetTimestamps(state: RenderStateSummary | undefined): number[] {
    const raw = (state?.contact_sheet as { timestamps_seconds?: unknown } | undefined)?.timestamps_seconds;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
        .sort((left, right) => left - right);
}

/** render.json の `plan.predicted_duration_seconds`（ffprobe が無い環境の尺の当て）。 */
export function readPlannedDurationSeconds(state: RenderStateSummary | undefined): number | undefined {
    const raw = (state?.plan as { predicted_duration_seconds?: unknown } | undefined)?.predicted_duration_seconds;
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

export interface ProjectCardTimestampInput {
    /** render.json の contact_sheet 由来の代表時刻（あれば最優先）。 */
    contactSheetTimestamps?: number[];
    /** 動画の尺（秒）。contact sheet が無いときの等間隔サンプリングに使う。 */
    durationSeconds?: number;
    /** 抜くコマ数。既定は {@link PROJECT_CARD_FRAME_COUNT}。 */
    count?: number;
}

/**
 * カードに使うコマの時刻列を決める。優先順位は
 *
 * 1. contact sheet の代表時刻（多すぎれば等間隔に間引く）
 * 2. 尺の等分割（`i/(count+1)` — 冒頭と末尾を避ける）
 * 3. どちらも無ければ 1 枚だけ 1.0 秒地点
 *
 * 冒頭 0 秒付近は黒フレームで始まる動画が多く、ポスターとして機能しないため、
 * ほかに候補があるかぎり落とす（1 の場合のみ該当。2 は構造的に 0 を含まない）。
 */
export function deriveProjectCardTimestamps(input: ProjectCardTimestampInput): number[] {
    const count = Math.max(1, input.count ?? PROJECT_CARD_FRAME_COUNT);
    const contactSheet = dropLeadingBlackCandidate(input.contactSheetTimestamps ?? []);
    if (contactSheet.length > 0) {
        return thinEvenly(contactSheet, count);
    }
    const duration = input.durationSeconds;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        return Array.from({ length: count }, (_unused, index) => round((duration * (index + 1)) / (count + 1)));
    }
    return [1];
}

/** 先頭の 0 秒付近（黒コマになりがち）は、ほかに候補があるかぎり捨てる。 */
function dropLeadingBlackCandidate(timestamps: number[]): number[] {
    if (timestamps.length > 1 && timestamps[0] < 0.4) {
        return timestamps.slice(1);
    }
    return timestamps;
}

/**
 * 上限を超えたときの間引き規則: 最初と最後を必ず残して等間隔サンプリングする
 * （`packages/render-cut/src/contact-sheet.mjs` の `thinEvenly` と同じ規則 —
 * 同じ入力から同じ絵が出ることを揃えるため、規則をここでも踏襲する）。
 */
function thinEvenly(sortedValues: number[], max: number): number[] {
    if (max <= 0) {
        return [];
    }
    if (sortedValues.length <= max) {
        return sortedValues;
    }
    const picked = new Set<number>();
    for (let index = 0; index < max; index += 1) {
        picked.add(sortedValues[Math.round((index * (sortedValues.length - 1)) / (max - 1))]);
    }
    return [...picked].sort((left, right) => left - right);
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/**
 * `edit` 段で抜く 1 コマぶんの指示。「どのファイルの・何秒地点か」だけを持つ。
 */
export interface EditTimelineSample {
    /** カットが指す動画/静止画のパス（`edit.json` に書かれたまま — 相対なら root 基準）。 */
    sourcePath: string;
    /** そのファイル内の時刻（秒）。静止画ソースでも 0 を返す。 */
    sourceSeconds: number;
}

/**
 * `edit.json` のタイムラインを引いて、出力尺を等分割した時刻に「そのとき映っている
 * カットの、元動画の該当秒」を返す。つまり素材単体ではなく **組んだ順・組んだ範囲**の絵になる。
 *
 * タイムラインの解決規則（`in`/`out`/`speed`/`at`/`track`/`freeze` の扱い）は
 * `packages/render-cut/src/cut-timeline.mjs` が正本で、ここはカード用の縮小コピー。
 * render-cut 側と `packages/edit-lint/src/cut-timeline.mjs` に既に 2 つ実装がある構図に
 * 3 つ目を足す形になるため、向こうを変えたらここも見直すこと（向こうの
 * `segmentDuration` のコメントと同じ約束）。カード用なので次の 2 点は割り切っている:
 *
 * - `freeze` の停止尺は**セグメントの長さには数える**（後続カットの位置がずれないように）が、
 *   停止中の時刻を厳密に再現はしない（1 コマの絵としては差が出ないため）
 * - `xfade` の遷移中は、勝っているほうのカット 1 枚だけを採る
 */
export function deriveEditTimelineSamples(edit: unknown, count: number): EditTimelineSample[] {
    const document = isRecord(edit) ? edit : undefined;
    if (!document) {
        return [];
    }
    const pathBySourceId = buildSourcePathIndex(document);
    const segments = Array.isArray(document.tracks) && !Array.isArray(document.cuts)
        ? resolveEditV2Segments(document, pathBySourceId)
        : resolveEditSegments(Array.isArray(document.cuts) ? document.cuts.filter(isRecord) : [], pathBySourceId);
    const duration = segments.reduce((longest, segment) => Math.max(longest, segment.end), 0);
    if (!(duration > 0)) {
        return [];
    }
    const samples: EditTimelineSample[] = [];
    for (let index = 0; index < count; index += 1) {
        const outSeconds = (duration * (index + 1)) / (count + 1);
        const winner = selectSegmentAt(segments, outSeconds);
        if (!winner?.sourcePath) {
            continue;
        }
        const sourceSeconds = Math.min(
            Math.max(winner.sourceIn, winner.sourceIn + (outSeconds - winner.start) * winner.speed),
            Math.max(winner.sourceIn, winner.sourceOut)
        );
        samples.push({ sourcePath: winner.sourcePath, sourceSeconds: round(sourceSeconds) });
    }
    return samples;
}

interface EditSegment {
    /** 重なったときの勝者選択に使う z（大きいほうが上）。 */
    track: number;
    /** 出力タイムライン上の開始・終了（秒）。 */
    start: number;
    end: number;
    /** そのセグメントが映すファイル（解決できないときは undefined — 尺には数えるが絵には使わない）。 */
    sourcePath?: string;
    /** 素材内の使用区間（秒）と再生速度。 */
    sourceIn: number;
    sourceOut: number;
    speed: number;
}

/** `cuts[]` を出力タイムライン上へ並べる（`resolveCutSegments` の縮小版・v0/v1）。 */
function resolveEditSegments(cuts: Record<string, unknown>[], pathBySourceId: Map<string, string>): EditSegment[] {
    const cursorByTrack = new Map<number, number>();
    const segments: EditSegment[] = [];
    for (const cut of cuts) {
        const track = Number.isInteger(cut.track) && (cut.track as number) >= 0 ? cut.track as number : 0;
        const duration = segmentDuration(cut);
        if (!(duration > 0)) {
            continue;
        }
        const cursor = cursorByTrack.get(track) ?? 0;
        const at = cut.at;
        const start = typeof at === 'number' && Number.isFinite(at) && at >= 0 ? at : cursor;
        const end = start + duration;
        cursorByTrack.set(track, end);
        const cutIn = numberOr(cut.in, 0);
        segments.push({
            track, start, end,
            sourcePath: resolveCutSourcePath(cut, pathBySourceId),
            sourceIn: cutIn, sourceOut: numberOr(cut.out, cutIn), speed: segmentSpeed(cut)
        });
    }
    return segments;
}

/**
 * v2（`tracks[].items[]`）を同じセグメント列へ射影する。
 *
 * v2 の出力軸は **整数フレーム**（`item.at` / `item.duration`）で、素材軸は秒
 * （`source.in` / `source.out`）— edit.schema.json の editV2 $comment どおり。
 * `tracks` の配列順は画面の下から上 = 合成 z 順なので、配列の添字をそのまま
 * {@link EditSegment.track} に使う（後ろの track ほど上＝勝つ）。
 *
 * ここで採るのは `source.kind === 'media'` のアイテムだけ。html / telop / shape は
 * ヘッドレス Chrome でのラスタライズが要り、カード生成では焼けないため
 * （`edit` 段で重ね物が乗らないのと同じ割り切り — ファイル冒頭の origin の説明を参照）。
 * group は子の `at` が親相対なので、親の開始フレームを足しながら再帰で降りる。
 */
function resolveEditV2Segments(document: Record<string, unknown>, pathBySourceId: Map<string, string>): EditSegment[] {
    const output = isRecord(document.output) ? document.output : undefined;
    const fps = numberOr(output?.fps, 0) > 0 ? numberOr(output?.fps, 30) : 30;
    const tracks = Array.isArray(document.tracks) ? document.tracks : [];
    const segments: EditSegment[] = [];
    tracks.forEach((track, trackIndex) => {
        if (!isRecord(track) || track.lane !== 'visual' || track.hidden === true) {
            return;
        }
        collectEditV2Items(track.items, trackIndex, 0, fps, pathBySourceId, segments);
    });
    return segments;
}

function collectEditV2Items(
    items: unknown, track: number, parentAtFrames: number, fps: number,
    pathBySourceId: Map<string, string>, segments: EditSegment[]
): void {
    if (!Array.isArray(items)) {
        return;
    }
    for (const item of items) {
        if (!isRecord(item) || item.hidden === true) {
            continue;
        }
        const atFrames = parentAtFrames + numberOr(item.at, NaN);
        const durationFrames = numberOr(item.duration, NaN);
        if (!Number.isFinite(atFrames) || !(durationFrames > 0)) {
            continue;
        }
        const source = isRecord(item.source) ? item.source : undefined;
        if (source?.kind === 'group') {
            collectEditV2Items(item.items, track, atFrames, fps, pathBySourceId, segments);
            continue;
        }
        if (source?.kind !== 'media') {
            continue;
        }
        const sourceIn = numberOr(source.in, 0);
        segments.push({
            track,
            start: atFrames / fps,
            end: (atFrames + durationFrames) / fps,
            sourcePath: pathBySourceId.get(typeof source.src === 'string' ? source.src : ''),
            sourceIn,
            sourceOut: numberOr(source.out, sourceIn),
            speed: segmentSpeed(source)
        });
    }
}

/** その時刻を覆うセグメントのうち、いちばん上のトラック（`computeVideoRuns` の勝者選択と同じ）。 */
function selectSegmentAt(segments: EditSegment[], seconds: number): EditSegment | undefined {
    let winner: EditSegment | undefined;
    for (const segment of segments) {
        // 同じ track 内で重なったときは後から宣言されたほうが上（v2 の items も配列順が下から上）。
        if (segment.start <= seconds && segment.end > seconds && (!winner || segment.track >= winner.track)) {
            winner = segment;
        }
    }
    return winner;
}

function segmentSpeed(cut: Record<string, unknown> | undefined): number {
    const value = cut?.speed;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function segmentDuration(cut: Record<string, unknown>): number {
    const cutIn = numberOr(cut.in, 0);
    const cutOut = numberOr(cut.out, cutIn);
    const freeze = isRecord(cut.freeze) ? numberOr(cut.freeze.duration_sec, 0) : 0;
    return (cutOut - cutIn) / segmentSpeed(cut) + Math.max(0, freeze);
}

/**
 * `sources[]`（v1）または `source`（v0）から id → パスの索引を作る。
 * v0 は id を持たないので、全カット共通の既定として空文字キーへ入れる。
 */
function buildSourcePathIndex(document: Record<string, unknown>): Map<string, string> {
    const index = new Map<string, string>();
    const sources = Array.isArray(document.sources) ? document.sources : [];
    for (const source of sources) {
        if (!isRecord(source)) {
            continue;
        }
        const { id, path } = source;
        if (typeof id === 'string' && typeof path === 'string' && path) {
            index.set(id, path);
        }
    }
    const legacy = isRecord(document.source) ? document.source.path : undefined;
    if (typeof legacy === 'string' && legacy) {
        index.set('', legacy);
    }
    return index;
}

/** カットが指すファイル。v1 は `src`（id 参照）、v0 は共通ソース。 */
function resolveCutSourcePath(cut: Record<string, unknown>, pathBySourceId: Map<string, string>): string | undefined {
    const src = cut.src;
    if (typeof src === 'string' && src) {
        return pathBySourceId.get(src);
    }
    return pathBySourceId.get('');
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** コマ 1 枚のファイル名（0 始まりの index を 1 始まりの連番にする）。 */
export function projectCardFrameFileName(index: number): string {
    return `frame-${index + 1}.jpg`;
}

/** コマ 1 枚のプロジェクト相対パス（フロントエンドが `root.resolve()` に渡す形）。 */
export function projectCardFrameRelativePath(key: string, index: number): string {
    return `${PROJECT_CARD_CACHE_DIRECTORY}/${key}/${projectCardFrameFileName(index)}`;
}

/** ファイル名からコマ番号を読む（キャッシュ再読み込み時の並べ替え用）。不正なら undefined。 */
export function parseProjectCardFrameIndex(fileName: string): number | undefined {
    const match = /^frame-(\d+)\.jpg$/.exec(fileName);
    if (!match) {
        return undefined;
    }
    const parsed = Number(match[1]);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed - 1 : undefined;
}
