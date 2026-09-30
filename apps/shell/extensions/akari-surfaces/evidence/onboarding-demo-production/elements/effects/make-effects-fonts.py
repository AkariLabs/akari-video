# 断片 demo-effects に埋め込む書体の切り出し（使う文字だけ・別名・woff2）
# 使い方（公開リポのルートで）: python make-effects-fonts.py <出力ディレクトリ> [assets/font]
# 出力の *.b64 と *.range を build-effects-fragment.py が @font-face（data URI + unicode-range）に入れる
#
# 2026-10-01 目利きの差し戻しの直し: 札の文字を 22px/800 → 32px/900 に上げたので、Noto Sans JP の
# 静的体を wght 900 で切り出す。unicode-range を付けて、同じ家族名・同じ太さの別断片（demo-title 等）と
# 同じ文書に並んでも自分の字だけを受け持つ（他の断片と同じ作法）。
import sys, base64, io
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

OUT = sys.argv[1]
FONT_DIR = sys.argv[2] if len(sys.argv) > 2 else "assets/font"


def rename(font, family, style="Regular", ps=None):
    name = font["name"]
    ps = ps or (family.replace(" ", "") + "-" + style)
    for rec in list(name.names):
        nid = rec.nameID
        if nid in (1, 16):
            rec.string = family
        elif nid in (2, 17):
            rec.string = style
        elif nid == 3:
            rec.string = ps + ";subset;akari-demo"
        elif nid == 4:
            rec.string = family + " " + style if style != "Regular" else family
        elif nid == 6:
            rec.string = ps
        elif nid in (21, 22, 25):
            name.removeNames(nameID=nid)
    return font


def do_subset(font, text):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.name_IDs = ["*"]           # 著作権・ライセンス（0 / 13 / 14）を残す
    opts.name_languages = ["*"]
    opts.layout_features = ["*"]
    opts.hinting = False
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    font.recalcTimestamp = False  # head.modified を原本のまま保つ（出力をバイト単位で再現可能にする）
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    return buf.getvalue()


def unicode_range(text):
    cps = sorted({ord(c) for c in text})
    return ",".join(f"U+{cp:04X}" for cp in cps)


SANS_TEXT = "効果音エフェクト"
DISPLAY_TEXT = "パッ!"

# Noto Sans JP（可変）→ wght 900 の静的体 → 札の 8 文字
noto = TTFont(f"{FONT_DIR}/noto-sans-jp/NotoSansJP-Variable.ttf", recalcTimestamp=False)
noto = instancer.instantiateVariableFont(noto, {"wght": 900}, updateFontNames=False)
rename(noto, "AKARI Demo Sans", "Black", "AKARIDemoSans-Black")
sans = do_subset(noto, SANS_TEXT)

dela = TTFont(f"{FONT_DIR}/dela-gothic-one/DelaGothicOne-Regular.ttf", recalcTimestamp=False)
rename(dela, "AKARI Demo Display", "Regular", "AKARIDemoDisplay-Regular")
disp = do_subset(dela, DISPLAY_TEXT)

for label, data, text in (("sans", sans, SANS_TEXT), ("display", disp, DISPLAY_TEXT)):
    open(f"{OUT}/{label}.woff2", "wb").write(data)
    open(f"{OUT}/{label}.b64", "w").write(base64.b64encode(data).decode())
    open(f"{OUT}/{label}.range", "w").write(unicode_range(text))
    print(label, len(data), "bytes", len(base64.b64encode(data)), "b64", unicode_range(text))
