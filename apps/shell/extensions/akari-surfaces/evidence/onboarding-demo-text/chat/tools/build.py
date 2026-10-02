# demo-chat 断片の組み立て（2026-10-01 文字の大きさの作り直し）。
#   python build.py <fragment.tpl.html> <out fragment.html> [<font source ttf>]
# 1) 雛形の本文（<style> と タグを除いた文字）から使う文字を集める
# 2) Noto Sans JP（可変・OFL 1.1）を wght 800 の静的体にし、その文字だけ残して woff2 → base64
#    family 名は別名 "AKARI Demo Sans"（OFL の Reserved Font Name 'Source' を名乗らない）。著作権表示と許諾は保持
# 3) 雛形の @@FONT800@@ / @@RANGE@@ を埋めて書き出す
import base64, io, json, re, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

TPL, OUT = sys.argv[1], sys.argv[2]
SRC = sys.argv[3] if len(sys.argv) > 3 else r"C:/Users/kyach/akari-wt/onboarding-demo-rich/assets/font/noto-sans-jp/NotoSansJP-Variable.ttf"
FAMILY = "AKARI Demo Sans"
WEIGHT = 800

tpl = open(TPL, encoding="utf-8").read()
body = re.sub(r"<style>.*?</style>", "", tpl, flags=re.S)
text = re.sub(r"<[^>]+>", "", body)
chars = sorted({c for c in text if not c.isspace()} | {" "})

font = TTFont(SRC)
font = instancer.instantiateVariableFont(font, {"wght": WEIGHT}, updateFontNames=False)
options = subset.Options()
options.flavor = "woff2"
options.layout_features = ["palt", "kern", "liga", "calt", "ccmp", "locl", "vert"]
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
options.hinting = False
options.desubroutinize = True
sub = subset.Subsetter(options)
sub.populate(text="".join(chars))
sub.subset(font)
style = "ExtraBold"
for rec in list(font["name"].names):
    if rec.nameID in (1, 16):
        rec.string = FAMILY
    elif rec.nameID in (2, 17):
        rec.string = style
    elif rec.nameID == 4:
        rec.string = f"{FAMILY} {style}"
    elif rec.nameID == 6:
        rec.string = f"AKARIDemoSans-{style}"
    elif rec.nameID == 3:
        rec.string = f"AKARIDemoSans-{style};demo-chat subset"
font.flavor = "woff2"
font.recalcTimestamp = False  # head.modified を元のまま残し、同じ入力なら同じバイト列にする
buf = io.BytesIO()
font.save(buf)
data = buf.getvalue()
covered = TTFont(io.BytesIO(data)).getBestCmap()
missing = [c for c in chars if ord(c) not in covered]
assert not missing, missing

cps = sorted({ord(c) for c in chars})
ranges = []
for cp in cps:
    if ranges and cp == ranges[-1][1] + 1:
        ranges[-1][1] = cp
    else:
        ranges.append([cp, cp])
unicode_range = ",".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in ranges)

out = tpl.replace("@@FONT800@@", base64.b64encode(data).decode("ascii")).replace("@@RANGE@@", unicode_range)
assert "@@" not in out
open(OUT, "w", encoding="utf-8", newline="\n").write(out)
print(json.dumps({"chars": "".join(chars), "woff2_bytes": len(data), "unicode_range": unicode_range,
                  "out_bytes": len(out.encode("utf-8")), "out": OUT}, ensure_ascii=False))
