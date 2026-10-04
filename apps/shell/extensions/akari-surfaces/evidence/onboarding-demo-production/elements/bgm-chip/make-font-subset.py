# demo-bgm 断片用のフォント切り出し（BGM 札の「BGM」だけ）。
# Noto Sans JP（可変・SIL OFL 1.1）を wght 900 の静的体にし、使う文字だけ残して woff2 → base64。
# family 名は別名 "AKARI Demo Sans"（OFL の Reserved Font Name 'Source' を名乗らない）。
import base64, io, json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

SRC = r"<WORKTREE>/assets/font/noto-sans-jp/NotoSansJP-Variable.ttf"
OUT_DIR = sys.argv[1]
TEXT = sys.argv[2]
WEIGHT = int(sys.argv[3])
FAMILY = "AKARI Demo Sans"

chars = sorted(set(TEXT))
font = TTFont(SRC)
font = instancer.instantiateVariableFont(font, {"wght": WEIGHT}, updateFontNames=False)
options = subset.Options()
options.flavor = "woff2"
options.layout_features = ["palt", "kern", "liga", "calt", "ccmp", "locl"]
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
options.hinting = False
options.desubroutinize = True
sub = subset.Subsetter(options)
sub.populate(text="".join(chars))
sub.subset(font)
style = {700: "Bold", 800: "ExtraBold", 900: "Black"}.get(WEIGHT, f"W{WEIGHT}")
name = font["name"]
for rec in list(name.names):
    if rec.nameID in (1, 16):
        rec.string = FAMILY
    elif rec.nameID in (2, 17):
        rec.string = style
    elif rec.nameID == 4:
        rec.string = f"{FAMILY} {style}"
    elif rec.nameID == 6:
        rec.string = f"AKARIDemoSans-{style}"
    elif rec.nameID == 3:
        rec.string = f"AKARIDemoSans-{style};demo-bgm subset"
font.flavor = "woff2"
buf = io.BytesIO()
font.save(buf)
data = buf.getvalue()
check = TTFont(io.BytesIO(data))
covered = check.getBestCmap()
missing = [c for c in chars if ord(c) not in covered]
names = {r.nameID: str(r) for r in check["name"].names if r.platformID == 3}
open(f"{OUT_DIR}/demo-bgm-{WEIGHT}.woff2", "wb").write(data)
cps = sorted(ord(c) for c in chars)
ranges = []
for cp in cps:
    if ranges and cp == ranges[-1][1] + 1:
        ranges[-1][1] = cp
    else:
        ranges.append([cp, cp])
unicode_range = ",".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in ranges)
json.dump({"weight": WEIGHT, "bytes": len(data), "missing": missing, "chars": "".join(chars),
           "unicode_range": unicode_range, "b64": base64.b64encode(data).decode("ascii"),
           "names": names}, open(f"{OUT_DIR}/font.json", "w", encoding="utf-8"), ensure_ascii=False)
print(json.dumps({"bytes": len(data), "missing": missing, "unicode_range": unicode_range, "names": names}, ensure_ascii=False))
