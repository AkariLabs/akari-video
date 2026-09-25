import { evaluatedItemTransform, hasItemKeyframeGroup, writeItemTransformAt, type TransformV2 } from '@akari-video/edit-store';
import { EditV2Document, moveTreeV2Item } from './edit-v2-mutations';

/**
 * 出力プレビューの上のバー・要素の上の小さなメニュー（コピー / スタイルをコピー / 貼り付け / 複製 / 削除 / ロック）の
 * edit.json への書き方。DOM に依存しない純関数だけを置き、node --test で確かめる。
 *
 * - コピーは OS のクリップボードへ edit.json の item（JSON）を載せる。参照する素材は sources ごと写すので、
 *   別のプロジェクトやエージェントへもそのまま渡せる（{@link buildItemClipboard}）
 * - 貼り付けはプレイヘッドの時刻へ、元の位置から 20px ずつずらして置く（{@link pasteItemClipboard}）
 * - スタイルをコピーは、種類ごとに決めた見た目の値だけを次に押した要素へ写す（{@link applyStyleClip}）
 */

type JsonRecord = Record<string, any>;

export const ITEM_CLIPBOARD_KIND = 'akari-video/edit-item';
/** 貼り付け・複製のずらし幅（出力の px）。 */
export const PASTE_OFFSET_PX = 20;

export type ContextBarKind = 'shape' | 'line' | 'photo' | 'text' | 'canvas' | 'other';

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|avif|heic)$/iu;

const isRecord = (value: unknown): value is JsonRecord => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 種類の見分け（上のバーの項目と、スタイルをコピーの写し方が変わる）。 */
export function contextBarKind(item: JsonRecord | undefined, sourcePath?: string): ContextBarKind {
    const source = isRecord(item?.source) ? item!.source : undefined;
    if (!source) return 'other';
    if (source.kind === 'shape') return source.shape === 'line' || source.shape === 'arrow' ? 'line' : 'shape';
    if (source.kind === 'media') return typeof sourcePath === 'string' && IMAGE_EXT.test(sourcePath) ? 'photo' : 'other';
    if (source.kind === 'caption' || source.kind === 'captions' || source.kind === 'telop') return 'text';
    if (source.kind === 'group') return 'canvas';
    return 'other';
}

// ---- 木の探索 -----------------------------------------------------------------------------

export interface ItemPlace {
    item: JsonRecord;
    list: JsonRecord[];
    index: number;
    trackId: string;
    trackIndex: number;
    parent?: JsonRecord;
    /** 親の開始からの相対を足した、出力の開始フレーム。 */
    absoluteAt: number;
}

function visualTracks(doc: EditV2Document): Array<{ track: JsonRecord; index: number }> {
    const tracks = Array.isArray(doc.tracks) ? doc.tracks as JsonRecord[] : [];
    return tracks.map((track, index) => ({ track, index }))
        .filter(({ track }) => track.lane === 'visual' && Array.isArray(track.items));
}

export function findItemPlace(doc: EditV2Document, id: string): ItemPlace | undefined {
    for (const { track, index: trackIndex } of visualTracks(doc)) {
        const walk = (list: JsonRecord[], parent: JsonRecord | undefined, base: number): ItemPlace | undefined => {
            for (let index = 0; index < list.length; index++) {
                const item = list[index];
                if (!isRecord(item)) continue;
                const at = base + (Number.isFinite(item.at) ? item.at as number : 0);
                if (item.id === id) return { item, list, index, trackId: String(track.id), trackIndex, parent, absoluteAt: at };
                if (Array.isArray(item.items)) {
                    const hit = walk(item.items, item, at);
                    if (hit) return hit;
                }
            }
            return undefined;
        };
        const hit = walk(track.items as JsonRecord[], undefined, 0);
        if (hit) return hit;
    }
    return undefined;
}

