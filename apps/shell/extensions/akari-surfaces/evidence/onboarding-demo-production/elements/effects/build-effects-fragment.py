# 断片 demo-effects（「効果音とか、エフェクトを、パッと。ほら、こんな感じで。」17.4667〜21.9667 s）を組み立てる。
# 使い方（公開リポのルートで）:
#   python make-effects-fonts.py <fonts>           # 書体を切り出す（*.b64 / *.range）
#   python build-effects-fragment.py <fonts> <出力 fragment.html>
# 乱数は使わない。紙吹雪の軌跡・擬音のコマごとの値はここで決まった式から計算して keyframes に書き出す
# （同じ入力なら同じバイト列）。境界（右の舞台・人物の届く範囲・字幕帯）は組み立て時に assert する。
import math
import sys

FONTS, OUT = sys.argv[1], sys.argv[2]
read = lambda name: open(f"{FONTS}/{name}", encoding="ascii").read().strip()

PA_X, PA_Y = 1005, 330          # 擬音「パッ!」の中心（--fx-pa-left / --fx-pa-top の既定）
FPS = 30


def f(v, nd=3):
    s = f"{v:.{nd}f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def pct(i, n):
    return f(100 * i / n, 3) + "%"


def in_stage(x, y, pad=0.0):
    """右の舞台（y<460 は x 720〜1240、y 460〜610 は x 830〜1240）に pad 込みで収まるか。"""
    if y - pad < 0 or y + pad > 610 or x + pad > 1240:
        return False
    lo = 720 if y + pad < 460 else 830
    return x - pad >= lo


# ── 擬音のポップ（19.70 から: .3 → 1.28 → .92 → 1、rotate −14°→−6°、揺れ 3 コマ）───────────
# delay は --fx-pa-at（2.20 = 語頭 2.2333 の 1 コマ前起点）。k は delay からのコマ（k=1 が 19.700）。
# 値はコマ位置に置き、線形でつなぐ（書き出しの各コマはこの表の値そのもの）。
# 縦（sy）は差し戻しの数値どおり 1.28 まで。横（sx）は 1.17 で止める: 静止時の擬音は幅 427px
# （x 787〜1214）あり、一様に 1.28 倍すると 547px で右の舞台（x 720〜1240・幅 520）に入らない。
# 横 1.17・縦 1.28 の「ボヨン」と伸びる形にして、同じコマで左へ 21px・上へ 7px 寄せて舞台に収める。
POP_FRAMES = 12
SX_PEAK, SY_PEAK = 1.17, 1.28
SHIFT_X, SHIFT_Y = -21, -7       # 横 1.17 のときの寄せ（途中は伸びに比例）
pop = []
for k in range(POP_FRAMES + 1):
    tau = (k - 1) / FPS
    if k == 0:
        s, op = 0.3, 0.0
    elif tau <= 0.1 + 1e-9:                  # .3 → 1.28（ease-out cubic・0.10 s）
        u = tau / 0.1
        s, op = 0.3 + 0.98 * (1 - (1 - u) ** 3), 1.0
    elif tau <= 0.2334:                      # 1.28 → .92（smoothstep・4 コマ）
        u = (tau - 0.1) / (0.2333 - 0.1)
        s, op = 1.28 - 0.36 * (u * u * (3 - 2 * u)), 1.0
    elif tau <= 0.3334:                      # .92 → 1（ease-out quad・3 コマ）
        u = min(1.0, (tau - 0.2333) / 0.1)
        s, op = 0.92 + 0.08 * (1 - (1 - u) ** 2), 1.0
    else:
        s, op = 1.0, 1.0
    sy = s
    sx = 1 + (s - 1) * (SX_PEAK - 1) / (SY_PEAK - 1) if s > 1 else s
    # 基準の傾き（--fx-pa-rotate、既定 −6°）への足し算: −8°（= −14°）から起きて、わずかに行き過ぎて戻る
    rot = {0: -8, 1: -8, 2: -4.5, 3: -1.8, 4: 0, 5: 1, 6: 1, 7: 0.5}.get(k, 0)
    # 最大 1.28 の直後 3 コマだけ ±6px で揺らす（0.10〜0.20 s）
    jx, jy = {5: (6, -3), 6: (-6, 3), 7: (5, -2)}.get(k, (0, 0))
    grow = max(0.0, (sx - 1) / (SX_PEAK - 1))
    tx, ty = jx + SHIFT_X * grow, jy + SHIFT_Y * grow
    pop.append((k, sx, sy, rot, tx, ty, op))

# ── 「ほら」の跳ね（擬音 1 → 1.15 → 1、0.25 s）: delay --fx-sparkle-at（3.05 = 語頭 3.0833 の 1 コマ前）──
# 基点は右寄り（64% 55%）: 静止時の右端 1214 から 1.15 倍しても舞台の右端 1240 を越えない
HIT = [1.0, 1.08, 1.14, 1.15, 1.12, 1.07, 1.03, 1.01, 1.0]

