"""demo-done の断片（overlays/demo-done/fragment.html）を組み立て直す。

    python build-demo-done.py <公開リポのルート> [出力先 fragment.html]

- 書体: assets/font の Noto Sans JP（可変）を wght 800 / 900 の静的体にしてから、使う字（＋空白）だけを
  woff2 に切り出し、family 名を AKARI Demo Sans に改名する（OFL の Reserved Font Name 'Source' を
  名乗らない）。Dela Gothic One は「完了」（＋空白）だけ。著作権表示・許諾（name ID 0 / 13 / 14）は残す
- 判子の「完了」の基線は、2 字の外形の上下中央が円の中心（82）に来る値を計算して入れる
- 白フチ（text-shadow の輪）は半径 --done-halo の円周 32 点＋柔らかい影 8 点を生成する
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
LEAD, HEAD, STAMP = " 喋ってるだけで", " 編集は", " 完了"
STAMP_SIZE = 70


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
    font.save(out)
    return out.read_bytes()


def urange(text):
    return ", ".join("U+%04X" % c for c in sorted({ord(ch) for ch in text}))


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    variable = FONTS / "noto-sans-jp/NotoSansJP-Variable.ttf"
    sans800 = subset_woff2(instancer.instantiateVariableFont(TTFont(variable), {"wght": 800}),
                           LEAD, "AKARI Demo Sans", "ExtraBold", tmp / "s800.woff2")
    sans900 = subset_woff2(instancer.instantiateVariableFont(TTFont(variable), {"wght": 900}),
                           HEAD, "AKARI Demo Sans", "Black", tmp / "s900.woff2")
    display = subset_woff2(TTFont(FONTS / "dela-gothic-one/DelaGothicOne-Regular.ttf"),
                           STAMP, "AKARI Demo Display", "Regular", tmp / "d.woff2")
    df = TTFont(tmp / "d.woff2")
    upm = df["head"].unitsPerEm
    glyphs = df.getGlyphSet()
    cmap = df.getBestCmap()
    ymin, ymax = 1e9, -1e9
    for ch in STAMP.strip():
        pen = BoundsPen(glyphs)
        glyphs[cmap[ord(ch)]].draw(pen)
        ymin, ymax = min(ymin, pen.bounds[1]), max(ymax, pen.bounds[3])
    text_y = round(82 + (ymin + ymax) / 2 / upm * STAMP_SIZE, 2)

halo = []
for i in range(32):
    a = i * math.tau / 32
    halo.append(f"    calc(var(--done-halo, 9px) * {math.cos(a):.4f}) calc(var(--done-halo, 9px) * {math.sin(a):.4f}) 0 var(--done-halo-color, #FFFFFF)")
for i in range(8):
    a = i * math.tau / 8
    halo.append(f"    calc(var(--done-halo, 9px) * {math.cos(a):.4f}) calc(var(--done-halo, 9px) * {math.sin(a):.4f} + 4px) 14px var(--done-shadow-color, rgba(58, 38, 20, .085))")

b64 = lambda data: base64.b64encode(data).decode()
html = ((HERE / "fragment.tpl.html").read_text(encoding="utf-8")
        .replace("{{SANS800}}", b64(sans800))
        .replace("{{SANS900}}", b64(sans900))
        .replace("{{DISPLAY}}", b64(display))
        .replace("{{SANS800_RANGE}}", urange(LEAD))
        .replace("{{SANS900_RANGE}}", urange(HEAD))
        .replace("{{DISPLAY_RANGE}}", urange(STAMP))
        .replace("{{HALO_SHADOW}}", ",\n".join(halo))
        .replace("{{TEXT_Y}}", f"{text_y}"))
assert "{{" not in html
OUT.write_text(html, encoding="utf-8", newline="\n")
print(OUT, len(html.encode()), "bytes", "text_y", text_y)
