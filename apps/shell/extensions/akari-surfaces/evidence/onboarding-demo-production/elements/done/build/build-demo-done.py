"""demo-done の断片（overlays/demo-done/fragment.html）を組み立て直す。

    python build-demo-done.py <公開リポのルート> [出力先 fragment.html]

- 書体: assets/font の Noto Sans JP（可変）を wght 900 の静的体にしてから、使う字（＋空白）だけを
  woff2 に切り出し、family 名を AKARI Demo Sans に改名する（OFL の Reserved Font Name 'Source' を
  名乗らない）。Dela Gothic One は「完了」（＋空白）だけ。著作権表示・許諾（name ID 0 / 13 / 14）は残す
- 判子の「完了」は、2 字を並べたときの墨の外形（字形の輪郭の最小・最大）の中心が円の中心（88, 88）に
  来るよう、text-anchor: middle の x と基線 y を書体の輪郭から計算して入れる
  （送り幅の中心で揃えると、Dela Gothic One は「完」が左へはみ出す分だけ墨が左へ寄る）
- 白フチ（text-shadow の輪）は半径 --done-halo の円周 32 点＋柔らかい影 8 点を生成する
- 声の波形は棒 5 本（幅 6・高さ WAVE_HEIGHTS・間隔 WAVE_GAP）の線を生成する
- 同じ入力なら同じバイト列になる（乱数・時刻を使わない）
"""
import base64, math, sys, tempfile
from pathlib import Path
from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(sys.argv[1])
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/demo-done/fragment.html"
HERE = Path(__file__).resolve().parent
FONTS = ROOT / "assets/font"
SANS, STAMP = " 喋ってるだけで編集は", " 完了"
STAMP_SIZE = 64          # 「完了」の文字サイズ（px。判子の viewBox 176 = 176px なので単位は同じ）
STAMP_C = 88             # 判子の円の中心（viewBox 内）
INNER_R = 77             # 内側の細い輪（2px）の半径。外の太い輪は r 84.5・線 7（外径 176）
HEAD_LEFT = 770          # 2 行目の左端。780 だと「は」の白フチと判子の輪の間が 5px しかない（実測）→ 10px 左へ
LEAD_LEFT = 770          # 1 行目の左端（マイクの左端 = 2 行目「編」の墨の左端 771 にそろう）
LEAD_WIDTH = 450         # 1 行目の幅（右端 1220 = 判子の輪の右端 1220 にそろう）
LEAD_GAP = 9             # マイク 32.4 ＋ 文字 358 ＋ 波形 42 ＋ 間隔 × 2 が幅 450 に収まる値
WAVE_HEIGHTS = [16, 30, 22, 36, 12]
WAVE_OFFSETS = ["0s", ".18s", ".09s", ".27s", ".13s"]
WAVE_REST = [".55", ".9", ".7", "1", ".62"]
WAVE_BAR, WAVE_GAP, WAVE_H = 6, 3, 36


def subset_woff2(font, text, family, style, out):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]   # palt を残す
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    s = subset.Subsetter(options=opts)
    s.populate(text=text)
    s.subset(font)
    ps = (family + "-" + style).replace(" ", "")
    for rec in font["name"].names:
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID in (2, 17):
            rec.string = style
        elif rec.nameID == 4:
            rec.string = family + " " + style
        elif rec.nameID == 6:
            rec.string = ps
        elif rec.nameID == 3:
            rec.string = ps + ";subset-demo-done"
    font.flavor = "woff2"
    font.recalcTimestamp = False   # head.modified を今の時刻で書き換えない（同じ入力 → 同じバイト列）
    font.save(out)
    return out.read_bytes()


def urange(text):
    return ", ".join("U+%04X" % c for c in sorted({ord(ch) for ch in text}))


