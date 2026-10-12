import type { ItemV2, KeyframeV2, TransformV2 } from './edit-v2';

export type TransformField = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate';
const FIELDS: readonly TransformField[] = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isMedia = (item: Pick<ItemV2, 'source'>): boolean => item.source.kind === 'media';
const pointsOf = (item: Pick<ItemV2, 'keyframes'>): KeyframeV2[] =>
    Array.isArray(item.keyframes) ? item.keyframes.slice().sort((a, b) => a.t - b.t) : [];
const frameOf = (item: Pick<ItemV2, 'duration'>, frame: number): number =>
    Math.min(item.duration, Math.max(0, Math.round(frame)));

/**
 * 3D モックアップの向き（three ランタイムの標準ツマミ。度）。3 本で 1 つのキーフレームグループ
 * `rotation3d` になる（内部契約 2026-10-11-3d-place §2.2）。静的値は source.vars の文字列、
 * キーは keyframes[].vars の数値、easing のキーは "vars.<名前>"。
 */
export const ROTATION_3D_VARS = ['--akari-3d-rot-x', '--akari-3d-rot-y', '--akari-3d-rot-z'] as const;
export type Rotation3dVar = typeof ROTATION_3D_VARS[number];
export type Rotation3dValues = Partial<Record<Rotation3dVar, number>>;
const isRotation3dVar = (name: string): name is Rotation3dVar => (ROTATION_3D_VARS as readonly string[]).includes(name);

/** three 断片の html item か（scene3d 素材のパス、または 3D 回転の値・キーを持つ）。 */
export function isScene3dItem(item: Pick<ItemV2, 'source' | 'keyframes'>): boolean {
    if (item.source.kind !== 'html') return false;
    if (/(^|\/)scene3d\//u.test(item.source.path ?? '')) return true;
    const vars = item.source.vars ?? {};
    return ROTATION_3D_VARS.some(name => vars[name] !== undefined)
        || pointsOf(item).some(point => ROTATION_3D_VARS.some(name => finite(point.vars?.[name])));
}

function eased(point: KeyframeV2, field: TransformField | 'opacity' | Rotation3dVar, u: number, media: boolean): number {
    const raw = point.easing;
    const name = typeof raw === 'string' ? raw : field.startsWith('--')
        ? raw?.[`vars.${field}`] ?? 'linear'
        : raw?.[`transform.${field}`] ?? raw?.transform ?? 'linear';
    if (media) return name === 'ease-in-out'
        ? u < .5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2 : u;
    if (name === 'hold') return 0;
    if (name === 'ease-in-out' || name === 'in-out-cubic') return u < .5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
    if (name === 'in-quad') return u * u;
    if (name === 'out-quad') return 1 - (1 - u) ** 2;
    if (name === 'in-out-quad') return u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    if (name === 'in-cubic') return u ** 3;
    if (name === 'out-cubic') return 1 - (1 - u) ** 3;
    if (name === 'in-quart') return u ** 4;
    if (name === 'out-quart') return 1 - (1 - u) ** 4;
    if (name === 'in-out-quart') return u < .5 ? 8 * u ** 4 : 1 - (-2 * u + 2) ** 4 / 2;
    if (name === 'in-expo') return u === 0 ? 0 : 2 ** (10 * u - 10);
    if (name === 'out-expo') return u === 1 ? 1 : 1 - 2 ** (-10 * u);
    if (name === 'in-out-expo') return u === 0 || u === 1 ? u
        : u < .5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (-20 * u + 10)) / 2;
    if (name === 'in-back') return 2.70158 * u ** 3 - 1.70158 * u ** 2;
    if (name === 'out-back') return 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
    if (name === 'in-out-back') {
        const c = 1.70158 * 1.525;
        return u < .5 ? ((2 * u) ** 2 * ((c + 1) * 2 * u - c)) / 2
            : (((2 * u - 2) ** 2 * ((c + 1) * (2 * u - 2) + c)) + 2) / 2;
    }
    if (name === 'out-bounce') {
        const n = 7.5625, d = 2.75;
        if (u < 1 / d) return n * u * u;
        if (u < 2 / d) return n * (u - 1.5 / d) ** 2 + .75;
        if (u < 2.5 / d) return n * (u - 2.25 / d) ** 2 + .9375;
        return n * (u - 2.625 / d) ** 2 + .984375;
    }
    if (name === 'out-elastic') return u === 0 || u === 1 ? u
        : 2 ** (-10 * u) * Math.sin((u * 10 - .75) * (2 * Math.PI / 3)) + 1;
    const match = typeof name === 'string' ? name.match(/^cubic-bezier\(([^,]+),([^,]+),([^,]+),([^,]+)\)$/u) : null;
    if (match) {
        const [x1, y1, x2, y2] = match.slice(1).map(Number);
        if ([x1, y1, x2, y2].every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1) {
            const curve = (p: number, a: number, b: number): number =>
                3 * (1 - p) ** 2 * p * a + 3 * (1 - p) * p ** 2 * b + p ** 3;
            let low = 0, high = 1;
            for (let i = 0; i < 32; i++) {
                const mid = (low + high) / 2;
                if (curve(mid, x1, x2) < u) low = mid; else high = mid;
            }
            return curve((low + high) / 2, y1, y2);
        }
    }
    return u;
}