function allIds(doc: EditV2Document): Set<string> {
    const ids = new Set<string>();
    const walk = (list: unknown): void => {
        if (!Array.isArray(list)) return;
        for (const item of list) {
            if (!isRecord(item)) continue;
            if (typeof item.id === 'string') ids.add(item.id);
            walk(item.items);
        }
    };
    for (const track of Array.isArray(doc.tracks) ? doc.tracks as JsonRecord[] : []) walk(track.items);
    const audio = isRecord(doc.audio) ? doc.audio : undefined;
    for (const key of ['sfx', 'narration']) {
        for (const entry of Array.isArray(audio?.[key]) ? audio![key] as JsonRecord[] : []) {
            if (typeof entry?.id === 'string') ids.add(entry.id);
        }
    }
    return ids;
}

function uniqueId(base: string, taken: Set<string>): string {
    if (!taken.has(base)) { taken.add(base); return base; }
    let serial = 1;
    while (taken.has(`${base}-copy-${serial}`)) serial++;
    const id = `${base}-copy-${serial}`;
    taken.add(id);
    return id;
}

function nextVisualTrackId(doc: EditV2Document): string {
    const ids = new Set((Array.isArray(doc.tracks) ? doc.tracks as JsonRecord[] : []).map(track => String(track.id)));
    let serial = 1;
    while (ids.has(`v${serial}`)) serial++;
    return `v${serial}`;
}

// ---- コピー / 貼り付け（OS のクリップボード・edit.json の item） ----------------------------

export interface ItemClipboardEnvelope {
    kind: typeof ITEM_CLIPBOARD_KIND;
    version: 1;
    /** 時間（at / duration）の単位。貼り先の fps が違うときに換算する。 */
    fps: number;
    output: { width: number; height: number };
    item: JsonRecord;
    /** item（と子）が参照する sources[]。 */
    sources: JsonRecord[];
}

/** item と子が参照する sources の id（media の src・マスク）。 */
function referencedSourceIds(item: JsonRecord): string[] {
    const ids: string[] = [];
    const walk = (node: JsonRecord): void => {
        if (isRecord(node.source) && node.source.kind === 'media' && typeof node.source.src === 'string') ids.push(node.source.src);
        if (typeof node.mask === 'string') ids.push(node.mask);
        for (const child of Array.isArray(node.items) ? node.items : []) if (isRecord(child)) walk(child);
    };
    walk(item);
    return [...new Set(ids)];
}

function containsCaptionRef(item: JsonRecord): boolean {
    if (isRecord(item.source) && (item.source.kind === 'caption' || item.source.kind === 'captions')) return true;
    return (Array.isArray(item.items) ? item.items : []).some(child => isRecord(child) && containsCaptionRef(child));
}

/**
 * 選んだ item を OS のクリップボードに載せる形にする。字幕（captions.json の行を指す item）は
 * edit.json だけでは写せないので対象外（タイムラインのコピーへ任せる）。
 */
export function buildItemClipboard(doc: EditV2Document, itemId: string): ItemClipboardEnvelope | undefined {
    const place = findItemPlace(doc, itemId);
    if (!place || containsCaptionRef(place.item)) return undefined;
    const item = clone(place.item);
    // キャンバスの子は親の中の相対時刻なので、貼るときのために出力の時刻へ直しておく
    item.at = place.absoluteAt;
    const sources = Array.isArray(doc.sources) ? doc.sources as JsonRecord[] : [];
    const wanted = referencedSourceIds(item);
    const output = isRecord(doc.output) ? doc.output : {};
    return {
        kind: ITEM_CLIPBOARD_KIND,
        version: 1,
        fps: Number.isFinite(output.fps) && output.fps > 0 ? output.fps : 30,
        output: { width: Number(output.width) || 1920, height: Number(output.height) || 1080 },
        item,
        sources: sources.filter(source => wanted.includes(String(source?.id))).map(clone)
    };
}

export function serializeItemClipboard(envelope: ItemClipboardEnvelope): string {
    return `${JSON.stringify(envelope, undefined, 2)}\n`;
}