# ── キラッの放射（12 個・40〜72px・中心から半径 145 / 172 / 198px へ）──────────────────────
# 角度は右 0° 時計回り。人物側 120°〜150° には置かない（94° と 162° の間は空ける）
GLINT_FLY = {"near": 145, "mid": 172, "far": 198}
GLINTS = [  # (角度, 飛距離, 大きさ, 時間差 ms)
    (162, "far", 60, 0), (190, "far", 44, 17), (218, "mid", 72, 0), (246, "near", 46, 33),
    (272, "near", 50, 17), (298, "near", 42, 0), (324, "mid", 64, 33), (350, "mid", 48, 17),
    (16, "mid", 58, 0), (42, "mid", 44, 33), (68, "mid", 62, 17), (94, "near", 40, 0),
]
for a, fly, size, _ in GLINTS:
    assert not (115 <= a <= 155), a
    r = GLINT_FLY[fly]
    x, y = PA_X + r * math.cos(math.radians(a)), PA_Y + r * math.sin(math.radians(a))
    assert in_stage(x, y, size * 0.55), (a, x, y)

# ── 紙吹雪（16 枚・8〜12px の角丸長方形・橙と黄）────────────────────────────────────
# 擬音と同じ色の紙が擬音の上を舞っても見えないので、擬音の縁の少し内側（擬音の裏）から外へ弾けさせる:
#   上組 8 枚: 上の縁から弾け上がり、擬音の上の空き（y 164〜230）でひらひらして消える
#   下組 8 枚: 下の縁からこぼれ落ち、擬音の下の空いた壁（y 440〜545）へ舞い落ちる
# 軌跡は上 4 種・下 4 種 × 左右の鏡映。擬音の縁は静止時の実測（上 230〜282、下 364〜429）。
CF_DURATION = 0.9167  # 3.05 起点 + 時間差 ≤ 33ms → 21.47 までに消える
CF_STEPS = 14
CF_PATHS = {  # 上組 (横の距離, 上がる高さ, 最後の高さ（起点からの y）, 揺れ) / 下組 (横の距離, 落ちる距離, 0, 揺れ)
    "t1": (70, 88, -40, 8), "t2": (38, 100, -52, 10), "t3": (104, 70, -30, 7), "t4": (18, 94, -48, 10),
    "b1": (60, 120, 0, 10), "b2": (30, 150, 0, 12), "b3": (88, 100, 0, 8), "b4": (15, 135, 0, 10),
}
UP = 0.3  # 上組が頂点に届く割合（0.275 s）


def cf_point(path, u):
    dx, h, end, sway = CF_PATHS[path]
    x = dx * (1 - (1 - u) ** 2)
    if path.startswith("t"):
        if u <= UP:
            y = -h * (1 - (1 - u / UP) ** 2)
        else:
            v = (u - UP) / (1 - UP)
            y = -h + (h + end) * v ** 1.2
            x += sway * math.sin(2 * math.pi * 1.25 * v) * v
    else:
        y = h * u ** 1.25 - 26 * u * (1 - u) ** 3          # 一瞬だけ浮いてから落ちる
        x += sway * math.sin(2 * math.pi * 1.5 * u) * u
    return x, y


CF_SPIN = {  # (回る角度, ひらめく回数)
    "fast": (540, 2),
    "slow": (-320, 1.25),
}
CONFETTI = [  # (向き, 軌跡, 起点 x, 起点 y, 色, 幅, 高さ, 回り, 時間差 ms)
    (-1, "t1", 852, 294, "var(--demo-accent,#F97316)", 12, 8, "fast", 0),
    (-1, "t2", 905, 285, "var(--demo-spark,#FFD94A)", 11, 8, "slow", 17),
    (-1, "t3", 952, 254, "var(--demo-accent-soft,#FDBA74)", 12, 7, "fast", 33),
    (-1, "t4", 990, 262, "var(--demo-accent-hot,#FB923C)", 10, 8, "slow", 0),
    (1, "t4", 1030, 292, "var(--demo-spark,#FFD94A)", 12, 8, "fast", 17),
    (1, "t2", 1075, 282, "var(--demo-accent,#F97316)", 11, 7, "slow", 33),
    (1, "t3", 1100, 286, "var(--demo-accent-soft,#FDBA74)", 12, 8, "fast", 0),
    (1, "t4", 1165, 263, "var(--demo-spark,#FFD94A)", 10, 7, "slow", 17),
    (-1, "b4", 880, 394, "var(--demo-spark,#FFD94A)", 12, 8, "slow", 0),
    (-1, "b1", 945, 404, "var(--demo-accent,#F97316)", 11, 8, "fast", 33),
    (-1, "b3", 990, 378, "var(--demo-accent-hot,#FB923C)", 12, 7, "slow", 17),
    (1, "b2", 1010, 380, "var(--demo-spark,#FFD94A)", 10, 8, "fast", 0),
    (1, "b1", 1045, 393, "var(--demo-accent-soft,#FDBA74)", 12, 8, "slow", 33),
    (1, "b3", 1090, 378, "var(--demo-accent,#F97316)", 11, 7, "fast", 17),
    (1, "b1", 1150, 381, "var(--demo-spark,#FFD94A)", 12, 8, "slow", 0),
    (1, "b4", 1192, 378, "var(--demo-accent-hot,#FB923C)", 10, 8, "fast", 33),
]
for sign, path, x0, y0, _c, w, h, _s, _d in CONFETTI:
    for i in range(CF_STEPS + 1):
        x, y = cf_point(path, i / CF_STEPS)
        px, py = x0 + sign * x, y0 + y
        assert px - 8 >= 740, (x0, path, px)             # 舞台の中（x ≥ 740）
        assert in_stage(px, py, 8), (x0, path, px, py)
        assert py - 8 >= 160, (x0, path, py)             # 札（y 92〜156）の下で舞う