def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    variable = FONTS / "noto-sans-jp/NotoSansJP-Variable.ttf"
    sans900 = subset_woff2(instancer.instantiateVariableFont(TTFont(variable), {"wght": 900}),
                           SANS, "AKARI Demo Sans", "Black", tmp / "s900.woff2")
    display = subset_woff2(TTFont(FONTS / "dela-gothic-one/DelaGothicOne-Regular.ttf"),
                           STAMP, "AKARI Demo Display", "Regular", tmp / "d.woff2")
    # 「完了」の墨の外形（送りを足しながら 2 字の輪郭の範囲を取る。GPOS に 2 字間の詰めは無い）
    df = TTFont(tmp / "d.woff2")
    upm = df["head"].unitsPerEm
    glyphs = df.getGlyphSet()
    cmap = df.getBestCmap()
    hmtx = df["hmtx"]
    pen_x = 0
    xmin = ymin = 1e9
    xmax = ymax = -1e9
    for ch in STAMP.strip():
        name = cmap[ord(ch)]
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        bx0, by0, bx1, by1 = pen.bounds
        xmin, xmax = min(xmin, pen_x + bx0), max(xmax, pen_x + bx1)
        ymin, ymax = min(ymin, by0), max(ymax, by1)
        pen_x += hmtx[name][0]
    scale = STAMP_SIZE / upm
    # text-anchor: middle は送り幅の中心（pen_x / 2）を x に置く。墨の中心との差だけ x をずらす
    text_x = round(STAMP_C + (pen_x / 2 - (xmin + xmax) / 2) * scale, 2)
    text_y = round(STAMP_C + (ymin + ymax) / 2 * scale, 2)
    ink_half_w = (xmax - xmin) / 2 * scale
    ink_half_h = (ymax - ymin) / 2 * scale

halo = []
for i in range(32):
    a = i * math.tau / 32
    halo.append(f"    calc(var(--done-halo, 9px) * {math.cos(a):.4f}) calc(var(--done-halo, 9px) * {math.sin(a):.4f}) 0 var(--done-halo-color, #FFFFFF)")
for i in range(8):
    a = i * math.tau / 8
    halo.append(f"    calc(var(--done-halo, 9px) * {math.cos(a):.4f}) calc(var(--done-halo, 9px) * {math.sin(a):.4f} + 4px) 14px var(--done-shadow-color, rgba(58, 38, 20, .085))")

wave_w = len(WAVE_HEIGHTS) * WAVE_BAR + (len(WAVE_HEIGHTS) - 1) * WAVE_GAP
bars = []
for i, (h, off, rest) in enumerate(zip(WAVE_HEIGHTS, WAVE_OFFSETS, WAVE_REST)):
    x = WAVE_BAR / 2 + i * (WAVE_BAR + WAVE_GAP)
    half = (h - WAVE_BAR) / 2          # 丸い端（半径 3）を足して高さ h になる線の半分の長さ
    bars.append(f'<line class="demo-done__bar" x1="{fmt(x)}" y1="{fmt(WAVE_H / 2 - half)}" x2="{fmt(x)}" y2="{fmt(WAVE_H / 2 + half)}" style="--bar-offset:{off};--bar-rest:{rest}"/>')
wave = "\n".join("        " + b for b in bars)

b64 = lambda data: base64.b64encode(data).decode()
html = ((HERE / "fragment.tpl.html").read_text(encoding="utf-8")
        .replace("{{SANS900}}", b64(sans900))
        .replace("{{DISPLAY}}", b64(display))
        .replace("{{SANS900_RANGE}}", urange(SANS))
        .replace("{{DISPLAY_RANGE}}", urange(STAMP))
        .replace("{{HALO_SHADOW}}", ",\n".join(halo))
        .replace("{{LEAD_GAP}}", str(LEAD_GAP))
        .replace("{{LEAD_LEFT}}", str(LEAD_LEFT))
        .replace("{{LEAD_WIDTH}}", str(LEAD_WIDTH))
        .replace("{{HEAD_LEFT}}", str(HEAD_LEFT))
        .replace("{{STAMP_SIZE}}", str(STAMP_SIZE))
        .replace("{{INNER_R}}", str(INNER_R))
        .replace("{{TEXT_X}}", fmt(text_x))
        .replace("{{TEXT_Y}}", fmt(text_y))
        .replace("{{WAVE_W}}", str(wave_w))
        .replace("{{WAVE_HALO}}", wave)
        .replace("{{WAVE_INK}}", wave))
assert "{{" not in html
OUT.write_text(html, encoding="utf-8", newline="\n")
corner = math.hypot(ink_half_w, ink_half_h)
print(OUT, len(html.encode()), "bytes", "text_x", text_x, "text_y", text_y,
      "ink half w/h", round(ink_half_w, 2), round(ink_half_h, 2),
      "inner edge", INNER_R - 1, "side gap", round(INNER_R - 1 - ink_half_w, 2), "corner r", round(corner, 2))
