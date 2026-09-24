export type Point = [number, number];
export type PathSegment = { t: 'L'; p: Point } | { t: 'C'; c1: Point; c2: Point; p: Point };
export interface Subpath {
    start: Point;
    segs: PathSegment[];
    closed: boolean;
}

const numberToken = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const tokenPattern = new RegExp(`[MLCZ]|${numberToken}`, 'gu');
const numberPattern = new RegExp(`^${numberToken}$`, 'u');
const f = (v: number): number => +v.toFixed(3);
const point = (p: Point): string => `${f(p[0])} ${f(p[1])}`;

/** Rejects unsupported or relative SVG commands instead of silently changing a copied path. */
export function parseShapePath(d: string): Subpath[] {
    if (!d || d.length > 100000) throw new Error('shape path is empty or too long');
    const tokens = d.match(tokenPattern) ?? [];
    if (d.replace(tokenPattern, '').replace(/[\s,]/gu, '') !== '') {
        throw new Error('unsupported shape path command');
    }
    const subs: Subpath[] = [];
    let i = 0;
    let sub: Subpath | undefined;
    const number = (): number => {
        const token = tokens[i++];
        if (!token || !numberPattern.test(token)) throw new Error('invalid shape path coordinate');
        const value = Number(token);
        if (!Number.isFinite(value)) throw new Error('non-finite shape path coordinate');
        return value;
    };
    while (i < tokens.length) {
        const command = tokens[i++];
        if (command === 'M') {
            sub = { start: [number(), number()], segs: [], closed: false };
            subs.push(sub);
        } else if (command === 'L' && sub && !sub.closed) sub.segs.push({ t: 'L', p: [number(), number()] });
        else if (command === 'C' && sub && !sub.closed) {
            sub.segs.push({
                t: 'C',
                c1: [number(), number()],
                c2: [number(), number()],
                p: [number(), number()],
            });
        } else if (command === 'Z' && sub && !sub.closed) {
            sub.closed = true;
            const last = sub.segs.length ? sub.segs[sub.segs.length - 1].p : sub.start;
            if (Math.hypot(last[0] - sub.start[0], last[1] - sub.start[1]) > 1e-6) {
                sub.segs.push({ t: 'L', p: [...sub.start] });
            }
        } else throw new Error('invalid shape path structure');
    }
    if (!subs.length || subs.some((s) => !s.segs.length)) throw new Error('shape path has no segments');
    return subs;
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}
function cubicExtrema(a: number, b: number, c: number, d: number): number[] {
    const A = -a + 3 * b - 3 * c + d;
    const B = 2 * (a - 2 * b + c);
    const C = b - a;
    if (Math.abs(A) < 1e-12) return Math.abs(B) < 1e-12 ? [] : [-C / B].filter((t) => t > 0 && t < 1);
    const discriminant = B * B - 4 * A * C;
    if (discriminant < 0) return [];
    return [(-B + Math.sqrt(discriminant)) / (2 * A), (-B - Math.sqrt(discriminant)) / (2 * A)].filter((t) =>
        t > 0 && t < 1
    );
}
export function shapePathBounds(subs: Subpath[]): { x: number; y: number; width: number; height: number } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (p: Point): void => {
        x0 = Math.min(x0, p[0]);
        y0 = Math.min(y0, p[1]);
        x1 = Math.max(x1, p[0]);
        y1 = Math.max(y1, p[1]);
    };
    for (const sub of subs) {
        let prev = sub.start;
        add(prev);
        for (const seg of sub.segs) {
            add(seg.p);
            if (seg.t === 'C') {
                for (let axis = 0; axis < 2; axis++) {
                    for (const t of cubicExtrema(prev[axis], seg.c1[axis], seg.c2[axis], seg.p[axis])) {
                        const p: Point = [...prev] as Point;
                        p[axis] = cubic(prev[axis], seg.c1[axis], seg.c2[axis], seg.p[axis], t);
                        add(p);
                    }
                }
            }
            prev = seg.p;
        }
    }
    return { x: x0, y: y0, width: Math.max(1e-6, x1 - x0), height: Math.max(1e-6, y1 - y0) };
}
export function serializeShapePath(subs: Subpath[]): string {
    return subs.map((s) =>
        `M${point(s.start)}` + s.segs.map((g) =>
            g.t === 'L' ? `L${point(g.p)}` : `C${point(g.c1)} ${point(g.c2)} ${point(g.p)}`
        ).join('') + (s.closed ? 'Z' : '')
    ).join('');
}
export function fitShapePath(d: string, width: number, height: number): Subpath[] {
    const subs = parseShapePath(d);
    const b = shapePathBounds(subs);
    const map = (p: Point): Point => [(p[0] - b.x) * width / b.width, (p[1] - b.y) * height / b.height];
    return subs.map((s) => ({
        start: map(s.start),
        closed: s.closed,
        segs: s.segs.map((g) =>
            g.t === 'L'
                ? { t: 'L' as const, p: map(g.p) }
                : { t: 'C' as const, c1: map(g.c1), c2: map(g.c2), p: map(g.p) }
        ),
    }));
}