# ── CSS ───────────────────────────────────────────────────────────────────
EASE = {
    "smooth": "var(--ease-smooth, cubic-bezier(0.38, 0, 0.1, 1.1))",
    "slowdown": "var(--ease-slowdown, cubic-bezier(0.11, 0.86, 0.98, 0.9))",
    "overshoot": "var(--ease-overshoot, cubic-bezier(0.17, 3.75, 0, 0.74))",
    "overshoot-soft": "var(--ease-overshoot-soft, cubic-bezier(0.17, 2.21, 0.17, 0.97))",
    "accelerate": "var(--ease-accelerate, cubic-bezier(1, 0, 0.98, 0.8))",
    "hard-out": "var(--ease-hard-out, cubic-bezier(0, 0.61, 0, 1))",
    "linear": "var(--ease-linear, linear)",
}
AT = {
    "chip1": "var(--fx-chip1-at,0s)",
    "chip2": "var(--fx-chip2-at,1.2333s)",
    "pa": "var(--fx-pa-at,2.2s)",
    "hora": "var(--fx-sparkle-at,3.05s)",
    "check": "var(--fx-check-at,3.6s)",
    "exit": "var(--fx-exit-at,4.2333s)",
}
STAR = "M50 2C53.5 33 67 46.5 98 50 67 53.5 53.5 67 50 98 46.5 67 33 53.5 2 50 33 46.5 46.5 33 50 2Z"
STAR_SVG = (f'<svg viewBox="0 0 100 100"><path d="{STAR}" fill="var(--demo-spark,#FFD94A)" '
            f'stroke="var(--demo-accent,#F97316)" stroke-width="7" paint-order="stroke fill"/>'
            f'<path d="{STAR}" transform="translate(50 50) scale(.42) translate(-50 -50)" fill="#FFFFFF"/></svg>')

kf = []  # keyframes の文字列


def keyframes(name, steps):
    body = "".join(f"{p}{{{decl}}}" for p, decl in steps)
    kf.append(f"@keyframes demo-effects-{name}{{{body}}}")


keyframes("chip-pop", [("0%", "opacity:0;transform:scale(.6)"), ("100%", "opacity:1;transform:scale(1)")])
keyframes("sound-ring", [("0%", "opacity:.6;transform:scale(.4)"), ("100%", "opacity:0;transform:scale(1)")])
# ✦ は左上の外から 4 コマで回りながら札の中の定位置へ飛び込む（コマ位置に値を置いて線形）。
# 通ったコマの位置に軌跡のキラッ（TRAIL）が 1 つずつ残る
STAR_PATH = [(0, -44, -56, -160, 0.8), (1, -44, -56, -160, 0.9), (1, -24, -31, -95, 1.0),
             (1, -9, -12, -35, 1.12), (1, -2, -2, -8, 1.05), (1, 0, 0, 0, 1.0)]
keyframes("star-in", [(pct(i, len(STAR_PATH) - 1),
                       f"opacity:{op};transform:translate({x}px,{y}px) rotate({r}deg) scale({f(sc)})")
                      for i, (op, x, y, r, sc) in enumerate(STAR_PATH)])
keyframes("trail", [("0%", "opacity:0;transform:scale(.3) rotate(0deg)"),
                    ("12%", "opacity:1;transform:scale(1.1) rotate(15deg)"),
                    ("45%", "opacity:1;transform:scale(.9) rotate(45deg)"),
                    ("100%", "opacity:0;transform:scale(0) rotate(100deg)")])
keyframes("chip-bump", [("0%", "transform:translateY(0)"), ("40%", "transform:translateY(-6px)"),
                        ("100%", "transform:translateY(0)")])