/** OS のクリップボードの文字列を読む。edit.json の item そのもの（{ id, source, … }）も受ける。 */
export function parseItemClipboard(text: string): ItemClipboardEnvelope | undefined {
    let value: unknown;
    try { value = JSON.parse(text); } catch { return undefined; }
    if (!isRecord(value)) return undefined;
    if (value.kind === ITEM_CLIPBOARD_KIND) {
        if (value.version !== 1 || !isRecord(value.item) || typeof value.item.id !== 'string' || !isRecord(value.item.source)) return undefined;
        return {
            kind: ITEM_CLIPBOARD_KIND, version: 1,
            fps: Number.isFinite(value.fps) && (value.fps as number) > 0 ? value.fps as number : 30,
            output: isRecord(value.output) ? { width: Number(value.output.width) || 1920, height: Number(value.output.height) || 1080 }
                : { width: 1920, height: 1080 },
            item: value.item,
            sources: Array.isArray(value.sources) ? value.sources.filter(isRecord) : []
        };
    }
    // 素の item（エージェントが直接書いたもの）
    if (typeof value.id === 'string' && isRecord(value.source) && typeof value.source.kind === 'string'
        && !('tracks' in value)) {
        return { kind: ITEM_CLIPBOARD_KIND, version: 1, fps: 30, output: { width: 1920, height: 1080 }, item: value, sources: [] };
    }
    return undefined;
}

export interface PasteResult { document: EditV2Document; itemId: string; trackId: string }

/**
 * クリップボードの item を貼る。時刻 = `atFrame`（出力のフレーム）・位置 = 元から `offset` px ずらす。
 * いちばん上に新しい映像トラックを作って置く（重なりで edit-lint を落とさない・最前面に出る）。
 * sources は同じパスのものがあればそれを使い、無ければ足す（id がぶつかるときは付け替える）。
 */
export function pasteItemClipboard(doc: EditV2Document, envelope: ItemClipboardEnvelope,
    options: { atFrame: number; offset: { x: number; y: number } }): PasteResult {
    const value = clone(doc) as JsonRecord;
    const output = isRecord(value.output) ? value.output : {};
    const fps = Number.isFinite(output.fps) && output.fps > 0 ? output.fps as number : 30;
    const ratio = fps / (envelope.fps > 0 ? envelope.fps : fps);
    const sources: JsonRecord[] = Array.isArray(value.sources) ? value.sources : (value.sources = []);
    const sourceIds = new Set(sources.map(source => String(source.id)));
    const remap = new Map<string, string>();
    for (const incoming of envelope.sources) {
        const id = String(incoming.id);
        const samePath = sources.find(source => source.path === incoming.path);
        if (samePath) { remap.set(id, String(samePath.id)); continue; }
        let next = id;
        let serial = 2;
        while (sourceIds.has(next)) next = `${id}-${serial++}`;
        sourceIds.add(next);
        remap.set(id, next);
        sources.push({ ...clone(incoming), id: next });
    }
    const missing = referencedSourceIds(envelope.item).filter(id => !remap.has(id) && !sourceIds.has(id));
    if (missing.length) throw new Error(`貼り付ける素材が見つかりません: ${missing.join(', ')}`);
    const taken = allIds(value);
    const item = clone(envelope.item);
    const rewrite = (node: JsonRecord, top: boolean): void => {
        node.id = uniqueId(String(node.id), taken);
        if (isRecord(node.source) && node.source.kind === 'media' && typeof node.source.src === 'string') {
            node.source.src = remap.get(node.source.src) ?? node.source.src;
        }
        if (typeof node.mask === 'string') node.mask = remap.get(node.mask) ?? node.mask;
        if (!top && Number.isFinite(node.at)) node.at = Math.round(node.at * ratio);
        if (Number.isFinite(node.duration)) node.duration = Math.max(1, Math.round(node.duration * ratio));
        for (const child of Array.isArray(node.items) ? node.items : []) if (isRecord(child)) rewrite(child, false);
    };
    rewrite(item, true);
    delete item.locked;
    item.at = Math.max(0, Math.round(options.atFrame));
    const transform = isRecord(item.transform) ? item.transform : {};
    item.transform = {
        ...transform,
        x: (Number.isFinite(transform.x) ? transform.x : 0) + options.offset.x,
        y: (Number.isFinite(transform.y) ? transform.y : 0) + options.offset.y
    };
    const trackId = nextVisualTrackId(value);
    const tracks: JsonRecord[] = Array.isArray(value.tracks) ? value.tracks : (value.tracks = []);
    tracks.push({ id: trackId, lane: 'visual', items: [item] });
    return { document: value, itemId: item.id, trackId };
}

