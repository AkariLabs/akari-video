/** Ink colors are content colors chosen by the author, not theme colors. */
export const INK_PALETTE = ['#f97316', '#2563eb', '#dc2626', '#16a34a', '#111827'] as const;
export const INK_MAX_POINTS = 100;

export type InkPoint = [number, number];
export interface InkAspect { w: number; h: number }
export interface InkBox { x: number; y: number; w: number; h: number }
export interface InkBase {
    id: string;
    color: string;
    x: number;
    y: number;
    recT?: InkPoint;
    anchor?: { object: string; [key: string]: unknown };
    /** Original annotation, including unrecognized fields, for lossless round trips. */
    unknown?: Record<string, unknown>;
}
export interface InkPen extends InkBase { type: 'pen'; points: InkPoint[]; strokeWidth: number; box?: InkBox; around?: string | null }
export interface InkArrow extends InkBase { type: 'arrow'; from: InkPoint; to: InkPoint; strokeWidth: number; pointsTo?: string | null }
export interface InkText extends InkBase { type: 'text'; at: InkPoint; text: string; textHeight: number; over?: string | null }
export type InkObject = InkPen | InkArrow | InkText;
export interface InkDocument { schema: 'akari.ink.v0'; space: 'canvas-rect'; aspect: InkAspect; objects: InkObject[]; nextId?: number }
export interface FrameSceneAnnotation { id: string; type: string; x?: number; y?: number; color?: string; text?: string; frame?: Record<string, unknown>; anchor?: { object: string; [key: string]: unknown }; [key: string]: unknown }
export interface InkTarget { ref: string; box: InkBox }
export interface InkStroke { tool: 'pen'; space: 'canvas-rect'; points: InkPoint[] }

const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const point = (value: unknown, fallback: InkPoint): InkPoint =>
    Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number'
        ? [value[0], value[1]] : [...fallback];
