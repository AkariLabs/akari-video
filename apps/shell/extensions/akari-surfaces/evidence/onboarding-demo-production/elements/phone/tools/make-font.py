# demo-phone の埋め込みフォント（AKARI Demo Sans 800）を作る（断片に入っているバイト列をそのまま再現する手順）。
# 元: assets/font/noto-sans-jp/NotoSansJP-Variable.ttf（OFL・RFN 'Source'）→ wght=800 の静的体 → 使う文字だけ → woff2。
# family 名は別名 "AKARI Demo Sans"（RFN を名乗らない）。著作権・ライセンスの name レコードは残す。
# 使い方: python make-font.py <公開リポ> <作業ディレクトリ>  → <作業>/demo-phone-800.b64（断片の data URI の中身）
import base64, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
repo, work = sys.argv[1], sys.argv[2]
TEXT = "AKARI Video@akari_video"
inst = instancer.instantiateVariableFont(TTFont(f"{repo}/assets/font/noto-sans-jp/NotoSansJP-Variable.ttf"), {"wght": 800})
for rec in inst["name"].names:
    if rec.nameID in (1, 4, 16):
        rec.string = "AKARI Demo Sans" if rec.nameID != 4 else "AKARI Demo Sans ExtraBold"
    if rec.nameID == 6:
        rec.string = "AKARIDemoSans-ExtraBold"
inst.save(os.path.join(work, "inst800.ttf"))
opts = subset.Options(); opts.flavor = "woff2"; opts.layout_features = ["kern", "palt"]; opts.name_IDs = ["*"]; opts.notdef_outline = True
ft = TTFont(os.path.join(work, "inst800.ttf"))
s = subset.Subsetter(opts); s.populate(text=TEXT); s.subset(ft)
ft.flavor = "woff2"; ft.save(os.path.join(work, "demo-phone-800.woff2"))
f = TTFont(os.path.join(work, "demo-phone-800.woff2"))
for r in list(f["name"].names):
    if r.nameID == 3: r.string = "2.004;AKARI;AKARIDemoSans-ExtraBold-subset"
    if r.nameID == 17: r.string = "ExtraBold"
    if r.nameID == 2: r.string = "Regular"
f["name"].names = [r for r in f["name"].names if r.nameID != 25]
f.flavor = "woff2"; f.save(os.path.join(work, "demo-phone-800.woff2"))
open(os.path.join(work, "demo-phone-800.b64"), "w").write(base64.b64encode(open(os.path.join(work, "demo-phone-800.woff2"), "rb").read()).decode())
print("unicode-range:", ",".join("U+%04X" % c for c in sorted(set(map(ord, TEXT)))))