function valueAt(points: KeyframeV2[], frame: number, field: TransformField,
    fallback: number, media: boolean, statics: TransformV2): number {
    const declared = points.flatMap(point => {
        const transform = point.transform;
        if (!transform) return [];
        let value = transform[field];
        if (!finite(value) && (field === 'scaleX' || field === 'scaleY')) {
            value = transform.scale ?? (media ? statics[field] ?? statics.scale ?? 1 : fallback);
        }
        return finite(value) ? [{ point, value }] : [];
    });
    if (!declared.length) return fallback;
    if (frame <= declared[0].point.t) return declared[0].value;
    const last = declared[declared.length - 1];
    if (frame >= last.point.t) return last.value;
    for (let i = 1; i < declared.length; i++) {
        const right = declared[i], left = declared[i - 1];
        if (frame > right.point.t) continue;
        const span = right.point.t - left.point.t;
        const u = span > 0 ? eased(right.point, field, (frame - left.point.t) / span, media) : 1;
        return left.value + (right.value - left.value) * u;
    }
    return last.value;
}

/** Effective local pose, in pixels, unitless scale factors, and degrees. */
export function evaluatedItemTransform(item: Pick<ItemV2, 'source' | 'transform' | 'keyframes' | 'duration'>,
    frame: number): Required<TransformV2> {
    const staticValue = item.transform ?? {};
    const base: Required<TransformV2> = {
        x: staticValue.x ?? 0, y: staticValue.y ?? 0, scale: staticValue.scale ?? 1,
        scaleX: staticValue.scaleX ?? staticValue.scale ?? 1,
        scaleY: staticValue.scaleY ?? staticValue.scale ?? 1, rotate: staticValue.rotate ?? 0
    };
    const points = pointsOf(item), media = isMedia(item);
    if (!points.some(point => point.transform)) return base;
    const at = frameOf(item, frame);
    return Object.fromEntries(FIELDS.map(field => [field,
        valueAt(points, at, field, base[field], media, staticValue)])) as unknown as Required<TransformV2>;
}

export type ItemKeyframeGroup = 'position' | 'size' | 'rotation' | 'opacity' | 'rotation3d';
type TransformGroup = Exclude<ItemKeyframeGroup, 'opacity' | 'rotation3d'>;
const GROUP_FIELDS: Record<TransformGroup, readonly TransformField[]> = {
    position: ['x', 'y'], size: ['scale', 'scaleX', 'scaleY'], rotation: ['rotate']
};
const groupOf = (field: TransformField): TransformGroup =>
    field === 'x' || field === 'y' ? 'position'
        : field === 'rotate' ? 'rotation' : 'size';
