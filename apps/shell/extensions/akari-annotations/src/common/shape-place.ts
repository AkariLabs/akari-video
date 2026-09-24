import { shapeSourceFromPreset, type ShapePresetV1 } from '@akari-video/edit-store';
import { EditV2Document, indexEditV2Items, insertItem, insertTrack } from './edit-v2-mutations';
import { materialRangeOverlaps } from './material-drop-overlap';

/**
 * 図形の棚から置く図形（`akari.timeline.addShapeAt`）の純関数。
 *
 * 書くデータは図形の契約 v1 どおり: 形は棚の 1 行を値で写し（path + `params.preset`・角丸の見本は元の形 +
 * `cornerRadius`・ライン = line の params・吹き出し = bubble の params）、置き方は item 共通の transform に置く。
 * 写しそのものは edit-store の shapeSourceFromPreset に任せ、ここでは寸法・位置・段の選び方だけを決める。
 * DOM に依存しないので node --test で検証する。
 */

/** 置いた図形の尺（秒）。画像素材を置くときの既定と同じ。 */
export const SHAPE_PLACE_DEFAULT_DURATION_SECONDS = 5;

export interface ShapePoint {
    readonly x: number;
    readonly y: number;
}

/**
 * `akari.timeline.addShapeAt` の引数。
 * - `t`: 出力の秒。省略時はプレイヘッド
 * - `center`: 図形の中心（出力 px）。省略時は出力の中央。プレビューへのドロップは落とした点をここに渡す
 * - `transform`: item の transform を直接書くとき（x / y = 図形の左上の出力 px。center より優先）
 */
export interface ShapePlaceRequest {
    readonly preset: string;
    readonly t?: number;
    readonly center?: ShapePoint;
    readonly transform?: { readonly x?: number; readonly y?: number };
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function point(value: unknown): ShapePoint | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const { x, y } = value as { x?: unknown; y?: unknown };
    return finite(x) && finite(y) ? { x, y } : undefined;
}

export function parseShapePlaceRequest(value: unknown): ShapePlaceRequest | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.preset !== 'string' || !candidate.preset.trim()) return undefined;
    const center = point(candidate.center);
    const rawTransform = candidate.transform && typeof candidate.transform === 'object'
        ? candidate.transform as { x?: unknown; y?: unknown } : undefined;
    const transform = rawTransform && (finite(rawTransform.x) || finite(rawTransform.y))
        ? { ...(finite(rawTransform.x) ? { x: rawTransform.x } : {}), ...(finite(rawTransform.y) ? { y: rawTransform.y } : {}) }
        : undefined;
    return {
        preset: candidate.preset,
        ...(finite(candidate.t) && candidate.t >= 0 ? { t: candidate.t } : {}),
        ...(center ? { center } : {}),
        ...(transform ? { transform } : {})
    };
}