keyframes("pa-pop", [(pct(k, POP_FRAMES),
                      f"opacity:{f(op)};transform:translate({f(tx, 1)}px,{f(ty, 1)}px) rotate({f(rot)}deg) scale({f(sx)},{f(sy)})")
                     for k, sx, sy, rot, tx, ty, op in pop])
keyframes("pa-hit", [(pct(i, len(HIT) - 1), f"transform:scale({f(v)})") for i, v in enumerate(HIT)])
keyframes("ray", [("0%", "opacity:0;transform:translateX(70px) scaleX(.2)"),
                  ("40%", "opacity:1;transform:translateX(120px) scaleX(1)"),
                  ("100%", "opacity:0;transform:translateX(190px) scaleX(.4)")])
keyframes("ring", [("0%", "opacity:0;transform:scale(.3)"), ("12%", "opacity:1;transform:scale(.75)"),
                   ("100%", "opacity:0;transform:scale(3)")])
for name, r in GLINT_FLY.items():
    keyframes(f"glint-fly-{name}", [("0%", "transform:translateX(50px)"), ("100%", f"transform:translateX({r}px)")])
# 飛び出した直後から大きく光り（外側で最大）、飛び切ってから縮んで消える
keyframes("glint", [("0%", "opacity:0;transform:scale(.2) rotate(0deg)"),
                    ("8%", "opacity:1;transform:scale(.95) rotate(10deg)"),
                    ("30%", "opacity:1;transform:scale(1.1) rotate(30deg)"),
                    ("55%", "opacity:1;transform:scale(1) rotate(50deg)"),
                    ("80%", "opacity:.8;transform:scale(.55) rotate(75deg)"),
                    ("100%", "opacity:0;transform:scale(0) rotate(95deg)")])
for name in CF_PATHS:
    keyframes(f"cf-path-{name}", [(pct(i, CF_STEPS), "transform:translate({}px,{}px)".format(
        *[f(v, 1) for v in cf_point(name, i / CF_STEPS)])) for i in range(CF_STEPS + 1)])
for name, (turn, flips) in CF_SPIN.items():
    steps = []
    for i in range(CF_STEPS + 1):
        u = i / CF_STEPS
        c = math.cos(2 * math.pi * flips * u)
        sy = math.copysign(max(0.3, abs(c)), c)
        op = 0 if i == 0 else (1 if u <= 0.72 else max(0.0, 1 - (u - 0.72) / 0.28))
        steps.append((pct(i, CF_STEPS), f"opacity:{f(op, 2)};transform:rotate({f(turn * u, 1)}deg) scaleY({f(sy, 2)})"))
    keyframes(f"cf-spin-{name}", steps)
keyframes("check", [("0%", "opacity:0;transform:scale(.2) rotate(-30deg)"), ("100%", "opacity:1;transform:scale(1) rotate(0deg)")])
keyframes("exit", [("0%", "opacity:1;transform:scale(1)"), ("100%", "opacity:0;transform:scale(.92)")])

A = "[data-akari-active] .demo-effects"
anim = [
    f"{A} .fx-chip--sound .fx-chip-pop{{animation:demo-effects-chip-pop .28s {EASE['overshoot-soft']} {AT['chip1']} both}}",
    f"{A} .fx-chip--effect .fx-chip-pop{{animation:demo-effects-chip-pop .28s {EASE['overshoot-soft']} {AT['chip2']} both}}",
    f"{A} .fx-sound-ring{{animation:demo-effects-sound-ring .4s {EASE['smooth']} calc({AT['chip1']} + var(--d)) forwards}}",
    f"{A} .fx-icon--spark .fx-star{{animation:demo-effects-star-in .1667s {EASE['linear']} {AT['chip2']} both}}",
    f"{A} .fx-trail-body{{animation:demo-effects-trail .45s {EASE['linear']} calc({AT['chip2']} + var(--d)) both}}",
    f"{A} .fx-chip-bump{{animation:demo-effects-chip-bump .2s {EASE['smooth']} {AT['pa']} both}}",
    f"{A} .fx-pa-pop{{animation:demo-effects-pa-pop .4s {EASE['linear']} {AT['pa']} both}}",
    f"{A} .fx-pa-hit{{animation:demo-effects-pa-hit .2667s {EASE['linear']} {AT['hora']} both}}",
    f"{A} .fx-ray-bar{{animation:demo-effects-ray .45s {EASE['slowdown']} {AT['pa']} both}}",
    f"{A} .fx-ring{{animation:demo-effects-ring .4s {EASE['slowdown']} {AT['pa']} both}}",
] + [
    f"{A} .fx-glint-fly--{name}{{animation:demo-effects-glint-fly-{name} .6s {EASE['hard-out']} calc({AT['hora']} + var(--d)) both}}"
    for name in GLINT_FLY
] + [
    f"{A} .fx-glint-body{{animation:demo-effects-glint .6s {EASE['linear']} calc({AT['hora']} + var(--d)) both}}",
] + [
    f"{A} .fx-cf-path--{name}{{animation:demo-effects-cf-path-{name} {f(CF_DURATION, 4)}s {EASE['linear']} calc({AT['hora']} + var(--d)) both}}"
    for name in CF_PATHS
] + [
    f"{A} .fx-cf-spin--{name}{{animation:demo-effects-cf-spin-{name} {f(CF_DURATION, 4)}s {EASE['linear']} calc({AT['hora']} + var(--d)) both}}"
    for name in CF_SPIN
] + [
    f"{A} .fx-check-pop{{animation:demo-effects-check .36s {EASE['overshoot']} calc({AT['check']} + var(--d)) both}}",
    f"{A} .fx-stage{{animation:demo-effects-exit .25s {EASE['accelerate']} {AT['exit']} forwards}}",
]