const declares = (point: KeyframeV2, group: ItemKeyframeGroup): boolean => group === 'opacity'
    ? finite(point.opacity)
    : group === 'rotation3d' ? ROTATION_3D_VARS.some(name => finite(point.vars?.[name]))
        : GROUP_FIELDS[group].some(field => finite(point.transform?.[field]));
const groupPoints = (item: Pick<ItemV2, 'keyframes'>, group: ItemKeyframeGroup): KeyframeV2[] =>
    pointsOf(item).filter(point => declares(point, group));
const hasPointValue = (point: KeyframeV2): boolean => Object.entries(point)
    .some(([key, value]) => key !== 't' && key !== 'easing' && value !== undefined);
function legalPointArray(item: ItemV2, points: KeyframeV2[]): KeyframeV2[] | undefined {
    const meaningful = points.filter(hasPointValue).sort((a, b) => a.t - b.t);
    if (!meaningful.length) return undefined;
    if (meaningful.length > 1) return meaningful;
    // The existing file schema requires two array entries. This empty entry has no animated
    // property; every evaluator and diamond list ignores it.
    const t = meaningful[0].t < item.duration ? meaningful[0].t + 1 : meaningful[0].t - 1;
    return [...meaningful, { t }].sort((a, b) => a.t - b.t);
}

export function hasItemKeyframeGroup(item: Pick<ItemV2, 'keyframes'>, group: ItemKeyframeGroup): boolean {
    return groupPoints(item, group).length > 0;
}

export function hasTransformKeyframe(item: Pick<ItemV2, 'keyframes'>, field: TransformField): boolean {
    return hasItemKeyframeGroup(item, groupOf(field));
}

/** The same declared-point/hold/interpolation rule as the transform evaluator. */
export function evaluatedItemOpacity(item: Pick<ItemV2, 'opacity' | 'keyframes' | 'duration'>,
    frame: number): number {
    const points = groupPoints(item, 'opacity');
    const fallback = item.opacity ?? 1;
    if (!points.length) return fallback;
    const at = frameOf(item, frame);
    if (at <= points[0].t) return points[0].opacity!;
    const last = points[points.length - 1];
    if (at >= last.t) return last.opacity!;
    for (let index = 1; index < points.length; index++) {
        const right = points[index], left = points[index - 1];
        if (at > right.t) continue;
        const u = eased(right, 'opacity', (at - left.t) / (right.t - left.t || 1), false);
        return left.opacity! + (right.opacity! - left.opacity!) * u;
    }
    return fallback;
}

function staticRotation3d(item: Pick<ItemV2, 'source'>, name: Rotation3dVar): number {
    const raw = item.source.kind === 'html' ? item.source.vars?.[name] : undefined;
    const value = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
    return Number.isFinite(value) ? value : 0;
}

/** 3D 回転 1 本の、その時刻に見えている値（度）。キーが無ければ source.vars、それも無ければ 0。 */
export function evaluatedItemVar(item: Pick<ItemV2, 'source' | 'keyframes' | 'duration'>,
    frame: number, name: Rotation3dVar): number {
    const fallback = staticRotation3d(item, name);
    const points = pointsOf(item).filter(point => finite(point.vars?.[name]));
    if (!points.length) return fallback;
    const at = frameOf(item, frame);
    if (at <= points[0].t) return points[0].vars![name];
    const last = points[points.length - 1];
    if (at >= last.t) return last.vars![name];
    for (let index = 1; index < points.length; index++) {
        const right = points[index], left = points[index - 1];
        if (at > right.t) continue;
        const u = eased(right, name, (at - left.t) / (right.t - left.t || 1), false);
        return left.vars![name] + (right.vars![name] - left.vars![name]) * u;
    }
    return fallback;
}

function validPatch(patch: TransformV2): void {
    for (const [field, value] of Object.entries(patch)) {
        if (!FIELDS.includes(field as TransformField) || !finite(value)
            || ((field === 'scale' || field === 'scaleX' || field === 'scaleY') && value <= 0)) {
            throw new Error(`Invalid transform.${field}`);
        }
    }
}