/** 複製: 同じ時刻・20px ずらして、元のすぐ上の新しいトラック（キャンバスの子は親の中の次）へ。 */
export function duplicateItem(doc: EditV2Document, itemId: string, offset: { x: number; y: number }): PasteResult {
    const value = clone(doc) as JsonRecord;
    const place = findItemPlace(value, itemId);
    if (!place) throw new Error(`複製する要素が見つかりません: ${itemId}`);
    const taken = allIds(value);
    const copy = clone(place.item);
    const fresh = (node: JsonRecord): void => {
        node.id = uniqueId(String(node.id), taken);
        for (const child of Array.isArray(node.items) ? node.items : []) if (isRecord(child)) fresh(child);
    };
    fresh(copy);
    // ロックは元を守るためのもの。複製はそのまま動かせるように外す（元はロックのまま）
    delete copy.locked;
    const transform = isRecord(copy.transform) ? copy.transform : {};
    copy.transform = { ...transform, x: (Number.isFinite(transform.x) ? transform.x : 0) + offset.x,
        y: (Number.isFinite(transform.y) ? transform.y : 0) + offset.y };
    if (place.parent) {
        place.list.splice(place.index + 1, 0, copy);
        return { document: value, itemId: copy.id, trackId: place.trackId };
    }
    const trackId = nextVisualTrackId(value);
    (value.tracks as JsonRecord[]).splice(place.trackIndex + 1, 0, { id: trackId, lane: 'visual', items: [copy] });
    return { document: value, itemId: copy.id, trackId };
}

// ---- スタイルをコピー -------------------------------------------------------------------

export interface StyleClip {
    kind: ContextBarKind;
    /** item の中のドット区切りのパス → 値（null = その値が無い = 写すときに消す）。 */
    values: Record<string, unknown>;
}

/** 種類ごとに写す見た目（notes の口述: 図形 = 塗り・枠・太さ・角の丸み・不透明度 / ライン = 色・太さ・線種・端・不透明度 / 文字 = スタイル・フォント・動き・不透明度）。 */
export const STYLE_PATHS: Record<ContextBarKind, readonly string[]> = {
    shape: ['source.params.fill', 'source.params.stroke', 'source.params.strokeWidth', 'source.params.cornerRadius', 'opacity'],
    line: ['source.params.stroke', 'source.params.strokeWidth', 'source.params.dash', 'source.params.lineCap',
        'source.params.startCap', 'source.params.endCap', 'source.params.startCapFilled', 'source.params.endCapFilled', 'opacity'],
    text: ['motion', 'animator', 'opacity'],
    photo: ['flip', 'opacity'],
    canvas: ['motion', 'opacity'],
    other: ['opacity']
};

function readPath(item: JsonRecord, path: string): unknown {
    let node: unknown = item;
    for (const key of path.split('.')) {
        if (!isRecord(node)) return undefined;
        node = node[key];
    }
    return node;
}

function writePath(item: JsonRecord, path: string, value: unknown): void {
    const keys = path.split('.');
    const last = keys.pop()!;
    let node = item;
    for (const key of keys) {
        if (!isRecord(node[key])) node[key] = {};
        node = node[key];
    }
    if (value === null || value === undefined) delete node[last];
    else node[last] = clone(value);
}

export function styleClipOf(item: JsonRecord, kind: ContextBarKind): StyleClip {
    const values: Record<string, unknown> = {};
    for (const path of STYLE_PATHS[kind]) {
        const value = readPath(item, path);
        values[path] = value === undefined ? null : clone(value);
    }
    return { kind, values };
}

