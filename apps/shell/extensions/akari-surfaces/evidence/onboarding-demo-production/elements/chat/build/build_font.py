# demo-chat 断片用のフォント切り出し。
# Noto Sans JP（可変・OFL）を wght で静的体にし、断片が使う文字だけ残して woff2 → base64 にする。
# family 名は別名 "AKARI Demo Sans"（OFL の Reserved Font Name 'Source' を名乗らない）。
import base64, io, json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

SRC = r"C:/Users/kyach/akari-wt/onboarding-demo-rich/assets/font/noto-sans-jp/NotoSansJP-Variable.ttf"
OUT_DIR = sys.argv[1]
TEXT = sys.argv[2]
WEIGHTS = [int(w) for w in sys.argv[3].split(",")]
FAMILY = "AKARI Demo Sans"

chars = sorted(set(TEXT) | {" "})
result = {}
for weight in WEIGHTS:
    font = TTFont(SRC)
    font = instancer.instantiateVariableFont(font, {"wght": weight}, updateFontNames=False)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["palt", "kern", "liga", "calt", "ccmp", "locl", "vert"]
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
    options.hinting = False
    options.desubroutinize = True
    sub = subset.Subsetter(options)
    sub.populate(text="".join(chars))
    sub.subset(font)
    style = {500: "Medium", 700: "Bold", 800: "ExtraBold", 900: "Black"}.get(weight, f"W{weight}")
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
            rec.string = f"AKARIDemoSans-{style};demo-chat subset"
    font.flavor = "woff2"
    buf = io.BytesIO()
    font.save(buf)
    data = buf.getvalue()
    cmap = TTFont(io.BytesIO(data))
    covered = cmap.getBestCmap()
    missing = [c for c in chars if ord(c) not in covered]
    with open(f"{OUT_DIR}/demo-chat-{weight}.woff2", "wb") as fh:
        fh.write(data)
    result[str(weight)] = {
        "bytes": len(data),
        "missing": missing,
        "b64": base64.b64encode(data).decode("ascii"),
    }

cps = sorted({ord(c) for c in chars})
ranges = []
for cp in cps:
    if ranges and cp == ranges[-1][1] + 1:
        ranges[-1][1] = cp
    else:
        ranges.append([cp, cp])
unicode_range = ",".join(
    f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in ranges
)
result["unicode_range"] = unicode_range
result["chars"] = "".join(chars)
with open(f"{OUT_DIR}/font.json", "w", encoding="utf-8") as fh:
    json.dump(result, fh, ensure_ascii=False)
print(json.dumps({k: (v if not isinstance(v, dict) else {"bytes": v["bytes"], "missing": v["missing"]}) for k, v in result.items()}, ensure_ascii=False))