function normalizedAxisPatch(current: Required<TransformV2>, patch: TransformV2): TransformV2 {
    if (patch.scale === undefined || patch.scaleX !== undefined || patch.scaleY !== undefined) return patch;
    const previous = Math.sqrt(current.scaleX * current.scaleY);
    const ratio = previous > 0 ? patch.scale / previous : 1;
    return { ...patch, scaleX: current.scaleX * ratio, scaleY: current.scaleY * ratio };
}

type GroupValue = TransformV2 | number | Rotation3dValues;

function valuesAt(item: ItemV2, frame: number, group: ItemKeyframeGroup): GroupValue {
    if (group === 'opacity') return evaluatedItemOpacity(item, frame);
    if (group === 'rotation3d') return Object.fromEntries(ROTATION_3D_VARS
        .map(name => [name, evaluatedItemVar(item, frame, name)])) as Rotation3dValues;
    const pose = evaluatedItemTransform(item, frame);
    if (group === 'position') return { x: pose.x, y: pose.y };
    if (group === 'rotation') return { rotate: pose.rotate };
    if (item.source.kind === 'group') return { scale: pose.scale };
    return { scale: pose.scale, scaleX: pose.scaleX, scaleY: pose.scaleY };
}

/** 静的値の文字列。浮動小数の端数（0.1 + 0.2 等）を 1/1000 度で丸める。 */
const varText = (value: number): string => String(Math.round(value * 1000) / 1000);

function withStaticGroup(item: ItemV2, group: ItemKeyframeGroup, value: GroupValue): ItemV2 {
    if (group === 'opacity') return { ...item, opacity: value as number };
    if (group === 'rotation3d') {
        if (item.source.kind !== 'html') throw new Error('3D の回転は html アイテムにだけ書けます');
        const vars = { ...item.source.vars };
        for (const [name, number] of Object.entries(value as Rotation3dValues)) {
            if (finite(number)) vars[name] = varText(number);
        }
        return { ...item, source: { ...item.source, vars } };
    }
    return { ...item, transform: { ...item.transform, ...(value as TransformV2) } };
}

/** Backfill old sparse points only when this group is written. Values are read before mutation. */
export function normalizeItemKeyframeGroup(item: ItemV2, group: ItemKeyframeGroup): ItemV2 {
    const keyframes = pointsOf(item).map(point => {
        const copy = structuredClone(point);
        if (!declares(point, group)) return copy;
        const value = valuesAt(item, point.t, group);
        if (group === 'opacity') copy.opacity = value as number;
        else if (group === 'rotation3d') copy.vars = { ...copy.vars, ...(value as Rotation3dValues) } as Record<string, number>;
        else copy.transform = { ...copy.transform, ...(value as TransformV2) };
        return copy;
    });
    return keyframes.length ? { ...item, keyframes } : item;
}

function fullMediaPoint(item: ItemV2, point: KeyframeV2): KeyframeV2 {
    if (!point.transform) return { ...point };
    return { ...point, transform: evaluatedItemTransform(item, point.t) };
}

function addGroupPoint(item: ItemV2, frame: number, group: ItemKeyframeGroup,
    value: GroupValue): ItemV2 {
    const at = frameOf(item, frame);
    const normalized = normalizeItemKeyframeGroup(item, group);
    const keyframes = pointsOf(normalized).map(point => isMedia(item) ? fullMediaPoint(normalized, point) : structuredClone(point));
    let seat = keyframes.find(point => point.t === at);
    if (!seat) { seat = { t: at }; keyframes.push(seat); }
    if (group === 'opacity') {
        seat.opacity = value as number;
        if (isMedia(item)) seat.transform = evaluatedItemTransform(item, at);
    }
    else if (group === 'rotation3d') seat.vars = { ...seat.vars, ...(value as Rotation3dValues) } as Record<string, number>;
    else seat.transform = { ...(isMedia(item) ? evaluatedItemTransform(item, at) : seat.transform),
        ...(value as TransformV2) };
    return { ...normalized, keyframes: legalPointArray(item, keyframes) };
}