/** 写す値の一覧（種類が違う相手には不透明度だけ）。 */
export function styleWrites(clip: StyleClip, targetKind: ContextBarKind): Array<{ path: string; value: unknown }> {
    const paths = clip.kind === targetKind ? Object.keys(clip.values) : ['opacity'];
    return paths.map(path => ({ path, value: path in clip.values ? clip.values[path] : null }));
}

export function applyStyleClip(doc: EditV2Document, targetId: string, clip: StyleClip, targetKind: ContextBarKind): EditV2Document {
    const value = clone(doc) as JsonRecord;
    const place = findItemPlace(value, targetId);
    if (!place) throw new Error(`スタイルを当てる要素が見つかりません: ${targetId}`);
    for (const { path, value: next } of styleWrites(clip, targetKind)) {
        // v0 の rect は角の丸みを持てない（描画に効かない）ので写さない
        if (path === 'source.params.cornerRadius' && place.item.source?.shape !== 'path' && place.item.source?.shape !== 'rounded-rect') continue;
        writePath(place.item, path, next);
    }
    return value;
}

// ---- ロック・線の端・角の丸み・画面に合わせる -------------------------------------------------

export function isItemLocked(doc: EditV2Document | undefined, id: string | undefined): boolean {
    if (!doc || !id) return false;
    return findItemPlace(doc, id)?.item.locked === true;
}

/** 映像トラックの木の中でロック中の item の id。 */
export function lockedItemIds(doc: EditV2Document): string[] {
    const ids: string[] = [];
    const walk = (list: unknown): void => {
        if (!Array.isArray(list)) return;
        for (const item of list) {
            if (!isRecord(item)) continue;
            if (item.locked === true && typeof item.id === 'string') ids.push(item.id);
            walk(item.items);
        }
    };
    for (const { track } of visualTracks(doc)) walk(track.items);
    return ids;
}

export function setItemLocked(doc: EditV2Document, id: string, locked: boolean): EditV2Document {
    const value = clone(doc) as JsonRecord;
    const place = findItemPlace(value, id);
    if (!place) throw new Error(`要素が見つかりません: ${id}`);
    if (locked) place.item.locked = true; else delete place.item.locked;
    return value;
}

/** 始点と終点の飾りを入れ替える（線の向きはそのまま）。 */
export function swapLineEnds(doc: EditV2Document, id: string): EditV2Document {
    const value = clone(doc) as JsonRecord;
    const params = findItemPlace(value, id)?.item.source?.params;
    if (!isRecord(params)) throw new Error('ラインを選んでください。');
    const pairs: Array<[string, string]> = [['startCap', 'endCap'], ['startCapFilled', 'endCapFilled']];
    for (const [a, b] of pairs) {
        const first = params[a];
        const second = params[b];
        if (second === undefined) delete params[a]; else params[a] = second;
        if (first === undefined) delete params[b]; else params[b] = first;
    }
    return value;
}

/** 角の丸みを出せる形か（閉じた形で、直線どうしの角がある = path に曲線が無い / 角丸四角 / v0 の四角）。 */
export function hasCorners(item: JsonRecord | undefined): boolean {
    const source = item?.source;
    if (!isRecord(source) || source.kind !== 'shape') return false;
    if (source.shape === 'rect' || source.shape === 'rounded-rect') return true;
    if (source.shape !== 'path') return false;
    const d = source.params?.path?.d;
    return typeof d === 'string' && /Z/iu.test(d) && !/C/iu.test(d);
}

/**
 * 角の丸み（0〜100 = 短辺の半分に対する割合）。path はそのまま `cornerRadius`、
 * v0 の四角・角丸四角は描画に効く path（四角の値の写し）へ直してから付ける。
 */