export function scaleShapePath(subs: Subpath[], x: number, y: number): Subpath[] {
    const map = (p: Point): Point => [p[0] * x, p[1] * y];
    return subs.map((s) => ({
        start: map(s.start),
        closed: s.closed,
        segs: s.segs.map((g) =>
            g.t === 'L'
                ? { t: 'L' as const, p: map(g.p) }
                : { t: 'C' as const, c1: map(g.c1), c2: map(g.c2), p: map(g.p) }
        ),
    }));
}

export function roundShapePath(subs: Subpath[], radius: number): Subpath[] {
    if (radius <= 0) return subs;
    return subs.map((sub) => {
        if (!sub.closed || sub.segs.length < 3) return sub;
        const n = sub.segs.length;
        const corners = sub.segs.map((out, i) => {
            const incoming = sub.segs[(i - 1 + n) % n];
            if (incoming.t !== 'L' || out.t !== 'L') return null;
            const vertex = i === 0 ? sub.start : sub.segs[i - 1].p;
            const before = i === 0
                ? (n > 1 ? sub.segs[n - 2].p : sub.start)
                : (i > 1 ? sub.segs[i - 2].p : sub.start);
            const after = out.p;
            const l1 = Math.hypot(vertex[0] - before[0], vertex[1] - before[1]);
            const l2 = Math.hypot(after[0] - vertex[0], after[1] - vertex[1]);
            if (!l1 || !l2) return null;
            const u1: Point = [(vertex[0] - before[0]) / l1, (vertex[1] - before[1]) / l1];
            const u2: Point = [(after[0] - vertex[0]) / l2, (after[1] - vertex[1]) / l2];
            if (Math.abs(u1[0] * u2[1] - u1[1] * u2[0]) < .02 && u1[0] * u2[0] + u1[1] * u2[1] > 0) {
                return null;
            }
            const r = Math.min(radius, l1 / 2, l2 / 2);
            if (r < .01) return null;
            return {
                vertex,
                a: [vertex[0] - u1[0] * r, vertex[1] - u1[1] * r] as Point,
                b: [vertex[0] + u2[0] * r, vertex[1] + u2[1] * r] as Point,
            };
        });
        const result: Subpath = { start: corners[0]?.b ?? sub.start, segs: [], closed: true };
        for (let i = 0; i < n; i++) {
            const segment = sub.segs[i];
            const next = corners[(i + 1) % n];
            result.segs.push(segment.t === 'L' ? { t: 'L', p: next?.a ?? segment.p } : segment);
            if (next) {
                const K = .5523;
                result.segs.push({
                    t: 'C',
                    c1: [
                        next.a[0] + (next.vertex[0] - next.a[0]) * K,
                        next.a[1] + (next.vertex[1] - next.a[1]) * K,
                    ],
                    c2: [
                        next.b[0] + (next.vertex[0] - next.b[0]) * K,
                        next.b[1] + (next.vertex[1] - next.b[1]) * K,
                    ],
                    p: next.b,
                });
            }
        }
        return result;
    });
}

export function hasShapeCorners(d: string): boolean {
    const subs = parseShapePath(d);
    const bounds = shapePathBounds(subs);
    const radius = Math.min(bounds.width, bounds.height) / 4;
    return serializeShapePath(roundShapePath(subs, radius)) !== serializeShapePath(subs);
}