function cubicAt(a: number, b: number, c: number, d: number, t: number): number {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function cubicExtrema(a: number, b: number, c: number, d: number): number[] {
    const A = -a + 3 * b - 3 * c + d;
    const B = 2 * (a - 2 * b + c);
    const C = b - a;
    if (Math.abs(A) < 1e-12) return Math.abs(B) < 1e-12 ? [] : [-C / B].filter(t => t > 0 && t < 1);
    const discriminant = B * B - 4 * A * C;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    return [(-B + root) / (2 * A), (-B - root) / (2 * A)].filter(t => t > 0 && t < 1);
}

/**
 * 絶対座標 M/L/C/Z の path の実寸の外形（曲線の膨らみを含む）。降下（edit-store の fitShapePath）は
 * この外形を置いた寸法へ写すので、既定寸の縦横比もこの外形から取る（棚の viewBox の余白は捨てる）。
 */
export function shapePathBounds(d: string): { x: number; y: number; width: number; height: number } | undefined {
    const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const add = (x: number, y: number): void => {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    };
    let command = '';
    let current: [number, number] = [0, 0];
    let start: [number, number] = [0, 0];
    let index = 0;
    const next = (): number => Number(tokens[index++]);
    while (index < tokens.length) {
        const token = tokens[index];
        if (/^[A-Za-z]$/.test(token)) {
            // 契約 v1 の path は絶対座標の M/L/C/Z だけ。それ以外（相対・Q・A など）は外形を出さない。
            if (!'MLCZ'.includes(token)) return undefined;
            command = token;
            index++;
            if (command === 'Z') { current = start; continue; }
        }
        if (command === 'M' || command === 'L') {
            const p: [number, number] = [next(), next()];
            if (!p.every(Number.isFinite)) return undefined;
            add(p[0], p[1]);
            if (command === 'M') { start = p; command = 'L'; }
            current = p;
        } else if (command === 'C') {
            const c1: [number, number] = [next(), next()];
            const c2: [number, number] = [next(), next()];
            const p: [number, number] = [next(), next()];
            if (![...c1, ...c2, ...p].every(Number.isFinite)) return undefined;
            add(p[0], p[1]);
            for (let axis = 0; axis < 2; axis++) {
                for (const t of cubicExtrema(current[axis], c1[axis], c2[axis], p[axis])) {
                    const value = cubicAt(current[axis], c1[axis], c2[axis], p[axis], t);
                    if (axis === 0) add(value, current[1]); else add(current[0], value);
                }
            }
            current = p;
        } else {
            return undefined;
        }
    }
    if (!Number.isFinite(x0) || x1 - x0 <= 0 || y1 - y0 <= 0) return undefined;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * 既定寸: 長い辺 = 出力の短辺の 1/3・縦横比は形のまま。閉じた形・線の図形は path の実寸の外形、
 * ライン・吹き出しは棚の vb（降下が置いた寸法の中で形を作り直すため）。
 */
export function shapeDefaultSize(
    preset: ShapePresetV1, base: ShapePresetV1 | undefined, output: { width: number; height: number }
): { width: number; height: number } {
    const side = Math.max(1, Math.round(Math.min(output.width, output.height) / 3));
    const source = preset.rounded_from && base ? base : preset;
    const bounds = preset.kind === 'line' || preset.kind === 'bubble' ? undefined : shapePathBounds(source.d);
    const aspect = bounds ? bounds.width / bounds.height : preset.vb[0] / preset.vb[1];
    if (!Number.isFinite(aspect) || aspect <= 0) return { width: side, height: side };
    return aspect >= 1
        ? { width: side, height: Math.max(1, Math.round(side / aspect)) }
        : { width: Math.max(1, Math.round(side * aspect)), height: side };
}

export interface ShapeItemOptions {
    readonly preset: ShapePresetV1;
    /** 角丸の見本（rounded_from）が写す元の形。 */
    readonly base?: ShapePresetV1;
    readonly id: string;
    /** フレーム。 */
    readonly at: number;
    readonly duration: number;
    readonly output: { width: number; height: number };
    readonly center?: ShapePoint;
    readonly transform?: { readonly x?: number; readonly y?: number };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** 書く item。transform の x / y は図形の左上（出力 px）なので、中心から寸法の半分を引く。 */
export function buildShapeItem(options: ShapeItemOptions): Record<string, unknown> {
    const byId = new Map<string, ShapePresetV1>([[options.preset.id, options.preset]]);
    if (options.base) byId.set(options.base.id, options.base);
    const source = shapeSourceFromPreset(options.preset, byId);
    const size = shapeDefaultSize(options.preset, options.base, options.output);
    const center = options.center ?? { x: options.output.width / 2, y: options.output.height / 2 };
    const x = options.transform?.x ?? round2(center.x - size.width / 2);
    const y = options.transform?.y ?? round2(center.y - size.height / 2);
    return {
        id: options.id,
        at: Math.max(0, Math.round(options.at)),
        duration: Math.max(1, Math.round(options.duration)),
        transform: { x, y },
        source: { ...source, params: { ...source.params, width: size.width, height: size.height } }
    };
}

export function nextShapeItemId(doc: EditV2Document): string {
    const ids = new Set(indexEditV2Items(doc).keys());
    let serial = 1;
    while (ids.has(`shape-${serial}`)) serial++;
    return `shape-${serial}`;
}

export type ShapeTrackPlan = { readonly trackId: string } | { readonly insertIndex: number };

/**
 * 置く段: いちばん上の映像の段。ただしそこが重なる・ロック中・映像の段が 1 本だけ（= 本編）のときは
 * その上に新しい段を足す。tracks[] は画面の下から上の順（0 = 最背面）。
 */
export function planShapeTrack(
    tracks: readonly Record<string, unknown>[],
    range: { at: number; duration: number },
    lockedTrackIds: ReadonlySet<string> = new Set()
): ShapeTrackPlan {
    const visual = tracks.map((track, index) => ({ track, index }))
        .filter(entry => entry.track.lane === 'visual' && Array.isArray(entry.track.items));
    const top = visual[visual.length - 1];
    if (!top) return { insertIndex: tracks.length };
    const id = String(top.track.id);
    const items = top.track.items as Array<{ at: number; duration: number }>;
    if (visual.length === 1 || lockedTrackIds.has(id) || top.track.locked === true || materialRangeOverlaps(items, range)) {
        return { insertIndex: top.index + 1 };
    }
    return { trackId: id };
}

export function insertShapeItem(
    doc: EditV2Document, item: Record<string, unknown>, lockedTrackIds: ReadonlySet<string> = new Set()
): { doc: EditV2Document; trackId: string; createdTrack: boolean } {
    const tracks = Array.isArray(doc.tracks) ? doc.tracks as Array<Record<string, unknown>> : [];
    const plan = planShapeTrack(tracks, { at: item.at as number, duration: item.duration as number }, lockedTrackIds);
    if ('trackId' in plan) return { doc: insertItem(doc, plan.trackId, item), trackId: plan.trackId, createdTrack: false };
    const withTrack = insertTrack({ ...doc, tracks }, { index: plan.insertIndex, lane: 'visual' });
    const trackId = String((withTrack.tracks as Array<Record<string, unknown>>)[plan.insertIndex].id);
    return { doc: insertItem(withTrack, trackId, item), trackId, createdTrack: true };
}