export function setCornerRadius(doc: EditV2Document, id: string, percent: number): EditV2Document {
    const value = clone(doc) as JsonRecord;
    const item = findItemPlace(value, id)?.item;
    if (!item || !hasCorners(item)) throw new Error('角のある図形を選んでください。');
    const source = item.source;
    const params: JsonRecord = isRecord(source.params) ? source.params : (source.params = {});
    const next = Math.max(0, Math.min(100, Math.round(percent)));
    if (source.shape !== 'path') {
        const width = Number(params.width) > 0 ? Number(params.width) : 600;
        const height = Number(params.height) > 0 ? Number(params.height) : 340;
        source.shape = 'path';
        params.width = width;
        params.height = height;
        params.path = { d: `M0 0L${width} 0L${width} ${height}L0 ${height}Z`, vb: [width, height] };
        if (params.fill === undefined) params.fill = '#f97316';
    }
    if (next === 0) delete params.cornerRadius; else params.cornerRadius = next;
    return value;
}

/**
 * 変形のまとまり（位置・大きさ・回転）のどれかが動き（キーフレーム）を持つとき、再生位置の item の中のフレームを返す。
 * そのときは静的値へ書かず、キーフレームの書き込み層（edit-store の writeItemTransformAt）で再生位置へ点を打つ
 * （静的値へ書くと点に負けて「戻る」）。`atFrame` は出力のフレーム。
 */
function animatedFrame(place: ItemPlace, atFrame: number | undefined): number | undefined {
    if (atFrame === undefined || !Number.isFinite(atFrame)) return undefined;
    const item = place.item as never;
    if (!(['position', 'size', 'rotation'] as const).some(group => hasItemKeyframeGroup(item, group))) return undefined;
    const duration = Number.isFinite(place.item.duration) ? place.item.duration as number : 0;
    return Math.max(0, Math.min(duration, Math.round(atFrame) - place.absoluteAt));
}

function writeAnimatedTransform(item: JsonRecord, frame: number, patch: TransformV2): void {
    const updated = writeItemTransformAt(item as never, frame, patch);
    item.transform = updated.transform;
    if (updated.keyframes) item.keyframes = updated.keyframes; else delete item.keyframes;
}

/**
 * 画面に合わせる。図形・ライン = 画面いっぱいへ伸ばす（拡縮の中心は画面の中心なので x / y で左上を 0 に合わせる）/
 * 写真・動画ほか = 変形を外して画面に収める（既定の置き方）。
 * 動きを持つ item は再生位置へ点を打つ（`atFrame` = 出力のフレーム。省略時は静的値）。
 */
export function fitItemToScreen(doc: EditV2Document, id: string, atFrame?: number): EditV2Document {
    const value = clone(doc) as JsonRecord;
    const place = findItemPlace(value, id);
    const item = place?.item;
    if (!place || !item) throw new Error(`要素が見つかりません: ${id}`);
    const output = isRecord(value.output) ? value.output : {};
    const W = Number(output.width) || 1920;
    const H = Number(output.height) || 1080;
    const frame = animatedFrame(place, atFrame);
    if (item.source?.kind === 'shape') {
        const width = Number(item.source.params?.width) || 600;
        const height = Number(item.source.params?.height) || (item.source.shape === 'line' ? 80 : 340);
        const sx = W / width;
        const sy = H / height;
        if (frame !== undefined) {
            writeAnimatedTransform(item, frame, { x: (W / 2) * (sx - 1), y: (H / 2) * (sy - 1), scaleX: sx, scaleY: sy, rotate: 0 });
            return value;
        }
        item.transform = { x: (W / 2) * (sx - 1), y: (H / 2) * (sy - 1), scaleX: sx, scaleY: sy };
        if (Math.abs(sx - sy) < 1e-9) item.transform = { x: item.transform.x, y: item.transform.y, scale: sx };
    } else if (frame !== undefined) {
        writeAnimatedTransform(item, frame, { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0 });
    } else {
        item.transform = { x: 0, y: 0, scale: 1 };
    }
    return value;
}