# ── DOM ───────────────────────────────────────────────────────────────────
RAYS = [(161.8, 110, "a"), (189.4, 70, "s"), (205.9, 96, "a"), (234.5, 62, "s"), (252.1, 104, "a"),
        (282.6, 76, "s"), (301.2, 90, "a"), (330.8, 60, "s"), (347.4, 108, "a"), (14.9, 72, "s"),
        (33.5, 98, "a"), (64.1, 66, "s"), (83.6, 100, "a"), (110.2, 80, "s")]
COL = {"a": "var(--demo-accent,#F97316)", "s": "var(--demo-spark,#FFD94A)"}
rays = "\n".join(
    f'    <i class="fx-ray" style="--a:{a}deg"><b class="fx-ray-bar" style="--l:{l}px;--c:{COL[c]}"></b></i>'
    for a, l, c in RAYS)
glints = "\n".join(
    f'    <i class="fx-glint" style="--a:{a}deg"><b class="fx-glint-fly fx-glint-fly--{fly}" style="--d:{d}ms">'
    f'<b class="fx-glint-up"><b class="fx-glint-body" style="--s:{s}px;--d:{d}ms">{STAR_SVG}</b></b></b></i>'
    for a, fly, s, d in GLINTS)
confetti = "\n".join(
    f'    <i class="fx-cf" style="left:{x0}px;top:{y0}px"><b class="fx-cf-mirror"{" data-flip" if sign < 0 else ""}>'
    f'<b class="fx-cf-path fx-cf-path--{path}" style="--d:{d}ms"><b class="fx-cf-spin fx-cf-spin--{spin}" style="--d:{d}ms">'
    f'<b class="fx-cf-paper" style="--w:{w}px;--h:{h}px;--c:{c}"></b></b></b></b></i>'
    for sign, path, x0, y0, c, w, h, spin, d in CONFETTI)
TRAIL = [(-44, -56, 22, 0), (-24, -31, 17, 33.3), (-9, -12, 13, 66.7)]  # ✦ の軌跡（中心からの相対・大きさ・時間差 ms）
trail = "\n".join(
    f'      <i class="fx-trail" style="--tx:{x}px;--ty:{y}px"><b class="fx-trail-body" style="--s:{s}px;--d:{d}ms">{STAR_SVG}</b></i>'
    for x, y, s, d in TRAIL)
CHECK_SVG = ('<svg viewBox="0 0 24 24"><path d="M6.6 12.4l3.6 3.6 7.4-7.6" fill="none" stroke="var(--demo-accent,#F97316)" '
             'stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>')
NOTE_SVG = ('<svg viewBox="0 0 30 30"><g fill="var(--demo-accent,#F97316)">'
            '<ellipse cx="11.2" cy="22.7" rx="7" ry="5.3" transform="rotate(-22 11.2 22.7)"/>'
            '<rect x="15.3" y="2" width="3.5" height="21" rx="1.2"/>'
            '<path d="M18.3 2.3c.4 3.3 2.7 4.7 5.2 6.2 2.5 1.6 4.2 3.9 3.3 7.5-.2.8-1.2.8-1.3 0-.4-2.8-2.4-4.6-7.2-5.3Z"/>'
            '</g></svg>')

