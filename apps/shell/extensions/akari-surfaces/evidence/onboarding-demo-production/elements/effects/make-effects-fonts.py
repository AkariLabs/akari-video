# 断片 demo-effects に埋め込む書体の切り出し（使う文字だけ・別名・woff2）
# 使い方（公開リポのルートで）: python make-effects-fonts.py <出力ディレクトリ> [assets/font]
# 出力の *.b64 を fragment.html の @font-face の data URI に入れる
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

# Noto Sans JP（可変）→ wght 800 の静的体 → 札の 8 文字
noto = TTFont(f"{FONT_DIR}/noto-sans-jp/NotoSansJP-Variable.ttf", recalcTimestamp=False)
noto = instancer.instantiateVariableFont(noto, {"wght": 800}, updateFontNames=False)
rename(noto, "AKARI Demo Sans", "ExtraBold", "AKARIDemoSans-ExtraBold")
sans = do_subset(noto, "効果音エフェクト")

dela = TTFont(f"{FONT_DIR}/dela-gothic-one/DelaGothicOne-Regular.ttf", recalcTimestamp=False)
rename(dela, "AKARI Demo Display", "Regular", "AKARIDemoDisplay-Regular")
disp = do_subset(dela, "パッ!")

for label, data in (("sans", sans), ("display", disp)):
    open(f"{OUT}/{label}.woff2", "wb").write(data)
    open(f"{OUT}/{label}.b64", "w").write(base64.b64encode(data).decode())
    print(label, len(data), "bytes", len(base64.b64encode(data)), "b64")