/** Add one visible-pose point. A lone group point also becomes its static value. */
export function activateItemKeyframeGroup(item: ItemV2, frame: number, group: ItemKeyframeGroup): ItemV2 {
    const at = frameOf(item, frame);
    const hadGroup = hasItemKeyframeGroup(item, group);
    const value = valuesAt(item, at, group);
    if (groupPoints(item, group).some(point => point.t === at)) return normalizeItemKeyframeGroup(item, group);
    const updated = addGroupPoint(item, at, group, value);
    return hadGroup ? updated : withStaticGroup(updated, group, value);
}

/** Item-wide diamond: all four groups share one playhead point and one item result.
 * A 3D item adds its rotation3d group to the same point. */
export function activateItemKeyframe(item: ItemV2, frame: number): ItemV2 {
    const groups: ItemKeyframeGroup[] = ['position', 'size', 'rotation', 'opacity'];
    if (isScene3dItem(item)) groups.push('rotation3d');
    return groups.reduce((current, group) => activateItemKeyframeGroup(current, frame, group), item);
}

export function activateItemTransformKeyframe(item: ItemV2, frame: number, field: TransformField): ItemV2 {
    return activateItemKeyframeGroup(item, frame, groupOf(field));
}

function patchedGroupValue(item: ItemV2, frame: number, group: TransformGroup,
    patch: TransformV2): TransformV2 {
    const current = evaluatedItemTransform(item, frame);
    if (group === 'position') return { x: patch.x ?? current.x, y: patch.y ?? current.y };
    if (group === 'rotation') return { rotate: patch.rotate ?? current.rotate };
    if (item.source.kind === 'group') {
        const scale = patch.scaleX !== undefined || patch.scaleY !== undefined
            ? Math.sqrt((patch.scaleX ?? patch.scale ?? current.scale)
                * (patch.scaleY ?? patch.scale ?? current.scale))
            : patch.scale ?? current.scale;
        return { scale };
    }
    const adjusted = normalizedAxisPatch(current, patch);
    const scaleX = adjusted.scaleX ?? current.scaleX, scaleY = adjusted.scaleY ?? current.scaleY;
    return { scale: Math.sqrt(scaleX * scaleY), scaleX, scaleY };
}

function writeGroup(item: ItemV2, frame: number, group: TransformGroup,
    patch: TransformV2): ItemV2 {
    const value = patchedGroupValue(item, frame, group, patch);
    if (!hasItemKeyframeGroup(item, group)) return withStaticGroup(item, group, value);
    const initialPoint = groupPoints(item, group)[0];
    const updated = addGroupPoint(item, frame, group, value);
    return groupPoints(item, group).length === 1
        ? withStaticGroup(updated, group, valuesAt(updated, initialPoint.t, group)) : updated;
}

/** A gesture returns one updated item; every animated group auto-keys at the playhead. */
export function writeItemTransformAt(item: ItemV2, frame: number, input: TransformV2): ItemV2 {
    validPatch(input);
    return [...new Set(Object.keys(input).map(field => groupOf(field as TransformField)))].reduce(
        (current, group) => writeGroup(current, frame, group, input), item);
}

/** 3D 回転の書き込み（gizmo・インスペクタ共通）。グループにキーがあれば再生ヘッドに自動キー、無ければ静的値。 */
export function writeItemVarsAt(item: ItemV2, frame: number, values: Rotation3dValues): ItemV2 {
    for (const [name, value] of Object.entries(values)) {
        if (!isRotation3dVar(name) || !finite(value)) throw new Error(`Invalid vars.${name}`);
    }
    if (!hasItemKeyframeGroup(item, 'rotation3d')) return withStaticGroup(item, 'rotation3d', values);
    const initialPoint = groupPoints(item, 'rotation3d')[0];
    const merged = { ...(valuesAt(item, frame, 'rotation3d') as Rotation3dValues), ...values };
    const updated = addGroupPoint(item, frame, 'rotation3d', merged);
    return groupPoints(item, 'rotation3d').length === 1
        ? withStaticGroup(updated, 'rotation3d', valuesAt(updated, initialPoint.t, 'rotation3d')) : updated;
}