css = f"""/*
 * demo-effects — 初回ガイドのお手本「効果音とか、エフェクトを、パッと。ほら、こんな感じで。」（17.4667〜21.9667 s）
 * edit.json: 段 demo-stage、at 524、duration 135。時刻はすべて断片内のローカル秒（先頭 = 0）。
 * 組み立て: evidence/onboarding-demo-production/elements/effects/build-effects-fragment.py（乱数なし・計算した値をそのまま書く）
 *   0.033  札「♪ 効果音」が弾んで出て、♪ から音の輪 2 本（48→120px）が広がる（語頭 17.50）   --fx-chip1-at
 *   1.267  札「✦ エフェクト」。✦ が左上の外から 4 コマで回って飛び込み、通った所にキラッ 3 個（語頭 18.74）
 *                                                                                              --fx-chip2-at（1 コマ前起点）
 *   2.233  擬音「パッ!」: 縦 .3 → 1.28（+0.10 s）→ .92（+0.23 s）→ 1（+0.33 s）、横は 1.17 で止めて縦に伸びる形
 *          （一様に 1.28 倍すると右の舞台の幅 520px を越えるため）、−14°→−6°、最大の直後 3 コマ ±6px の揺れ。
 *          放射線・衝撃の輪・札の跳ねも同じコマ（語頭 19.70）                                   --fx-pa-at（1 コマ前起点）
 *   3.083  「ほら」: 擬音が 1 → 1.15 → 1 で跳ね、キラッ 12 個（40〜72px）が半径 145〜198px へ放射、
 *          紙吹雪 16 枚が擬音の縁の裏から上下へ弾けて舞う（〜21.47）（語頭 20.55）
 *                                                                                              --fx-sparkle-at（3.05 起点）
 *   3.633  「こんな感じで」: 札 2 枚の右上に ✓ バッジが付く（2 枚目は +0.10 s）（語頭 21.10）   --fx-check-at（3.60 起点）
 *   4.233→4.483 抜け                                                                           --fx-exit-at
 * 人物側（右 0° 時計回り 120°〜150°・x < 720）にはキラッも紙吹雪も飛ばさない。紙吹雪は x ≥ 740。
 * 書体: 使う文字だけ切り出した OFL 書体を別名で埋め込み、unicode-range で自分の字だけを受け持つ
 *   （Noto Sans JP wght 900 → "AKARI Demo Sans"、Dela Gothic One → "AKARI Demo Display"。著作権と OFL の name は保持）
 * ツマミ（すべて var(--name, 既定値)。断片内では定義しない）:
 *   位置   --fx-chips-left / --fx-chip-top / --fx-chips-gap（札の並び）
 *          --fx-pa-left / --fx-pa-top（擬音の中心）/ --fx-pa-size / --fx-pa-rotate
 *   色     --demo-ink / --demo-accent / --demo-accent-hot / --demo-accent-soft / --demo-spark
 *          --demo-card / --demo-card-line / --demo-shadow
 *   時刻   --fx-chip1-at / --fx-chip2-at / --fx-pa-at / --fx-sparkle-at / --fx-check-at / --fx-exit-at
 */
@font-face{{font-family:"AKARI Demo Sans";font-weight:900;font-style:normal;font-display:block;src:url(data:font/woff2;base64,{read("sans.b64")}) format("woff2");unicode-range:{read("sans.range")}}}
@font-face{{font-family:"AKARI Demo Display";font-weight:400;font-style:normal;font-display:block;src:url(data:font/woff2;base64,{read("display.b64")}) format("woff2");unicode-range:{read("display.range")}}}
.demo-effects{{position:absolute;inset:0;isolation:isolate}}
.demo-effects,.demo-effects *,.demo-effects *::before,.demo-effects *::after{{box-sizing:border-box}}
.demo-effects .fx-stage{{position:absolute;inset:0;transform-origin:var(--fx-pa-left,{PA_X}px) var(--fx-pa-top,{PA_Y}px)}}

/* ── 札 2 枚（白いピル・高さ 64・32px/900。中身は左右同じ余白で札の中央） ───────────── */
.demo-effects .fx-chips{{position:absolute;left:var(--fx-chips-left,740px);top:var(--fx-chip-top,92px);display:flex;gap:var(--fx-chips-gap,12px);z-index:4}}
.demo-effects .fx-chip{{position:relative;flex:none;height:64px}}
.demo-effects .fx-chip-bump{{position:relative;height:100%}}
.demo-effects .fx-chip-pop{{display:flex;align-items:center;justify-content:center;gap:10px;height:100%;padding:0 26px 0 24px;
  border-radius:32px;background:var(--demo-card,rgba(255,255,255,.97));border:1px solid var(--demo-card-line,rgba(23,19,15,.07));
  box-shadow:var(--demo-shadow,0 18px 44px rgba(58,38,20,.22)),0 2px 5px rgba(58,38,20,.10);transform-origin:18% 50%;
  font:900 32px/1 "AKARI Demo Sans","Hiragino Sans","Yu Gothic UI","Yu Gothic","Meiryo",sans-serif;
  color:var(--demo-ink,#17130F);letter-spacing:.02em;white-space:nowrap}}
/* 弾みの基点: 札 1 は左端（舞台の左端 720 の外へ弾まない）、札 2 は ✦ の辺り（右端 1240 の外へ弾まない） */
.demo-effects .fx-chip--sound .fx-chip-pop{{transform-origin:5% 50%;padding:0 27px 0 23px}}
/* 左右の余白は描いた字形の実測で揃える（札 1: ♪ の左 29px・音 の右 29px、札 2: ✦ の左 30px・ト の右 30px） */
.demo-effects .fx-chip--effect .fx-chip-pop{{padding:0 24px 0 26px}}
.demo-effects .fx-label{{display:block;margin-right:-.02em}}
.demo-effects .fx-icon{{position:relative;flex:none;display:block;width:30px;height:30px}}
.demo-effects .fx-icon svg{{position:absolute;inset:0;width:100%;height:100%;overflow:visible}}
.demo-effects .fx-star{{position:absolute;inset:0}}
/* ♪ から広がる音の輪（札の上。♪ を中心に 48 → 120px） */
.demo-effects .fx-sound-ring{{position:absolute;left:39px;top:32px;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;
  border:5px solid var(--demo-accent,#F97316);opacity:0;z-index:2}}
/* ✦ の軌跡のキラッ（札の上） */
.demo-effects .fx-trail{{position:absolute;left:calc(42px + var(--tx));top:calc(32px + var(--ty));width:0;height:0;z-index:2}}
.demo-effects .fx-trail-body{{position:absolute;left:calc(var(--s) / -2);top:calc(var(--s) / -2);width:var(--s);height:var(--s);opacity:0}}
.demo-effects .fx-trail-body svg{{position:absolute;inset:0;width:100%;height:100%;overflow:visible}}
/* 「こんな感じで」の ✓ バッジ（白地＋橙の ✓・24px） */
.demo-effects .fx-check{{position:absolute;right:-8px;top:-10px;width:24px;height:24px;z-index:3}}
.demo-effects .fx-check-pop{{position:absolute;inset:0;border-radius:50%;background:#FFFFFF;border:2px solid var(--demo-accent,#F97316);
  box-shadow:0 3px 8px rgba(58,38,20,.28)}}
.demo-effects .fx-check-pop svg{{position:absolute;inset:-2px;width:24px;height:24px}}

/* ── 擬音「パッ!」（バラエティの文法: 白フチ → 墨の縁と厚み → 黄→橙のグラデ） ── */
.demo-effects .fx-pa{{position:absolute;left:var(--fx-pa-left,{PA_X}px);top:var(--fx-pa-top,{PA_Y}px);width:0;height:0;z-index:2}}
.demo-effects .fx-pa-tilt{{position:absolute;left:0;top:0;transform:translate(-50%,-50%) rotate(var(--fx-pa-rotate,-6deg))}}
.demo-effects .fx-pa-pop{{transform-origin:50% 55%}}
.demo-effects .fx-pa-hit{{transform-origin:64% 55%}}
.demo-effects .fx-pa-stack{{display:grid;width:max-content;white-space:nowrap;
  font:400 var(--fx-pa-size,168px)/1 "AKARI Demo Display","Hiragino Sans","Yu Gothic UI","Yu Gothic","Meiryo",sans-serif;
  letter-spacing:-.03em;padding:.06em .12em .1em}}
.demo-effects .fx-pa-stack>span{{grid-area:1/1;paint-order:stroke fill}}
.demo-effects .fx-pa-halo{{color:#FFFFFF;-webkit-text-stroke:.2em #FFFFFF;
  text-shadow:0 .054em 0 #FFFFFF,0 .095em .167em rgba(58,38,20,.38)}}
.demo-effects .fx-pa-depth{{color:var(--demo-ink,#17130F);-webkit-text-stroke:.107em var(--demo-ink,#17130F);
  text-shadow:0 .048em 0 var(--demo-ink,#17130F)}}
.demo-effects .fx-pa-face{{color:transparent;
  background:linear-gradient(180deg,#FFE879 0%,var(--demo-spark,#FFD94A) 34%,var(--demo-accent-hot,#FB923C) 70%,var(--demo-accent,#F97316) 100%);
  -webkit-background-clip:text;background-clip:text}}

/* ── 放射線 14 本と衝撃の輪（擬音の中心から。右 0° 時計回り 120〜150° は人物側なので置かない） ── */
.demo-effects .fx-burst{{position:absolute;left:var(--fx-pa-left,{PA_X}px);top:var(--fx-pa-top,{PA_Y}px);width:0;height:0;z-index:1}}
.demo-effects .fx-ray{{position:absolute;left:0;top:0;width:0;height:0;transform:rotate(var(--a))}}
.demo-effects .fx-ray-bar{{position:absolute;left:0;top:-3.5px;width:var(--l);height:7px;border-radius:3.5px;
  background:var(--c);box-shadow:0 0 0 2.5px var(--demo-ink,#17130F);transform-origin:0 50%;opacity:0}}
.demo-effects .fx-ring{{position:absolute;left:-60px;top:-60px;width:120px;height:120px;border-radius:50%;
  border:6px solid var(--demo-spark,#FFD94A);box-shadow:0 0 0 2px var(--demo-ink,#17130F),inset 0 0 0 2px var(--demo-ink,#17130F);opacity:0}}

/* ── 紙吹雪 16 枚（擬音の縁の裏から外へ弾ける。左へ飛ぶ分は静的な鏡映 scaleX(-1)） ── */
.demo-effects .fx-confetti{{position:absolute;inset:0;z-index:1}}
.demo-effects .fx-cf{{position:absolute;width:0;height:0}}
.demo-effects .fx-cf-mirror,.demo-effects .fx-cf-path,.demo-effects .fx-cf-spin{{position:absolute;left:0;top:0;width:0;height:0}}
.demo-effects .fx-cf-mirror[data-flip]{{transform:scaleX(-1)}}
.demo-effects .fx-cf-spin{{opacity:0}}
.demo-effects .fx-cf-paper{{position:absolute;left:calc(var(--w) / -2);top:calc(var(--h) / -2);width:var(--w);height:var(--h);
  border-radius:2px;background:var(--c)}}

/* ── キラッ 12 個（4 芒星・黄に白い芯。擬音の中心から放射状に飛ぶ） ── */
.demo-effects .fx-glints{{position:absolute;left:var(--fx-pa-left,{PA_X}px);top:var(--fx-pa-top,{PA_Y}px);width:0;height:0;z-index:3}}
.demo-effects .fx-glint{{position:absolute;left:0;top:0;width:0;height:0;transform:rotate(var(--a))}}
.demo-effects .fx-glint-fly{{position:absolute;left:0;top:0;width:0;height:0}}
.demo-effects .fx-glint-up{{position:absolute;left:0;top:0;width:0;height:0;transform:rotate(calc(var(--a) * -1))}}
.demo-effects .fx-glint-body{{position:absolute;left:calc(var(--s) / -2);top:calc(var(--s) / -2);width:var(--s);height:var(--s);opacity:0}}
.demo-effects .fx-glint-body::before{{content:"";position:absolute;inset:-30%;border-radius:50%;
  background:radial-gradient(circle,rgba(255,246,210,.9) 0,rgba(255,217,74,.4) 32%,rgba(255,217,74,0) 68%)}}
.demo-effects .fx-glint-body svg{{position:absolute;inset:0;width:100%;height:100%;overflow:visible}}

/* ── 動き（[data-akari-active] ゲート内。delay はローカル秒の変数） ── */
""" + "\n".join(anim) + "\n\n" + "\n".join(kf) + "\n"

