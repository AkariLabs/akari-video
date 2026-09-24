/* Deterministic SVG path catalog. All coordinates are absolute M/L/C/Z. */
const catalog = (function () {
  'use strict';

  var DEG = Math.PI / 180;
  var MARGIN = 3;
  var MARGIN_STROKE = 4;

  function cos(a) { return Math.cos(a * DEG); }
  function sin(a) { return Math.sin(a * DEG); }
  function pol(r, a, cx, cy) { return [(cx || 0) + r * cos(a), (cy || 0) + r * sin(a)]; }
  function ang(c, p) { return Math.atan2(p[1] - c[1], p[0] - c[0]) / DEG; }
  function incr(a0, a1) { return a0 + ((((a1 - a0) % 360) + 360) % 360); }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // ---------------------------------------------------------------- path builder
  // 内部表現は絶対座標の M / L / C / Z のみ（円弧は 3 次ベジェに展開）。
  function Path() { this.c = []; this.x = null; this.y = null; this.sx = 0; this.sy = 0; }
  Path.prototype.M = function (x, y) {
    this.c.push(['M', x, y]); this.x = x; this.y = y; this.sx = x; this.sy = y; return this;
  };
  Path.prototype.L = function (x, y) {
    if (this.x === null) return this.M(x, y);
    if (Math.abs(this.x - x) < 1e-6 && Math.abs(this.y - y) < 1e-6) return this;
    this.c.push(['L', x, y]); this.x = x; this.y = y; return this;
  };
  Path.prototype.C = function (a, b, c, d, x, y) {
    this.c.push(['C', a, b, c, d, x, y]); this.x = x; this.y = y; return this;
  };
  Path.prototype.Q = function (qx, qy, x, y) {
    var x0 = this.x, y0 = this.y;
    return this.C(x0 + 2 / 3 * (qx - x0), y0 + 2 / 3 * (qy - y0), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y);
  };
  // 楕円弧（媒介変数角・度）。a0 → a1 のどちら向きでもよい。始点へは自動で M / L。
  Path.prototype.A = function (cx, cy, rx, ry, a0, a1) {
    var x0 = cx + rx * cos(a0), y0 = cy + ry * sin(a0);
    if (this.x === null) this.M(x0, y0); else this.L(x0, y0);
    var span = a1 - a0, n = Math.max(1, Math.ceil(Math.abs(span) / 90 - 1e-9)), st = span / n;
    for (var i = 0; i < n; i++) {
      var t0 = (a0 + st * i) * DEG, t1 = (a0 + st * (i + 1)) * DEG, k = 4 / 3 * Math.tan((t1 - t0) / 4);
      var px = cx + rx * Math.cos(t0), py = cy + ry * Math.sin(t0);
      var qx = cx + rx * Math.cos(t1), qy = cy + ry * Math.sin(t1);
      this.C(px - k * rx * Math.sin(t0), py + k * ry * Math.cos(t0),
             qx + k * rx * Math.sin(t1), qy - k * ry * Math.cos(t1), qx, qy);
    }
    return this;
  };
  Path.prototype.Z = function () { this.c.push(['Z']); this.x = null; this.y = null; return this; };
  Path.prototype.add = function (o) { this.c = this.c.concat(o.c); return this; };
  Path.prototype.map = function (fn) {
    this.c = this.c.map(function (cmd) {
      var out = [cmd[0]];
      for (var i = 1; i < cmd.length; i += 2) { var q = fn(cmd[i], cmd[i + 1]); out.push(q[0], q[1]); }
      return out;
    });
    return this;
  };
  Path.prototype.rot = function (deg) {
    var c = cos(deg), s = sin(deg);
    return this.map(function (x, y) { return [x * c - y * s, x * s + y * c]; });
  };
  Path.prototype.scale = function (sx, sy) {
    return this.map(function (x, y) { return [x * sx, y * (sy === undefined ? sx : sy)]; });
  };
  Path.prototype.move = function (dx, dy) {
    return this.map(function (x, y) { return [x + dx, y + dy]; });
  };
  function P() { return new Path(); }
  function join() { var p = P(); for (var i = 0; i < arguments.length; i++) p.add(arguments[i]); return p; }

  // ---------------------------------------------------------------- primitives
  function poly(pts, p) {
    p = p || P();
    pts.forEach(function (q, i) { if (i === 0) p.M(q[0], q[1]); else p.L(q[0], q[1]); });
    return p.Z();
  }
  function polyline(pts, p) {
    p = p || P();
    pts.forEach(function (q, i) { if (i === 0) p.M(q[0], q[1]); else p.L(q[0], q[1]); });
    return p;
  }
  // 角丸多角形。rr は数値か頂点ごとの配列（切り込み距離。辺の半分で頭打ち。0 = 角のまま）
  function roundPoly(pts, rr, p) {
    p = p || P();
    var n = pts.length, K = 0.5523;
    for (var i = 0; i < n; i++) {
      var v = pts[i], r = Array.isArray(rr) ? rr[i] : rr;
      if (!r) { if (i === 0) p.M(v[0], v[1]); else p.L(v[0], v[1]); continue; }
      var a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      var la = dist(v, a), lb = dist(v, b), d = Math.min(r, la / 2, lb / 2);
      var pin = [v[0] + (a[0] - v[0]) * d / la, v[1] + (a[1] - v[1]) * d / la];
      var pout = [v[0] + (b[0] - v[0]) * d / lb, v[1] + (b[1] - v[1]) * d / lb];
      if (i === 0) p.M(pin[0], pin[1]); else p.L(pin[0], pin[1]);
      p.C(pin[0] + K * (v[0] - pin[0]), pin[1] + K * (v[1] - pin[1]),
          pout[0] + K * (v[0] - pout[0]), pout[1] + K * (v[1] - pout[1]), pout[0], pout[1]);
    }
    return p.Z();
  }
  function circle(cx, cy, r, p) { return (p || P()).A(cx, cy, r, r, 0, 360).Z(); }
  function ellipse(cx, cy, rx, ry, p) { return (p || P()).A(cx, cy, rx, ry, 0, 360).Z(); }
  function rect(x, y, w, h, p) { return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], p); }
  function roundRect(x, y, w, h, r, p) {
    p = p || P();
    return p.A(x + w - r, y + r, r, r, -90, 0).A(x + w - r, y + h - r, r, r, 0, 90)
      .A(x + r, y + h - r, r, r, 90, 180).A(x + r, y + r, r, r, 180, 270).Z();
  }
  function capsule(w, h, p) { return roundRect(0, 0, w, h, h / 2, p); }
  function regPts(n, r, rot) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(pol(r, (rot === undefined ? -90 : rot) + i * 360 / n));
    return out;
  }
  // 星形の頂点列。R / r は数値か配列（頂点ごと）。jit は外側頂点の角度ずれ（度）
  function starPts(n, R, r, rot, jit) {
    var out = [], st = 360 / n; rot = rot === undefined ? -90 : rot;
    for (var i = 0; i < n; i++) {
      var ro = Array.isArray(R) ? R[i] : R, ri = Array.isArray(r) ? r[i] : r;
      out.push(pol(ro, rot + i * st + (jit ? jit[i] : 0)));
      out.push(pol(ri, rot + (i + 0.5) * st));
    }
    return out;
  }
  // 腕の和集合（アスタリスク / 十字）を 1 本の外形で。h = 腕の半幅、L = 中心から腕先まで
  function asterisk(n, L, h, round, rot, p) {
    p = p || P(); rot = rot || 0;
    var st = 360 / n, ri = h / sin(st / 2);
    for (var k = 0; k < n; k++) {
      var a = rot + k * st, u = [cos(a), sin(a)], v = [-sin(a), cos(a)];
      if (round) p.A(L * u[0], L * u[1], h, h, a - 90, a + 90);
      else { p.L(L * u[0] - h * v[0], L * u[1] - h * v[1]); p.L(L * u[0] + h * v[0], L * u[1] + h * v[1]); }
      var q = pol(ri, a + st / 2); p.L(q[0], q[1]);
    }
    return p.Z();
  }
  // 花びら星（先が丸い花びらを放射状に。谷は半径 ri、先端円は中心 Lc・半径 b）
  function petalStar(n, ri, Lc, b, rot, p) {
    p = p || P(); rot = rot === undefined ? -90 : rot;
    var st = 360 / n;
    function tangent(C, V, want) {
      var d = dist(C, V), base = ang(C, V), off = Math.acos(b / d) / DEG, best = null, bd = 1e9;
      [base + off, base - off].forEach(function (t) {
        var df = Math.abs(((((t - want) % 360) + 540) % 360) - 180);
        if (df < bd) { bd = df; best = t; }
      });
      return best;
    }
    for (var k = 0; k < n; k++) {
      var a = rot + k * st, C = pol(Lc, a), V1 = pol(ri, a - st / 2), V2 = pol(ri, a + st / 2);
      var t1 = tangent(C, V1, a - 90), t2 = incr(t1, tangent(C, V2, a + 90));
      p.L(V1[0], V1[1]);
      p.A(C[0], C[1], b, b, t1, t2);
    }
    return p.Z();
  }
  function circleX(a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
    if (d >= a[2] + b[2] || d <= Math.abs(a[2] - b[2])) throw new Error('circles do not intersect: ' + a + ' / ' + b);
    var l = (a[2] * a[2] - b[2] * b[2] + d * d) / (2 * d), h = Math.sqrt(a[2] * a[2] - l * l);
    var mx = a[0] + dx * l / d, my = a[1] + dy * l / d;
    return [[mx + h * dy / d, my - h * dx / d], [mx - h * dy / d, my + h * dx / d]];
  }
  function farther(ps, ref) { return dist(ps[0], ref) >= dist(ps[1], ref) ? ps[0] : ps[1]; }
  // 円の輪（時計回りに並べた円の和集合の外形）
  function circleRing(cs, ref, p) {
    p = p || P();
    var n = cs.length, X = [];
    for (var i = 0; i < n; i++) X.push(farther(circleX(cs[i], cs[(i + 1) % n]), ref));
    for (var j = 0; j < n; j++) {
      var c = cs[j], a0 = ang(c, X[(j - 1 + n) % n]), a1 = incr(a0, ang(c, X[j]));
      p.A(c[0], c[1], c[2], c[2], a0, a1);
    }
    return p.Z();
  }
  // 底が平らな雲（左 → 右に並べた円。最初と最後の円は底線に接する）
  function cloudFlat(cs, p) {
    p = p || P();
    var n = cs.length, X = [];
    for (var i = 0; i < n - 1; i++) {
      var ps = circleX(cs[i], cs[i + 1]); X.push(ps[0][1] < ps[1][1] ? ps[0] : ps[1]);
    }
    for (var j = 0; j < n; j++) {
      var c = cs[j];
      var a0 = j === 0 ? 90 : ang(c, X[j - 1]);
      var a1 = incr(a0, j === n - 1 ? 90 : ang(c, X[j]));
      p.A(c[0], c[1], c[2], c[2], a0, a1);
    }
    return p.Z();
  }
  // 円周上の半円こぶ（丸い歯・ホタテ縁）
  function scallop(n, R, b, rot, p) {
    p = p || P(); rot = rot || 0;
    var dl = Math.acos(1 - b * b / (2 * R * R)) / DEG, st = 360 / n;
    for (var k = 0; k < n; k++) {
      var f = rot + k * st, c = pol(R, f);
      var A = pol(R, f - dl), B = pol(R, f + dl), aA = ang(c, A);
      p.A(c[0], c[1], b, b, aA, incr(aA, ang(c, B)));
      p.A(0, 0, R, R, f + dl, f + st - dl);
    }
    return p.Z();
  }
  function gear(n, Rr, Rt, baseF, tipF, hole, rot, p) {
    p = p || P(); rot = rot || 0;
    var st = 360 / n, ba = st * baseF / 2, ta = st * tipF / 2;
    for (var k = 0; k < n; k++) {
      var c = rot + k * st, q;
      p.A(0, 0, Rr, Rr, c - st + ba, c - ba);
      q = pol(Rt, c - ta); p.L(q[0], q[1]);
      p.A(0, 0, Rt, Rt, c - ta, c + ta);
      q = pol(Rr, c + ba); p.L(q[0], q[1]);
    }
    p.Z();
    if (hole) p.A(0, 0, hole, hole, 0, -360).Z();
    return p;
  }
  // 中心 c・半径 r の円上を from → to へ、角度 thr を通る向きで
  function arcThrough(p, c, r, from, to, thr) {
    var s = ang(c, from), up = incr(s, ang(c, to)) - s, t = ((((thr - s) % 360) + 360) % 360);
    p.A(c[0], c[1], r, r, s, t <= up ? s + up : s - (360 - up));
    return p;
  }
  // Catmull-Rom → 3 次ベジェ
  function smoothClosed(pts, p) {
    p = p || P();
    var n = pts.length;
    p.M(pts[0][0], pts[0][1]);
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      p.C(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
          p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    return p.Z();
  }
  function smoothOpen(pts, p) {
    p = p || P();
    var n = pts.length;
    p.L(pts[0][0], pts[0][1]);
    for (var i = 0; i < n - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      p.C(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
          p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    return p;
  }
  // 極座標の閉曲線。harm = [[振幅, 周波数, 位相(rad)], ...]
  function polarPts(N, harm, sx, sy) {
    var out = [];
    for (var i = 0; i < N; i++) {
      var t = i * 2 * Math.PI / N, r = 1;
      harm.forEach(function (h) { r += h[0] * Math.cos(h[1] * t + h[2]); });
      out.push([50 * r * Math.cos(t) * (sx || 1), 50 * r * Math.sin(t) * (sy || 1)]);
    }
    return out;
  }
  function subdivide(pts, maxLen) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(dist(a, b) / maxLen));
      for (var j = 0; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
    }
    return out;
  }
  // 開いた折れ線をマイター付きで左右にオフセット（帯を作る）
  function offsetPolyline(pts, w) {
    var n = pts.length, out = [];
    for (var i = 0; i < n; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n - 1, i + 1)];
      var d1 = norm([b[0] - a[0], b[1] - a[1]]), d2 = norm([c[0] - b[0], c[1] - b[1]]);
      if (i === 0) d1 = d2; if (i === n - 1) d2 = d1;
      var n1 = [-d1[1], d1[0]], n2 = [-d2[1], d2[0]], m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
      var k = w / (m[0] * n1[0] + m[1] * n1[1]);
      out.push([b[0] + m[0] * k, b[1] + m[1] * k]);
    }
    return out;
  }
  function norm(v) { var l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
  function mirrorX(p) { return p.map(function (x, y) { return [-x, y]; }); }
  function mirrorY(p) { return p.map(function (x, y) { return [x, -y]; }); }

  // ---------------------------------------------------------------- fit & serialize
  function bbox(p) {
    var b = [Infinity, Infinity, -Infinity, -Infinity], cx = 0, cy = 0;
    function add(x, y) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    p.c.forEach(function (c) {
      if (c[0] === 'M' || c[0] === 'L') { add(c[1], c[2]); cx = c[1]; cy = c[2]; }
      else if (c[0] === 'C') {
        for (var i = 1; i <= 24; i++) {
          var t = i / 24, u = 1 - t;
          add(u * u * u * cx + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
              u * u * u * cy + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]);
        }
        cx = c[5]; cy = c[6];
      }
    });
    return b;
  }
  function num(v) { v = Math.round(v * 100) / 100; if (v === 0) v = 0; return String(v); }
  function serialize(p) {
    return p.c.map(function (c) {
      return c[0] + c.slice(1).map(num).join(' ');
    }).join('');
  }
  function fitTo(p, vb, m) {
    var b = bbox(p), bw = b[2] - b[0], bh = b[3] - b[1];
    if (!vb) {
      var s0 = (100 - 2 * m) / Math.max(bw, bh);
      vb = [Math.round(bw * s0 + 2 * m), Math.round(bh * s0 + 2 * m)];
    }
    var s = Math.min((vb[0] - 2 * m) / bw, (vb[1] - 2 * m) / bh);
    var dx = (vb[0] - bw * s) / 2 - b[0] * s, dy = (vb[1] - bh * s) / 2 - b[1] * s;
    p.map(function (x, y) { return [x * s + dx, y * s + dy]; });
    return vb;
  }

  // ---------------------------------------------------------------- catalog
  var categories = [];
  var cur = null;
  function cat(key, label) { cur = { key: key, label: label, items: [] }; categories.push(cur); }
  // opts: { vb, kind, rule }
  function add(slug, name, path, opts) {
    opts = opts || {};
    var kind = opts.kind || 'fill';
    var vb = fitTo(path, opts.vb, kind === 'stroke' ? MARGIN_STROKE : MARGIN);
    var def = { id: cur.key + '-' + slug, name: name, vb: vb, d: serialize(path), kind: kind };
    if (opts.rule) def.rule = opts.rule;
    cur.items.push(def);
  }
  var EO = { rule: 'evenodd' };

  // ===== 1. 基本の図形
  cat('basic', '基本の図形');
  add('square', '四角', rect(0, 0, 100, 100));
  add('rounded-square', '角丸四角', roundRect(0, 0, 100, 100, 18));
  add('circle', '円', circle(0, 0, 50));
  add('triangle', '三角', poly([[50, 0], [100, 86.6], [0, 86.6]]));
  add('triangle-down', '逆三角', poly([[0, 0], [100, 0], [50, 86.6]]));
  add('right-triangle', '直角三角', poly([[0, 0], [100, 100], [0, 100]]));
  add('diamond', 'ひし形', poly([[40, 0], [80, 50], [40, 100], [0, 50]]));
  add('cross', '十字', asterisk(4, 50, 11, false, -90));
  add('cross-thick', '太めの十字', asterisk(4, 50, 20, false, -90));
  add('trapezoid', '台形', poly([[28, 0], [92, 0], [120, 70], [0, 70]]));
  add('parallelogram', '平行四辺形', poly([[30, 0], [120, 0], [90, 70], [0, 70]]));
  add('semicircle', '半円', P().A(0, 0, 50, 50, 180, 360).Z());
  add('quarter-circle', '四分円', P().M(0, 100).L(0, 0).A(0, 100, 100, 100, -90, 0).Z());
  add('ring', 'リング・ドーナツ', join(circle(0, 0, 50), P().A(0, 0, 30, 30, 0, -360).Z()), EO);
  add('pill', 'カプセル', capsule(160, 70));

  // ===== 2. 多角形
  cat('polygon', '多角形');
  add('pentagon', '五角形', poly(regPts(5, 50)));
  add('hexagon', '六角形（縦）', poly(regPts(6, 50)));
  add('hexagon-flat', '六角形（横）', poly(regPts(6, 50, 0)));
  add('heptagon', '七角形', poly(regPts(7, 50)));
  add('octagon', '八角形', poly(regPts(8, 50, -90 + 22.5)));
  add('decagon', '十角形', poly(regPts(10, 50)));
  add('dodecagon', '十二角形', poly(regPts(12, 50, -90 + 15)));
  add('hexagon-rounded', '角丸六角形', roundPoly(regPts(6, 50), 12));
  add('octagon-rounded', '角丸八角形', roundPoly(regPts(8, 50, -90 + 22.5), 8));

  // ===== 3. スター
  cat('star', 'スター');
  add('4', '4 点の星', poly(starPts(4, 50, 18)));
  add('5', '5 点の星', poly(starPts(5, 50, 20)));
  add('6', '6 点の星', poly(starPts(6, 50, 27)));
  add('7', '7 点の星', poly(starPts(7, 50, 26)));
  add('8', '8 点の星', poly(starPts(8, 50, 28)));
  add('10', '10 点の星', poly(starPts(10, 50, 30)));
  add('12', '12 点の星', poly(starPts(12, 50, 33)));
  add('16', '16 点の星', poly(starPts(16, 50, 36)));
  add('burst-24', 'ギザギザ（価格シール）', poly(starPts(24, 50, 42)));
  add('5-rounded', '角丸の星', roundPoly(starPts(5, 50, 22), [9, 3, 9, 3, 9, 3, 9, 3, 9, 3]));
  add('explosion', '爆発', poly(starPts(12,
    [50, 38, 46, 34, 50, 40, 45, 35, 49, 39, 44, 36],
    [24, 27, 22, 26, 25, 23, 27, 24, 22, 26, 25, 23], -90,
    [0, 4, -3, 5, -2, 3, -4, 2, -5, 3, 0, -3])));
  add('square-12', '四角い星（12 点）', poly(starPts(12, 50, 50 * cos(45) / cos(30))));

  // ===== 4. 矢印
  cat('arrow', '矢印');
  var arR = [[0, 22], [58, 22], [58, 0], [100, 35], [58, 70], [58, 48], [0, 48]];
  add('right', '右矢印', poly(arR));
  add('left', '左矢印', mirrorX(poly(arR)));
  add('up', '上矢印', poly(arR).rot(-90));
  add('down', '下矢印', poly(arR).rot(90));
  add('left-right', '左右矢印', poly([[0, 35], [28, 0], [28, 22], [92, 22], [92, 0], [120, 35], [92, 70], [92, 48], [28, 48], [28, 70]]));
  add('up-down', '上下矢印', poly([[0, 35], [28, 0], [28, 22], [92, 22], [92, 0], [120, 35], [92, 70], [92, 48], [28, 48], [28, 70]]).rot(90));
  add('four-way', '4 方向矢印', (function () {
    var p = P(), L = 50, h = 8, hw = 18, hb = 30;
    for (var k = 0; k < 4; k++) {
      var a = k * 90 - 90, u = [cos(a), sin(a)], v = [-sin(a), cos(a)];
      [[hb, -h], [hb, -hw], [L, 0], [hb, hw], [hb, h]].forEach(function (q) {
        p.L(u[0] * q[0] + v[0] * q[1], u[1] * q[0] + v[1] * q[1]);
      });
      var iv = pol(h * Math.SQRT2, a + 45); p.L(iv[0], iv[1]);
    }
    return p.Z();
  })());
  add('chevron', 'シェブロン', poly([[0, 0], [66, 0], [100, 40], [66, 80], [0, 80], [34, 40]]));
  add('chevron-double', '二重シェブロン', join(
    poly([[0, 0], [36, 0], [70, 40], [36, 80], [0, 80], [34, 40]]),
    poly([[50, 0], [86, 0], [120, 40], [86, 80], [50, 80], [84, 40]])));
  add('notched', '切り込み付き右矢印', poly([[0, 22], [58, 22], [58, 0], [100, 35], [58, 70], [58, 48], [0, 48], [13, 35]]));
  add('pentagon', 'ホームベース矢印', poly([[0, 0], [74, 0], [110, 35], [74, 70], [0, 70]]));
  add('u-turn', 'U ターン矢印', P().M(10, 100).L(10, 45).A(50, 45, 40, 40, 180, 360).L(90, 70).L(103, 70)
    .L(78, 100).L(53, 70).L(66, 70).A(50, 45, 16, 16, 360, 180).L(34, 100).Z());
  add('circular', '円形矢印', (function () {
    var p = P(), Ro = 46, Ri = 28, a0 = 200, a1 = 470, q;
    p.A(0, 0, Ro, Ro, a0, a1);
    q = pol(Ro + 11, a1); p.L(q[0], q[1]);
    q = pol((Ro + Ri) / 2, a1 + 26); p.L(q[0], q[1]);
    q = pol(Ri - 11, a1); p.L(q[0], q[1]);
    p.A(0, 0, Ri, Ri, a1, a0);
    return p.Z();
  })());
  add('curved', 'カーブ矢印', (function () {
    var p = P(), Ro = 100, Ri = 78, a0 = 200, a1 = 316, q;
    p.A(0, 0, Ro, Ro, a0, a1);
    q = pol(Ro + 14, a1); p.L(q[0], q[1]);
    q = pol((Ro + Ri) / 2, a1 + 16); p.L(q[0], q[1]);
    q = pol(Ri - 14, a1); p.L(q[0], q[1]);
    p.A(0, 0, Ri, Ri, a1, a0);
    return p.Z();
  })());
  add('bent', '曲がり矢印', P().M(0, 100).L(0, 52).A(40, 52, 40, 40, 180, 270).L(66, 12).L(66, 0).L(100, 26)
    .L(66, 52).L(66, 40).L(40, 40).A(40, 52, 12, 12, 270, 180).L(28, 100).Z());
  add('thin', '細い右矢印', poly([[0, 26], [68, 26], [64, 6], [100, 30], [64, 54], [68, 34], [0, 34]]));
  add('diagonal', '斜め矢印', poly(arR).rot(-45));

  // ===== 5. フローチャート
  cat('flow', 'フローチャート');
  add('process', '処理', rect(0, 0, 160, 90));
  add('alt-process', '代替処理', roundRect(0, 0, 160, 90, 16));
  add('decision', '判断', poly([[80, 0], [160, 50], [80, 100], [0, 50]]));
  add('data', 'データ', poly([[32, 0], [160, 0], [128, 90], [0, 90]]));
  add('predefined', '定義済み処理', join(rect(0, 0, 14, 90), rect(19, 0, 122, 90), rect(146, 0, 14, 90)));
  function docBottom(p, xR, xL, yb, amp) {
    var w = xR - xL, xm = (xR + xL) / 2;
    p.C(xR - w / 6, yb - amp, xm + w / 6, yb - amp, xm, yb);
    p.C(xm - w / 6, yb + amp, xL + w / 6, yb + amp, xL, yb);
    return p;
  }
  add('document', '書類', docBottom(P().M(0, 0).L(160, 0).L(160, 80), 160, 0, 80, 16).Z());
  add('multi-document', '複数書類', docBottom(P().M(0, 24).L(12, 24).L(12, 12).L(24, 12).L(24, 0).L(160, 0)
    .L(160, 70).L(148, 70).L(148, 82).L(136, 82).L(136, 94), 136, 0, 94, 14).Z());
  add('terminator', '端子', capsule(160, 70));
  add('preparation', '準備', poly([[0, 45], [32, 0], [128, 0], [160, 45], [128, 90], [32, 90]]));
  add('manual-input', '手操作入力', poly([[0, 28], [160, 0], [160, 90], [0, 90]]));
  add('manual-operation', '手作業', poly([[0, 0], [160, 0], [130, 90], [30, 90]]));
  add('connector', '結合子', circle(0, 0, 50));
  add('off-page', '他ページ結合子', poly([[0, 0], [100, 0], [100, 72], [50, 104], [0, 72]]));
  add('database', 'データベース（円柱）', P().A(50, 14, 50, 14, 180, 360).A(50, 106, 50, 14, 0, 180).Z());
  add('delay', '遅延', P().M(0, 0).L(100, 0).A(100, 45, 45, 45, -90, 90).L(0, 90).Z());
  add('display', '表示', P().M(0, 45).L(36, 0).L(128, 0).A(128, 45, 32, 45, -90, 90).L(36, 90).Z());

  // ===== 6. 吹き出し
  cat('bubble', '吹き出し');
  var bubBL = [[0, 0], [160, 0], [160, 96], [58, 96], [24, 132], [32, 96], [0, 96]];
  add('rect', '四角い吹き出し', poly(bubBL));
  add('rounded', '角丸の吹き出し', roundPoly(bubBL, [16, 16, 16, 3, 2, 3, 16]));
  add('oval', '楕円の吹き出し', (function () {
    var p = P(), rx = 80, ry = 52;
    p.A(0, 0, rx, ry, 132, 110 + 360);
    return p.L(-70, 84).Z();
  })());
  add('thought', '考え中の吹き出し', (function () {
    var cs = [], rs = [20, 17, 19, 16, 20, 17, 19, 16, 20, 17];
    for (var k = 0; k < 10; k++) cs.push([50 * cos(k * 36), 28 * sin(k * 36), rs[k]]);
    return join(circleRing(cs, [0, 0]), circle(-47, 49, 9), circle(-60, 62, 5.5));
  })());
  add('shout', '叫びの吹き出し', poly(starPts(14,
    [48, 42, 50, 44, 47, 41, 49, 43, 46, 74, 45, 50, 42, 48],
    [35, 34, 36, 33, 35, 34, 36, 35, 33, 34, 33, 36, 34, 35], -90,
    [0, 3, -2, 4, -3, 2, -4, 3, -2, 4, -3, 2, -2, 3])).scale(1.35, 1));
  add('tail-right', '右しっぽの吹き出し', roundPoly([[0, 0], [140, 0], [140, 40], [178, 70], [140, 64], [140, 100], [0, 100]],
    [16, 16, 2, 2, 2, 16, 16]));
  add('tail-top', '上しっぽの吹き出し', roundPoly([[0, 34], [104, 34], [134, 0], [128, 34], [160, 34], [160, 124], [0, 124]],
    [16, 2, 2, 2, 16, 16, 16]));
  add('square-center', '真ん中しっぽの四角い吹き出し', poly([[0, 0], [110, 0], [110, 96], [69, 96], [55, 120], [41, 96], [0, 96]]));
  add('round-right', '右しっぽの丸い吹き出し', (function () {
    var p = P();
    p.A(0, 0, 50, 50, 50, 20 + 360);
    return p.L(66, 56).Z();
  })());
  add('curved-tail', 'カーブしっぽの吹き出し', (function () {
    var p = P(), w = 160, h = 100, r = 18;
    p.A(w - r, r, r, r, -90, 0).A(w - r, h - r, r, r, 0, 90);
    p.L(96, h).Q(92, 122, 66, 136).Q(80, 118, 74, h);
    p.A(r, h - r, r, r, 90, 180).A(r, r, r, r, 180, 270);
    return p.Z();
  })());

  // ===== 7. 雲
  cat('cloud', '雲');
  add('classic', '雲', circleRing([[-58, 10, 24], [-34, -14, 28], [4, -28, 34], [42, -12, 28],
    [64, 10, 22], [38, 26, 22], [4, 30, 24], [-30, 28, 22]], [4, 6]));
  add('flat', '底が平らな雲', cloudFlat([[-60, 0, 20], [-30, -14, 28], [10, -22, 32], [46, -4, 24]]));
  add('long', '横長の雲', cloudFlat([[-80, 4, 16], [-55, -8, 22], [-22, -16, 26], [12, -10, 24], [44, -16, 22], [74, 0, 20]]));
  add('puffy', 'ぽわぽわ雲', (function () {
    var cs = [], rs = [18, 16, 17, 15, 18, 16, 17, 15];
    for (var k = 0; k < 8; k++) cs.push([40 * cos(k * 45), 20 * sin(k * 45), rs[k]]);
    return circleRing(cs, [0, 0]);
  })());
  add('icon', 'アイコンの雲', cloudFlat([[-30, 5, 15], [0, -8, 26], [32, 2, 18]]));
  add('tall', 'もくもく雲', circleRing([[-50, 12, 20], [-40, -14, 24], [-12, -34, 28], [22, -32, 26],
    [46, -10, 24], [52, 14, 18], [26, 26, 20], [-4, 28, 20], [-30, 26, 20]], [0, -2]));

  // ===== 8. ハート
  cat('heart', 'ハート');
  function heart() {
    return P().M(50, 88).C(22, 68, 4, 51, 4, 31).C(4, 17, 15, 7, 28, 7).C(38, 7, 46, 13, 50, 22)
      .C(54, 13, 62, 7, 72, 7).C(85, 7, 96, 17, 96, 31).C(96, 51, 78, 68, 50, 88).Z();
  }
  add('heart', 'ハート', heart());
  add('fat', 'ふっくらハート', P().M(50, 90).C(46, 90, 2, 64, 2, 36).C(2, 16, 16, 4, 30, 4).C(40, 4, 47, 10, 50, 18)
    .C(53, 10, 60, 4, 70, 4).C(84, 4, 98, 16, 98, 36).C(98, 64, 54, 90, 50, 90).Z());
  add('tilted', '傾いたハート', heart().move(-50, -48).rot(-16));
  add('ring', 'ハートの輪', join(heart(), heart().move(-50, -46).scale(0.56).move(50, 44)), EO);
  add('slim', '細身のハート', heart().scale(0.78, 1));
  add('wide', '横長のハート', heart().scale(1.3, 1));

  // --- ハート 第 2 弾（2026-09-24 改）: 下側が曲線ですぼむ・傾いたハート
  // 媒介変数ハート（x = 16 sin³t, y = -(13cos t - 5cos2t - 2cos3t - cos4t)）を滑らかな変形 warp で
  // 形づけ、Catmull-Rom で通す。角は上の谷（t=0）と先端（t=π）の 2 か所だけ、他の継ぎ目は
  // ハンドルが一直線（G1）。warp は s=0（最も幅の広い高さ）で傾き 0 なので折れが出ない。
  function paramHeart(warp, N) {
    N = N || 48;
    var pts = [];
    for (var i = 0; i < N; i++) {
      var t = i * 2 * Math.PI / N;
      var x = 16 * Math.pow(Math.sin(t), 3);
      var y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      var s = Math.max(0, Math.min(1, (y + 4) / 21)), q = warp(x, y, s, t);
      pts.push([q[0], q[1], i === 0 || i === N / 2 ? 1 : 0]);
    }
    return smoothPath(pts);
  }
  function sstep(s) { return s * s * (3 - 2 * s); }
  function cardWarp(x, y, s) { return [x * (1 - 0.42 * sstep(s)), y + 6 * s * s]; }
  add('card', 'トランプのハート', paramHeart(cardWarp));
  add('card-slim', 'すらりとしたハート', paramHeart(function (x, y, s) {
    return [0.86 * x * (1 - 0.5 * sstep(s)), y + 15 * s * s];
  }));
  add('curl-tip', '先がはねたハート', paramHeart(function (x, y, s) {
    return [x * (1 - 0.35 * sstep(s)) - 9 * s * s * s, y + 8 * s * s];
  }));
  add('lean-right', '右に傾いたハート', paramHeart(function (x, y, s) {
    return [x * (1 - 0.46 * sstep(s)), y + 9 * s * s];
  }).rot(20));
  add('lean-left', '左に傾いた手描きハート', paramHeart(function (x, y, s, t) {
    var k = Math.tanh(x / 4), g = 1.03 - 0.12 * k;          // 左の山を大きく、右を小さく
    var X = x * g * (1 - 0.3 * sstep(s)) + 0.4 * Math.sin(3 * t);
    var Y = y * (1.02 - 0.06 * k) + 5 * s * s + 0.4 * Math.sin(2 * t) * Math.sin(t);
    return [X, Y];
  }).rot(-18));
  add('soft-wide', 'ふんわり横長のハート', paramHeart(function (x, y, s) {
    return [1.35 * x * (1 + 0.12 * Math.sin(2 * Math.PI * s) * Math.sin(Math.PI * s)), 0.92 * y + 5 * s * s];
  }));

  // ===== 9. 横断幕・垂れ幕
  cat('banner', '横断幕・垂れ幕');
  var ribbonPts = [[28, 0], [132, 0], [132, 16], [160, 16], [148, 36], [160, 56], [120, 56], [120, 40],
    [40, 40], [40, 56], [0, 56], [12, 36], [0, 16], [28, 16]];
  add('ribbon', '横断幕（リボン）', poly(ribbonPts));
  add('flag', '両端切り込みの旗', poly([[0, 0], [160, 0], [146, 30], [160, 60], [0, 60], [14, 30]]));
  add('ribbon-curved', 'カーブしたリボン', poly(subdivide(ribbonPts, 4).map(function (q) {
    return [q[0], q[1] + 0.0045 * (q[0] - 80) * (q[0] - 80)];
  })));
  add('hanging', '垂れ幕', roundPoly([[-6, -8], [76, -8], [76, 2], [70, 2], [70, 150], [35, 176], [0, 150], [0, 2], [-6, 2]],
    [4, 4, 3, 0, 0, 0, 0, 0, 3]));
  add('hanging-swallowtail', '燕尾の垂れ幕', poly([[0, 0], [70, 0], [70, 176], [35, 148], [0, 176]]));
  add('tag', 'タグ', join(roundPoly([[32, 0], [160, 0], [160, 70], [32, 70], [0, 35]], [3, 10, 10, 3, 5]),
    P().A(24, 35, 7, 7, 0, -360).Z()), EO);
  add('badge', 'リボン付きバッジ', (function () {
    var p = P(), q;
    p.A(0, 0, 40, 40, 125, 415);
    [[38, 96], [27, 86], [14, 100]].forEach(function (v) { p.L(v[0], v[1]); });
    q = pol(40, 80); p.L(q[0], q[1]);
    p.A(0, 0, 40, 40, 80, 100);
    [[-14, 100], [-27, 86], [-38, 96]].forEach(function (v) { p.L(v[0], v[1]); });
    return p.Z();
  })());
  add('scroll', '巻物', roundPoly([[0, 0], [14, 0], [14, 10], [146, 10], [146, 0], [160, 0], [160, 80], [146, 80],
    [146, 70], [14, 70], [14, 80], [0, 80]], [6, 6, 0, 0, 6, 6, 6, 6, 0, 0, 6, 6]));
  add('pennant', 'ペナント', poly([[0, 0], [160, 30], [0, 60]]));

  // ===== 10. 雫
  cat('drop', '雫');
  function drop() {
    return P().M(50, 0).C(62, 22, 86, 42, 86, 64).A(50, 64, 36, 36, 0, 180).C(14, 42, 38, 22, 50, 0).Z();
  }
  add('teardrop', '雫', drop());
  add('teardrop-down', '逆さの雫', drop().rot(180));
  add('pin', 'マップピン', (function () {
    var p = P(), r = 30, D = 74, f = Math.acos(r / D) / DEG, q = pol(r, 90 - f);
    p.M(0, D).L(q[0], q[1]).A(0, 0, r, r, 90 - f, 90 + f - 360).Z();
    return p.A(0, 0, 12, 12, 0, -360).Z();
  })(), EO);
  add('tilted', '傾いた雫', drop().move(-50, -60).rot(35));

  // ===== 11. 歯車
  cat('gear', '歯車');
  add('8', '歯車（8 枚歯）', gear(8, 37, 50, 0.56, 0.34, 15, -90), EO);
  add('12', '歯車（12 枚歯）', gear(12, 40, 50, 0.52, 0.3, 17, -90), EO);
  add('16', '歯車（細かい歯）', gear(16, 42, 50, 0.52, 0.3, 20, -90), EO);
  add('solid', '歯車（穴なし）', gear(10, 39, 50, 0.54, 0.32, 0, -90));
  add('round-teeth', '丸い歯の歯車', join(scallop(12, 40, 8, -90), P().A(0, 0, 16, 16, 0, -360).Z()), EO);
  // 歯の長い本物らしい歯車（2026-09-24 オーナー追加依頼）: 歯の高さ = 外径の 3〜4 割・スポークの窓・軸穴
  function spokeWindows(n, ri, ro, gap, rot) {
    var p = P(), st = 360 / n;
    for (var k = 0; k < n; k++) {
      var a0 = rot + k * st + gap / 2, a1 = rot + (k + 1) * st - gap / 2, q = pol(ri, a1);
      p.A(0, 0, ro, ro, a0, a1); p.L(q[0], q[1]); p.A(0, 0, ri, ri, a1, a0); p.Z();
    }
    return p;
  }
  add('long-6spoke', '歯の長い歯車（6 本スポーク）', join(gear(12, 32, 50, 0.46, 0.26, 0, -90), spokeWindows(6, 13, 25, 16, -90), P().A(0, 0, 6, 6, 0, -360).Z()), EO);
  add('long-4spoke', '歯の長い歯車（4 本スポーク）', join(gear(14, 34, 50, 0.48, 0.24, 0, -90), spokeWindows(4, 12, 27, 20, -45), P().A(0, 0, 7, 7, 0, -360).Z()), EO);
  add('sprocket', 'スプロケット（細い長い歯）', join(gear(18, 36, 50, 0.42, 0.18, 0, -90), spokeWindows(5, 13, 29, 18, -90), P().A(0, 0, 7, 7, 0, -360).Z()), EO);

  // ===== 12. 四角い星・アスタリスク
  cat('asterisk', '四角い星・アスタリスク');
  add('6', 'アスタリスク（6 本）', asterisk(6, 50, 9, false, -90));
  add('8', 'アスタリスク（8 本）', asterisk(8, 50, 7, false, -90));
  add('4-round', '丸い十字', asterisk(4, 41, 12, true, -90));
  add('5-round', '丸い 5 本腕', asterisk(5, 40, 10, true, -90));
  add('sparkle', 'きらめき', P().M(0, -50).Q(6, -6, 50, 0).Q(6, 6, 0, 50).Q(-6, 6, -50, 0).Q(-6, -6, 0, -50).Z());
  add('sparkle-thin', '細いきらめき', P().M(0, -50).Q(3, -3, 34, 0).Q(3, 3, 0, 50).Q(-3, 3, -34, 0).Q(-3, -3, 0, -50).Z());
  add('twinkle', 'またたき（8 光線）', poly(starPts(8, [50, 26, 50, 26, 50, 26, 50, 26], 8)));
  add('square-star', '四角い星（8 点）', poly(starPts(8, 50, 50 * cos(45) / cos(22.5))));

  // ===== 13. 有機的な図形
  cat('organic', '有機的な図形');
  function flower(n, d, r) {
    var cs = [];
    for (var k = 0; k < n; k++) { var c = pol(d, -90 + k * 360 / n); cs.push([c[0], c[1], r]); }
    return circleRing(cs, [0, 0]);
  }
  add('flower-4', '4 枚花びらの花', flower(4, 26, 24));
  add('flower-5', '5 枚花びらの花', flower(5, 28, 22));
  add('flower-6', '6 枚花びらの花', flower(6, 30, 19));
  add('daisy', 'デイジー', petalStar(14, 20, 40, 8));
  function leafHeart() { // 先端が原点、葉は -y 方向
    return P().M(0, 0).C(-8, -10, -24, -22, -23, -35).C(-22, -46, -6, -48, 0, -37)
      .C(6, -48, 22, -46, 23, -35).C(24, -22, 8, -10, 0, 0).Z();
  }
  add('clover-4', '四つ葉のクローバー', join(leafHeart().rot(45), leafHeart().rot(135), leafHeart().rot(225), leafHeart().rot(315)));
  add('clover-3', '三つ葉のクローバー', join(leafHeart().scale(1.15, 1).rot(0), leafHeart().scale(1.15, 1).rot(120), leafHeart().scale(1.15, 1).rot(240)));
  add('leaf', '葉っぱ', P().M(0, -50).C(28, -28, 40, 24, 12, 44).C(4, 51, -4, 51, -12, 44).C(-40, 24, -28, -28, 0, -50).Z().rot(35));
  add('willow', '柳の葉', P().M(0, -50).C(20, -25, 20, 25, 0, 50).C(-20, 25, -20, -25, 0, -50).Z().rot(40));
  add('blob-1', 'ブロブ 1', smoothClosed(polarPts(36, [[0.12, 2, 0.3], [0.08, 3, 1.2], [0.05, 5, 2.0]], 1.1, 1)));
  add('blob-2', 'ブロブ 2', smoothClosed(polarPts(36, [[0.15, 2, 1.0], [0.1, 3, -0.4], [0.04, 4, 2.5]])));
  add('blob-3', 'ブロブ 3', smoothClosed(polarPts(36, [[0.1, 3, 0.2], [0.08, 2, 2.2], [0.06, 5, -1.0]], 1, 1.05)));
  add('pebble', '小石', smoothClosed(polarPts(36, [[0.22, 2, 0], [0.05, 3, 0.5]])).rot(-15));

  // --- 有機的な図形 第 2 弾（2026-09-24）: 手描き風の点列 → 滑らかな外形。[x, y, 1] は角（尖り）
  function smoothPath(pts, p) {
    p = p || P();
    var n = pts.length;
    var T = pts.map(function (q, i) {
      if (q[2]) return [0, 0];
      var a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      return [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2];
    });
    p.M(pts[0][0], pts[0][1]);
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n, a = pts[i], b = pts[j];
      p.C(a[0] + T[i][0] / 3, a[1] + T[i][1] / 3, b[0] - T[j][0] / 3, b[1] - T[j][1] / 3, b[0], b[1]);
    }
    return p.Z();
  }
  // 右半分（上の軸上の点 → 下の軸上の点）から左右対称の点列を作る
  function mirrorHalf(r) {
    return r.concat(r.slice(1, -1).reverse().map(function (q) { return [-q[0], q[1], q[2]]; }));
  }
  function cornerPol(r, a, cx, cy) { var q = pol(r, a, cx, cy); return [q[0], q[1], 1]; }

  // 葉
  add('monstera', 'モンステラ', smoothPath(mirrorHalf([[0, -50, 1], [16, -46], [28, -38], [33, -32, 1], [11, -27, 1], [11, -24, 1],
    [37, -27, 1], [41, -17], [43, -10, 1], [13, -8, 1], [13, -5, 1], [44, -4, 1], [44, 6], [42, 14, 1], [13, 10, 1], [13, 13, 1],
    [40, 20, 1], [34, 32], [22, 42], [10, 44], [0, 34, 1]])));
  add('ginkgo', 'イチョウ', (function () {
    var c = [0, 22], n = 10, pts = [[-2.5, 50, 1], [-2.5, 24, 1], [-20, 12]];
    for (var j = 0; j <= n; j++) {
      var a = -155 + j * 130 / n, edge = j === 0 || j === n, mid = j === n / 2;
      var r = mid ? 38 : (j % 2 ? 55 : 53);
      var q = pol(r, a, c[0], c[1]); pts.push([q[0], q[1], edge || mid ? 1 : 0]);
    }
    pts.push([20, 12], [2.5, 24, 1], [2.5, 50, 1]);
    return smoothPath(pts);
  })());
  add('maple', 'もみじ', (function () {
    var pts = [];
    function lobe(c, R) {
      [[-20, 0.52], [-13, 0.72], [-8, 0.62], [0, 1], [8, 0.62], [13, 0.72], [20, 0.52]].forEach(function (o) { pts.push(pol(R * o[1], c + o[0])); });
    }
    lobe(-90, 50); pts.push(pol(17, -64)); lobe(-38, 46); pts.push(pol(17, -8)); lobe(22, 34); pts.push(pol(13, 56));
    pts.push([3, 16], [3, 56], [-3, 56], [-3, 16]);
    pts.push(pol(13, 124)); lobe(158, 34); pts.push(pol(17, 188)); lobe(218, 46); pts.push(pol(17, 244));
    return poly(pts);
  })());
  add('heart-leaf', 'ハート形の葉', smoothPath(mirrorHalf([[0, -50, 1], [14, -38], [30, -18], [38, 4], [32, 24], [16, 34], [5, 30], [0, 22, 1]])));
  add('fern', 'シダの葉', (function () {
    var up = [[0, 52, 1], [2, 52, 1], [2, 44, 1]];
    for (var i = 0; i < 9; i++) {
      var y = 44 - i * 10, w = 30 * Math.sin(Math.PI * (i + 1.5) / 11) + 4;
      up.push([0.5 * w + 2, y - 2.6 - 0.1 * w], [w + 2, y - 5 - 0.2 * w], [0.5 * w + 2, y - 7.4 - 0.1 * w], [2, y - 10, 1]);
    }
    up.push([0, -52, 1]);
    return smoothPath(mirrorHalf(up.reverse())).map(function (x, y) { var t = (52 - y) / 104; return [x + 16 * t * t, y]; });
  })());

  // 花
  add('tulip', 'チューリップ', smoothPath([[-22, -40, 1], [-14, -31], [-9, -26, 1], [0, -46, 1], [9, -26, 1], [14, -31], [22, -40, 1],
    [28, -20], [26, -2], [14, 10], [3, 12, 1], [3, 30, 1], [14, 20], [28, 12, 1], [22, 32], [3, 42, 1], [3, 54, 1], [-3, 54, 1],
    [-3, 12, 1], [-14, 10], [-26, -2], [-28, -20]]));
  add('sakura', '桜', (function () {
    var pts = [];
    for (var k = 0; k < 5; k++) {
      var a = -90 + k * 72;
      pts.push(cornerPol(13, a - 36), pol(34, a - 24), pol(48, a - 12), pol(50, a - 5), cornerPol(41, a),
        pol(50, a + 5), pol(48, a + 12), pol(34, a + 24));
    }
    return smoothPath(pts);
  })());
  add('lotus', '蓮の花', smoothPath(mirrorHalf([[0, -48, 1], [10, -32], [12, -10, 1], [22, -22], [36, -28, 1], [38, -10], [32, 4, 1],
    [44, -2], [54, -2, 1], [44, 12], [22, 20], [0, 22]])));

  // 水・炎
  add('splash', '水しぶき', join(smoothPath([[-50, 30], [-44, 22], [-45, -4], [-34, 16, 1], [-22, -24], [-14, 12, 1], [0, -12],
    [10, 12, 1], [22, -30], [30, 14, 1], [44, -8], [46, 22], [50, 30], [34, 40], [0, 44], [-34, 40]]),
    circle(-22, -40, 5), circle(22, -46, 5), circle(4, -30, 3.5), circle(40, -21, 3)));
  add('puddle', '水たまり', smoothClosed(polarPts(40, [[0.1, 2, 0.4], [0.08, 3, 1.7], [0.06, 5, 0.3], [0.04, 7, 2]], 1.6, 0.62)));
  add('drip', 'したたる形', smoothPath([[-50, -18], [-30, -28], [0, -24], [28, -30], [50, -20], [52, -4], [42, 4], [34, 6], [32, 24],
    [28, 31], [24, 24], [22, 8], [12, 8], [5, 10], [5, 38], [0, 45], [-5, 38], [-6, 10], [-16, 7], [-24, 8], [-25, 18], [-29, 23],
    [-33, 18], [-35, 6], [-46, 4], [-53, -6]]));
  add('flame', '炎', smoothPath([[2, -50, 1], [12, -34], [20, -22], [31, -32, 1], [35, -12], [38, 8], [31, 28], [17, 43], [0, 48],
    [-17, 43], [-31, 28], [-36, 8], [-32, -10], [-27, -26, 1], [-18, -12], [-13, -24], [-6, -38]]));

  // 羽根・貝
  add('feather', '羽根', smoothPath([[0, -50, 1], [10, -42], [19, -24], [20, -10, 1], [11, -6, 1], [19, -4, 1], [18, 14], [10, 30],
    [2, 36, 1], [1.5, 50, 1], [-1.5, 50, 1], [-2, 36, 1], [-11, 28], [-17, 12], [-17, 2, 1], [-9, -2, 1], [-17, -5, 1], [-17, -22],
    [-9, -40]]).rot(30));
  add('shell', 'ホタテ貝', (function () {
    var c = [0, 34], n = 9, pts = [[-9, 48, 1], [-17, 42, 1], [-5, 36, 1]];
    for (var j = 0; j <= 2 * n; j++) {
      var q = pol(j % 2 ? 54 : 48, -162 + j * 144 / (2 * n), c[0], c[1]);
      pts.push([q[0], q[1], j % 2 ? 0 : 1]);
    }
    pts.push([5, 36, 1], [17, 42, 1], [9, 48, 1]);
    return smoothPath(pts);
  })());

  // 果物
  add('apple', 'りんご', smoothPath([[-2, -28, 1], [-1, -40], [1, -49, 1], [5, -48, 1], [4, -42, 1], [14, -52], [32, -52, 1],
    [20, -42], [4, -37, 1], [3, -28, 1], [16, -33], [32, -31], [43, -18], [45, 2], [38, 24], [24, 40], [10, 40], [0, 36],
    [-10, 40], [-24, 40], [-38, 24], [-45, 2], [-43, -18], [-32, -31], [-16, -33]]));
  add('lemon', 'レモン', (function () {
    var pts = [];
    for (var k = 0; k < 18; k++) {
      var x = 40 * cos(k * 20), y = 30 * sin(k * 20);
      if (k === 0 || k === 9) x *= 1.25;
      pts.push([x, y]);
    }
    return smoothClosed(pts).rot(-20);
  })());
  add('cherries', 'さくらんぼ', (function () {
    var L = [-22, 26], R = [22, 30], r = 19, p = P();
    var A1 = pol(r, -100, L[0], L[1]), A2 = pol(r, -75, L[0], L[1]);
    var B1 = pol(r, -105, R[0], R[1]), B2 = pol(r, -80, R[0], R[1]);
    p.M(A1[0], A1[1]).Q(-22, -22, 3, -48).L(8, -48).Q(24, -10, B2[0], B2[1]);
    p.A(R[0], R[1], r, r, -80, 255);
    p.Q(18, -10, 5, -40).Q(-15, -22, A2[0], A2[1]);
    p.A(L[0], L[1], r, r, -75, 260);
    return p.Z();
  })());

  // 石
  add('pebbles', '小石の群れ', join(
    smoothClosed(polarPts(24, [[0.12, 2, 0.3], [0.05, 3, 1]])).scale(0.5, 0.38).move(-28, 12),
    smoothClosed(polarPts(24, [[0.1, 2, 1.4], [0.05, 3, 2]])).scale(0.4, 0.32).move(30, 18),
    smoothClosed(polarPts(24, [[0.1, 2, 2.2], [0.04, 3, 0.4]])).scale(0.36, 0.28).move(2, -22)));
  add('stone', '石', roundPoly([[-42, -8], [-22, -34], [16, -38], [44, -14], [40, 20], [8, 36], [-34, 28]], 7));

  // 手描きのかたち
  add('blob-long', '細長いブロブ', smoothClosed(polarPts(36, [[0.08, 2, 0.8], [0.06, 3, 2.4], [0.04, 4, 0.2]], 1.9, 0.62)).rot(-8));
  add('blob-triangle', '三角っぽいブロブ', smoothClosed(polarPts(36, [[0.2, 3, Math.PI], [0.05, 2, 0.6], [0.03, 5, 1.4]])).rot(-30));
  add('bean', '豆', smoothClosed([[-44, 4], [-38, -18], [-18, -28], [0, -20], [18, -28], [38, -18], [44, 4], [30, 22], [0, 28], [-30, 22]]));
  add('amoeba', 'アメーバ', smoothClosed([50, 30, 44, 26, 36, 48, 28, 40, 24, 46, 30, 38, 27, 42].map(function (r, i) { return pol(r, i * 360 / 14); })));

  // 珊瑚・サボテン
  add('coral', '珊瑚', smoothPath([[-5, 50, 1], [-5, 28], [-12, 14], [-24, 6], [-36, -2], [-44, -14], [-46, -26], [-41, -30], [-37, -18],
    [-30, -8], [-24, -8], [-25, -22], [-27, -36], [-23, -44], [-18, -40], [-18, -24], [-14, -8], [-6, 4], [-2, -8], [-1, -26],
    [1, -42], [6, -49], [11, -45], [8, -30], [12, -14], [18, -10], [23, -21], [24, -33], [29, -40], [34, -36], [34, -26], [37, -21],
    [44, -28], [51, -27], [51, -20], [40, -10], [26, 2], [12, 14], [5, 26], [5, 50, 1]]));
  add('cactus', 'サボテン', roundPoly([[-10, 50], [-10, 20], [-32, 20], [-32, -14], [-18, -14], [-18, 6], [-10, 6], [-10, -40],
    [10, -40], [10, -6], [18, -6], [18, -30], [32, -30], [32, 8], [10, 8], [10, 50]],
    [0, 4, 12, 7, 7, 4, 4, 10, 10, 4, 4, 7, 7, 12, 4, 0]));

  // ===== 14. 波線（線のみ）
  cat('wave', '波線');
  var ST = { kind: 'stroke' };
  add('sine', 'ゆるい波線', (function () {
    var pts = []; for (var x = 0; x <= 200; x += 5) pts.push([x, 20 * Math.sin(2 * Math.PI * x / 100)]);
    return smoothOpen(pts);
  })(), ST);
  add('tight', '細かい波線', (function () {
    var pts = []; for (var x = 0; x <= 200; x += 2.5) pts.push([x, 8 * Math.sin(2 * Math.PI * x / 33.333)]);
    return smoothOpen(pts);
  })(), ST);
  add('zigzag', 'ジグザグ線', (function () {
    var pts = []; for (var i = 0; i <= 8; i++) pts.push([i * 25, i % 2 ? 0 : 30]);
    return polyline(pts);
  })(), ST);
  add('square', '矩形波', (function () {
    var pts = [[0, 30]]; for (var i = 0; i < 5; i++) { var x = i * 40; pts.push([x, 0], [x + 20, 0], [x + 20, 30], [x + 40, 30]); }
    return polyline(pts);
  })(), ST);
  add('coil', 'ばね・ループ', (function () {
    var pts = []; for (var i = 0; i <= 120; i++) { var t = i * Math.PI / 12; pts.push([5 * t - 14 * Math.sin(t), -14 * Math.cos(t)]); }
    return smoothOpen(pts);
  })(), ST);
  add('scribble', '手書きの下線', smoothOpen([[0, 26], [50, 21], [110, 18], [170, 15], [200, 14], [150, 25], [90, 30],
    [30, 36], [70, 36], [130, 33], [190, 30]]), ST);

  // ===== 15. 抽象的な図形
  cat('abstract', '抽象的な図形');
  add('blob-cutout', '穴あきブロブ', join(smoothClosed(polarPts(36, [[0.12, 2, 0.9], [0.07, 3, 2.1], [0.04, 5, 0.4]], 1.08, 1)),
    P().A(8, -4, 17, 17, 0, -360).Z()), EO);
  add('half-circles', '重なる半円', join(P().A(0, 0, 50, 50, 180, 360).Z(), P().A(0, 62, 50, 50, 180, 360).Z()));
  add('quarter-deco', '四分円の飾り', join(P().M(0, 100).L(0, 56).A(0, 100, 44, 44, -90, 0).Z(),
    P().A(0, 100, 100, 100, -90, 0).L(62, 100).A(0, 100, 62, 62, 0, -90).Z()));
  add('arch', 'アーチ（窓）', P().M(0, 140).L(0, 36).A(36, 36, 36, 36, 180, 360).L(72, 140).Z());
  add('arc-band', '弧の帯', P().A(0, 0, 50, 50, 180, 360).A(0, 0, 28, 28, 360, 180).Z());
  add('squiggle-band', 'うねる帯', (function () {
    var A = 10, per = 70, w = 7, top = [], bot = [];
    for (var x = 0; x <= 175; x += 5) {
      var y = A * Math.cos(2 * Math.PI * x / per), dy = -A * 2 * Math.PI / per * Math.sin(2 * Math.PI * x / per);
      var nn = norm([-dy, 1]);
      top.push([x - nn[0] * w, y - nn[1] * w]); bot.push([x + nn[0] * w, y + nn[1] * w]);
    }
    var p = smoothOpen(top);
    var e = [175, A * Math.cos(2 * Math.PI * 175 / per)];
    p.A(e[0], e[1], w, w, -90, 90);
    smoothOpen(bot.reverse(), p);
    p.A(0, A, w, w, 90, 270);
    return p.Z();
  })());
  add('zigzag-band', 'ジグザグの帯', (function () {
    var c = []; for (var i = 0; i <= 6; i++) c.push([i * 26, i % 2 ? 0 : 26]);
    var a = offsetPolyline(c, -7), b = offsetPolyline(c, 7).reverse();
    return poly(a.concat(b));
  })());
  add('pills', 'カプセルの群れ', join(capsule(90, 24), capsule(70, 24).move(22, 34), capsule(84, 24).move(-6, 68)).rot(-30));
  add('seal', 'ホタテ縁のシール', scallop(16, 44, 8, -90));
  add('swoosh', 'スウッシュ（筆あと）', P().M(0, 70).C(30, 30, 100, 4, 160, 8).C(116, 28, 58, 54, 16, 80).C(8, 84, 1, 78, 0, 70).Z());
  add('triforce', '三角の集まり', (function () {
    var o = [[50, 0], [100, 86.6], [0, 86.6]], cx = 50, cy = 57.73, s = 0.8;
    var inner = [[25, 43.3], [75, 43.3], [50, 86.6]].map(function (q) { return [cx + (q[0] - cx) * s, cy + (q[1] - cy) * s]; });
    return join(poly(o), poly(inner.reverse()));
  })(), EO);
  add('lens', 'レンズ', (function () {
    var p = P(), c1 = [-30, 0], c2 = [30, 0], r = 50, t = [0, -40], b = [0, 40];
    p.M(t[0], t[1]);
    arcThrough(p, c1, r, t, b, 0);
    arcThrough(p, c2, r, b, t, 180);
    return p.Z();
  })());
  add('crescent', '三日月', (function () {
    var A = [0, 0, 50], B = [24, -14, 44], X = circleX(A, B), p = P();
    var away = ang([B[0], B[1]], [A[0], A[1]]); // A 上で B から遠い向き（B → A の向き）
    p.M(X[0][0], X[0][1]);
    arcThrough(p, A, A[2], X[0], X[1], away);
    arcThrough(p, B, B[2], X[1], X[0], ang([B[0], B[1]], [A[0], A[1]]));
    return p.Z();
  })());

  // --- 抽象的な図形 第 2 弾（2026-09-24）
  // 中心線 fn(t) に沿った帯（両端は丸いキャップ。wf は数値か 0..1 → 半幅の関数）
  function band(fn, t0, t1, N, wf) {
    var A = [], B = [], th0 = 0, th1 = 0, e = (t1 - t0) * 1e-4;
    function W(s) { return typeof wf === 'function' ? wf(s) : wf; }
    for (var i = 0; i <= N; i++) {
      var t = t0 + (t1 - t0) * i / N, c = fn(t), c1 = fn(t + e), c0 = fn(t - e);
      var th = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]) / DEG, w = W(i / N);
      A.push(pol(w, th - 90, c[0], c[1])); B.push(pol(w, th + 90, c[0], c[1]));
      if (i === 0) th0 = th; if (i === N) th1 = th;
    }
    var p = smoothOpen(A), ce = fn(t1), cs = fn(t0);
    if (W(1) > 0.01) p.A(ce[0], ce[1], W(1), W(1), th1 - 90, th1 + 90);
    smoothOpen(B.reverse(), p);
    if (W(0) > 0.01) p.A(cs[0], cs[1], W(0), W(0), th0 + 90, th0 + 270);
    return p.Z();
  }
  function crescentP(A, B) {
    var X = circleX(A, B), p = P(), toA = ang([B[0], B[1]], [A[0], A[1]]);
    p.M(X[0][0], X[0][1]);
    arcThrough(p, A, A[2], X[0], X[1], toA);
    arcThrough(p, B, B[2], X[1], X[0], toA);
    return p.Z();
  }
  // 丸い端の弧の帯（C 字）
  function arcBandRound(Ro, Ri, a0, a1) {
    var p = P(), m = (Ro + Ri) / 2, w = (Ro - Ri) / 2, e = pol(m, a1), s = pol(m, a0);
    p.A(0, 0, Ro, Ro, a0, a1).A(e[0], e[1], w, w, a1, a1 + 180).A(0, 0, Ri, Ri, a1, a0).A(s[0], s[1], w, w, a0 + 180, a0 + 360);
    return p.Z();
  }

  add('squiggle', 'くねくね線', band(function (t) { return [t * 30, 12 * Math.sin(t * Math.PI)]; }, 0, 4, 80, 6).rot(-20));
  add('confetti', '紙吹雪', (function () {
    function bar(r, x, y) { return roundRect(-9, -3, 18, 6, 3).rot(r).move(x, y); }
    function tri(r, x, y) { return poly(regPts(3, 7)).rot(r).move(x, y); }
    return join(bar(30, -35, -30), circle(5, -38, 5), tri(15, 35, -25), tri(-20, -10, -10), bar(-40, 25, 5), circle(-38, 8, 4),
      bar(70, 0, 20), circle(38, 32, 5), tri(40, -28, 36), rect(-4, -4, 8, 8).rot(20).move(12, 40));
  })());
  add('split-circle', '割れた円', join(P().A(0, 0, 50, 50, 90, 270).Z().move(-4, 6), P().A(0, 0, 50, 50, -90, 90).Z().move(4, -6)));
  add('pie-3q', '4 分の 3 の円', P().M(0, 0).A(0, 0, 50, 50, 0, 270).Z());
  add('pie-slice', 'パイの一切れ', P().M(0, 0).A(0, 0, 50, 50, -118, -62).Z());
  add('c-ring', 'C の字の輪', arcBandRound(50, 30, 40, 320));
  add('concentric', '同心円', join(circle(0, 0, 50), circle(0, 0, 38), circle(0, 0, 26), circle(0, 0, 14)), EO);
  add('bolt', '稲妻', poly([[18, 0], [62, 0], [42, 36], [70, 36], [16, 100], [30, 52], [4, 52]]));
  add('torn-strip', '破れた紙の帯', (function () {
    var t = [0, -4, 2, -3, 1, -5, 0, -2, 3, -4, 1, -3, 2, -1, -4, 0, -2], b = [1, 4, -1, 3, 0, 5, 2, -1, 4, 1, 3, -2, 2, 4, 0, 3, 1];
    var pts = [];
    for (var i = 0; i <= 16; i++) pts.push([i * 10, t[i]]);
    for (var j = 16; j >= 0; j--) pts.push([j * 10, 44 + b[j]]);
    return poly(pts);
  })());
  add('brush', '筆のひと塗り', smoothPath([[4, -18], [30, -26], [70, -22], [110, -27], [148, -20], [158, -16, 1], [148, -9, 1], [162, -3, 1],
    [150, 3, 1], [160, 9, 1], [148, 15, 1], [154, 20, 1], [120, 24], [80, 20], [40, 25], [8, 20], [0, 14, 1], [8, 8, 1],
    [-4, 2, 1], [6, -4, 1], [-2, -10, 1]]));
  add('wave-band', '波の帯', (function () {
    var top = [], bot = [];
    for (var x = 0; x <= 160; x += 5) {
      var y = 12 * Math.sin(2 * Math.PI * x / 80);
      top.push([x, y]); bot.push([x, y + 24]);
    }
    return smoothOpen(bot.reverse(), smoothOpen(top)).Z();
  })());
  add('blob-ring', 'ブロブの輪', (function () {
    var h = [[0.12, 2, 0.5], [0.08, 3, 1.9], [0.04, 5, 0.8]];
    return join(smoothClosed(polarPts(36, h, 1.05, 1)), smoothClosed(polarPts(36, h, 1.05, 1)).scale(0.6));
  })(), EO);
  add('corner-brackets', 'コーナー枠', join(poly([[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]]),
    poly([[100, 70], [60, 70], [60, 60], [90, 60], [90, 30], [100, 30]])));
  add('leaf-corner', 'リーフ角の四角', roundPoly([[0, 0], [100, 0], [100, 100], [0, 100]], [45, 0, 45, 0]));
  add('stripes', '斜めストライプ', (function () {
    var p = P();
    for (var i = 0; i < 5; i++) { var x = i * 24; poly([[x + 14, 0], [x + 26, 0], [x + 12, 60], [x, 60]], p); }
    return p;
  })());
  add('dot-grid', 'ドットの並び', (function () {
    var p = P();
    for (var r = 0; r < 3; r++) for (var c = 0; c < 4; c++) circle(c * 26, r * 26, 7, p);
    return p;
  })());
  add('tri-cutout', '三角抜きの円', join(circle(0, 0, 50), poly(regPts(3, 28)).move(0, 3)), EO);
  add('sticker', '丸いギザギザのシール', roundPoly(starPts(14, 50, 41), [5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3]));
  add('tapered', '細くなる線', band(function (t) { return [160 * t, -30 * t * (1 - t) + 10 * t]; }, 0, 1, 60,
    function (s) { return 15 * Math.pow(Math.sin(Math.PI * s), 0.8); }));
  add('pill-dot', 'カプセルと丸', join(capsule(110, 40), circle(140, 20, 20)));
  add('stairs', '階段', poly([[0, 100], [0, 75], [25, 75], [25, 50], [50, 50], [50, 25], [75, 25], [75, 0], [100, 0], [100, 100]]));
  add('chevron-stack', '重なるシェブロン', (function () {
    var p = P();
    for (var i = 0; i < 3; i++) poly([[0, 30], [40, 0], [80, 30], [80, 46], [40, 16], [0, 46]].map(function (q) { return [q[0], q[1] + i * 30]; }), p);
    return p;
  })());
  add('diamonds', 'ひし形の群れ', join(poly([[0, -30], [30, 0], [0, 30], [-30, 0]]), poly([[44, -38], [60, -22], [44, -6], [28, -22]]),
    poly([[40, 16], [50, 26], [40, 36], [30, 26]])));
  add('leaf-split', '割れた葉', (function () {
    var t = [0, -40], b = [0, 40];
    var L = P().M(t[0], t[1]); arcThrough(L, [30, 0], 50, t, b, 180); L.Z();
    var R = P().M(b[0], b[1]); arcThrough(R, [-30, 0], 50, b, t, 0); R.Z();
    return join(L.move(-4, 4), R.move(4, -4)).rot(-35);
  })());
  add('arch-frame', 'アーチの枠', join(P().M(0, 110).L(0, 36).A(36, 36, 36, 36, 180, 360).L(72, 110).Z(),
    P().M(12, 98).L(12, 36).A(36, 36, 24, 24, 180, 360).L(60, 98).Z()), EO);
  add('capsule-ring', 'カプセルの輪', join(capsule(160, 70), roundRect(14, 14, 132, 42, 21)), EO);
  add('venn-3', '3 つの円の重なり', circleRing([0, 1, 2].map(function (k) { var c = pol(20, -90 + k * 120); return [c[0], c[1], 30]; }), [0, 0]));
  add('venn-2', '2 つの円の重なり', (function () {
    var A = [-20, 0, 32], B = [20, 0, 32], X = circleX(A, B), top = X[0][1] < X[1][1] ? X[0] : X[1], bot = top === X[0] ? X[1] : X[0];
    var p = P().M(top[0], top[1]);
    arcThrough(p, A, 32, top, bot, 180); arcThrough(p, B, 32, bot, top, 0);
    return p.Z();
  })());
  add('plus-rounded', '角丸プラス', roundPoly([[-18, -50], [18, -50], [18, -18], [50, -18], [50, 18], [18, 18], [18, 50], [-18, 50],
    [-18, 18], [-50, 18], [-50, -18], [-18, -18]], [10, 10, 6, 10, 10, 6, 10, 10, 6, 10, 10, 6]));
  add('shards', '破片', join(poly([[0, 0], [40, 8], [22, 46]]), poly([[48, 0], [92, 20], [60, 34]]), poly([[34, 56], [80, 44], [70, 90], [40, 84]])));
  add('spiral', 'うずまき', band(function (t) { return pol(4 + 0.06 * t, t); }, 180, 1080, 180, 6));
  add('sunburst', '太陽の光線', (function () {
    var p = circle(0, 0, 22);
    for (var k = 0; k < 12; k++) {
      var a = k * 30;
      poly([pol(30, a - 3.8), pol(50, a - 4.6), pol(50, a + 4.6), pol(30, a + 3.8)], p);
    }
    return p;
  })());
  add('crescent-pair', '向かい合う三日月', join(crescentP([0, 0, 30], [14, 0, 27]), mirrorX(crescentP([0, 0, 30], [14, 0, 27])).move(64, 0)));
  add('scallop-band', 'スカラップの帯', (function () {
    var p = P().M(0, 50).L(0, 16);
    for (var k = 0; k < 5; k++) p.A(16 + 32 * k, 16, 16, 16, 180, 360);
    return p.L(160, 50).Z();
  })());
  add('rounded-triangle', '角丸三角', roundPoly([[50, 0], [100, 86.6], [0, 86.6]], 14));
  add('squircle', 'スクワークル', (function () {
    var pts = [];
    for (var i = 0; i < 48; i++) {
      var t = i * 7.5, c = cos(t), s = sin(t);
      pts.push([50 * Math.sign(c) * Math.sqrt(Math.abs(c)), 50 * Math.sign(s) * Math.sqrt(Math.abs(s))]);
    }
    return smoothClosed(pts);
  })());
  add('rainbow', '虹の帯', join([[50, 40], [34, 24], [18, 8]].map(function (r) {
    return P().A(0, 0, r[0], r[0], 180, 360).A(0, 0, r[1], r[1], 360, 180).Z();
  }).reduce(function (a, b) { return a.add(b); }, P())));

  return { version: 1, categories: categories };
})();
export default catalog;