export function writeItemOpacityAt(item: ItemV2, frame: number, opacity: number): ItemV2 {
    if (!finite(opacity) || opacity < 0 || opacity > 1) throw new Error('Invalid opacity');
    if (!hasItemKeyframeGroup(item, 'opacity')) return withStaticGroup(item, 'opacity', opacity);
    const initialPoint = groupPoints(item, 'opacity')[0];
    const updated = addGroupPoint(item, frame, 'opacity', opacity);
    return groupPoints(item, 'opacity').length === 1
        ? withStaticGroup(updated, 'opacity', valuesAt(updated, initialPoint.t, 'opacity')) : updated;
}

/** Removing the last group point freezes the pose visible immediately before deletion. */
export function removeItemKeyframeGroup(item: ItemV2, frame: number, group: ItemKeyframeGroup): ItemV2 {
    const at = frameOf(item, frame);
    if (!groupPoints(item, group).some(point => point.t === at)) return item;
    const before = valuesAt(item, at, group);
    const normalized = normalizeItemKeyframeGroup(item, group);
    const keyframes = pointsOf(normalized).map(point => {
        const copy = structuredClone(point);
        if (copy.t !== at) return copy;
        if (group === 'opacity') delete copy.opacity;
        else if (group === 'rotation3d') {
            if (copy.vars) {
                for (const name of ROTATION_3D_VARS) delete copy.vars[name];
                if (!Object.keys(copy.vars).length) delete copy.vars;
            }
        }
        else if (copy.transform) {
            for (const field of GROUP_FIELDS[group]) delete copy.transform[field];
            if (!Object.keys(copy.transform).length) delete copy.transform;
        }
        return copy;
    }).filter(point => point.transform || point.opacity !== undefined || point.crop || point.perspective
        || point.animator || point.gain_db !== undefined || (point.vars && Object.keys(point.vars).length));
    let updated: ItemV2 = { ...normalized, keyframes: legalPointArray(item, keyframes) };
    const remaining = groupPoints(updated, group);
    if (!remaining.length) updated = withStaticGroup(updated, group, before);
    else if (remaining.length === 1) updated = withStaticGroup(updated, group,
        valuesAt(normalized, remaining[0].t, group));
    return updated;
}

/** Timeline point deletion is deliberately whole-point, independent of the selected row. */
export function removeItemKeyframePoint(item: ItemV2, frame: number): ItemV2 {
    const at = frameOf(item, frame);
    const point = pointsOf(item).find(entry => entry.t === at);
    if (!point) return item;
    const values = (['position', 'size', 'rotation', 'opacity', 'rotation3d'] as const)
        .filter(group => declares(point, group)).map(group => [group, valuesAt(item, at, group)] as const);
    const keyframes = pointsOf(item).filter(entry => entry.t !== at).map(entry => structuredClone(entry));
    let updated: ItemV2 = { ...item, keyframes: legalPointArray(item, keyframes) };
    for (const [group, value] of values) if (!hasItemKeyframeGroup(updated, group)) {
        updated = withStaticGroup(updated, group, value);
    }
    return updated;
}

export function moveItemKeyframeGroup(item: ItemV2, fromFrame: number, toFrame: number,
    group: ItemKeyframeGroup): ItemV2 {
    const from = frameOf(item, fromFrame), to = frameOf(item, toFrame);
    if (from === to) return item;
    const point = groupPoints(item, group).find(entry => entry.t === from);
    if (!point) return item;
    const value = valuesAt(item, from, group);
    const removed = removeItemKeyframeGroup(item, from, group);
    return addGroupPoint(removed, to, group, value);
}