html = f"""<div class="demo-effects" lang="ja">
<style>
{css}</style>
<div class="fx-stage">
  <div class="fx-burst" aria-hidden="true">
{rays}
    <i class="fx-ring"></i>
  </div>
  <div class="fx-confetti" aria-hidden="true">
{confetti}
  </div>
  <div class="fx-pa">
    <div class="fx-pa-tilt"><div class="fx-pa-hit"><div class="fx-pa-pop">
      <div class="fx-pa-stack">
        <span class="fx-pa-halo" data-mirror="text">パッ!</span>
        <span class="fx-pa-depth" data-mirror="text">パッ!</span>
        <span class="fx-pa-face">パッ!</span>
      </div>
    </div></div></div>
  </div>
  <div class="fx-glints" aria-hidden="true">
{glints}
  </div>
  <div class="fx-chips">
    <div class="fx-chip fx-chip--sound">
      <div class="fx-chip-bump"><div class="fx-chip-pop">
        <span class="fx-icon fx-icon--note" aria-hidden="true">{NOTE_SVG}</span>
        <span class="fx-label">効果音</span>
      </div></div>
      <i class="fx-sound-ring" aria-hidden="true" style="--d:.0333s"></i>
      <i class="fx-sound-ring" aria-hidden="true" style="--d:.1667s"></i>
      <i class="fx-check" aria-hidden="true"><b class="fx-check-pop" style="--d:0s">{CHECK_SVG}</b></i>
    </div>
    <div class="fx-chip fx-chip--effect">
      <div class="fx-chip-bump"><div class="fx-chip-pop">
        <span class="fx-icon fx-icon--spark" aria-hidden="true"><b class="fx-star"><svg viewBox="0 0 100 100"><path d="{STAR}" fill="var(--demo-accent,#F97316)"/></svg></b></span>
        <span class="fx-label">エフェクト</span>
      </div></div>
{trail}
      <i class="fx-check" aria-hidden="true"><b class="fx-check-pop" style="--d:.1s">{CHECK_SVG}</b></i>
    </div>
  </div>
</div>
</div>
"""
open(OUT, "w", encoding="utf-8", newline="\n").write(html)
print(OUT, len(html.encode("utf-8")), "bytes")
