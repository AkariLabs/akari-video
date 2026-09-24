/** Geometry is computed in placed pixels and contains no shared mutable state. */
export interface BubbleParams {
    style: 'ellipse' | 'rounded' | 'rect' | 'jagged' | 'burst' | 'cloud' | 'wobble';
    count: number;
    depth: number;
    jitter: number;
    seed: number;
    tail: 'point' | 'dots' | 'none';
    tailAngle: number;
    tailLength: number;
    tailWidth: number;
    tailCurve: number;
}

type Point = [number, number];
type EllipseSample = [number, number, number, number];
type InternalStyle = 'ellipse' | 'round' | 'rect' | 'spike' | 'burst' | 'cloud' | 'wave';
type InternalBubbleParams = Omit<BubbleParams, 'style'> & { style: InternalStyle };

interface BubbleGeometry {
    subs: Point[][];
    tip: Point | null;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

function seededRandom(seed: number): () => number {
    let a = (((seed | 0) * 2654435761) ^ 0x9e3779b9) >>> 0;
    return () => {
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
} // mulberry32（同じ seed なら毎回同じ形）
// 楕円を弧長で等分して引く表: at(s) = [x, y, 外向きの法線 x, y]（s = 0〜1・上から時計回り）
function ellipsePerimeter(A: number, B: number): { at: (s: number) => EllipseSample; L: number } {
    const M = 1440;
    const raw: Array<[number, number, number]> = [];
    const cum: number[] = [0];
    for (let i = 0; i <= M; i++) {
        const t = i / M * 2 * Math.PI;
        raw.push([A * Math.sin(t), -B * Math.cos(t), t]);
        if (i) {
            cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
        }
    }
    const L = cum[M];
    const at = (s: number): EllipseSample => {
        s = ((s % 1) + 1) % 1;
        const tg = s * L;
        let lo = 0;
        let hi = M;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] <= tg) lo = mid;
            else hi = mid;
        }
        const f = (tg - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
        const t = raw[lo][2] + (raw[hi][2] - raw[lo][2]) * f;
        const x = A * Math.sin(t);
        const y = -B * Math.cos(t);
        const nx = x / (A * A);
        const ny = y / (B * B);
        const nl = Math.hypot(nx, ny) || 1;
        return [x, y, nx / nl, ny / nl];
    };
    return { at, L };
}
// 外形の箱をぴったり 2A × 2B・中心 = 原点に当て直す
function normalizeBody(P: Point[], A: number, B: number): Point[] {
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    P.forEach(([x, y]) => {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
    });
    const sx = 2 * A / ((x1 - x0) || 1);
    const sy = 2 * B / ((y1 - y0) || 1);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return P.map(([x, y]) => [(x - cx) * sx, (y - cy) * sy]);
}
// 本体の外周 = 密な点列（上から時計回り）
function bodyPoints(A: number, B: number, p: InternalBubbleParams): Point[] {
    const st = p.style;
    const rnd = seededRandom(p.seed || 0);
    const jit = (p.jitter || 0) / 100;
    const dep = (p.depth || 0) / 100;
    const m = Math.min(A, B);
    const P: Point[] = [];
    if (st === 'rect' || st === 'round') {
        const r = st === 'round' ? m * .35 : 0;
        const step = Math.max(1, (A + B) / 60);
        const line = (x0: number, y0: number, x1: number, y1: number): void => {
            const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
            for (let i = 0; i < k; i++) P.push([x0 + (x1 - x0) * i / k, y0 + (y1 - y0) * i / k]);
        };
        const arc = (cx: number, cy: number, a0: number): void => {
            if (!r) return;
            for (let i = 0; i < 12; i++) {
                const a = (a0 + 90 * i / 12) * Math.PI / 180;
                P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
        };
        line(0, -B, A - r, -B);
        arc(A - r, -B + r, -90);
        line(A, -B + r, A, B - r);
        arc(A - r, B - r, 0);
        line(A - r, B, -A + r, B);
        arc(-A + r, B - r, 90);
        line(-A, B - r, -A, -B + r);
        arc(-A + r, -B + r, 180);
        line(-A + r, -B, 0, -B);
        return P;
    }
    const E = ellipsePerimeter(A, B);
    const n = Math.max(3, Math.round(p.count || 12));
    if (st === 'spike' || st === 'burst') {
        const bu = st === 'burst';
        const dp = dep * m * (bu ? .8 : .5);
        const pts: Point[] = [];
        const o0 = .5 / n * .37; // 真上をトゲの先にしない（少しずらす）
        for (let i = 0; i < n; i++) {
            const s1 = (i + (rnd() - .5) * jit * (bu ? .6 : .4)) / n + o0;
            const s2 = (i + .5 + (rnd() - .5) * jit * (bu ? .36 : .3)) / n + o0;
            const t = E.at(s1);
            const pull = dp * rnd() * jit * (bu ? .9 : .45);
            pts.push([t[0] - t[2] * pull, t[1] - t[3] * pull]);
            const v = E.at(s2);
            const dv = dp * (1 - rnd() * jit * (bu ? .45 : .3));
            pts.push([v[0] - v[2] * dv, v[1] - v[3] * dv]);
        }
        pts.forEach((a, i) => {
            const b = pts[(i + 1) % pts.length];
            for (let j = 0; j < 6; j++) {
                P.push([a[0] + (b[0] - a[0]) * j / 6, a[1] + (b[1] - a[1]) * j / 6]);
            }
        });
        return normalizeBody(P, A, B);
    }
    if (st === 'cloud') {
        const bf = .35 + .6 * dep;
        const h0 = E.L / n / 2 * bf * .9;
        const V: Point[] = [];
        const TAU = 2 * Math.PI;
        const nm = (x: number): number => ((x % TAU) + TAU) % TAU;
        for (let i = 0; i < n; i++) {
            const q = E.at((i + (rnd() - .5) * jit * .5) / n);
            V.push([q[0] - q[2] * h0, q[1] - q[3] * h0]);
        }
        for (let i = 0; i < n; i++) {
            const a = V[i];
            const b = V[(i + 1) % n];
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const c = Math.hypot(dx, dy) || 1;
            const no: Point = [dy / c, -dx / c];
            const h = Math.max(.5, Math.min(c / 2 * .95, c / 2 * bf * (1 + (rnd() - .5) * jit * .7)));
            const R = (c * c / 4 + h * h) / (2 * h);
            const mx = (a[0] + b[0]) / 2;
            const my = (a[1] + b[1]) / 2;
            const cx = mx - no[0] * (R - h);
            const cy = my - no[1] * (R - h);
            const a0 = Math.atan2(a[1] - cy, a[0] - cx);
            const a1 = Math.atan2(b[1] - cy, b[0] - cx);
            const ap = Math.atan2(my + no[1] * h - cy, mx + no[0] * h - cx);
            const d1 = nm(ap - a0);
            const d2 = nm(a1 - a0);
            const sw = d1 < d2 ? d2 : d2 - TAU;
            const k = Math.max(8, Math.ceil(Math.abs(sw) * R / 2));
            for (let j = 0; j < k; j++) {
                const q = a0 + sw * j / k;
                P.push([cx + R * Math.cos(q), cy + R * Math.sin(q)]);
            }
        }
        return normalizeBody(P, A, B);
    }
    if (st === 'wave') {
        const N = Math.max(480, n * 14);
        const amp = dep * m * .12;
        const Wa: number[] = [];
        for (let i = 0; i < n; i++) Wa.push(1 + (rnd() - .5) * jit * 1.4);
        for (let i = 0; i < N; i++) {
            const s = i / N;
            const q = E.at(s);
            const w = s * n;
            const o = amp * Wa[Math.floor(w) % n] * Math.sin(2 * Math.PI * w);
            P.push([q[0] + q[2] * o, q[1] + q[3] * o]);
        }
        return normalizeBody(P, A, B);
    }
    for (let i = 0; i < 480; i++) {
        const q = E.at(i / 480);
        P.push([q[0], q[1]]);
    }
    return P;
} // ellipse
// 本体 + しっぽ。返り値 = {subs:[点列…], tip, x0,y0,x1,y1}
function bubbleGeometry(A: number, B: number, p: InternalBubbleParams): BubbleGeometry {
    const P = bodyPoints(A, B, p);
    const S_ = (A + B) / 2;
    const N = P.length;
    const subs: Point[][] = [];
    let tip: Point | null = null;
    const tail = p.tail || 'none';
    if (tail === 'none') subs.push(P);
    else {
        const phi = (p.tailAngle || 0) * Math.PI / 180;
        const dx = Math.sin(phi);
        const dy = -Math.cos(phi);
        const qx = Math.cos(phi);
        const qy = Math.sin(phi);
        const c = Math.max(-1, Math.min(1, (p.tailCurve || 0) / 100));
        const L = Math.max(2, (p.tailLength || 0) / 100 * 1.5 * S_);
        let i0 = 0;
        let best = -2;
        P.forEach((q, i) => {
            const r = Math.hypot(q[0], q[1]) || 1;
            const cs = (q[0] * dx + q[1] * dy) / r;
            if (cs > best) {
                best = cs;
                i0 = i;
            }
        });
        const rp = P[i0][0] * dx + P[i0][1] * dy;
        const base: Point = [dx * rp, dy * rp]; // 本体の縁の、しっぽの向きの点
        if (tail === 'point') {
            const hw = Math.max(2, (p.tailWidth || 0) / 100 * S_ * .9) / 2;
            const inb = (q: Point): boolean =>
                Math.abs(q[0] * dy - q[1] * dx) < hw && (q[0] * dx + q[1] * dy) > 0;
            let ia = i0;
            let ib = i0;
            let k = 0;
            while (k < N / 3 && inb(P[(ia - 1 + N) % N])) {
                ia = (ia - 1 + N) % N;
                k++;
            }
            ia = (ia - 1 + N) % N;
            k = 0;
            while (k < N / 3 && inb(P[(ib + 1) % N])) {
                ib = (ib + 1) % N;
                k++;
            }
            ib = (ib + 1) % N;
            const Pa = P[ia];
            const Pb = P[ib];
            const R0: Point = [(Pa[0] + Pb[0]) / 2, (Pa[1] + Pb[1]) / 2];
            const fw = L * (1 - .15 * Math.abs(c));
            tip = [base[0] + dx * fw + qx * c * L * .6, base[1] + dy * fw + qy * c * L * .6];
            const ctl: Point = [base[0] + dx * L * .5, base[1] + dy * L * .5];
            const Qa: Point = [ctl[0] + (Pa[0] - R0[0]) * .35, ctl[1] + (Pa[1] - R0[1]) * .35];
            const Qb: Point = [ctl[0] + (Pb[0] - R0[0]) * .35, ctl[1] + (Pb[1] - R0[1]) * .35];
            const quad = (a: Point, q: Point, b: Point): Point[] => {
                const o: Point[] = [];
                for (let j = 1; j < 18; j++) {
                    const t = j / 18;
                    const u = 1 - t;
                    o.push([
                        u * u * a[0] + 2 * u * t * q[0] + t * t * b[0],
                        u * u * a[1] + 2 * u * t * q[1] + t * t * b[1],
                    ]);
                }
                return o;
            };
            const out: Point[] = [];
            for (let j = ib; j !== ia; j = (j + 1) % N) out.push(P[j]);
            out.push(Pa, ...quad(Pa, Qa, tip), tip, ...quad(tip, Qb, Pb));
            subs.push(out);
        } // 本体とつながった 1 本の輪郭
        else {
            subs.push(P);
            const rd = S_ * (.06 + .16 * (p.tailWidth || 0) / 100);
            const rs = [rd, rd * .66, rd * .42];
            const g = 1.5 + L * .16;
            const cen: Array<[number, number, number]> = [];
            let d = 0;
            const minD = (x: number, y: number): number => {
                let mn = 1e9;
                for (const q of P) {
                    const e = Math.hypot(q[0] - x, q[1] - y);
                    if (e < mn) mn = e;
                }
                return mn;
            };
            rs.forEach((r, i) => {
                d += (i ? rs[i - 1] : 0) + g + r;
                const pos = (): Point => {
                    const lat = c * d * d / (L + rd * 3) * .5;
                    return [base[0] + dx * d + qx * lat, base[1] + dy * d + qy * lat];
                };
                let q = pos();
                for (let it = 0; it < 30; it++) {
                    const md = minD(q[0], q[1]);
                    if (md >= r + g * .8) break;
                    d += r + g * .8 - md + .5;
                    q = pos();
                }
                cen.push([q[0], q[1], r]);
            }); // 本体と重ならない
            cen.forEach(([x, y, r]) => {
                const o: Point[] = [];
                for (let j = 0; j < 40; j++) {
                    const a = j / 40 * 2 * Math.PI;
                    o.push([x + r * Math.sin(a), y - r * Math.cos(a)]);
                }
                subs.push(o);
            });
            tip = [cen[2][0], cen[2][1]];
        }
    }
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    subs.forEach((s) =>
        s.forEach(([x, y]) => {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        })
    );
    return { subs, tip, x0, y0, x1, y1 };
}
// 箱（W×H px）にぴったり入る本体の大きさ A, B を探す（しっぽの長さは本体の大きさに比例するので、数回の当て直しで決まる）
function fitBubble(
    W: number,
    H: number,
    p: InternalBubbleParams,
): { A: number; B: number; g: BubbleGeometry } {
    let A = W / 2;
    let B = H / 2;
    let g: BubbleGeometry;
    for (let i = 0; i < 80; i++) {
        g = bubbleGeometry(A, B, p);
        const ex = W / ((g.x1 - g.x0) || 1);
        const ey = H / ((g.y1 - g.y0) || 1);
        if (Math.abs(ex - 1) < 1e-7 && Math.abs(ey - 1) < 1e-7) break;
        A *= ex;
        B *= ey;
        if (i === 79) g = bubbleGeometry(A, B, p);
    }
    return { A, B, g: g! };
}
const serializeBubble = (g: BubbleGeometry, sx: number, sy: number, ox: number, oy: number): string =>
    g.subs.map((s) =>
        'M' + s.map((q) =>
            (+((q[0] - g.x0) * sx + ox).toFixed(2)) + ' ' + (+((q[1] - g.y0) * sy + oy).toFixed(2))
        ).join('L') + 'Z'
    ).join('');
export function bubblePath(width: number, height: number, params: BubbleParams): string {
    const style: InternalStyle = params.style === 'rounded'
        ? 'round'
        : params.style === 'jagged'
        ? 'spike'
        : params.style === 'wobble'
        ? 'wave'
        : params.style;
    const p: InternalBubbleParams = {
        ...params,
        style,
    };
    const f = fitBubble(width, height, p);
    const g = f.g;
    return serializeBubble(g, width / ((g.x1 - g.x0) || 1), height / ((g.y1 - g.y0) || 1), 0, 0);
}