/** 位置をずらす（揃え: プレビューで測った見えている箱の差を出力の px で足す）。動きを持つ item は再生位置の見えている位置から。 */
export function nudgeItem(doc: EditV2Document, id: string, dx: number, dy: number, atFrame?: number): EditV2Document {
    const value = clone(doc) as JsonRecord;
    const place = findItemPlace(value, id);
    const item = place?.item;
    if (!place || !item) throw new Error(`要素が見つかりません: ${id}`);
    const frame = animatedFrame(place, atFrame);
    if (frame !== undefined) {
        const pose = evaluatedItemTransform(item as never, frame);
        writeAnimatedTransform(item, frame, { x: Math.round((pose.x + dx) * 100) / 100, y: Math.round((pose.y + dy) * 100) / 100 });
        return value;
    }
    const transform = isRecord(item.transform) ? item.transform : {};
    item.transform = { ...transform,
        x: Math.round(((Number.isFinite(transform.x) ? transform.x : 0) + dx) * 100) / 100,
        y: Math.round(((Number.isFinite(transform.y) ? transform.y : 0) + dy) * 100) / 100 };
    return value;
}

/**
 * 図形の大きさを px で指定する（配置の窓の 幅 / 高さ）。見えている左上を動かさない
 * （拡縮の中心 = 画面の中心なので、x / y を補正する）。動きを持つ図形は再生位置の見えている値から、その時刻の点として書く。
 */