const finite = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const frameOf = (raw: FrameSceneAnnotation): Record<string, unknown> => raw.frame && typeof raw.frame === 'object' ? raw.frame : {};
const present = (record: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

export function nextId(doc: InkDocument): string {
    const used = new Set(doc.objects.map(obj => obj.id));
    let index = Math.max(1, doc.nextId ?? 1);
    for (const obj of doc.objects) {
        const match = /^ink-(\d+)$/.exec(obj.id);
        if (match) index = Math.max(index, Number(match[1]) + 1);
    }
    while (used.has(`ink-${index}`)) index += 1;
    return `ink-${index}`;
}

export function addObject(doc: InkDocument, object: InkObject): InkDocument {
    const added = copy(object);
    const match = /^ink-(\d+)$/.exec(added.id);
    return { ...doc, objects: [...doc.objects, added], nextId: Math.max(doc.nextId ?? 1, match ? Number(match[1]) + 1 : 1) };
}

function translate(obj: InkObject, dx: number, dy: number): InkObject {
    const points = obj.type === 'pen' ? obj.points : obj.type === 'arrow' ? [obj.from, obj.to] : [obj.at];
    const bounds = boundingBox(obj);
    const limitedDx = Math.max(-bounds.x, Math.min(1 - bounds.x - bounds.w, dx));
    const limitedDy = Math.max(-bounds.y, Math.min(1 - bounds.y - bounds.h, dy));
    const move = ([x, y]: InkPoint): InkPoint => [clamp(x + limitedDx), clamp(y + limitedDy)];
    const first = move(points[0] ?? [obj.x, obj.y]);
    if (obj.type === 'pen') return { ...obj, x: first[0], y: first[1], points: obj.points.map(move), box: obj.box ? boundingBox({ ...obj, points: obj.points.map(move) }) : undefined };
    if (obj.type === 'arrow') return { ...obj, x: first[0], y: first[1], from: move(obj.from), to: move(obj.to) };
    return { ...obj, x: first[0], y: first[1], at: move(obj.at) };
}

export function moveObject(doc: InkDocument, id: string, dx: number, dy: number): InkDocument {
    return { ...doc, objects: doc.objects.map(obj => obj.id === id ? translate(obj, dx, dy) : obj) };
}
export function deleteObject(doc: InkDocument, id: string): InkDocument {
    return { ...doc, objects: doc.objects.filter(obj => obj.id !== id) };
}
export function duplicateObject(doc: InkDocument, id: string): InkDocument {
    const source = doc.objects.find(obj => obj.id === id);
    if (!source) return { ...doc, objects: [...doc.objects] };
    const newId = nextId(doc);
    const duplicate = translate({ ...copy(source), id: newId }, 0.02, 0.02);
    return addObject(doc, duplicate);
}
export function setColor(doc: InkDocument, id: string, color: string): InkDocument {
    return { ...doc, objects: doc.objects.map(obj => obj.id === id ? { ...obj, color } : obj) };
}
export function setText(doc: InkDocument, id: string, text: string): InkDocument {
    return { ...doc, objects: doc.objects.map(obj => obj.id === id && obj.type === 'text' ? { ...obj, text } : obj) };
}

/** Match the existing image annotation's rounded uniform sampling. */
export function decimatePoints(points: InkPoint[], max = INK_MAX_POINTS): InkPoint[] {
    if (max < 2 || points.length <= max) return points.map(p => [...p]);
    const result: InkPoint[] = [];
    const last = points.length - 1;
    for (let index = 0; index < max; index += 1) result.push([...points[Math.round(index * last / (max - 1))]]);
    return result;
}

export function boundingBox(obj: InkObject): InkBox {
    if (obj.type === 'text') {
        const lines = obj.text.split('\n');
        return { x: obj.at[0], y: obj.at[1] - obj.textHeight, w: Math.max(...lines.map(line => [...line].length), 0) * obj.textHeight * 0.6, h: obj.textHeight * lines.length };
    }
    const points = obj.type === 'pen' ? obj.points : [obj.from, obj.to];
    if (!points.length) return { x: obj.x, y: obj.y, w: 0, h: 0 };
    const xs = points.map(p => p[0]); const ys = points.map(p => p[1]);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const distance = (p: InkPoint, a: InkPoint, b: InkPoint, ratio: number): number => {
    const dx = (b[0] - a[0]) * ratio; const dy = b[1] - a[1];
    const t = dx * dx + dy * dy ? Math.max(0, Math.min(1, (((p[0] - a[0]) * ratio) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot((p[0] - a[0]) * ratio - t * dx, p[1] - a[1] - t * dy);
};
export function arrowHead(obj: InkArrow, aspect: InkAspect): [InkPoint, InkPoint] {
    const ratio = aspect.w / aspect.h;
    const dx = (obj.to[0] - obj.from[0]) * ratio; const dy = obj.to[1] - obj.from[1];
    const len = Math.hypot(dx, dy) || 1; const ux = dx / len; const uy = dy / len;
    const size = Math.max(obj.strokeWidth * 4, 0.02);
    return [
        [obj.to[0] - (ux * 0.8 - uy * 0.6) * size / ratio, obj.to[1] - (uy * 0.8 + ux * 0.6) * size],
        [obj.to[0] - (ux * 0.8 + uy * 0.6) * size / ratio, obj.to[1] - (uy * 0.8 - ux * 0.6) * size]
    ];
}
export function hitTest(doc: InkDocument, p: InkPoint, tolerance: number): string | null {
    const ratio = doc.aspect.w / doc.aspect.h;
    for (const obj of [...doc.objects].reverse()) {
        if (obj.type === 'text') {
            const box = boundingBox(obj);
            if (p[0] >= box.x - tolerance / ratio && p[0] <= box.x + box.w + tolerance / ratio && p[1] >= box.y - tolerance && p[1] <= box.y + box.h + tolerance) return obj.id;
            continue;
        }
        const points = obj.type === 'pen' ? obj.points : [obj.from, obj.to];
        const segments: Array<[InkPoint, InkPoint]> = [];
        for (let i = 1; i < points.length; i += 1) segments.push([points[i - 1], points[i]]);
        if (obj.type === 'arrow') for (const end of arrowHead(obj, doc.aspect)) segments.push([obj.to, end]);
        if (segments.some(([a, b]) => distance(p, a, b, ratio) <= tolerance + obj.strokeWidth / 2)) return obj.id;
    }
    return null;
}

const contains = (box: InkBox, p: InkPoint): boolean => p[0] >= box.x && p[0] <= box.x + box.w && p[1] >= box.y && p[1] <= box.y + box.h;
const area = (box: InkBox): number => box.w * box.h;
const overlap = (a: InkBox, b: InkBox): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
export function deriveTargets(doc: InkDocument, targets: InkTarget[]): InkDocument {
    return { ...doc, objects: doc.objects.map(obj => {
        if (obj.type === 'pen') {
            const box = boundingBox(obj);
            const ranked = targets.map(target => ({ target, score: overlap(box, target.box) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
            return { ...obj, box, around: ranked[0]?.target.ref ?? null };
        }
        if (obj.type === 'arrow') {
            const tip: InkPoint = [obj.to[0] + (obj.to[0] - obj.from[0]) * 0.1, obj.to[1] + (obj.to[1] - obj.from[1]) * 0.1];
            const match = targets.filter(target => contains(target.box, obj.to) || contains(target.box, tip)).sort((a, b) => area(a.box) - area(b.box))[0];
            return { ...obj, pointsTo: match?.ref ?? null };
        }
        const match = targets.filter(target => contains(target.box, obj.at)).sort((a, b) => area(a.box) - area(b.box))[0];
        return { ...obj, over: match?.ref ?? null };
    }) };
}

export function fromAnnotation(raw: FrameSceneAnnotation): InkObject {
    const frame = frameOf(raw);
    const fallback: InkPoint = [finite(raw.x, 0), finite(raw.y, 0)];
    const base = { id: raw.id, color: raw.color ?? INK_PALETTE[0], x: fallback[0], y: fallback[1], recT: Array.isArray(frame.recT) ? point(frame.recT, [0, 0]) : undefined, anchor: copy(raw.anchor), unknown: copy(raw) };
    if (raw.type === 'arrow') {
        const from = point(frame.from, fallback);
        return { ...base, type: 'arrow', from, to: point(frame.to, from), strokeWidth: finite(frame.strokeWidth, 0.008), pointsTo: frame.pointsTo as string | null | undefined };
    }
    if (raw.type === 'text') {
        const at = point(frame.at, fallback);
        return { ...base, type: 'text', at, text: raw.text ?? '', textHeight: finite(frame.textHeight, 0.045), over: frame.over as string | null | undefined };
    }
    const points = Array.isArray(frame.points) ? frame.points.map(value => point(value, fallback)) : [];
    return { ...base, type: 'pen', points, strokeWidth: finite(frame.strokeWidth, 0.008), box: copy(frame.box as InkBox | undefined), around: frame.around as string | null | undefined };
}

export function toAnnotation(obj: InkObject): FrameSceneAnnotation {
    const original = obj.unknown ? copy(obj.unknown) as FrameSceneAnnotation : null;
    const raw: FrameSceneAnnotation = original ?? { id: obj.id, type: obj.type };
    raw.id = obj.id; raw.type = obj.type;
    if (!original || present(raw, 'color') || obj.color !== INK_PALETTE[0]) raw.color = obj.color;
    if (!original || present(raw, 'x') || obj.x !== 0) raw.x = obj.x;
    if (!original || present(raw, 'y') || obj.y !== 0) raw.y = obj.y;
    if (obj.anchor !== undefined) raw.anchor = copy(obj.anchor);
    const frame = raw.frame ? copy(raw.frame) : {};
    const write = (key: string, value: unknown): void => { if (!original || present(frame, key)) frame[key] = copy(value); };
    if (obj.type === 'pen') {
        write('points', obj.points); write('strokeWidth', obj.strokeWidth);
        if (obj.box !== undefined || !original) frame.box = copy(obj.box ?? boundingBox(obj));
        if (obj.around !== undefined || !original) frame.around = obj.around ?? null;
    } else if (obj.type === 'arrow') {
        write('from', obj.from); write('to', obj.to); write('strokeWidth', obj.strokeWidth);
        if (obj.pointsTo !== undefined || !original) frame.pointsTo = obj.pointsTo ?? null;
    } else {
        write('at', obj.at); write('textHeight', obj.textHeight);
        if (!original || present(raw, 'text')) raw.text = obj.text;
        if (obj.over !== undefined || !original) frame.over = obj.over ?? null;
    }
    if (obj.recT !== undefined) frame.recT = copy(obj.recT);
    if (!original || raw.frame) raw.frame = frame;
    return raw;
}
export function inkToAnnotations(doc: InkDocument): FrameSceneAnnotation[] { return doc.objects.map(toAnnotation); }
export function annotationsToInk(list: FrameSceneAnnotation[], { aspect }: { aspect: InkAspect }): InkDocument {
    return { schema: 'akari.ink.v0', space: 'canvas-rect', aspect: copy(aspect), objects: list.map(fromAnnotation) };
}
export function strokesFromInk(doc: InkDocument): InkStroke[] {
    return doc.objects.filter((obj): obj is InkPen => obj.type === 'pen').map(obj => ({ tool: 'pen', space: 'canvas-rect', points: decimatePoints(obj.points) }));
}
export function inkFromStrokes(strokes: Array<{ tool?: string; points?: InkPoint[] }>, aspect: InkAspect = { w: 1920, h: 1080 }): InkDocument {
    let doc: InkDocument = { schema: 'akari.ink.v0', space: 'canvas-rect', aspect: copy(aspect), objects: [] };
    for (const stroke of strokes) {
        if (stroke.tool !== 'pen' || !Array.isArray(stroke.points) || stroke.points.length < 2) continue;
        const points = decimatePoints(stroke.points);
        doc = addObject(doc, { id: nextId(doc), type: 'pen', color: INK_PALETTE[0], x: points[0][0], y: points[0][1], points, strokeWidth: 0.008 });
    }
    return doc;
}

export function validateInk(doc: unknown): { errors: string[]; warnings: string[] } {
    const errors: string[] = []; const warnings: string[] = [];
    if (!doc || typeof doc !== 'object') return { errors: ['document must be an object'], warnings };
    const value = doc as Partial<InkDocument>;
    if (value.schema !== 'akari.ink.v0') errors.push('schema must be akari.ink.v0');
    if (value.space !== 'canvas-rect') errors.push('space must be canvas-rect');
    if (!value.aspect || !Number.isFinite(value.aspect.w) || !Number.isFinite(value.aspect.h) || value.aspect.w <= 0 || value.aspect.h <= 0) errors.push('aspect must have positive w and h');
    if (!Array.isArray(value.objects)) return { errors: [...errors, 'objects must be an array'], warnings };
    const ids = new Set<string>();
    const checkPoint = (p: unknown, path: string): void => {
        if (!Array.isArray(p) || p.length < 2 || p.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) errors.push(`${path} must be within 0..1`);
    };
    value.objects.forEach((obj, index) => {
        if (!obj || typeof obj !== 'object') { errors.push(`objects[${index}] must be an object`); return; }
        if (typeof obj.id !== 'string' || !obj.id) errors.push(`objects[${index}].id is required`);
        if (ids.has(obj.id)) errors.push(`duplicate id ${obj.id}`); ids.add(obj.id);
        checkPoint([obj.x, obj.y], `${obj.id}.x/y`);
        if (obj.type === 'pen') {
            if (!Array.isArray(obj.points) || obj.points.length < 2) warnings.push(`${obj.id}: pen needs at least 2 points`);
            if (Array.isArray(obj.points) && obj.points.length > INK_MAX_POINTS) warnings.push(`${obj.id}: point limit exceeded`);
            for (const [i, p] of (Array.isArray(obj.points) ? obj.points : []).entries()) checkPoint(p, `${obj.id}.points[${i}]`);
        } else if (obj.type === 'arrow') { checkPoint(obj.from, `${obj.id}.from`); checkPoint(obj.to, `${obj.id}.to`); }
        else if (obj.type === 'text') checkPoint(obj.at, `${obj.id}.at`);
        else warnings.push(`objects[${index}]: unknown type`);
    });
    return { errors, warnings };
}