export function resizeShapeTo(doc: EditV2Document, id: string,
    size: { width?: number; height?: number; keepRatio?: boolean }, atFrame?: number): EditV2Document {
    const value = clone(doc) as JsonRecord;
    const place = findItemPlace(value, id);
    const item = place?.item;
    if (!place || !item || item.source?.kind !== 'shape') throw new Error('図形を選んでください。');
    const output = isRecord(value.output) ? value.output : {};
    const cx = (Number(output.width) || 1920) / 2;
    const cy = (Number(output.height) || 1080) / 2;
    const baseW = Number(item.source.params?.width) || 600;
    const baseH = Number(item.source.params?.height) || (item.source.shape === 'line' ? 80 : 340);
    const frame = animatedFrame(place, atFrame);
    const t: JsonRecord = frame !== undefined ? evaluatedItemTransform(item as never, frame)
        : isRecord(item.transform) ? item.transform : {};
    const scale = Number.isFinite(t.scale) ? t.scale : 1;
    const sx0 = Number.isFinite(t.scaleX) ? t.scaleX : scale;
    const sy0 = Number.isFinite(t.scaleY) ? t.scaleY : scale;
    let sx = size.width !== undefined && size.width > 0 ? size.width / baseW : sx0;
    let sy = size.height !== undefined && size.height > 0 ? size.height / baseH : sy0;
    if (size.keepRatio) {
        if (size.width !== undefined) sy = sy0 * (sx / sx0);
        else if (size.height !== undefined) sx = sx0 * (sy / sy0);
    }
    const x0 = Number.isFinite(t.x) ? t.x : 0;
    const y0 = Number.isFinite(t.y) ? t.y : 0;
    const left = x0 + cx * (1 - sx0);
    const top = y0 + cy * (1 - sy0);
    if (frame !== undefined) {
        writeAnimatedTransform(item, frame, { x: round2(left - cx * (1 - sx)), y: round2(top - cy * (1 - sy)),
            scaleX: round4(sx), scaleY: round4(sy) });
        return value;
    }
    const next: JsonRecord = { ...t, x: round2(left - cx * (1 - sx)), y: round2(top - cy * (1 - sy)) };
    delete next.scale; delete next.scaleX; delete next.scaleY;
    if (Math.abs(sx - sy) < 1e-9) next.scale = round4(sx); else { next.scaleX = round4(sx); next.scaleY = round4(sy); }
    item.transform = next;
    return value;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

// ---- レイヤー一覧（配置の窓） ---------------------------------------------------------------

export interface LayerRow {
    id: string;
    name: string;
    kind: ContextBarKind;
    /** 出力の秒。 */
    start: number;
    end: number;
    locked: boolean;
    hidden: boolean;
    selected: boolean;
}

export interface LayerList {
    /** 今の親（null = 画面のいちばん上の階層）。 */
    parent: { id: string; name: string } | null;
    /** 前面が先。 */
    rows: LayerRow[];
}

const KIND_NAME: Record<ContextBarKind, string> = {
    shape: '図形', line: 'ライン', photo: '写真', text: '文字', canvas: 'キャンバス', other: '素材'
};

/**
 * 選んだ要素と同じ親の中で、プレイヘッドの時刻に出ているもの（無ければ選んだものだけ）を前面から並べる。
 * いちばん上の階層では映像トラックの上下が重なり順、キャンバスの中では子の並び順。
 */
export function layerListAt(doc: EditV2Document, selectedId: string, playheadFrame: number,
    sourcePath: (sourceId: string) => string | undefined = () => undefined): LayerList {
    const fps = isRecord(doc.output) && Number(doc.output.fps) > 0 ? Number(doc.output.fps) : 30;
    const place = findItemPlace(doc, selectedId);
    const row = (item: JsonRecord, absoluteAt: number): LayerRow => {
        const kind = contextBarKind(item, isRecord(item.source) && typeof item.source.src === 'string' ? sourcePath(item.source.src) : undefined);
        const duration = Number.isFinite(item.duration) ? item.duration as number : 0;
        return { id: String(item.id), name: typeof item.name === 'string' && item.name ? item.name : `${KIND_NAME[kind]}（${item.id}）`,
            kind, start: absoluteAt / fps, end: (absoluteAt + duration) / fps, locked: item.locked === true,
            hidden: item.hidden === true, selected: item.id === selectedId };
    };
    const covers = (at: number, item: JsonRecord): boolean => at <= playheadFrame && playheadFrame < at + (Number(item.duration) || 0);
    if (place?.parent) {
        const parentAt = place.absoluteAt - (Number(place.item.at) || 0);
        const rows = place.list.filter(isRecord).map(item => ({ item, at: parentAt + (Number(item.at) || 0) }))
            .filter(({ item, at }) => item.id === selectedId || covers(at, item))
            .map(({ item, at }) => row(item, at)).reverse();
        return { parent: { id: String(place.parent.id), name: typeof place.parent.name === 'string' && place.parent.name ? place.parent.name : 'キャンバス' }, rows };
    }
    const rows: LayerRow[] = [];
    for (const { track } of visualTracks(doc)) {
        for (const item of track.items as JsonRecord[]) {
            if (!isRecord(item) || typeof item.id !== 'string') continue;
            const at = Number(item.at) || 0;
            if (item.id === selectedId || covers(at, item)) rows.push(row(item, at));
        }
    }
    return { parent: null, rows: rows.reverse() };
}

/**
 * レイヤー一覧の並べ替え: `id` を `targetId` の位置（前面から数えた同じ順位）へ動かす。
 * いちばん上の階層では相手のトラックへ同じ時刻のまま移す（重なるときは新しいトラックが相手の上にできる）。
 */
export function moveLayer(doc: EditV2Document, id: string, targetId: string): EditV2Document {
    if (id === targetId) return doc;
    const place = findItemPlace(doc, id);
    const target = findItemPlace(doc, targetId);
    if (!place || !target) throw new Error('並べ替える要素が見つかりません。');
    if (place.parent || target.parent) {
        if (!place.parent || !target.parent || place.parent.id !== target.parent.id) throw new Error('同じキャンバスの中でだけ並べ替えられます。');
        return moveTreeV2Item(doc, id, { parent: String(place.parent.id), index: target.index }).document;
    }
    // 相手のすぐ上（前面へ動かすとき）/ すぐ下（背面へ動かすとき）に空のトラックを作って移す。
    // 相手のトラックへそのまま入れると、時刻が重なって相手の上にしか置けないため。
    const value = clone(doc) as JsonRecord;
    const tracks = value.tracks as JsonRecord[];
    const toFront = target.trackIndex > place.trackIndex;
    const trackId = nextVisualTrackId(value);
    tracks.splice(toFront ? target.trackIndex + 1 : target.trackIndex, 0, { id: trackId, lane: 'visual', items: [] });
    return moveTreeV2Item(value, id, { track: trackId }, { at: place.item.at }).document;
}
